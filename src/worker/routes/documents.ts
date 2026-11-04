import crypto from "node:crypto";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { documents, events, memberships } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import {
	ALLOWED_DOCUMENT_EXTENSIONS,
	ALLOWED_DOCUMENT_MIME_TYPES,
	checkUploadRateLimit,
	detectMimeTypeFromMagicBytes,
	MAX_DOCUMENT_SIZE_BYTES,
	readBoundedRequestBody,
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

	// 1. Content-Length pre-check
	const contentLengthHeader = c.req.header("content-length");
	if (contentLengthHeader) {
		const cl = parseInt(contentLengthHeader, 10);
		if (!isNaN(cl) && cl > MAX_DOCUMENT_SIZE_BYTES + 65536) {
			return sendError(
				c,
				"FILE_TOO_LARGE",
				`Upload exceeds maximum permitted size of ${MAX_DOCUMENT_SIZE_BYTES} bytes (8 MB).`,
				413,
			);
		}
	}

	// 2. Stream-bound request body before full buffering
	const bounded = await readBoundedRequestBody(c.req.raw, MAX_DOCUMENT_SIZE_BYTES + 65536);
	if (bounded.error === "FILE_TOO_LARGE") {
		return sendError(
			c,
			"FILE_TOO_LARGE",
			`Upload exceeds maximum permitted size of ${MAX_DOCUMENT_SIZE_BYTES} bytes (8 MB).`,
			413,
		);
	}

	// 3. Parse bounded multipart form data
	let formData: FormData;
	try {
		const boundedReq = new Request(c.req.raw.url, {
			method: c.req.raw.method,
			headers: c.req.raw.headers,
			body: bounded.buffer,
		});
		formData = await boundedReq.formData();
	} catch {
		return sendError(c, "BAD_REQUEST", "Malformed multipart form data.", 400);
	}

	// 4. Enforce exactly one file in the multipart payload
	let fileCount = 0;
	let uploadedFile: File | null = null;
	for (const [key, value] of formData.entries()) {
		if (
			value instanceof File ||
			(typeof value === "object" && value !== null && "arrayBuffer" in value)
		) {
			fileCount++;
			if (key === "file" && !uploadedFile) {
				uploadedFile = value as File;
			}
		}
	}

	if (fileCount !== 1 || !uploadedFile) {
		return sendError(
			c,
			"BAD_REQUEST",
			"Exactly one file must be provided in the 'file' multipart field.",
			400,
		);
	}

	if (uploadedFile.size === 0) {
		return sendError(c, "BAD_REQUEST", "Uploaded file cannot be empty.", 400);
	}

	if (uploadedFile.size > MAX_DOCUMENT_SIZE_BYTES) {
		return sendError(
			c,
			"FILE_TOO_LARGE",
			`File exceeds maximum permitted size of ${MAX_DOCUMENT_SIZE_BYTES} bytes (8 MB).`,
			413,
		);
	}

	// 5. Allowed extension check
	const originalName = sanitizeFilename(uploadedFile.name || "document");
	const ext = path.extname(originalName).toLowerCase();
	if (!ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
		return sendError(
			c,
			"BAD_REQUEST",
			`File extension '${ext}' is not permitted. Permitted extensions: .jpg, .jpeg, .png, .pdf.`,
			400,
		);
	}

	const buffer = await uploadedFile.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	if (bytes.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
		return sendError(
			c,
			"FILE_TOO_LARGE",
			`File exceeds maximum permitted size of ${MAX_DOCUMENT_SIZE_BYTES} bytes (8 MB).`,
			413,
		);
	}

	// 6. Magic bytes signature check
	const detectedMime = detectMimeTypeFromMagicBytes(bytes);
	if (!detectedMime || !ALLOWED_DOCUMENT_MIME_TYPES.has(detectedMime)) {
		return sendError(
			c,
			"BAD_REQUEST",
			"Unsupported file type or invalid signature. Permitted types: JPEG, PNG, PDF.",
			400,
		);
	}

	// 7. Claimed MIME type vs signature check
	if (
		uploadedFile.type &&
		uploadedFile.type !== detectedMime &&
		!(uploadedFile.type === "image/jpg" && detectedMime === "image/jpeg")
	) {
		return sendError(
			c,
			"BAD_REQUEST",
			"Claimed Content-Type does not match inspected file signature.",
			400,
		);
	}

	// 8. Put object to private R2 storage
	const r2 = c.env?.rangkai_documents_dev;
	if (!r2) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Document storage service is unavailable.",
			503,
		);
	}

	const docId = crypto.randomUUID();
	const r2Key = `events/${eventId}/documents/${docId}`;

	try {
		await r2.put(r2Key, buffer, {
			httpMetadata: {
				contentType: detectedMime,
			},
			customMetadata: {
				eventId,
				documentId: docId,
				uploadedBy: currentUser.id,
				originalName,
				uploadedAt: new Date().toISOString(),
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

	// 9. Atomic DB insert + authoritative state check + audit log + invalidate review if in review status
	const db = c.get("db");
	const auditId = crypto.randomUUID();
	const now = new Date();

	try {
		const query = sql`
			WITH checked_event AS (
				SELECT e.id, e.organization_id
				FROM events e
				JOIN memberships m ON m.organization_id = e.organization_id
				WHERE e.id = ${eventId}
				  AND e.status IN ('draft', 'review')
				  AND m.user_id = ${currentUser.id}
				  AND m.role = 'organizer'
				FOR UPDATE OF e
			),
			inserted AS (
				INSERT INTO documents (
					id, event_id, uploaded_by, r2_key, original_name, mime_type, size_bytes, visibility, created_at
				)
				SELECT
					${docId}, ce.id, ${currentUser.id}, ${r2Key}, ${originalName}, ${detectedMime}, ${bytes.byteLength}, 'private', ${now}
				FROM checked_event ce
				RETURNING *
			),
			updated_event AS (
				UPDATE events
				SET status = 'draft', verified_by = NULL, verified_at = NULL, updated_at = ${now}
				FROM checked_event ce
				WHERE events.id = ce.id AND events.status = 'review'
				RETURNING events.id
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId}, ce.organization_id, ${eventId}, ${currentUser.id}, 'document.uploaded', 'document', i.id, null,
					json_build_object(
						'documentId', i.id,
						'originalName', i.original_name,
						'mimeType', i.mime_type,
						'sizeBytes', i.size_bytes
					),
					${now}
				FROM inserted i
				JOIN checked_event ce ON ce.id = i.event_id
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

		const res = await db.execute(query);
		const row = res.rows[0];

		if (!row) {
			// Winning mutation check failed (event was published or organizer role revoked)
			let compensationSuccess = true;
			try {
				await r2.delete(r2Key);
			} catch (compErr) {
				compensationSuccess = false;
				console.error("COMPENSATION_FAILURE: R2 orphan object requires manual reconciliation", {
					documentId: docId,
					eventId,
					error: compErr instanceof Error ? compErr.message : String(compErr),
				});
			}

			if (!compensationSuccess) {
				return sendError(
					c,
					"DEPENDENCY_UNAVAILABLE",
					"Event state conflict occurred and storage cleanup requires manual reconciliation.",
					503,
				);
			}

			return sendError(
				c,
				"STATE_CONFLICT",
				"Event is no longer in draft or review status, or organizer authorization was changed.",
				409,
			);
		}

		return c.json(
			{
				document: {
					id: row.id as string,
					eventId: row.eventId as string,
					originalName: row.originalName as string,
					mimeType: row.mimeType as string,
					sizeBytes: Number(row.sizeBytes),
					createdAt:
						row.createdAt instanceof Date
							? row.createdAt.toISOString()
							: (row.createdAt as string),
				},
			},
			201,
		);
	} catch {
		// Compensation: delete object from R2 on DB failure
		let compensationSuccess = true;
		try {
			await r2.delete(r2Key);
		} catch (compErr) {
			compensationSuccess = false;
			console.error("COMPENSATION_FAILURE: R2 orphan document requires manual reconciliation", {
				documentId: docId,
				eventId,
				error: compErr instanceof Error ? compErr.message : String(compErr),
			});
		}

		if (!compensationSuccess) {
			return sendError(
				c,
				"DEPENDENCY_UNAVAILABLE",
				"Failed to persist document in database and storage cleanup failed. Manual reconciliation required.",
				503,
			);
		}

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
