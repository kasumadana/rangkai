import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
	cleanupEvidence,
	cleanupTasks,
	eventAssignments,
	memberships,
	wasteRecords,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import {
	createCleanupTaskSchema,
	createWasteRecordSchema,
	patchCleanupTaskSchema,
	reopenCleanupTaskSchema,
	uploadEvidenceSchema,
} from "../validators/cleanup";
import {
	MAX_MULTIPART_ENVELOPE_OVERHEAD_BYTES,
	checkUploadRateLimit,
	detectMimeFromMagicBytes,
	doesExtensionMatchMime,
	sanitizeDocumentFilename,
	validateBinaryFormatStructure,
} from "../validators/documents";
import { uuidParamSchema } from "../validators/events";

const cleanupRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

cleanupRouter.use("*", requireAuth);

export const MAX_EVIDENCE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB (5,242,880 bytes)

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
 * Builds private R2 storage key for cleanup evidence photos.
 * Never exposed in public or client responses.
 */
export function buildPrivateEvidenceR2Key(
	eventId: string,
	taskId: string,
	evidenceId: string,
	sanitizedFilename: string,
): string {
	return `events/${eventId}/cleanup-tasks/${taskId}/evidence/${evidenceId}/${sanitizedFilename}`;
}

/**
 * Helper to parse PostGIS POINT GeoJSON or EWKT into { lng, lat }
 */
function parsePointLocation(
	rawGeoJson: unknown,
): { lng: number; lat: number } | null {
	if (!rawGeoJson) return null;
	try {
		const obj =
			typeof rawGeoJson === "string" ? JSON.parse(rawGeoJson) : rawGeoJson;
		if (
			obj &&
			typeof obj === "object" &&
			"type" in obj &&
			obj.type === "Point" &&
			"coordinates" in obj &&
			Array.isArray(obj.coordinates) &&
			obj.coordinates.length >= 2
		) {
			return {
				lng: Number(obj.coordinates[0]),
				lat: Number(obj.coordinates[1]),
			};
		}
	} catch {
		// Ignore parse errors
	}
	return null;
}

/**
 * POST /api/events/:eventId/cleanup-tasks
 * Create a cleanup task for an event (Organizer only).
 */
