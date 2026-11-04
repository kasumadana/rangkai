import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { documents, events, memberships } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import {
	ALLOWED_MIME_TYPES,
	checkUploadRateLimit,
	detectMimeTypeFromMagicBytes,
	MAX_DOCUMENT_SIZE_BYTES,
	sanitizeFilename,
} from "../validators/documents";

export const documentsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

documentsRouter.use("*", requireAuth);

// Helper: Assert current user is an organizer in the event's organization
async function assertOrganizerForEvent(
	c: Parameters<typeof sendError>[0],
	eventId: string,
	userId: string,
) {
	const db = c.get("db");
	const eventRows = await db
		.select()
		.from(events)
		.where(eq(events.id, eventId))
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return { error: sendError(c, "NOT_FOUND", "Event not found.", 404) };
	}

	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, event.organizationId),
				eq(memberships.userId, userId),
			),
		)
		.limit(1);

	const membership = memberRows[0];
	if (!membership || membership.role !== "organizer") {
		return {
			error: sendError(
				c,
				"FORBIDDEN",
				"Organizer permission required for this event.",
				403,
			),
		};
	}

	return { event };
}

// POST /api/events/:eventId/documents - Upload source document
documentsRouter.post("/:eventId/documents", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;
	const event = check.event;

	// Respect lifecycle invariants
	if (event.status === "completed" || event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot upload documents to an event in terminal status: ${event.status}.`,
			409,
		);
	}
	if (event.status === "published" || event.status === "active") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Documents can only be uploaded prior to publication. Current status: ${event.status}.`,
			409,
		);
	}

	// Rate limiting per user
	if (!checkUploadRateLimit(currentUser.id)) {
		return sendError(
			c,
			"RATE_LIMITED",
			"Upload rate limit exceeded. Please wait before uploading again.",
			429,
		);
	}

	// Parse multipart
	let formData: FormData;
	try {
		formData = await c.req.formData();
	} catch {
		return sendError(c, "BAD_REQUEST", "Malformed multipart form data.", 400);
	}

	const file = formData.get("file");
	if (
		!file ||
		typeof file === "string" ||
		!(file instanceof File || (typeof file === "object" && "arrayBuffer" in file))
	) {
		return sendError(
			c,
			"BAD_REQUEST",
			"File is required in the 'file' multipart field.",
			400,
		);
	}

	if (file.size === 0) {
		return sendError(c, "BAD_REQUEST", "Uploaded file cannot be empty.", 400);
	}

	if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
		return sendError(
			c,
			"FILE_TOO_LARGE",
			`File exceeds maximum permitted size of ${MAX_DOCUMENT_SIZE_BYTES} bytes (8 MB).`,
			413,
		);
	}

	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	if (bytes.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
		return sendError(
			c,
			"FILE_TOO_LARGE",
			`File exceeds maximum permitted size of ${MAX_DOCUMENT_SIZE_BYTES} bytes (8 MB).`,
			413,
		);
	}

	const detectedMime = detectMimeTypeFromMagicBytes(bytes);
	if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
		return sendError(
			c,
			"BAD_REQUEST",
			"Unsupported file type or invalid signature. Permitted types: JPEG, PNG, PDF.",
			400,
		);
	}

	// Claimed MIME type check if present
	if (
		file.type &&
		file.type !== detectedMime &&
		!(file.type === "image/jpg" && detectedMime === "image/jpeg")
	) {
		return sendError(
			c,
			"BAD_REQUEST",
			"Claimed Content-Type does not match inspected file signature.",
			400,
		);
	}

	// Check R2 binding
	const r2 = c.env?.rangkai_documents_dev;
	if (!r2) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Document storage service is unavailable.",
			503,
		);
	}

	const ext =
		detectedMime === "application/pdf"
			? "pdf"
			: detectedMime === "image/png"
				? "png"
				: "jpg";
	const docId = crypto.randomUUID();
	const r2Key = `events/${eventId}/${docId}.${ext}`;
	const originalName = sanitizeFilename(file.name || `document.${ext}`);

	// Write to R2
	try {
		await r2.put(r2Key, buffer, {
			httpMetadata: { contentType: detectedMime },
			customMetadata: {
				eventId,
				uploadedBy: currentUser.id,
				originalName,
			},
		});
	} catch {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Failed to store document in storage service.",
			503,
		);
	}

	// Atomic DB insert + audit log + invalidate review if in review status
	const db = c.get("db");
	const auditId = crypto.randomUUID();
	const now = new Date();

	const query = sql`
		WITH inserted AS (
			INSERT INTO documents (
				id, event_id, uploaded_by, r2_key, original_name, mime_type, size_bytes, visibility, created_at
			)
			VALUES (
				${docId}, ${eventId}, ${currentUser.id}, ${r2Key}, ${originalName}, ${detectedMime}, ${bytes.byteLength}, 'private', ${now}
			)
			RETURNING *
		),
		updated_event AS (
			UPDATE events
			SET status = 'draft', verified_by = NULL, verified_at = NULL, updated_at = ${now}
			WHERE id = ${eventId} AND status = 'review'
			RETURNING id
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${event.organizationId}, ${eventId}, ${currentUser.id}, 'document.uploaded', 'document', id, null,
				json_build_object(
					'documentId', id,
					'originalName', original_name,
					'mimeType', mime_type,
					'sizeBytes', size_bytes
				),
				${now}
			FROM inserted
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			original_name AS "originalName",
			mime_type AS "mimeType",
			size_bytes AS "sizeBytes",
			created_at AS "createdAt"
		FROM inserted;
	`;

	try {
		const res = await db.execute(query);
		const row = res.rows[0];
		return c.json(
			{
				document: {
					id: row.id as string,
					eventId: row.eventId as string,
					originalName: row.originalName as string,
					mimeType: row.mimeType as string,
					sizeBytes: Number(row.sizeBytes),
					createdAt: new Date(row.createdAt as string),
				},
			},
			201,
		);
	} catch {
		// Compensation: delete object from R2 on DB failure
		await r2.delete(r2Key).catch(() => {});
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Failed to persist document record in database.",
			503,
		);
	}
});

