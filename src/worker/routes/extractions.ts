import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { aiExtractions, documents, events, memberships } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import {
	GEMINI_MODEL_DEFAULT,
	GEMINI_PROMPT_VERSION,
	GEMINI_SCHEMA_VERSION,
	invokeGeminiExtraction,
} from "../services/gemini";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import { checkExtractionRateLimit } from "../validators/documents";
import {
	createExtractionSchema,
	patchExtractedFieldsSchema,
} from "../validators/extractions";

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

// 1. Events Extractions Router: /api/events/:eventId/extractions and /api/events/:eventId/extracted-fields
export const eventsExtractionsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

eventsExtractionsRouter.use("*", requireAuth);

// POST /api/events/:eventId/extractions - Trigger AI document extraction
eventsExtractionsRouter.post("/:eventId/extractions", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;
	const event = check.event;

	// Invariant: cannot trigger extractions on terminal, published, or active events
	if (event.status === "completed" || event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot extract fields for event in terminal status: ${event.status}.`,
			409,
		);
	}
	if (event.status === "published" || event.status === "active") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot extract fields for published or active event. Current status: ${event.status}.`,
			409,
		);
	}

	// Rate limit check for AI extractions
	if (!checkExtractionRateLimit(currentUser.id)) {
		return sendError(
			c,
			"RATE_LIMITED",
			"AI extraction rate limit exceeded. Please wait before triggering another extraction.",
			429,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createExtractionSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid extraction payload.",
			422,
		);
	}

	const { documentId } = parseResult.data;
	const db = c.get("db");

	// Verify document exists and belongs to event
	const docRows = await db
		.select()
		.from(documents)
		.where(
			and(eq(documents.id, documentId), eq(documents.eventId, eventId)),
		)
		.limit(1);

	const doc = docRows[0];
	if (!doc) {
		return sendError(
			c,
			"NOT_FOUND",
			"Document not found or does not belong to this event.",
			404,
		);
	}

	// Model resolution
	const configuredModel =
		c.env?.GEMINI_MODEL ||
		(typeof process !== "undefined" ? process.env?.GEMINI_MODEL : undefined) ||
		GEMINI_MODEL_DEFAULT;

	const extractionId = crypto.randomUUID();
	const initAuditId = crypto.randomUUID();
	const now = new Date();

	// Atomically reserve work in 'processing' status BEFORE calling provider
	// Guarantees simultaneous requests cannot both invoke Gemini
	const reserveQuery = sql`
		WITH checked_doc AS (
			SELECT d.id, d.r2_key, d.mime_type, e.organization_id, e.id AS event_id
			FROM documents d
			JOIN events e ON e.id = d.event_id
			JOIN memberships m ON m.organization_id = e.organization_id
			WHERE d.id = ${documentId} AND d.event_id = ${eventId}
			  AND e.status IN ('draft', 'review')
			  AND m.user_id = ${currentUser.id}
			  AND m.role = 'organizer'
			  AND NOT EXISTS (
				  SELECT 1 FROM ai_extractions ax
				  WHERE ax.document_id = d.id AND ax.status IN ('pending', 'processing')
			  )
			FOR UPDATE
		),
		inserted_res AS (
			INSERT INTO ai_extractions (
				id, document_id, model_name, prompt_version, schema_version, status, created_at
			)
			SELECT
				${extractionId}, cd.id, ${configuredModel}, ${GEMINI_PROMPT_VERSION},
				${GEMINI_SCHEMA_VERSION}, 'processing', ${now}
			FROM checked_doc cd
			RETURNING *
		),
		logged_init AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${initAuditId}, cd.organization_id, cd.event_id, ${currentUser.id}, 'extraction.initiated', 'ai_extraction', ir.id, null,
				json_build_object(
					'extractionId', ir.id,
					'documentId', cd.id,
					'status', 'processing',
					'modelName', ${configuredModel}::text
				),
				${now}
			FROM inserted_res ir
			JOIN checked_doc cd ON cd.id = ir.document_id
			RETURNING id
		)
		SELECT
			id,
			document_id AS "documentId",
			model_name AS "modelName",
			prompt_version AS "promptVersion",
			schema_version AS "schemaVersion",
			status,
			created_at AS "createdAt"
		FROM inserted_res;
	`;

	const reserveRes = await db.execute(reserveQuery);
	if (reserveRes.rows.length === 0) {
		// Reservation failed: either extraction already active or state changed
		const existingActive = await db
			.select()
			.from(aiExtractions)
			.where(
				and(
					eq(aiExtractions.documentId, documentId),
					inArray(aiExtractions.status, ["pending", "processing"]),
				),
			)
			.limit(1);

		if (existingActive.length > 0) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"An extraction is already in progress for this document.",
				409,
			);
		}

		return sendError(
			c,
			"STATE_CONFLICT",
			"Document extraction could not be initiated due to event status or permission changes.",
			409,
		);
	}

	// Get file from R2
	const r2 = c.env?.rangkai_documents_dev;
	if (!r2) {
		await db
			.update(aiExtractions)
			.set({ status: "failed", errorCode: "STORAGE_UNAVAILABLE" })
			.where(eq(aiExtractions.id, extractionId));
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Document storage service is unavailable.",
			503,
		);
	}

	const object = await r2.get(doc.r2Key);
	if (!object) {
		await db
			.update(aiExtractions)
			.set({ status: "failed", errorCode: "DOCUMENT_NOT_FOUND" })
			.where(eq(aiExtractions.id, extractionId));
		return sendError(c, "NOT_FOUND", "Document file not found in storage.", 404);
	}

	const buffer = await object.arrayBuffer();

	// Check Gemini API key
	const apiKey =
		c.env?.GEMINI_API_KEY ||
		(typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined);

	if (!apiKey) {
		await db
			.update(aiExtractions)
			.set({ status: "failed", errorCode: "CONFIG_MISSING" })
			.where(eq(aiExtractions.id, extractionId));
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Gemini AI service configuration is missing.",
			503,
		);
	}

	try {
		// Invoke Gemini multimodal extraction with configurable model
		const extractionResult = await invokeGeminiExtraction(
			buffer,
			doc.mimeType,
			apiKey,
			configuredModel,
		);

		const finalStatus = extractionResult.success ? "completed" : "failed";
		const outputJson = extractionResult.success
			? JSON.stringify(extractionResult.data)
			: null;
		const errorCode = extractionResult.errorCode ?? null;
		const latencyMs = extractionResult.latencyMs;
		const updateAuditId = crypto.randomUUID();
		const completedAt = new Date();

		const updateQuery = sql`
			WITH updated AS (
				UPDATE ai_extractions
				SET
					status = ${finalStatus},
					output_json = ${outputJson}::jsonb,
					error_code = ${errorCode},
					latency_ms = ${latencyMs}
				WHERE id = ${extractionId}
				RETURNING *
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${updateAuditId}, ${event.organizationId}, ${eventId}, ${currentUser.id},
					${finalStatus === "completed" ? "extraction.completed" : "extraction.failed"},
					'ai_extraction', id,
					json_build_object('status', 'processing'),
					json_build_object(
						'extractionId', id,
						'documentId', document_id,
						'status', status,
						'modelName', model_name,
						'errorCode', error_code,
						'latencyMs', latency_ms
					),
					${completedAt}
				FROM updated
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
				created_at AS "createdAt"
			FROM updated;
		`;

		const updateRes = await db.execute(updateQuery);
		const row = updateRes.rows[0];

		return c.json(
			{
				extraction: {
					id: row.id as string,
					documentId: row.documentId as string,
					modelName: row.modelName as string,
					promptVersion: row.promptVersion as string,
					schemaVersion: row.schemaVersion as string,
					outputJson: row.outputJson,
					status: row.status as string,
					errorCode: row.errorCode as string | null,
					latencyMs: row.latencyMs ? Number(row.latencyMs) : null,
					createdAt:
						row.createdAt instanceof Date
							? row.createdAt.toISOString()
							: (row.createdAt as string),
				},
			},
			200,
		);
	} catch {
		// Catch any unhandled error to prevent stuck 'processing' state
		await db
			.update(aiExtractions)
			.set({
				status: "failed",
				errorCode: "UNHANDLED_EXCEPTION",
			})
			.where(eq(aiExtractions.id, extractionId));

		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"An unexpected error occurred during extraction.",
			500,
		);
	}
});