cleanupRouter.post("/events/:eventId/cleanup-tasks", async (c) => {
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
			"Organizer permission required to create cleanup tasks.",
			403,
		);
	}

	const event = access.event;
	if (event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot create cleanup tasks for a cancelled event.",
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createCleanupTaskSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid cleanup task data.",
			422,
		);
	}

	const data = parseResult.data;

	// If assignedUserId is provided, verify the user is a member of the organization
	// and (if an officer) has an active cleanup assignment for this event
	if (data.assignedUserId) {
		const memberRows = await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.organizationId, event.organizationId),
					eq(memberships.userId, data.assignedUserId),
				),
			)
			.limit(1);

		const member = memberRows[0];
		if (!member) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Assigned user must be a member of the organization.",
				422,
			);
		}

		if (member.role === "officer") {
			const assignRows = await db
				.select({ canUpdateCleanup: eventAssignments.canUpdateCleanup })
				.from(eventAssignments)
				.where(
					and(
						eq(eventAssignments.eventId, eventId),
						eq(eventAssignments.userId, data.assignedUserId),
					),
				)
				.limit(1);

			if (!assignRows[0] || !assignRows[0].canUpdateCleanup) {
				return sendError(
					c,
					"VALIDATION_FAILED",
					"Assigned field officer must have an active event assignment with cleanup permission.",
					422,
				);
			}
		}
	}

	const taskId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const dueAtDate = data.dueAt ? new Date(data.dueAt) : null;
	const locationEwkt = data.location
		? `SRID=4326;POINT(${data.location.lng} ${data.location.lat})`
		: null;

	const query = sql`
		WITH target_event AS (
			SELECT e.id, e.organization_id, e.status
			FROM events e
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE e.id = ${eventId}
				AND e.status != 'cancelled'
			FOR UPDATE OF e
		),
		inserted AS (
			INSERT INTO cleanup_tasks (
				id, event_id, title, description, location,
				assigned_user_id, status, due_at, created_at, updated_at
			)
			SELECT
				${taskId}::uuid,
				te.id,
				${data.title}::text,
				${data.description ?? null}::text,
				CASE WHEN ${locationEwkt}::text IS NOT NULL THEN ST_GeomFromEWKT(${locationEwkt}::text) ELSE NULL END,
				${data.assignedUserId ?? null}::text,
				'todo',
				${dueAtDate}::timestamptz,
				${now}::timestamptz,
				${now}::timestamptz
			FROM target_event te
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}::uuid,
				te.organization_id,
				te.id,
				${currentUser.id}::text,
				'cleanup_task.created',
				'cleanup_task',
				i.id,
				null,
				jsonb_build_object(
					'title', i.title,
					'status', i.status,
					'assignedUserId', i.assigned_user_id,
					'dueAt', i.due_at
				),
				${now}::timestamptz
			FROM inserted i
			CROSS JOIN target_event te
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			title,
			description,
			CASE WHEN location IS NOT NULL THEN ST_AsGeoJSON(location)::json ELSE NULL END AS "locationGeoJson",
			assigned_user_id AS "assignedUserId",
			status,
			due_at AS "dueAt",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM inserted;
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as Record<string, unknown> | undefined;
	if (!row) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot create cleanup tasks for a cancelled event.",
			409,
		);
	}

	return c.json(
		{
			cleanupTask: {
				id: row.id as string,
				eventId: row.eventId as string,
				title: row.title as string,
				description: (row.description ?? null) as string | null,
				location: parsePointLocation(row.locationGeoJson),
				assignedUserId: (row.assignedUserId ?? null) as string | null,
				status: row.status as string,
				dueAt: row.dueAt ? new Date(row.dueAt as string).toISOString() : null,
				verifiedBy: null,
				verifiedAt: null,
				createdAt: new Date(row.createdAt as string).toISOString(),
				updatedAt: new Date(row.updatedAt as string).toISOString(),
			},
		},
		201,
	);
});

/**
 * GET /api/events/:eventId/cleanup-tasks
 * List cleanup tasks for an event (Organizer or assigned cleanup officer).
 * Includes safe evidence metadata (never raw R2 keys).
 */
cleanupRouter.get("/events/:eventId/cleanup-tasks", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(
		db,
		eventId,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to view cleanup tasks for this event.",
			403,
		);
	}

	const tasksQuery = sql`
		SELECT
			ct.id,
			ct.event_id AS "eventId",
			ct.title,
			ct.description,
			CASE WHEN ct.location IS NOT NULL THEN ST_AsGeoJSON(ct.location)::json ELSE NULL END AS "locationGeoJson",
			ct.assigned_user_id AS "assignedUserId",
			ct.status,
			ct.due_at AS "dueAt",
			ct.verified_by AS "verifiedBy",
			ct.verified_at AS "verifiedAt",
			ct.created_at AS "createdAt",
			ct.updated_at AS "updatedAt"
		FROM cleanup_tasks ct
		WHERE ct.event_id = ${eventId}
		ORDER BY ct.created_at ASC;
	`;

	const tasksRes = await db.execute(tasksQuery);
	const taskRows = tasksRes.rows as Array<Record<string, unknown>>;

	const evidenceRows = await db
		.select({
			id: cleanupEvidence.id,
			taskId: cleanupEvidence.taskId,
			stage: cleanupEvidence.stage,
			uploadedBy: cleanupEvidence.uploadedBy,
			createdAt: cleanupEvidence.createdAt,
		})
		.from(cleanupEvidence)
		.innerJoin(cleanupTasks, eq(cleanupEvidence.taskId, cleanupTasks.id))
		.where(eq(cleanupTasks.eventId, eventId))
		.orderBy(asc(cleanupEvidence.createdAt));

	const evidenceByTask = new Map<
		string,
		Array<{
			id: string;
			taskId: string;
			stage: string;
			uploadedBy: string;
			createdAt: string;
		}>
	>();

	for (const ev of evidenceRows) {
		const list = evidenceByTask.get(ev.taskId) || [];
		list.push({
			id: ev.id,
			taskId: ev.taskId,
			stage: ev.stage,
			uploadedBy: ev.uploadedBy,
			createdAt: ev.createdAt.toISOString(),
		});
		evidenceByTask.set(ev.taskId, list);
	}

	return c.json(
		{
			cleanupTasks: taskRows.map((row) => {
				const evList = evidenceByTask.get(row.id as string) || [];
				return {
					id: row.id as string,
					eventId: row.eventId as string,
					title: row.title as string,
					description: (row.description ?? null) as string | null,
					location: parsePointLocation(row.locationGeoJson),
					assignedUserId: (row.assignedUserId ?? null) as string | null,
					status: row.status as string,
					dueAt: row.dueAt ? new Date(row.dueAt as string).toISOString() : null,
					verifiedBy: (row.verifiedBy ?? null) as string | null,
					verifiedAt: row.verifiedAt
						? new Date(row.verifiedAt as string).toISOString()
						: null,
					createdAt: new Date(row.createdAt as string).toISOString(),
					updatedAt: new Date(row.updatedAt as string).toISOString(),
					evidenceCount: evList.length,
					evidence: evList,
				};
			}),
		},
		200,
	);
});

/**
 * GET /api/cleanup-tasks/:taskId
 * Get single cleanup task detail with safe evidence metadata.
 */
cleanupRouter.get("/cleanup-tasks/:taskId", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	if (!uuidParamSchema.safeParse(taskId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid cleanup task ID format.",
			422,
		);
	}

	const db = c.get("db");
	const taskQuery = sql`
		SELECT
			ct.id,
			ct.event_id AS "eventId",
			ct.title,
			ct.description,
			CASE WHEN ct.location IS NOT NULL THEN ST_AsGeoJSON(ct.location)::json ELSE NULL END AS "locationGeoJson",
			ct.assigned_user_id AS "assignedUserId",
			ct.status,
			ct.due_at AS "dueAt",
			ct.verified_by AS "verifiedBy",
			ct.verified_at AS "verifiedAt",
			ct.created_at AS "createdAt",
			ct.updated_at AS "updatedAt"
		FROM cleanup_tasks ct
		WHERE ct.id = ${taskId}
		LIMIT 1;
	`;
	const taskRes = await db.execute(taskQuery);
	const row = taskRes.rows[0] as Record<string, unknown> | undefined;

	if (!row) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		row.eventId as string,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to view this cleanup task.",
			403,
		);
	}

	const evidenceRows = await db
		.select({
			id: cleanupEvidence.id,
			taskId: cleanupEvidence.taskId,
			stage: cleanupEvidence.stage,
			uploadedBy: cleanupEvidence.uploadedBy,
			createdAt: cleanupEvidence.createdAt,
		})
		.from(cleanupEvidence)
		.where(eq(cleanupEvidence.taskId, taskId))
		.orderBy(desc(cleanupEvidence.createdAt));

	return c.json(
		{
			cleanupTask: {
				id: row.id as string,
				eventId: row.eventId as string,
				title: row.title as string,
				description: (row.description ?? null) as string | null,
				location: parsePointLocation(row.locationGeoJson),
				assignedUserId: (row.assignedUserId ?? null) as string | null,
				status: row.status as string,
				dueAt: row.dueAt ? new Date(row.dueAt as string).toISOString() : null,
				verifiedBy: (row.verifiedBy ?? null) as string | null,
				verifiedAt: row.verifiedAt
					? new Date(row.verifiedAt as string).toISOString()
					: null,
				createdAt: new Date(row.createdAt as string).toISOString(),
				updatedAt: new Date(row.updatedAt as string).toISOString(),
				evidence: evidenceRows.map((e) => ({
					id: e.id,
					taskId: e.taskId,
					stage: e.stage,
					uploadedBy: e.uploadedBy,
					createdAt: e.createdAt.toISOString(),
				})),
			},
		},
		200,
	);
});

/**
 * POST /api/events/:eventId/waste-records
 * Record waste quantities for an event (Organizer or assigned cleanup officer).
 * Enforces separation between weighed weight, estimated weight, and sack counts.
 */
cleanupRouter.post("/events/:eventId/waste-records", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(
		db,
		eventId,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You must be an organizer or an assigned cleanup officer for this event to record waste quantities.",
			403,
		);
	}

	const event = access.event;
	if (event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot record waste quantities for a cancelled event.",
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createWasteRecordSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid waste record data.",
			422,
		);
	}

	const data = parseResult.data;
	const hasTaskId = data.taskId !== undefined;

	const recordId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const formattedKg =
		data.quantityKg !== undefined ? data.quantityKg.toFixed(2) : null;

	// Atomic SQL CTE: lock event row, verify active membership + cleanup assignment + non-cancelled event + optional taskId ownership
	const query = sql`
		WITH target_event AS (
			SELECT
				e.id,
				e.organization_id,
				e.status,
				m.role AS member_role,
				COALESCE(ea.can_update_cleanup, false) AS can_update_cleanup
			FROM events e
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
			LEFT JOIN event_assignments ea
				ON ea.event_id = e.id
				AND ea.user_id = ${currentUser.id}
			WHERE e.id = ${eventId}
			FOR UPDATE OF e
		),
		authorized_event AS (
			SELECT *
			FROM target_event
			WHERE status != 'cancelled'
				AND (
					member_role = 'organizer'
					OR (member_role = 'officer' AND can_update_cleanup = true)
				)
		),
		valid_task AS (
			SELECT ct.id
			FROM cleanup_tasks ct
			WHERE ${hasTaskId} = true
				AND ct.id = ${data.taskId ?? null}::uuid
				AND ct.event_id = ${eventId}
		),
		inserted AS (
			INSERT INTO waste_records (
				id, event_id, task_id, category, quantity_kg,
				sack_count, measurement_method, destination, recorded_by, recorded_at
			)
			SELECT
				${recordId}::uuid,
				ae.id,
				${data.taskId ?? null}::uuid,
				${data.category}::text,
				${formattedKg}::numeric,
				${data.sackCount ?? null}::int,
				${data.measurementMethod}::text,
				${data.destination ?? null}::text,
				${currentUser.id}::text,
				${now}::timestamptz
			FROM authorized_event ae
			WHERE (${hasTaskId} = false OR EXISTS (SELECT 1 FROM valid_task))
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}::uuid,
				ae.organization_id,
				ae.id,
				${currentUser.id}::text,
				'waste_record.created',
				'waste_record',
				i.id,
				null,
				jsonb_build_object(
					'category', i.category,
					'quantityKg', CASE WHEN i.quantity_kg IS NOT NULL THEN i.quantity_kg::float8 ELSE NULL END,
					'sackCount', i.sack_count,
					'measurementMethod', i.measurement_method,
					'destination', i.destination,
					'taskId', i.task_id
				),
				${now}::timestamptz
			FROM inserted i
			CROSS JOIN authorized_event ae
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM target_event) AS "eventFound",
			(SELECT status FROM target_event) AS "eventStatus",
			(SELECT count(*)::int FROM authorized_event) AS "authorizedCount",
			(SELECT count(*)::int FROM valid_task) AS "validTaskCount",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					event_id AS "eventId",
					task_id AS "taskId",
					category,
					quantity_kg AS "quantityKg",
					sack_count AS "sackCount",
					measurement_method AS "measurementMethod",
					destination,
					recorded_by AS "recordedBy",
					recorded_at AS "recordedAt"
				FROM inserted
			) r) AS "createdRecord";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				eventFound: number;
				eventStatus: string | null;
				authorizedCount: number;
				validTaskCount: number;
				createdRecord: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.eventFound === 0) {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}

	if (row.eventStatus === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot record waste quantities for a cancelled event.",
			409,
		);
	}

	if (row.authorizedCount === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"You must be an organizer or an assigned cleanup officer for this event to record waste quantities.",
			403,
		);
	}

	if (hasTaskId && row.validTaskCount === 0) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Referenced cleanup task not found for this event.",
			422,
		);
	}

	if (!row.createdRecord) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented recording waste quantities.",
			409,
		);
	}

	const created = row.createdRecord;
	const recordedAtIso = new Date(created.recordedAt as string).toISOString();
	return c.json(
		{
			wasteRecord: {
				id: created.id as string,
				eventId: created.eventId as string,
				taskId: (created.taskId ?? null) as string | null,
				category: created.category as string,
				quantityKg:
					created.quantityKg !== null && created.quantityKg !== undefined
						? Number(created.quantityKg)
						: null,
				sackCount:
					created.sackCount !== null && created.sackCount !== undefined
						? Number(created.sackCount)
						: null,
				measurementMethod: created.measurementMethod as string,
				destination: (created.destination ?? null) as string | null,
				recordedBy: created.recordedBy as string,
				recordedAt: recordedAtIso,
				createdAt: recordedAtIso,
			},
		},
		201,
	);
});

