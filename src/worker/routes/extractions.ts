import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { aiExtractions, documents } from "../../db/schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import { extractDocumentWithGemini } from "../services/gemini";
import type { AppVariables, Env } from "../types";
import {
	ALLOWED_DOCUMENT_MIME_TYPES,
	MAX_DOCUMENT_SIZE_BYTES,
	checkExtractionRateLimit,
	detectMimeFromMagicBytes,
	validateBinaryFormatStructure,
} from "../validators/documents";
import { uuidParamSchema } from "../validators/events";
import {
	GEMINI_MODEL_NAME,
	GEMINI_PROMPT_VERSION,
	GEMINI_SCHEMA_VERSION,
	patchExtractedFieldsSchema,
	triggerExtractionSchema,
} from "../validators/extractions";

const extractionsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

extractionsRouter.use("*", requireAuth);

function mapUpdatedEventRow(row: Record<string, unknown>) {
	return {
		id: row.id as string,
		organizationId: row.organizationId as string,
		createdBy: row.createdBy as string,
		title: row.title as string,
		category: (row.category ?? null) as string | null,
		description: (row.description ?? null) as string | null,
		venueName: (row.venueName ?? null) as string | null,
		startsAt: row.startsAt ? new Date(row.startsAt as string).toISOString() : null,
		endsAt: row.endsAt ? new Date(row.endsAt as string).toISOString() : null,
		status: row.status as string,
		publicSlug: (row.publicSlug ?? null) as string | null,
		permitReference: (row.permitReference ?? null) as string | null,
		processionDescription: (row.processionDescription ?? null) as string | null,
		trafficImpactDescription: (row.trafficImpactDescription ?? null) as string | null,
		organizerName: (row.organizerName ?? null) as string | null,
		cleanupLocationNotes: (row.cleanupLocationNotes ?? null) as string | null,
		contactInformation: (row.contactInformation ?? null) as string | null,
		verifiedBy: (row.verifiedBy ?? null) as string | null,
		verifiedAt: row.verifiedAt
			? new Date(row.verifiedAt as string).toISOString()
			: null,
		publishedAt: row.publishedAt
			? new Date(row.publishedAt as string).toISOString()
			: null,
		createdAt: new Date(row.createdAt as string).toISOString(),
		updatedAt: new Date(row.updatedAt as string).toISOString(),
	};
}

/**
 * POST /api/events/:eventId/extractions
 * Trigger server-side Gemini multimodal extraction on an uploaded private document.
 * Requires organizer role, explicit processing authorization/consent, and organization rate limit.
 * Never auto-publishes; saves extraction as an unverified draft.
 */