// GET /api/events/:eventId/extractions - Get latest extraction status & data
eventsExtractionsRouter.get("/:eventId/extractions", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const db = c.get("db");

	// Find extractions for documents belonging to this event
	const extractionRows = await db
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
		})
		.from(aiExtractions)
		.innerJoin(documents, eq(aiExtractions.documentId, documents.id))
		.where(eq(documents.eventId, eventId))
		.orderBy(desc(aiExtractions.createdAt));

	return c.json({ extractions: extractionRows }, 200);
});

// PATCH /api/events/:eventId/extracted-fields - Human organizer review & correction
eventsExtractionsRouter.patch("/:eventId/extracted-fields", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;
	const existingEvent = check.event;

	if (
		existingEvent.status === "published" ||
		existingEvent.status === "active"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Published and active events cannot be modified via extracted-fields. Current status: ${existingEvent.status}.`,
			409,
		);
	}
	if (
		existingEvent.status === "completed" ||
		existingEvent.status === "cancelled"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot modify an event in terminal status: ${existingEvent.status}.`,
			409,
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
			parseResult.error.issues[0]?.message || "Invalid extracted field corrections.",
			422,
		);
	}

	const data = parseResult.data;
	const db = c.get("db");
	const auditId = crypto.randomUUID();
	const now = new Date();

	const startsAtDate =
		data.startsAt !== undefined
			? data.startsAt
				? new Date(data.startsAt)
				: null
			: existingEvent.startsAt;
	const endsAtDate =
		data.endsAt !== undefined
			? data.endsAt
				? new Date(data.endsAt)
				: null
			: existingEvent.endsAt;

	if (startsAtDate && endsAtDate && endsAtDate <= startsAtDate) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"End time must be after start time.",
			422,
		);
	}

	const newTitle = data.title ?? existingEvent.title;
	const newCategory =
		data.category !== undefined ? data.category : existingEvent.category;
	const newDescription =
		data.description !== undefined ? data.description : existingEvent.description;
	const newVenueName =
		data.venueName !== undefined ? data.venueName : existingEvent.venueName;
	const newPermitRef =
		data.permitReference !== undefined
			? data.permitReference
			: existingEvent.permitReference;

	// Invalidate review status back to draft if event was in review
	const newStatus = existingEvent.status === "review" ? "draft" : existingEvent.status;
	const newVerifiedBy = existingEvent.status === "review" ? null : existingEvent.verifiedBy;
	const newVerifiedAt = existingEvent.status === "review" ? null : existingEvent.verifiedAt;

	const beforeSnapshot = {
		title: existingEvent.title,
		category: existingEvent.category,
		description: existingEvent.description,
		venueName: existingEvent.venueName,
		startsAt: existingEvent.startsAt?.toISOString() ?? null,
		endsAt: existingEvent.endsAt?.toISOString() ?? null,
		permitReference: existingEvent.permitReference,
		status: existingEvent.status,
	};

	const afterSnapshot = {
		title: newTitle,
		category: newCategory,
		description: newDescription,
		venueName: newVenueName,
		startsAt: startsAtDate?.toISOString() ?? null,
		endsAt: endsAtDate?.toISOString() ?? null,
		permitReference: newPermitRef,
		status: newStatus,
		processionDescription: data.processionDescription ?? null,
		trafficImpactDescription: data.trafficImpactDescription ?? null,
		organizerName: data.organizerName ?? null,
		cleanupLocationNotes: data.cleanupLocationNotes ?? null,
		contactInformation: data.contactInformation ?? null,
	};

	// Atomic update with authoritative lock checking organizer role and draft/review state
	const query = sql`
		WITH current_event AS (
			SELECT e.*
			FROM events e
			JOIN memberships m ON m.organization_id = e.organization_id
			WHERE e.id = ${eventId}
			  AND e.status IN ('draft', 'review')
			  AND m.user_id = ${currentUser.id}
			  AND m.role = 'organizer'
			FOR UPDATE OF e
		),
		updated AS (
			UPDATE events e
			SET
				title = ${newTitle},
				category = ${newCategory},
				description = ${newDescription},
				venue_name = ${newVenueName},
				starts_at = ${startsAtDate},
				ends_at = ${endsAtDate},
				permit_reference = ${newPermitRef},
				status = ${newStatus},
				verified_by = ${newVerifiedBy},
				verified_at = ${newVerifiedAt},
				updated_at = ${now}
			FROM current_event ce
			WHERE e.id = ce.id
			RETURNING e.*
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ce.organization_id, ${eventId}, ${currentUser.id}, 'event.extracted_fields_corrected', 'event', u.id,
				${JSON.stringify(beforeSnapshot)}::jsonb,
				${JSON.stringify(afterSnapshot)}::jsonb,
				${now}
			FROM updated u
			JOIN current_event ce ON ce.id = u.id
			RETURNING id
		)
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
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			published_at AS "publishedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM updated;
	`;

	const res = await db.execute(query);
	const row = res.rows[0];

	if (!row) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Event could not be updated. Ensure it is in draft or review status and you are an authorized organizer.",
			409,
		);
	}

	return c.json(
		{
			event: {
				id: row.id as string,
				organizationId: row.organizationId as string,
				createdBy: row.createdBy as string,
				title: row.title as string,
				category: (row.category as string | null) ?? null,
				description: (row.description as string | null) ?? null,
				venueName: (row.venueName as string | null) ?? null,
				startsAt: row.startsAt ? new Date(row.startsAt as string) : null,
				endsAt: row.endsAt ? new Date(row.endsAt as string) : null,
				status: row.status as string,
				publicSlug: (row.publicSlug as string | null) ?? null,
				permitReference: (row.permitReference as string | null) ?? null,
				verifiedBy: (row.verifiedBy as string | null) ?? null,
				verifiedAt: row.verifiedAt ? new Date(row.verifiedAt as string) : null,
				publishedAt: row.publishedAt ? new Date(row.publishedAt as string) : null,
				createdAt: new Date(row.createdAt as string),
				updatedAt: new Date(row.updatedAt as string),
			},
		},
		200,
	);
});