/**
 * GET /api/events/:eventId/waste-records
 * List waste records for an event with separated weighed vs estimated totals.
 */
cleanupRouter.get("/events/:eventId/waste-records", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(
		db,
		eventId,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to view waste records for this event.",
			403,
		);
	}

	const rows = await db
		.select()
		.from(wasteRecords)
		.where(eq(wasteRecords.eventId, eventId))
		.orderBy(desc(wasteRecords.recordedAt));

	let weighedKg = 0;
	let estimatedKg = 0;
	let totalSacks = 0;

	const byCategory: Record<
		"organic" | "recyclable" | "residual",
		{ weighedKg: number; estimatedKg: number; totalSacks: number }
	> = {
		organic: { weighedKg: 0, estimatedKg: 0, totalSacks: 0 },
		recyclable: { weighedKg: 0, estimatedKg: 0, totalSacks: 0 },
		residual: { weighedKg: 0, estimatedKg: 0, totalSacks: 0 },
	};

	for (const r of rows) {
		const cat = r.category as "organic" | "recyclable" | "residual";
		const kg = r.quantityKg !== null ? Number(r.quantityKg) : 0;
		const sacks = r.sackCount ?? 0;

		if (r.measurementMethod === "weighed") {
			weighedKg += kg;
			if (byCategory[cat]) byCategory[cat].weighedKg += kg;
		} else {
			estimatedKg += kg;
			if (byCategory[cat]) byCategory[cat].estimatedKg += kg;
		}

		totalSacks += sacks;
		if (byCategory[cat]) byCategory[cat].totalSacks += sacks;
	}

	return c.json(
		{
			wasteRecords: rows.map((r) => ({
				id: r.id,
				eventId: r.eventId,
				taskId: r.taskId,
				category: r.category,
				quantityKg: r.quantityKg !== null ? Number(r.quantityKg) : null,
				sackCount: r.sackCount,
				measurementMethod: r.measurementMethod,
				destination: r.destination,
				recordedBy: r.recordedBy,
				recordedAt: r.recordedAt.toISOString(),
				createdAt: r.recordedAt.toISOString(),
			})),
			summary: {
				weighedKg: Number(weighedKg.toFixed(2)),
				estimatedKg: Number(estimatedKg.toFixed(2)),
				totalSacks,
				byCategory: {
					organic: {
						weighedKg: Number(byCategory.organic.weighedKg.toFixed(2)),
						estimatedKg: Number(byCategory.organic.estimatedKg.toFixed(2)),
						totalSacks: byCategory.organic.totalSacks,
					},
					recyclable: {
						weighedKg: Number(byCategory.recyclable.weighedKg.toFixed(2)),
						estimatedKg: Number(byCategory.recyclable.estimatedKg.toFixed(2)),
						totalSacks: byCategory.recyclable.totalSacks,
					},
					residual: {
						weighedKg: Number(byCategory.residual.weighedKg.toFixed(2)),
						estimatedKg: Number(byCategory.residual.estimatedKg.toFixed(2)),
						totalSacks: byCategory.residual.totalSacks,
					},
				},
			},
		},
		200,
	);
});

