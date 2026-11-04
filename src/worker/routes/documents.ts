import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { documents, events } from "../../db/schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import {
	ALLOWED_DOCUMENT_MIME_TYPES,
	MAX_DOCUMENT_SIZE_BYTES,
	MAX_MULTIPART_ENVELOPE_OVERHEAD_BYTES,
	buildPrivateDocumentR2Key,
	checkUploadRateLimit,
	detectMimeFromMagicBytes,
	doesExtensionMatchMime,
	sanitizeDocumentFilename,
	validateBinaryFormatStructure,
} from "../validators/documents";
import { uuidParamSchema } from "../validators/events";

const documentsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

documentsRouter.use("*", requireAuth);

/**
 * Reads request body stream up to maxBytes + 1 to enforce a hard size limit
 * before buffering an entire arbitrarily large payload into memory.
 */
async function readBoundedRequestBody(
	req: Request,
	maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; tooLarge: true }> {
	if (!req.body) {
		return { ok: true, bytes: new Uint8Array(0) };
	}

	const reader = req.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				totalBytes += value.byteLength;
				if (totalBytes > maxBytes) {
					await reader.cancel().catch(() => {});
					return { ok: false, tooLarge: true };
				}
				chunks.push(value);
			}
		}
	} finally {
		reader.releaseLock();
	}

	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return { ok: true, bytes: combined };
}

/**
 * POST /api/events/:eventId/documents
 * Upload a private source document (PDF, JPEG, PNG <= 8 MB) to Cloudflare R2
 * and atomically record metadata + audit log in PostgreSQL.
 */