// 2. Extractions Detail Router: GET /api/extractions/:extractionId (Organizer controlled inspection)
export const extractionsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

extractionsRouter.use("*", requireAuth);

extractionsRouter.get("/:extractionId", async (c) => {
	const currentUser = c.get("user")!;
	const extractionId = c.req.param("extractionId");

	const idValidation = uuidParamSchema.safeParse(extractionId);
	if (!idValidation.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid extraction ID format.",
			422,
		);
	}

	const db = c.get("db");

	// Join extraction -> document -> event -> membership to check organizer authorization
	const extractionRows = await db
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
			organizationId: events.organizationId,
		})
		.from(aiExtractions)
		.innerJoin(documents, eq(aiExtractions.documentId, documents.id))
		.innerJoin(events, eq(documents.eventId, events.id))
		.where(eq(aiExtractions.id, extractionId))
		.limit(1);

	const ext = extractionRows[0];
	if (!ext) {
		return sendError(c, "NOT_FOUND", "Extraction record not found.", 404);
	}

	// Verify caller is an organizer in the event's organization
	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, ext.organizationId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	const membership = memberRows[0];
	if (!membership || membership.role !== "organizer") {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required for this extraction.",
			403,
		);
	}

	return c.json(
		{
			extraction: {
				id: ext.id,
				documentId: ext.documentId,
				modelName: ext.modelName,
				promptVersion: ext.promptVersion,
				schemaVersion: ext.schemaVersion,
				outputJson: ext.outputJson,
				status: ext.status,
				errorCode: ext.errorCode,
				latencyMs: ext.latencyMs,
				createdAt: ext.createdAt,
			},
		},
		200,
	);
});