/**
 * PATCH /api/cleanup-tasks/:taskId
 * Update cleanup task fields or move task into 'in_progress'.
 * - Organizers may update administrative fields (title, description, location, assignedUserId, dueAt)
 *   and may transition status to 'in_progress' (from 'todo' or 'reopened').
 * - Assigned cleanup officers may only update status to 'in_progress' on tasks assigned to them.
 * - Neither organizers nor officers may bypass /submit, /verify, or /reopen via PATCH.
 */
cleanupRouter.patch("/cleanup-tasks/:taskId", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	if (!uuidParamSchema.safeParse(taskId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid cleanup task ID format.",
			422,
		);
	}

	const db = c.get("db");
	const taskRows = await db
		.select()
		.from(cleanupTasks)
		.where(eq(cleanupTasks.id, taskId))
		.limit(1);

	const task = taskRows[0];
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		task.eventId,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to update this cleanup task.",
			403,
		);
	}

	const event = access.event;
	if (event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot update cleanup tasks for a cancelled event.",
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = patchCleanupTaskSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message ||
				"Invalid cleanup task update data.",
			422,
		);
	}

	const data = parseResult.data;

	const hasAdminFields =
		data.title !== undefined ||
		data.description !== undefined ||
		data.location !== undefined ||
		data.assignedUserId !== undefined ||
		data.dueAt !== undefined;

	if (!access.isOrganizer) {
		if (hasAdminFields) {
			return sendError(
				c,
				"FORBIDDEN",
				"Field officers may only update cleanup task progress status, not administrative task fields.",
				403,
			);
		}

		if (task.assignedUserId !== currentUser.id) {
			return sendError(
				c,
				"FORBIDDEN",
				"Field officers may only update cleanup tasks assigned to them.",
				403,
			);
		}
	}

	// Neither organizers nor officers may bypass /submit, /verify, or /reopen via PATCH
	if (
		data.status !== undefined &&
		data.status !== "in_progress" &&
		data.status !== "todo"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot transition cleanup task to '${data.status}' via PATCH. Use the dedicated /submit, /verify, or /reopen endpoints.`,
			409,
		);
	}

	if (data.assignedUserId !== undefined && data.assignedUserId !== null) {
		const memberRows = await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.organizationId, event.organizationId),
					eq(memberships.userId, data.assignedUserId),
				),
			)
			.limit(1);

		const member = memberRows[0];
		if (!member) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Assigned user must be a member of the organization.",
				422,
			);
		}

		if (member.role === "officer") {
			const assignRows = await db
				.select({ canUpdateCleanup: eventAssignments.canUpdateCleanup })
				.from(eventAssignments)
				.where(
					and(
						eq(eventAssignments.eventId, task.eventId),
						eq(eventAssignments.userId, data.assignedUserId),
					),
				)
				.limit(1);

			if (!assignRows[0] || !assignRows[0].canUpdateCleanup) {
				return sendError(
					c,
					"VALIDATION_FAILED",
					"Assigned field officer must have an active event assignment with cleanup permission.",
					422,
				);
			}
		}
	}

	const hasTitle = data.title !== undefined;
	const hasDescription = data.description !== undefined;
	const hasAssignedUser = data.assignedUserId !== undefined;
	const hasDueAt = data.dueAt !== undefined;
	const hasStatus = data.status !== undefined;
	const hasLocation = data.location !== undefined;

	const newDueAt = hasDueAt && data.dueAt ? new Date(data.dueAt) : null;
	const newLocationEwkt =
		hasLocation && data.location
			? `SRID=4326;POINT(${data.location.lng} ${data.location.lat})`
			: null;

	const now = new Date();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH current_task AS (
			SELECT
				ct.*,
				e.organization_id,
				e.status AS event_status,
				m.role AS member_role,
				COALESCE(ea.can_update_cleanup, false) AS can_update_cleanup
			FROM cleanup_tasks ct
			INNER JOIN events e ON e.id = ct.event_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
			LEFT JOIN event_assignments ea
				ON ea.event_id = e.id
				AND ea.user_id = ${currentUser.id}
			WHERE ct.id = ${taskId}
			FOR UPDATE OF ct, e
		),
		authorized_task AS (
			SELECT *
			FROM current_task
			WHERE event_status != 'cancelled'
				AND (
					member_role = 'organizer'
					OR (
						member_role = 'officer'
						AND can_update_cleanup = true
						AND assigned_user_id = ${currentUser.id}
						AND ${!hasAdminFields} = true
					)
				)
		),
		valid_transition AS (
			SELECT *
			FROM authorized_task
			WHERE status IN ('todo', 'in_progress', 'reopened')
				AND (
					${hasStatus} = false
					OR (${data.status ?? null}::text = 'in_progress' AND status IN ('todo', 'in_progress', 'reopened'))
					OR (${data.status ?? null}::text = 'todo' AND status = 'todo')
				)
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				title = CASE WHEN ${hasTitle} THEN ${data.title ?? null}::text ELSE vt.title END,
				description = CASE WHEN ${hasDescription} THEN ${data.description ?? null}::text ELSE vt.description END,
				location = CASE
					WHEN ${!hasLocation} THEN vt.location
					WHEN ${newLocationEwkt}::text IS NOT NULL THEN ST_GeomFromEWKT(${newLocationEwkt}::text)
					ELSE NULL
				END,
				assigned_user_id = CASE WHEN ${hasAssignedUser} THEN ${data.assignedUserId ?? null}::text ELSE vt.assigned_user_id END,
				due_at = CASE WHEN ${hasDueAt} THEN ${newDueAt}::timestamptz ELSE vt.due_at END,
				status = CASE WHEN ${hasStatus} THEN ${data.status ?? null}::text ELSE vt.status END,
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}::timestamptz
			FROM valid_transition vt
			WHERE ct.id = vt.id
			RETURNING ct.*
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}::uuid,
				vt.organization_id,
				vt.event_id,
				${currentUser.id}::text,
				'cleanup_task.updated',
				'cleanup_task',
				u.id,
				jsonb_build_object(
					'title', vt.title,
					'description', vt.description,
					'assignedUserId', vt.assigned_user_id,
					'dueAt', vt.due_at,
					'status', vt.status
				),
				jsonb_build_object(
					'title', u.title,
					'description', u.description,
					'assignedUserId', u.assigned_user_id,
					'dueAt', u.due_at,
					'status', u.status
				),
				${now}::timestamptz
			FROM updated u
			INNER JOIN valid_transition vt ON vt.id = u.id
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM current_task) AS "taskFound",
			(SELECT event_status FROM current_task) AS "eventStatus",
			(SELECT status FROM current_task) AS "currentStatus",
			(SELECT count(*)::int FROM authorized_task) AS "authorizedCount",
			(SELECT count(*)::int FROM valid_transition) AS "validTransitionCount",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					event_id AS "eventId",
					title,
					description,
					CASE WHEN location IS NOT NULL THEN ST_AsGeoJSON(location)::json ELSE NULL END AS "locationGeoJson",
					assigned_user_id AS "assignedUserId",
					status,
					due_at AS "dueAt",
					verified_by AS "verifiedBy",
					verified_at AS "verifiedAt",
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM updated
			) r) AS "updatedTask";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				taskFound: number;
				eventStatus: string | null;
				currentStatus: string | null;
				authorizedCount: number;
				validTransitionCount: number;
				updatedTask: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.taskFound === 0) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	if (row.eventStatus === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot update cleanup tasks for a cancelled event.",
			409,
		);
	}

	if (row.authorizedCount === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to update this cleanup task.",
			403,
		);
	}

	if (row.currentStatus === "verified") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Verified tasks cannot be edited. A reopen transition is required.",
			409,
		);
	}

	if (row.validTransitionCount === 0 || !row.updatedTask) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot update cleanup task in status '${row.currentStatus}' to '${data.status ?? row.currentStatus}' via PATCH.`,
			409,
		);
	}

	const updated = row.updatedTask;
	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				location: parsePointLocation(updated.locationGeoJson),
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt
					? new Date(updated.dueAt as string).toISOString()
					: null,
				verifiedBy: (updated.verifiedBy ?? null) as string | null,
				verifiedAt: updated.verifiedAt
					? new Date(updated.verifiedAt as string).toISOString()
					: null,
				createdAt: new Date(updated.createdAt as string).toISOString(),
				updatedAt: new Date(updated.updatedAt as string).toISOString(),
			},
		},
		200,
	);
});