// GET /api/events/:eventId/documents - List documents for event (Organizer only)
documentsRouter.get("/:eventId/documents", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const db = c.get("db");
	const docRows = await db
		.select({
			id: documents.id,
			eventId: documents.eventId,
			originalName: documents.originalName,
			mimeType: documents.mimeType,
			sizeBytes: documents.sizeBytes,
			createdAt: documents.createdAt,
		})
		.from(documents)
		.where(eq(documents.eventId, eventId));

	return c.json({ documents: docRows }, 200);
});

// GET /api/events/:eventId/documents/:documentId - Controlled private document retrieval (Organizer only)
documentsRouter.get("/:eventId/documents/:documentId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
	const documentId = c.req.param("documentId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	const docIdValidation = uuidParamSchema.safeParse(documentId);
	if (!idValidation.success || !docIdValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const db = c.get("db");
	const docRows = await db
		.select()
		.from(documents)
		.where(
			and(eq(documents.id, documentId), eq(documents.eventId, eventId)),
		)
		.limit(1);

	const doc = docRows[0];
	if (!doc) {
		return sendError(c, "NOT_FOUND", "Document not found.", 404);
	}

	const r2 = c.env?.rangkai_documents_dev;
	if (!r2) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Document storage service is unavailable.",
			503,
		);
	}

	const object = await r2.get(doc.r2Key);
	if (!object) {
		return sendError(c, "NOT_FOUND", "Document content not found.", 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Cache-Control", "private, no-store");
	headers.set("Content-Type", doc.mimeType);

	return new Response(object.body, { headers });
});