documentsRouter.post("/:eventId/documents", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		const exists = await db
			.select({ id: events.id })
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);
		if (exists.length > 0) {
			return sendError(
				c,
				"FORBIDDEN",
				"Organizer permission required to upload event documents.",
				403,
			);
		}
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to upload event documents.",
			403,
		);
	}

	const event = access.event;

	if (event.status !== "draft" && event.status !== "review") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Documents can only be uploaded while an event is in draft or review status (current: ${event.status}).`,
			409,
		);
	}

	if (!checkUploadRateLimit(currentUser.id)) {
		return sendError(
			c,
			"RATE_LIMITED",
			"Upload rate limit exceeded (max 10 uploads per 10 minutes). Please wait before uploading again.",
			429,
		);
	}

	const contentType = c.req.header("content-type") || "";
	if (!contentType.toLowerCase().includes("multipart/form-data")) {
		return sendError(
			c,
			"BAD_REQUEST",
			"Document upload requires multipart/form-data Content-Type.",
			400,
		);
	}

	const maxEnvelopeBytes =
		MAX_DOCUMENT_SIZE_BYTES + MAX_MULTIPART_ENVELOPE_OVERHEAD_BYTES;

	// Fast-fail if Content-Length exceeds file limit + multipart envelope framing
	const contentLengthHeader = c.req.header("content-length");
	if (contentLengthHeader) {
		const contentLength = Number(contentLengthHeader);
		if (!Number.isNaN(contentLength) && contentLength > maxEnvelopeBytes) {
			return sendError(
				c,
				"PAYLOAD_TOO_LARGE",
				`Document size exceeds the maximum allowed limit of 8 MB (${MAX_DOCUMENT_SIZE_BYTES} bytes).`,
				413,
			);
		}
	}

	const bucket = c.env.rangkai_documents_dev;
	if (!bucket) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Document storage binding is not available.",
			503,
		);
	}

	// Enforce bounded stream read before multipart parsing
	const boundedBody = await readBoundedRequestBody(
		c.req.raw,
		maxEnvelopeBytes,
	);
	if (!boundedBody.ok) {
		return sendError(
			c,
			"PAYLOAD_TOO_LARGE",
			`Document size exceeds the maximum allowed limit of 8 MB (${MAX_DOCUMENT_SIZE_BYTES} bytes).`,
			413,
		);
	}

	let formData: FormData;
	try {
		const boundedReq = new Request(c.req.url, {
			method: c.req.method,
			headers: c.req.raw.headers,
			body: boundedBody.bytes,
		});
		formData = await boundedReq.formData();
	} catch {
		return sendError(
			c,
			"BAD_REQUEST",
			"Malformed multipart/form-data payload.",
			400,
		);
	}

	const fileEntries: File[] = [];
	let consentGranted = false;

	for (const [key, value] of formData.entries()) {
		if (value instanceof File) {
			if (key !== "file" && key !== "document") {
				return sendError(
					c,
					"VALIDATION_FAILED",
					`Unexpected file field '${key}'. Use 'file' or 'document'.`,
					422,
				);
			}
			fileEntries.push(value);
		} else if (key === "processingConsent" || key === "aiProcessingConsent") {
			const normalized = String(value).trim().toLowerCase();
			if (normalized === "true") {
				consentGranted = true;
			} else if (normalized !== "false" && normalized !== "") {
				return sendError(
					c,
					"VALIDATION_FAILED",
					"processingConsent must be 'true' or 'false'.",
					422,
				);
			}
		} else {
			return sendError(
				c,
				"VALIDATION_FAILED",
				`Unexpected multipart field '${key}'.`,
				422,
			);
		}
	}

	if (fileEntries.length === 0) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Exactly one document file is required in multipart field 'file' or 'document'.",
			422,
		);
	}

	if (fileEntries.length > 1) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Exactly one file may be uploaded per request.",
			422,
		);
	}

	const uploadedFile = fileEntries[0];

	if (uploadedFile.size === 0) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Uploaded document file cannot be empty.",
			422,
		);
	}

	if (uploadedFile.size > MAX_DOCUMENT_SIZE_BYTES) {
		return sendError(
			c,
			"PAYLOAD_TOO_LARGE",
			`Document size (${uploadedFile.size} bytes) exceeds the maximum allowed limit of 8 MB (${MAX_DOCUMENT_SIZE_BYTES} bytes).`,
			413,
		);
	}

	const rawBuffer = await uploadedFile.arrayBuffer();
	const fileBytes = new Uint8Array(rawBuffer);

	if (fileBytes.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
		return sendError(
			c,
			"PAYLOAD_TOO_LARGE",
			`Document size exceeds the maximum allowed limit of 8 MB (${MAX_DOCUMENT_SIZE_BYTES} bytes).`,
			413,
		);
	}

	// Verify genuine content format via magic bytes and structural integrity
	const detectedMime = detectMimeFromMagicBytes(fileBytes);
	if (
		!detectedMime ||
		!ALLOWED_DOCUMENT_MIME_TYPES.includes(detectedMime) ||
		!validateBinaryFormatStructure(fileBytes, detectedMime)
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Unsupported or corrupted document format. Only structurally valid PDF, JPEG, and PNG files are allowed.",
			422,
		);
	}

	// Require claimed MIME type to be present and match detected magic bytes
	const claimedMime = uploadedFile.type
		? uploadedFile.type.toLowerCase().split(";")[0].trim()
		: "";
	if (!claimedMime || claimedMime !== detectedMime) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			`Declared Content-Type (${claimedMime || "missing"}) does not match inspected file signature (${detectedMime}).`,
			422,
		);
	}

	// Require filename extension to match detected MIME type
	const sanitizedFilename = sanitizeDocumentFilename(
		uploadedFile.name || "document",
	);
	if (!doesExtensionMatchMime(sanitizedFilename, detectedMime)) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			`File extension of '${sanitizedFilename}' does not match inspected file content type (${detectedMime}).`,
			422,
		);
	}

	const documentId = crypto.randomUUID();
	const r2Key = buildPrivateDocumentR2Key(
		eventId,
		documentId,
		sanitizedFilename,
	);
	const now = new Date();
	const auditId = crypto.randomUUID();

	try {
		await bucket.put(r2Key, rawBuffer, {
			httpMetadata: {
				contentType: detectedMime,
			},
			customMetadata: {
				eventId,
				documentId,
				uploadedBy: currentUser.id,
			},
		});
	} catch {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Failed to store document in private object storage.",
			503,
		);
	}

	try {
		const query = sql`
			WITH target_event AS (
				SELECT e.id, e.organization_id, e.status, e.verified_by, e.verified_at
				FROM events e
				INNER JOIN memberships m
					ON m.organization_id = e.organization_id
					AND m.user_id = ${currentUser.id}
					AND m.role = 'organizer'
				WHERE e.id = ${eventId}
					AND e.status IN ('draft', 'review')
				FOR UPDATE OF e
			),
			inserted_doc AS (
				INSERT INTO documents (
					id, event_id, uploaded_by, r2_key, original_name,
					mime_type, size_bytes, visibility, ai_consent_by, ai_consent_at, created_at
				)
				SELECT
					${documentId}::uuid, id, ${currentUser.id}::text, ${r2Key}::text, ${sanitizedFilename}::text,
					${detectedMime}::text, ${fileBytes.byteLength}::int, 'private',
					${consentGranted ? currentUser.id : null}::text,
					${consentGranted ? now : null}::timestamptz,
					${now}::timestamptz
				FROM target_event
				RETURNING *
			),
			updated_event AS (
				UPDATE events e
				SET
					status = 'draft',
					verified_by = NULL,
					verified_at = NULL,
					updated_at = ${now}
				FROM target_event te
				WHERE e.id = te.id
					AND te.status = 'review'
					AND EXISTS (SELECT 1 FROM inserted_doc)
				RETURNING e.id, e.status
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId},
					te.organization_id,
					te.id,
					${currentUser.id},
					'document.uploaded',
					'document',
					d.id,
					jsonb_build_object(
						'eventStatus', te.status,
						'verifiedBy', te.verified_by
					),
					jsonb_build_object(
						'originalName', d.original_name,
						'mimeType', d.mime_type,
						'sizeBytes', d.size_bytes,
						'visibility', d.visibility,
						'aiConsentGranted', (d.ai_consent_at IS NOT NULL),
						'eventStatusAfter', CASE WHEN te.status = 'review' THEN 'draft' ELSE te.status END
					),
					${now}
				FROM inserted_doc d
				CROSS JOIN target_event te
				RETURNING id
			)
			SELECT
				id,
				event_id AS "eventId",
				original_name AS "originalName",
				mime_type AS "mimeType",
				size_bytes AS "sizeBytes",
				visibility,
				uploaded_by AS "uploadedBy",
				ai_consent_by AS "aiConsentBy",
				ai_consent_at AS "aiConsentAt",
				created_at AS "createdAt"
			FROM inserted_doc;
		`;

		const res = await db.execute(query);
		const docRow = res.rows[0] as Record<string, unknown> | undefined;

		if (!docRow) {
			try {
				await bucket.delete(r2Key);
			} catch {
				console.error(
					JSON.stringify({
						event: "r2_compensation_delete_failed",
						requestId: c.get("requestId"),
						eventId,
						documentId,
					}),
				);
				return sendError(
					c,
					"DEPENDENCY_UNAVAILABLE",
					"Event state conflict prevented document registration and storage cleanup compensation failed.",
					503,
				);
			}
			return sendError(
				c,
				"STATE_CONFLICT",
				"Concurrent event modification prevented document registration.",
				409,
			);
		}

		return c.json(
			{
				document: {
					id: docRow.id as string,
					eventId: docRow.eventId as string,
					originalName: docRow.originalName as string,
					mimeType: docRow.mimeType as string,
					sizeBytes: Number(docRow.sizeBytes),
					visibility: docRow.visibility as string,
					uploadedBy: docRow.uploadedBy as string,
					aiConsentGranted: Boolean(docRow.aiConsentAt),
					createdAt: new Date(docRow.createdAt as string).toISOString(),
				},
			},
			201,
		);
	} catch {
		try {
			await bucket.delete(r2Key);
		} catch {
			console.error(
				JSON.stringify({
					event: "r2_compensation_delete_failed",
					requestId: c.get("requestId"),
					eventId,
					documentId,
				}),
			);
			return sendError(
				c,
				"DEPENDENCY_UNAVAILABLE",
				"Failed to record document metadata and storage cleanup compensation failed.",
				503,
			);
		}
		return sendError(
			c,
			"INTERNAL_ERROR",
			"Failed to record document metadata. Uploaded object has been cleaned up.",
			500,
		);
	}
});

/**
 * GET /api/events/:eventId/documents
 * List private document metadata for an event (Organizers in org only).
 * Never exposes internal R2 keys.
 */
documentsRouter.get("/:eventId/documents", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		const exists = await db
			.select({ id: events.id })
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);
		if (exists.length > 0) {
			return sendError(
				c,
				"FORBIDDEN",
				"Organizer permission required to view private event documents.",
				403,
			);
		}
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to view private event documents.",
			403,
		);
	}

	const docs = await db
		.select({
			id: documents.id,
			eventId: documents.eventId,
			originalName: documents.originalName,
			mimeType: documents.mimeType,
			sizeBytes: documents.sizeBytes,
			visibility: documents.visibility,
			uploadedBy: documents.uploadedBy,
			aiConsentAt: documents.aiConsentAt,
			createdAt: documents.createdAt,
		})
		.from(documents)
		.where(eq(documents.eventId, eventId))
		.orderBy(desc(documents.createdAt));

	return c.json(
		{
			documents: docs.map((d) => ({
				id: d.id,
				eventId: d.eventId,
				originalName: d.originalName,
				mimeType: d.mimeType,
				sizeBytes: d.sizeBytes,
				visibility: d.visibility,
				uploadedBy: d.uploadedBy,
				aiConsentGranted: Boolean(d.aiConsentAt),
				createdAt: d.createdAt.toISOString(),
			})),
		},
		200,
	);
});

/**
 * GET /api/events/:eventId/documents/:documentId
 * Controlled authenticated download/view of a private source document for review.
 * Restricted strictly to organizers of the owning organization.
 */
documentsRouter.get("/:eventId/documents/:documentId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
	const documentId = c.req.param("documentId");

	if (
		!uuidParamSchema.safeParse(eventId).success ||
		!uuidParamSchema.safeParse(documentId).success
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid event or document ID format.",
			422,
		);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		const exists = await db
			.select({ id: events.id })
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);
		if (exists.length > 0) {
			return sendError(
				c,
				"FORBIDDEN",
				"Organizer permission required to access private source documents.",
				403,
			);
		}
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to access private source documents.",
			403,
		);
	}

	const docRows = await db
		.select()
		.from(documents)
		.where(and(eq(documents.id, documentId), eq(documents.eventId, eventId)))
		.limit(1);

	const doc = docRows[0];
	if (!doc) {
		return sendError(
			c,
			"NOT_FOUND",
			"Document not found for this event.",
			404,
		);
	}

	const bucket = c.env.rangkai_documents_dev;
	if (!bucket) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Document storage binding is not available.",
			503,
		);
	}

	const r2Obj = await bucket.get(doc.r2Key);
	if (!r2Obj) {
		return sendError(
			c,
			"NOT_FOUND",
			"Document object not found in storage.",
			404,
		);
	}

	const headers = new Headers();
	headers.set("Content-Type", doc.mimeType);
	headers.set(
		"Content-Disposition",
		`inline; filename="${doc.originalName.replace(/"/g, "")}"`,
	);
	headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
	headers.set("X-Content-Type-Options", "nosniff");

	const bodyBuffer = await r2Obj.arrayBuffer();
	return new Response(bodyBuffer, {
		status: 200,
		headers,
	});
});

export { documentsRouter };
export default documentsRouter;