/**
 * POST /api/cleanup-tasks/:taskId/submit
 * Submit a cleanup task for verification (IN_PROGRESS -> SUBMITTED).
 * Requires at least one 'after' stage photo evidence uploaded for this task.
 */
cleanupRouter.post("/cleanup-tasks/:taskId/submit", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	if (!uuidParamSchema.safeParse(taskId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid cleanup task ID format.",
			422,
		);
	}

	const db = c.get("db");
	const taskRows = await db
		.select()
		.from(cleanupTasks)
		.where(eq(cleanupTasks.id, taskId))
		.limit(1);

	const task = taskRows[0];
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		task.eventId,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You must be an assigned cleanup officer for this event to submit cleanup tasks.",
			403,
		);
	}

	if (!access.isOrganizer && task.assignedUserId !== currentUser.id) {
		return sendError(
			c,
			"FORBIDDEN",
			"Field officers may only submit cleanup tasks assigned to them.",
			403,
		);
	}

	const now = new Date();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH current_task AS (
			SELECT
				ct.*,
				e.organization_id,
				e.status AS event_status,
				m.role AS member_role,
				COALESCE(ea.can_update_cleanup, false) AS can_update_cleanup,
				(
					SELECT count(*)::int
					FROM cleanup_evidence ce
					WHERE ce.task_id = ct.id
						AND ce.stage = 'after'
				) AS after_evidence_count
			FROM cleanup_tasks ct
			INNER JOIN events e ON e.id = ct.event_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
			LEFT JOIN event_assignments ea
				ON ea.event_id = e.id
				AND ea.user_id = ${currentUser.id}
			WHERE ct.id = ${taskId}
			FOR UPDATE OF ct, e
		),
		authorized_task AS (
			SELECT *
			FROM current_task
			WHERE event_status != 'cancelled'
				AND (
					member_role = 'organizer'
					OR (
						member_role = 'officer'
						AND can_update_cleanup = true
						AND assigned_user_id = ${currentUser.id}
					)
				)
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				status = 'submitted',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}::timestamptz
			FROM authorized_task at
			WHERE ct.id = at.id
				AND at.status = 'in_progress'
				AND at.after_evidence_count >= 1
			RETURNING ct.*, at.organization_id, at.status AS before_status, at.after_evidence_count
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}::uuid,
				u.organization_id,
				u.event_id,
				${currentUser.id}::text,
				'cleanup_task.submitted',
				'cleanup_task',
				u.id,
				jsonb_build_object(
					'status', u.before_status
				),
				jsonb_build_object(
					'status', u.status,
					'afterEvidenceCount', u.after_evidence_count
				),
				${now}::timestamptz
			FROM updated u
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM current_task) AS "taskFound",
			(SELECT event_status FROM current_task) AS "eventStatus",
			(SELECT status FROM current_task) AS "currentStatus",
			(SELECT after_evidence_count FROM current_task) AS "afterEvidenceCount",
			(SELECT count(*)::int FROM authorized_task) AS "authorizedCount",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					event_id AS "eventId",
					title,
					description,
					CASE WHEN location IS NOT NULL THEN ST_AsGeoJSON(location)::json ELSE NULL END AS "locationGeoJson",
					assigned_user_id AS "assignedUserId",
					status,
					due_at AS "dueAt",
					verified_by AS "verifiedBy",
					verified_at AS "verifiedAt",
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM updated
			) r) AS "updatedTask";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				taskFound: number;
				eventStatus: string | null;
				currentStatus: string | null;
				afterEvidenceCount: number;
				authorizedCount: number;
				updatedTask: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.taskFound === 0) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	if (row.eventStatus === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot submit cleanup tasks for a cancelled event.",
			409,
		);
	}

	if (row.authorizedCount === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to submit this cleanup task.",
			403,
		);
	}

	if (row.currentStatus !== "in_progress") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cleanup task in status '${row.currentStatus}' cannot be submitted. Task must be in 'in_progress' status before submission.`,
			409,
		);
	}

	if (row.afterEvidenceCount < 1 || !row.updatedTask) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot submit cleanup task without at least one 'after' photo evidence uploaded.",
			409,
		);
	}

	const updated = row.updatedTask;
	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				location: parsePointLocation(updated.locationGeoJson),
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt
					? new Date(updated.dueAt as string).toISOString()
					: null,
				verifiedBy: null,
				verifiedAt: null,
				createdAt: new Date(updated.createdAt as string).toISOString(),
				updatedAt: new Date(updated.updatedAt as string).toISOString(),
			},
		},
		200,
	);
});

/**
 * POST /api/cleanup-tasks/:taskId/verify
 * Organizer verifies a submitted cleanup task (SUBMITTED -> VERIFIED).
 * Domain invariant (AGENTS.md §13):
 * Cleanup verification and road reopening are strictly independent.
 * This endpoint NEVER alters road_impacts or road_status_updates.
 */
cleanupRouter.post("/cleanup-tasks/:taskId/verify", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	if (!uuidParamSchema.safeParse(taskId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid cleanup task ID format.",
			422,
		);
	}

	const db = c.get("db");
	const taskRows = await db
		.select()
		.from(cleanupTasks)
		.where(eq(cleanupTasks.id, taskId))
		.limit(1);

	const task = taskRows[0];
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await getEventAndCheckAccess(db, task.eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to verify cleanup tasks.",
			403,
		);
	}

	const now = new Date();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH current_task AS (
			SELECT
				ct.*,
				e.organization_id,
				e.status AS event_status,
				(
					SELECT count(*)::int
					FROM cleanup_evidence ce
					WHERE ce.task_id = ct.id
						AND ce.stage = 'after'
				) AS after_evidence_count
			FROM cleanup_tasks ct
			INNER JOIN events e ON e.id = ct.event_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE ct.id = ${taskId}
			FOR UPDATE OF ct, e
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				status = 'verified',
				verified_by = ${currentUser.id}::text,
				verified_at = ${now}::timestamptz,
				updated_at = ${now}::timestamptz
			FROM current_task cur
			WHERE ct.id = cur.id
				AND cur.event_status != 'cancelled'
				AND cur.status = 'submitted'
				AND cur.after_evidence_count >= 1
			RETURNING ct.*, cur.organization_id, cur.status AS before_status
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}::uuid,
				u.organization_id,
				u.event_id,
				${currentUser.id}::text,
				'cleanup_task.verified',
				'cleanup_task',
				u.id,
				jsonb_build_object(
					'status', u.before_status
				),
				jsonb_build_object(
					'status', u.status,
					'verifiedBy', u.verified_by,
					'verifiedAt', u.verified_at
				),
				${now}::timestamptz
			FROM updated u
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM current_task) AS "taskFound",
			(SELECT event_status FROM current_task) AS "eventStatus",
			(SELECT status FROM current_task) AS "currentStatus",
			(SELECT after_evidence_count FROM current_task) AS "afterEvidenceCount",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					event_id AS "eventId",
					title,
					description,
					CASE WHEN location IS NOT NULL THEN ST_AsGeoJSON(location)::json ELSE NULL END AS "locationGeoJson",
					assigned_user_id AS "assignedUserId",
					status,
					due_at AS "dueAt",
					verified_by AS "verifiedBy",
					verified_at AS "verifiedAt",
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM updated
			) r) AS "updatedTask";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				taskFound: number;
				eventStatus: string | null;
				currentStatus: string | null;
				afterEvidenceCount: number;
				updatedTask: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.taskFound === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to verify cleanup tasks.",
			403,
		);
	}

	if (row.eventStatus === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot verify cleanup tasks for a cancelled event.",
			409,
		);
	}

	if (row.currentStatus !== "submitted") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Only cleanup tasks in 'submitted' status can be verified (current: ${row.currentStatus}).`,
			409,
		);
	}

	if (row.afterEvidenceCount < 1 || !row.updatedTask) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot verify cleanup task without at least one 'after' photo evidence.",
			409,
		);
	}

	const updated = row.updatedTask;
	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				location: parsePointLocation(updated.locationGeoJson),
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt
					? new Date(updated.dueAt as string).toISOString()
					: null,
				verifiedBy: (updated.verifiedBy ?? null) as string | null,
				verifiedAt: updated.verifiedAt
					? new Date(updated.verifiedAt as string).toISOString()
					: null,
				createdAt: new Date(updated.createdAt as string).toISOString(),
				updatedAt: new Date(updated.updatedAt as string).toISOString(),
			},
		},
		200,
	);
});