extractionsRouter.post("/events/:eventId/extractions", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to trigger AI document extraction.",
			403,
		);
	}

	const event = access.event;

	if (event.status !== "draft" && event.status !== "review") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`AI extraction can only be triggered while an event is in draft or review status (current: ${event.status}).`,
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = triggerExtractionSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid extraction request.",
			422,
		);
	}

	const data = parseResult.data;

	if (
		data.processingConsent === false ||
		data.aiProcessingConsent === false
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Organizer processing authorization/consent (processingConsent: true) is required before sending private documents to external AI processing.",
			422,
		);
	}

	const hasRequestConsent =
		data.processingConsent === true || data.aiProcessingConsent === true;

	// Organization-scoped rate limit (5 requests per 10 minutes per organization)
	if (!checkExtractionRateLimit(event.organizationId)) {
		return sendError(
			c,
			"RATE_LIMITED",
			"AI extraction rate limit exceeded (max 5 requests per 10 minutes per organization). Please wait or enter fields manually.",
			429,
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

	const extractionId = crypto.randomUUID();
	const reservationNow = new Date();
	const configuredModelName =
		c.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_NAME;

	// Step 1: Atomically lock event + document row, verify organizer membership & consent,
	// and reserve extraction slot at EVENT level if no active extraction is in progress across the event.
	const reserveQuery = sql`
		WITH target_doc AS (
			SELECT
				d.id,
				d.r2_key,
				d.mime_type,
				d.ai_consent_at,
				e.id AS event_id,
				e.organization_id,
				e.status AS event_status
			FROM documents d
			INNER JOIN events e ON e.id = d.event_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE d.id = ${data.documentId}
				AND d.event_id = ${eventId}
			FOR UPDATE OF e, d
		),
		consent_updated AS (
			UPDATE documents d
			SET
				ai_consent_at = COALESCE(d.ai_consent_at, ${hasRequestConsent ? reservationNow : null}::timestamptz),
				ai_consent_by = COALESCE(d.ai_consent_by, ${hasRequestConsent ? currentUser.id : null}::text)
			FROM target_doc td
			WHERE d.id = td.id
				AND (${hasRequestConsent}::boolean OR td.ai_consent_at IS NOT NULL)
			RETURNING d.id, d.ai_consent_at, d.ai_consent_by
		),
		active_extractions AS (
			SELECT ax.id
			FROM ai_extractions ax
			INNER JOIN documents d2 ON d2.id = ax.document_id
			INNER JOIN target_doc td ON td.event_id = d2.event_id
			WHERE ax.status IN ('pending', 'processing')
			LIMIT 1
		),
		reserved AS (
			INSERT INTO ai_extractions (
				id, document_id, model_name, prompt_version, schema_version,
				status, created_at
			)
			SELECT
				${extractionId}, td.id, ${configuredModelName}, ${GEMINI_PROMPT_VERSION}, ${GEMINI_SCHEMA_VERSION},
				'processing', ${reservationNow}
			FROM target_doc td
			INNER JOIN consent_updated cu ON cu.id = td.id
			WHERE td.event_status IN ('draft', 'review')
				AND NOT EXISTS (SELECT 1 FROM active_extractions)
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM target_doc) AS "docFound",
			(SELECT event_status FROM target_doc) AS "eventStatus",
			(SELECT count(*)::int FROM consent_updated) AS "consentValid",
			(SELECT count(*)::int FROM active_extractions) AS "activeCount",
			(SELECT id FROM reserved) AS "reservedId",
			(SELECT r2_key FROM target_doc) AS "r2Key",
			(SELECT mime_type FROM target_doc) AS "mimeType",
			(SELECT organization_id FROM target_doc) AS "organizationId";
	`;

	const reserveRes = await db.execute(reserveQuery);
	const reserveRow = reserveRes.rows[0] as
		| {
				docFound: number;
				eventStatus: string | null;
				consentValid: number;
				activeCount: number;
				reservedId: string | null;
				r2Key: string | null;
				mimeType: string | null;
				organizationId: string | null;
		  }
		| undefined;

	if (!reserveRow || reserveRow.docFound === 0) {
		return sendError(
			c,
			"NOT_FOUND",
			"Document not found for this event.",
			404,
		);
	}

	if (
		reserveRow.eventStatus !== "draft" &&
		reserveRow.eventStatus !== "review"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`AI extraction can only be triggered while an event is in draft or review status (current: ${reserveRow.eventStatus}).`,
			409,
		);
	}

	if (reserveRow.consentValid === 0) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Organizer processing authorization/consent (processingConsent: true) is required before sending private documents to external AI processing.",
			422,
		);
	}

	if (reserveRow.activeCount > 0 || !reserveRow.reservedId) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"An AI extraction is already in progress for this event.",
			409,
		);
	}

	const r2Key = reserveRow.r2Key!;
	const docMimeType = reserveRow.mimeType!;

	let finalStatus: "completed" | "failed" = "failed";
	let errorCode: string | null = null;
	let errorMessage: string | null = null;
	let latencyMs = 0;
	let modelName = configuredModelName;
	let promptVersion = GEMINI_PROMPT_VERSION;
	let schemaVersion = GEMINI_SCHEMA_VERSION;
	let outputJsonValue: unknown = null;

	try {
		const r2Obj = await bucket.get(r2Key);
		if (!r2Obj) {
			await db
				.delete(aiExtractions)
				.where(eq(aiExtractions.id, extractionId));
			return sendError(
				c,
				"NOT_FOUND",
				"Source document object is missing from private storage.",
				404,
			);
		}

		const rawBuffer = await r2Obj.arrayBuffer();
		const fileBytes = new Uint8Array(rawBuffer);

		if (
			fileBytes.byteLength === 0 ||
			fileBytes.byteLength > MAX_DOCUMENT_SIZE_BYTES
		) {
			errorCode = "INVALID_SOURCE_DOCUMENT";
			errorMessage =
				"Source document size is invalid or exceeds maximum allowed limit.";
		} else {
			const detectedMime = detectMimeFromMagicBytes(fileBytes);
			if (
				!detectedMime ||
				!ALLOWED_DOCUMENT_MIME_TYPES.includes(detectedMime) ||
				detectedMime !== docMimeType ||
				!validateBinaryFormatStructure(fileBytes, detectedMime)
			) {
				errorCode = "INVALID_SOURCE_DOCUMENT";
				errorMessage =
					"Source document failed integrity verification prior to extraction.";
			} else {
				const outcome = await extractDocumentWithGemini({
					apiKey: c.env.GEMINI_API_KEY || "",
					modelName: configuredModelName,
					mimeType: detectedMime,
					fileBytes,
				});

				latencyMs = outcome.latencyMs;
				modelName = outcome.modelName;
				promptVersion = outcome.promptVersion;
				schemaVersion = outcome.schemaVersion;

				if (outcome.ok) {
					finalStatus = "completed";
					outputJsonValue = outcome.data;
				} else {
					finalStatus = "failed";
					errorCode = outcome.errorCode;
					errorMessage = outcome.errorMessage;
				}
			}
		}
	} catch {
		finalStatus = "failed";
		errorCode = "PROVIDER_ERROR";
		errorMessage =
			"Unexpected error during document extraction. Manual entry remains available.";
	}

	const now = new Date();
	const auditId = crypto.randomUUID();
	const serializedOutputJson = outputJsonValue
		? JSON.stringify(outputJsonValue)
		: null;

	// Step 2: Finalize reserved extraction record and record append-only audit log atomically,
	// re-verifying that the event is still in draft or review status and caller is still an active organizer.
	const finalizeQuery = sql`
		WITH locked_event AS (
			SELECT e.id, e.organization_id, e.status, e.verified_by
			FROM events e
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE e.id = ${eventId}
			FOR UPDATE OF e
		),
		updated_extraction AS (
			UPDATE ai_extractions ax
			SET
				model_name = ${modelName},
				prompt_version = ${promptVersion},
				schema_version = ${schemaVersion},
				output_json = CASE
					WHEN le.status IN ('draft', 'review') AND ${serializedOutputJson}::text IS NOT NULL
					THEN (${serializedOutputJson}::text)::jsonb
					ELSE NULL
				END,
				status = CASE
					WHEN le.status IN ('draft', 'review') THEN ${finalStatus}
					ELSE 'failed'
				END,
				error_code = CASE
					WHEN le.status IN ('draft', 'review') THEN ${errorCode}::text
					ELSE 'EVENT_STATE_CONFLICT'
				END,
				latency_ms = ${latencyMs}
			FROM locked_event le
			WHERE ax.id = ${extractionId}
			RETURNING ax.*, le.status AS pre_event_status, le.organization_id
		),
		updated_event AS (
			UPDATE events e
			SET
				status = 'draft',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			FROM updated_extraction ux
			WHERE e.id = ${eventId}
				AND ux.pre_event_status = 'review'
				AND ux.status = 'completed'
			RETURNING e.id, e.status
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}::uuid,
				ux.organization_id,
				${eventId}::uuid,
				${currentUser.id}::text,
				CASE WHEN ux.status = 'completed' THEN 'extraction.completed' ELSE 'extraction.failed' END,
				'ai_extraction',
				ux.id,
				jsonb_build_object(
					'eventStatus', ux.pre_event_status
				),
				jsonb_build_object(
					'documentId', ${data.documentId}::text,
					'modelName', ux.model_name,
					'promptVersion', ux.prompt_version,
					'schemaVersion', ux.schema_version,
					'status', ux.status,
					'errorCode', ux.error_code,
					'latencyMs', ux.latency_ms,
					'processingConsentVerified', true,
					'eventStatusAfter', CASE
						WHEN ux.pre_event_status = 'review' AND ux.status = 'completed' THEN 'draft'
						ELSE ux.pre_event_status
					END
				),
				${now}::timestamptz
			FROM updated_extraction ux
			RETURNING id
		)
		SELECT
			id,
			document_id AS "documentId",
			model_name AS "modelName",
			prompt_version AS "promptVersion",
			schema_version AS "schemaVersion",
			output_json AS "outputJson",
			status,
			error_code AS "errorCode",
			latency_ms AS "latencyMs",
			created_at AS "createdAt",
			pre_event_status AS "preEventStatus"
		FROM updated_extraction;
	`;

	const res = await db.execute(finalizeQuery);
	const row = res.rows[0] as Record<string, unknown> | undefined;

	if (!row) {
		await db
			.update(aiExtractions)
			.set({
				status: "failed",
				errorCode: "EVENT_STATE_CONFLICT",
				latencyMs,
			})
			.where(eq(aiExtractions.id, extractionId));
		return sendError(
			c,
			"STATE_CONFLICT",
			"Event or membership state changed during extraction; result was not applied.",
			409,
		);
	}

	if (
		row.preEventStatus !== "draft" &&
		row.preEventStatus !== "review"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Event transitioned to '${String(row.preEventStatus)}' while extraction was in flight; extraction cannot be completed.`,
			409,
		);
	}

	const extractedObj = (row.outputJson ?? null) as
		| { issues?: string[] }
		| null;

	return c.json(
		{
			extraction: {
				id: row.id as string,
				documentId: row.documentId as string,
				modelName: row.modelName as string,
				promptVersion: row.promptVersion as string,
				schemaVersion: row.schemaVersion as string,
				status: row.status as string,
				errorCode: (row.errorCode ?? null) as string | null,
				errorMessage: errorMessage,
				latencyMs: Number(row.latencyMs ?? 0),
				outputJson: row.outputJson ?? null,
				extractedJson: row.outputJson ?? null,
				issues: Array.isArray(extractedObj?.issues) ? extractedObj.issues : [],
				createdAt: new Date(row.createdAt as string).toISOString(),
			},
			manualFallbackAvailable: true,
		},
		200,
	);
});

/**
 * GET /api/extractions/:extractionId
 * Retrieve extraction status, metadata, and structured candidate fields for human review.
 */
extractionsRouter.get("/extractions/:extractionId", async (c) => {
	const currentUser = c.get("user")!;
	const extractionId = c.req.param("extractionId");

	if (!uuidParamSchema.safeParse(extractionId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid extraction ID format.",
			422,
		);
	}

	const db = c.get("db");
	const rows = await db
		.select({
			id: aiExtractions.id,
			documentId: aiExtractions.documentId,
			modelName: aiExtractions.modelName,
			promptVersion: aiExtractions.promptVersion,
			schemaVersion: aiExtractions.schemaVersion,
			outputJson: aiExtractions.outputJson,
			status: aiExtractions.status,
			errorCode: aiExtractions.errorCode,
			latencyMs: aiExtractions.latencyMs,
			createdAt: aiExtractions.createdAt,
			eventId: documents.eventId,
		})
		.from(aiExtractions)
		.innerJoin(documents, eq(aiExtractions.documentId, documents.id))
		.where(eq(aiExtractions.id, extractionId))
		.limit(1);

	const record = rows[0];
	if (!record) {
		return sendError(c, "NOT_FOUND", "Extraction record not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		record.eventId,
		currentUser.id,
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Extraction record not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to view AI extraction details.",
			403,
		);
	}

	const extractedObj = (record.outputJson ?? null) as
		| { issues?: string[] }
		| null;

	return c.json(
		{
			extraction: {
				id: record.id,
				documentId: record.documentId,
				eventId: record.eventId,
				modelName: record.modelName,
				promptVersion: record.promptVersion,
				schemaVersion: record.schemaVersion,
				status: record.status,
				errorCode: record.errorCode,
				latencyMs: record.latencyMs,
				outputJson: record.outputJson,
				extractedJson: record.outputJson,
				issues: Array.isArray(extractedObj?.issues) ? extractedObj.issues : [],
				createdAt: record.createdAt.toISOString(),
			},
			manualFallbackAvailable: true,
		},
		200,
	);
});

/**
 * PATCH /api/events/:eventId/extracted-fields
 * Apply human-reviewed/corrected extracted fields to a draft or review event.
 * Persists all accepted corrections (including processionDescription, trafficImpactDescription,
 * organizerName, cleanupLocationNotes, contactInformation) and derives review/verification/audit
 * state directly from the locked database row.
 */
extractionsRouter.patch("/events/:eventId/extracted-fields", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to apply extracted field corrections.",
			403,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = patchExtractedFieldsSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message ||
				"Invalid extracted field corrections.",
			422,
		);
	}

	const data = parseResult.data;

	const hasTitle = data.title !== undefined;
	const hasCategory = data.category !== undefined;
	const hasDescription = data.description !== undefined;
	const hasVenueName = data.venueName !== undefined;
	const hasStartsAt = data.startsAt !== undefined;
	const hasEndsAt = data.endsAt !== undefined;
	const hasPermitReference = data.permitReference !== undefined;
	const hasProcessionDescription = data.processionDescription !== undefined;
	const hasTrafficImpactDescription =
		data.trafficImpactDescription !== undefined;
	const hasOrganizerName = data.organizerName !== undefined;
	const hasCleanupLocationNotes = data.cleanupLocationNotes !== undefined;
	const hasContactInformation = data.contactInformation !== undefined;

	const newStartsAt =
		hasStartsAt && data.startsAt ? new Date(data.startsAt) : null;
	const newEndsAt = hasEndsAt && data.endsAt ? new Date(data.endsAt) : null;

	const now = new Date();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH current_event AS (
			SELECT e.*
			FROM events e
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE e.id = ${eventId}
			FOR UPDATE OF e
		),
		merged AS (
			SELECT
				ce.id,
				CASE WHEN ${hasTitle} THEN ${data.title ?? null}::text ELSE ce.title END AS next_title,
				CASE WHEN ${hasCategory} THEN ${data.category ?? null}::text ELSE ce.category END AS next_category,
				CASE WHEN ${hasDescription} THEN ${data.description ?? null}::text ELSE ce.description END AS next_description,
				CASE WHEN ${hasVenueName} THEN ${data.venueName ?? null}::text ELSE ce.venue_name END AS next_venue_name,
				CASE WHEN ${hasStartsAt} THEN ${newStartsAt}::timestamptz ELSE ce.starts_at END AS next_starts_at,
				CASE WHEN ${hasEndsAt} THEN ${newEndsAt}::timestamptz ELSE ce.ends_at END AS next_ends_at,
				CASE WHEN ${hasPermitReference} THEN ${data.permitReference ?? null}::text ELSE ce.permit_reference END AS next_permit_reference,
				CASE WHEN ${hasProcessionDescription} THEN ${data.processionDescription ?? null}::text ELSE ce.procession_description END AS next_procession_description,
				CASE WHEN ${hasTrafficImpactDescription} THEN ${data.trafficImpactDescription ?? null}::text ELSE ce.traffic_impact_description END AS next_traffic_impact_description,
				CASE WHEN ${hasOrganizerName} THEN ${data.organizerName ?? null}::text ELSE ce.organizer_name END AS next_organizer_name,
				CASE WHEN ${hasCleanupLocationNotes} THEN ${data.cleanupLocationNotes ?? null}::text ELSE ce.cleanup_location_notes END AS next_cleanup_location_notes,
				CASE WHEN ${hasContactInformation} THEN ${data.contactInformation ?? null}::text ELSE ce.contact_information END AS next_contact_information
			FROM current_event ce
			WHERE ce.status IN ('draft', 'review')
		),
		valid_merged AS (
			SELECT
				m.*,
				(
					m.next_title IS DISTINCT FROM ce.title OR
					m.next_category IS DISTINCT FROM ce.category OR
					m.next_description IS DISTINCT FROM ce.description OR
					m.next_venue_name IS DISTINCT FROM ce.venue_name OR
					m.next_starts_at IS DISTINCT FROM ce.starts_at OR
					m.next_ends_at IS DISTINCT FROM ce.ends_at OR
					m.next_permit_reference IS DISTINCT FROM ce.permit_reference OR
					m.next_procession_description IS DISTINCT FROM ce.procession_description OR
					m.next_traffic_impact_description IS DISTINCT FROM ce.traffic_impact_description OR
					m.next_organizer_name IS DISTINCT FROM ce.organizer_name OR
					m.next_cleanup_location_notes IS DISTINCT FROM ce.cleanup_location_notes OR
					m.next_contact_information IS DISTINCT FROM ce.contact_information
				) AS is_modified
			FROM merged m
			INNER JOIN current_event ce ON ce.id = m.id
			WHERE m.next_starts_at IS NULL
				OR m.next_ends_at IS NULL
				OR m.next_ends_at > m.next_starts_at
		),
		updated AS (
			UPDATE events e
			SET
				title = vm.next_title,
				category = vm.next_category,
				description = vm.next_description,
				venue_name = vm.next_venue_name,
				starts_at = vm.next_starts_at,
				ends_at = vm.next_ends_at,
				permit_reference = vm.next_permit_reference,
				procession_description = vm.next_procession_description,
				traffic_impact_description = vm.next_traffic_impact_description,
				organizer_name = vm.next_organizer_name,
				cleanup_location_notes = vm.next_cleanup_location_notes,
				contact_information = vm.next_contact_information,
				status = CASE
					WHEN ce.status = 'review' AND vm.is_modified THEN 'draft'
					ELSE ce.status
				END,
				verified_by = CASE
					WHEN ce.status = 'review' AND vm.is_modified THEN NULL
					ELSE ce.verified_by
				END,
				verified_at = CASE
					WHEN ce.status = 'review' AND vm.is_modified THEN NULL
					ELSE ce.verified_at
				END,
				updated_at = ${now}
			FROM current_event ce
			INNER JOIN valid_merged vm ON vm.id = ce.id
			WHERE e.id = ce.id
			RETURNING e.*
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				u.organization_id,
				u.id,
				${currentUser.id},
				'event.extracted_fields_corrected',
				'event',
				u.id,
				jsonb_build_object(
					'title', ce.title,
					'category', ce.category,
					'description', ce.description,
					'venueName', ce.venue_name,
					'startsAt', ce.starts_at,
					'endsAt', ce.ends_at,
					'permitReference', ce.permit_reference,
					'processionDescription', ce.procession_description,
					'trafficImpactDescription', ce.traffic_impact_description,
					'organizerName', ce.organizer_name,
					'cleanupLocationNotes', ce.cleanup_location_notes,
					'hasContactInformation', (ce.contact_information IS NOT NULL),
					'status', ce.status,
					'verifiedBy', ce.verified_by,
					'verifiedAt', ce.verified_at
				),
				jsonb_build_object(
					'title', u.title,
					'category', u.category,
					'description', u.description,
					'venueName', u.venue_name,
					'startsAt', u.starts_at,
					'endsAt', u.ends_at,
					'permitReference', u.permit_reference,
					'processionDescription', u.procession_description,
					'trafficImpactDescription', u.traffic_impact_description,
					'organizerName', u.organizer_name,
					'cleanupLocationNotes', u.cleanup_location_notes,
					'hasContactInformation', (u.contact_information IS NOT NULL),
					'status', u.status,
					'verifiedBy', u.verified_by,
					'verifiedAt', u.verified_at
				),
				${now}
			FROM updated u
			INNER JOIN current_event ce ON ce.id = u.id
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM current_event) AS "eventFound",
			(SELECT status FROM current_event) AS "currentStatus",
			(SELECT count(*)::int FROM merged) AS "statusEditable",
			(SELECT count(*)::int FROM valid_merged) AS "datesValid",
			(SELECT row_to_json(u) FROM (
				SELECT
					id,
					organization_id AS "organizationId",
					created_by AS "createdBy",
					title,
					category,
					description,
					venue_name AS "venueName",
					starts_at AS "startsAt",
					ends_at AS "endsAt",
					status,
					public_slug AS "publicSlug",
					permit_reference AS "permitReference",
					procession_description AS "processionDescription",
					traffic_impact_description AS "trafficImpactDescription",
					organizer_name AS "organizerName",
					cleanup_location_notes AS "cleanupLocationNotes",
					contact_information AS "contactInformation",
					verified_by AS "verifiedBy",
					verified_at AS "verifiedAt",
					published_at AS "publishedAt",
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM updated
			) u) AS "updatedEvent";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				eventFound: number;
				currentStatus: string | null;
				statusEditable: number;
				datesValid: number;
				updatedEvent: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.eventFound === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to apply extracted field corrections.",
			403,
		);
	}

	if (row.statusEditable === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Extracted fields can only be applied to draft or review events (current: ${row.currentStatus}).`,
			409,
		);
	}

	if (row.datesValid === 0 || !row.updatedEvent) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"End time must be after start time.",
			422,
		);
	}

	return c.json({ event: mapUpdatedEventRow(row.updatedEvent) }, 200);
});

export { extractionsRouter };
export default extractionsRouter;