/**
 * POST /api/cleanup-tasks/:taskId/reopen
 * Organizer reopens a submitted or verified cleanup task (SUBMITTED | VERIFIED -> REOPENED).
 * Clears previous verification metadata so stale certification is never retained.
 */
cleanupRouter.post("/cleanup-tasks/:taskId/reopen", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	if (!uuidParamSchema.safeParse(taskId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid cleanup task ID format.",
			422,
		);
	}

	const db = c.get("db");
	const taskRows = await db
		.select()
		.from(cleanupTasks)
		.where(eq(cleanupTasks.id, taskId))
		.limit(1);

	const task = taskRows[0];
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await getEventAndCheckAccess(db, task.eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to reopen cleanup tasks.",
			403,
		);
	}

	let body: unknown = {};
	const contentType = c.req.header("content-type") || "";
	if (contentType.toLowerCase().includes("application/json")) {
		try {
			body = await c.req.json();
		} catch {
			return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
		}
	}

	const parseResult = reopenCleanupTaskSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid reopen payload.",
			422,
		);
	}

	const reason = parseResult.data.reason ?? null;
	const now = new Date();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH current_task AS (
			SELECT
				ct.*,
				e.organization_id,
				e.status AS event_status
			FROM cleanup_tasks ct
			INNER JOIN events e ON e.id = ct.event_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE ct.id = ${taskId}
			FOR UPDATE OF ct, e
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				status = 'reopened',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}::timestamptz
			FROM current_task cur
			WHERE ct.id = cur.id
				AND cur.event_status != 'cancelled'
				AND cur.status IN ('submitted', 'verified')
			RETURNING ct.*, cur.organization_id, cur.status AS before_status, cur.verified_by AS before_verified_by, cur.verified_at AS before_verified_at
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}::uuid,
				u.organization_id,
				u.event_id,
				${currentUser.id}::text,
				'cleanup_task.reopened',
				'cleanup_task',
				u.id,
				jsonb_build_object(
					'status', u.before_status,
					'verifiedBy', u.before_verified_by,
					'verifiedAt', u.before_verified_at
				),
				jsonb_build_object(
					'status', u.status,
					'verifiedBy', null,
					'verifiedAt', null,
					'reason', ${reason}::text
				),
				${now}::timestamptz
			FROM updated u
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM current_task) AS "taskFound",
			(SELECT event_status FROM current_task) AS "eventStatus",
			(SELECT status FROM current_task) AS "currentStatus",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					event_id AS "eventId",
					title,
					description,
					CASE WHEN location IS NOT NULL THEN ST_AsGeoJSON(location)::json ELSE NULL END AS "locationGeoJson",
					assigned_user_id AS "assignedUserId",
					status,
					due_at AS "dueAt",
					verified_by AS "verifiedBy",
					verified_at AS "verifiedAt",
					created_at AS "createdAt",
					updated_at AS "updatedAt"
				FROM updated
			) r) AS "updatedTask";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				taskFound: number;
				eventStatus: string | null;
				currentStatus: string | null;
				updatedTask: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.taskFound === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to reopen cleanup tasks.",
			403,
		);
	}

	if (row.eventStatus === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot reopen cleanup tasks for a cancelled event.",
			409,
		);
	}

	if (
		(row.currentStatus !== "submitted" && row.currentStatus !== "verified") ||
		!row.updatedTask
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Only 'submitted' or 'verified' cleanup tasks can be reopened (current: ${row.currentStatus}).`,
			409,
		);
	}

	const updated = row.updatedTask;
	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				location: parsePointLocation(updated.locationGeoJson),
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt
					? new Date(updated.dueAt as string).toISOString()
					: null,
				verifiedBy: null,
				verifiedAt: null,
				createdAt: new Date(updated.createdAt as string).toISOString(),
				updatedAt: new Date(updated.updatedAt as string).toISOString(),
			},
		},
		200,
	);
});

/**
 * POST /api/cleanup-tasks/:taskId/evidence
 * Upload photo evidence ('before' or 'after') for a cleanup task to private R2 storage.
 * Enforces JPEG/PNG magic bytes, structural validity, claimed MIME agreement, extension agreement,
 * 5 MB size limit, and atomic DB metadata + R2 compensation.
 */
cleanupRouter.post("/cleanup-tasks/:taskId/evidence", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	if (!uuidParamSchema.safeParse(taskId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid cleanup task ID format.",
			422,
		);
	}

	const db = c.get("db");
	const taskRows = await db
		.select()
		.from(cleanupTasks)
		.where(eq(cleanupTasks.id, taskId))
		.limit(1);

	const task = taskRows[0];
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		task.eventId,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You must be an assigned cleanup officer for this event to upload cleanup evidence.",
			403,
		);
	}

	if (!access.isOrganizer && task.assignedUserId !== currentUser.id) {
		return sendError(
			c,
			"FORBIDDEN",
			"Field officers may only upload evidence for cleanup tasks assigned to them.",
			403,
		);
	}

	const event = access.event;
	if (event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot upload cleanup evidence for a cancelled event.",
			409,
		);
	}

	if (task.status === "submitted" || task.status === "verified") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot upload additional evidence while cleanup task is in '${task.status}' status. Reopen the task first if changes are needed.`,
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
			"Evidence upload requires multipart/form-data Content-Type.",
			400,
		);
	}

	const maxEnvelopeBytes =
		MAX_EVIDENCE_SIZE_BYTES + MAX_MULTIPART_ENVELOPE_OVERHEAD_BYTES;

	const contentLengthHeader = c.req.header("content-length");
	if (contentLengthHeader) {
		const contentLength = Number(contentLengthHeader);
		if (!Number.isNaN(contentLength) && contentLength > maxEnvelopeBytes) {
			return sendError(
				c,
				"PAYLOAD_TOO_LARGE",
				`Evidence photo exceeds maximum allowed limit of 5 MB (${MAX_EVIDENCE_SIZE_BYTES} bytes).`,
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

	const boundedBody = await readBoundedRequestBody(
		c.req.raw,
		maxEnvelopeBytes,
	);
	if (!boundedBody.ok) {
		return sendError(
			c,
			"PAYLOAD_TOO_LARGE",
			`Evidence photo exceeds maximum allowed limit of 5 MB (${MAX_EVIDENCE_SIZE_BYTES} bytes).`,
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
	const stageValues: string[] = [];

	for (const [key, value] of formData.entries()) {
		if (value instanceof File) {
			if (key !== "file" && key !== "photo") {
				return sendError(
					c,
					"VALIDATION_FAILED",
					`Unexpected file field '${key}'. Use 'file' or 'photo'.`,
					422,
				);
			}
			fileEntries.push(value);
		} else if (key === "stage" || key === "evidenceType") {
			stageValues.push(String(value).trim());
		} else {
			return sendError(
				c,
				"VALIDATION_FAILED",
				`Unexpected multipart field '${key}'.`,
				422,
			);
		}
	}

	if (stageValues.length !== 1) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Stage must be 'before' or 'after'.",
			422,
		);
	}

	const stageParse = uploadEvidenceSchema.safeParse({
		stage: stageValues[0],
	});
	if (!stageParse.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			stageParse.error.issues[0]?.message ||
				"Stage must be 'before' or 'after'.",
			422,
		);
	}
	const stage = stageParse.data.stage;

	if (fileEntries.length === 0) {
		return sendError(
			c,
			"BAD_REQUEST",
			"A photo file is required in multipart field 'file' or 'photo'.",
			400,
		);
	}

	if (fileEntries.length > 1) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Only one evidence photo may be uploaded per request.",
			422,
		);
	}

	const uploadedFile = fileEntries[0];

	if (uploadedFile.size === 0) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Uploaded photo file cannot be empty.",
			422,
		);
	}

	if (uploadedFile.size > MAX_EVIDENCE_SIZE_BYTES) {
		return sendError(
			c,
			"PAYLOAD_TOO_LARGE",
			`Evidence photo (${uploadedFile.size} bytes) exceeds maximum allowed limit of 5 MB (${MAX_EVIDENCE_SIZE_BYTES} bytes).`,
			413,
		);
	}

	const rawBuffer = await uploadedFile.arrayBuffer();
	const fileBytes = new Uint8Array(rawBuffer);

	if (fileBytes.byteLength > MAX_EVIDENCE_SIZE_BYTES) {
		return sendError(
			c,
			"PAYLOAD_TOO_LARGE",
			`Evidence photo exceeds maximum allowed limit of 5 MB (${MAX_EVIDENCE_SIZE_BYTES} bytes).`,
			413,
		);
	}

	const detectedMime = detectMimeFromMagicBytes(fileBytes);
	if (
		(detectedMime !== "image/jpeg" && detectedMime !== "image/png") ||
		!validateBinaryFormatStructure(fileBytes, detectedMime)
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid or corrupted photo format. Only genuine JPEG and PNG images are allowed for cleanup evidence.",
			422,
		);
	}

	const claimedMime = uploadedFile.type
		? uploadedFile.type.toLowerCase().split(";")[0].trim()
		: "";
	if (!claimedMime || claimedMime !== detectedMime) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			`Declared Content-Type (${claimedMime || "missing"}) does not match detected photo signature (${detectedMime}).`,
			422,
		);
	}

	const sanitizedFilename = sanitizeDocumentFilename(
		uploadedFile.name || "evidence",
	);
	if (!doesExtensionMatchMime(sanitizedFilename, detectedMime)) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			`File extension of '${sanitizedFilename}' does not match detected photo content type (${detectedMime}).`,
			422,
		);
	}

	const evidenceId = crypto.randomUUID();
	const r2Key = buildPrivateEvidenceR2Key(
		task.eventId,
		taskId,
		evidenceId,
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
				eventId: task.eventId,
				taskId,
				evidenceId,
				stage,
				uploadedBy: currentUser.id,
			},
		});
	} catch {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Failed to store evidence photo in private object storage.",
			503,
		);
	}

	try {
		const query = sql`
			WITH target_task AS (
				SELECT
					ct.id,
					ct.event_id,
					ct.status AS task_status,
					e.organization_id,
					e.status AS event_status
				FROM cleanup_tasks ct
				INNER JOIN events e ON e.id = ct.event_id
				INNER JOIN memberships m
					ON m.organization_id = e.organization_id
					AND m.user_id = ${currentUser.id}
				LEFT JOIN event_assignments ea
					ON ea.event_id = e.id
					AND ea.user_id = ${currentUser.id}
				WHERE ct.id = ${taskId}
					AND e.status != 'cancelled'
					AND ct.status IN ('todo', 'in_progress', 'reopened')
					AND (
						m.role = 'organizer'
						OR (
							m.role = 'officer'
							AND COALESCE(ea.can_update_cleanup, false) = true
							AND ct.assigned_user_id = ${currentUser.id}
						)
					)
				FOR UPDATE OF ct, e
			),
			inserted AS (
				INSERT INTO cleanup_evidence (
					id, task_id, r2_key, stage, uploaded_by, created_at
				)
				SELECT
					${evidenceId}::uuid, tt.id, ${r2Key}::text, ${stage}::text, ${currentUser.id}::text, ${now}::timestamptz
				FROM target_task tt
				RETURNING *
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId}::uuid,
					tt.organization_id,
					tt.event_id,
					${currentUser.id}::text,
					'cleanup_evidence.uploaded',
					'cleanup_evidence',
					i.id,
					null,
					jsonb_build_object(
						'taskId', i.task_id,
						'stage', i.stage,
						'mimeType', ${detectedMime}::text,
						'sizeBytes', ${fileBytes.byteLength}::int
					),
					${now}::timestamptz
				FROM inserted i
				CROSS JOIN target_task tt
				RETURNING id
			)
			SELECT
				id,
				task_id AS "taskId",
				stage,
				uploaded_by AS "uploadedBy",
				created_at AS "createdAt"
			FROM inserted;
		`;

		const res = await db.execute(query);
		const evRow = res.rows[0] as Record<string, unknown> | undefined;

		if (!evRow) {
			try {
				await bucket.delete(r2Key);
			} catch {
				return sendError(
					c,
					"DEPENDENCY_UNAVAILABLE",
					"Task state conflict prevented evidence registration and storage cleanup compensation failed.",
					503,
				);
			}
			return sendError(
				c,
				"STATE_CONFLICT",
				"Concurrent task or event modification prevented evidence registration.",
				409,
			);
		}

		return c.json(
			{
				evidence: {
					id: evRow.id as string,
					taskId: evRow.taskId as string,
					stage: evRow.stage as string,
					uploadedBy: evRow.uploadedBy as string,
					createdAt: new Date(evRow.createdAt as string).toISOString(),
				},
			},
			201,
		);
	} catch {
		try {
			await bucket.delete(r2Key);
		} catch {
			return sendError(
				c,
				"DEPENDENCY_UNAVAILABLE",
				"Failed to record cleanup evidence metadata and storage cleanup compensation failed.",
				503,
			);
		}
		return sendError(
			c,
			"INTERNAL_ERROR",
			"Failed to record cleanup evidence metadata. Uploaded photo has been cleaned up.",
			500,
		);
	}
});

/**
 * GET /api/cleanup-tasks/:taskId/evidence/:evidenceId
 * Controlled authenticated download of a private cleanup evidence photo.
 * Restricted strictly to organizers of the owning organization and the specific field officer assigned to the task.
 */
cleanupRouter.get("/cleanup-tasks/:taskId/evidence/:evidenceId", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");
	const evidenceId = c.req.param("evidenceId");

	if (
		!uuidParamSchema.safeParse(taskId).success ||
		!uuidParamSchema.safeParse(evidenceId).success
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid cleanup task or evidence ID format.",
			422,
		);
	}

	const db = c.get("db");
	const taskRows = await db
		.select()
		.from(cleanupTasks)
		.where(eq(cleanupTasks.id, taskId))
		.limit(1);

	const task = taskRows[0];
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		task.eventId,
		currentUser.id,
		"cleanup",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to view evidence for this cleanup task.",
			403,
		);
	}

	// Task-assignee level ownership check for field officers
	if (!access.isOrganizer && task.assignedUserId !== currentUser.id) {
		return sendError(
			c,
			"FORBIDDEN",
			"Field officers may only view evidence for cleanup tasks assigned to them.",
			403,
		);
	}

	const evRows = await db
		.select()
		.from(cleanupEvidence)
		.where(
			and(
				eq(cleanupEvidence.id, evidenceId),
				eq(cleanupEvidence.taskId, taskId),
			),
		)
		.limit(1);

	const ev = evRows[0];
	if (!ev) {
		return sendError(
			c,
			"NOT_FOUND",
			"Evidence photo not found for this task.",
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

	const r2Obj = await bucket.get(ev.r2Key);
	if (!r2Obj) {
		return sendError(
			c,
			"NOT_FOUND",
			"Evidence object not found in storage.",
			404,
		);
	}

	const headers = new Headers();
	r2Obj.writeHttpMetadata(headers);
	if (!headers.get("Content-Type")) {
		const lowerKey = ev.r2Key.toLowerCase();
		headers.set(
			"Content-Type",
			lowerKey.endsWith(".png") ? "image/png" : "image/jpeg",
		);
	}
	headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
	headers.set("X-Content-Type-Options", "nosniff");

	const bodyBuffer = await r2Obj.arrayBuffer();
	return new Response(bodyBuffer, {
		status: 200,
		headers,
	});
});

export { cleanupRouter };
export default cleanupRouter;
