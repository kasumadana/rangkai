import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
	eventAssignments,
	events,
	memberships,
	roadImpacts,
	roadSegments,
	roadStatusUpdates,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import {
	createRoadImpactSchema,
	createRoadStatusSchema,
	roadSegmentsQuerySchema,
	updateRoadImpactSchema,
} from "../validators/roads";

// 1. Road Segments Router: GET /api/road-segments?bbox=...
export const roadSegmentsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

roadSegmentsRouter.use("*", requireAuth);

roadSegmentsRouter.get("/", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	// Verify caller has organizer membership in at least one organization
	const userMemberships = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.userId, currentUser.id),
				eq(memberships.role, "organizer"),
			),
		)
		.limit(1);

	if (userMemberships.length === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to query road segments catalog.",
			403,
		);
	}

	const queryParse = roadSegmentsQuerySchema.safeParse(c.req.query());
	if (!queryParse.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			queryParse.error.issues[0]?.message || "Invalid bbox query parameter.",
			422,
		);
	}

	const parts = queryParse.data.bbox
		.split(",")
		.map((s) => parseFloat(s.trim()));
	const [minLng, minLat, maxLng, maxLat] = parts;

	// Query verified road segments with spatial envelope intersection
	const query = sql`
		SELECT
			id,
			display_name AS "displayName",
			coverage_area AS "coverageArea",
			ST_AsGeoJSON(geom)::json AS geometry,
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			created_at AS "createdAt"
		FROM road_segments
		WHERE verified_by IS NOT NULL
			AND verified_at IS NOT NULL
			AND ST_Intersects(geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))
		ORDER BY display_name ASC
		LIMIT 100;
	`;

	const res = await db.execute(query);
	const segments = res.rows.map((row) => ({
		id: row.id as string,
		displayName: row.displayName as string,
		coverageArea: row.coverageArea as string,
		geometry: row.geometry,
		verifiedAt: row.verifiedAt ? new Date(row.verifiedAt as string) : null,
		createdAt: new Date(row.createdAt as string),
	}));

	return c.json({ segments }, 200);
});

// Helper: Verify organizer role for a given event
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

// 2. Road Impacts Router: /api/events/:eventId/road-impacts
export const roadImpactsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

roadImpactsRouter.use("*", requireAuth);

// POST /api/events/:eventId/road-impacts - Create road impact
roadImpactsRouter.post("/:eventId/road-impacts", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;
	const event = check.event;

	if (
		event.status === "published" ||
		event.status === "active"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road impacts can only be defined prior to publication. Current status: ${event.status}.`,
			409,
		);
	}
	if (
		event.status === "completed" ||
		event.status === "cancelled"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot add road impacts to an event in terminal status: ${event.status}.`,
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createRoadImpactSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid road impact data.",
			422,
		);
	}

	const data = parseResult.data;
	const db = c.get("db");

	// Verify road segment exists and is verified
	const segmentRows = await db
		.select({
			id: roadSegments.id,
			verifiedBy: roadSegments.verifiedBy,
			verifiedAt: roadSegments.verifiedAt,
		})
		.from(roadSegments)
		.where(eq(roadSegments.id, data.roadSegmentId))
		.limit(1);

	const segment = segmentRows[0];
	if (!segment || !segment.verifiedBy || !segment.verifiedAt) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Referenced road segment does not exist or has not been verified.",
			422,
		);
	}

	const impactId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const plannedFromDate = new Date(data.plannedFrom);
	const plannedToDate = new Date(data.plannedTo);

	// Atomic insert with authoritative lock and audit logging
	const query = sql`
		WITH current_event AS (
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
			INSERT INTO road_impacts (
				id, event_id, road_segment_id, planned_from, planned_to, impact_type, diversion_note, created_at
			)
			SELECT
				${impactId}, ce.id, ${data.roadSegmentId}, ${plannedFromDate}, ${plannedToDate},
				${data.impactType}, ${data.diversionNote ?? null}, ${now}
			FROM current_event ce
			RETURNING *
		),
		updated_event AS (
			UPDATE events
			SET status = 'draft', verified_by = NULL, verified_at = NULL, updated_at = ${now}
			FROM current_event ce
			WHERE events.id = ce.id AND events.status = 'review'
			RETURNING events.id
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ce.organization_id, ${eventId}, ${currentUser.id}, 'road_impact.created', 'road_impact', i.id, null,
				json_build_object(
					'impactId', i.id,
					'roadSegmentId', i.road_segment_id,
					'plannedFrom', i.planned_from,
					'plannedTo', i.planned_to,
					'impactType', i.impact_type
				),
				${now}
			FROM inserted i
			JOIN current_event ce ON ce.id = i.event_id
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			road_segment_id AS "roadSegmentId",
			planned_from AS "plannedFrom",
			planned_to AS "plannedTo",
			impact_type AS "impactType",
			diversion_note AS "diversionNote",
			created_at AS "createdAt"
		FROM inserted;
	`;

	const res = await db.execute(query);
	const row = res.rows[0];

	if (!row) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Road impact could not be created. Ensure the event is in draft or review status and you are an authorized organizer.",
			409,
		);
	}

	const impactData = {
		id: row.id as string,
		eventId: row.eventId as string,
		roadSegmentId: row.roadSegmentId as string,
		plannedFrom: new Date(row.plannedFrom as string).toISOString(),
		plannedTo: new Date(row.plannedTo as string).toISOString(),
		impactType: row.impactType as string,
		diversionNote: (row.diversionNote as string | null) ?? null,
		createdAt: new Date(row.createdAt as string).toISOString(),
	};

	return c.json(
		{
			impact: impactData,
			roadImpact: impactData,
		},
		201,
	);
});

// GET /api/events/:eventId/road-impacts - List planned road impacts for event
roadImpactsRouter.get("/:eventId/road-impacts", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const db = c.get("db");

	const query = sql`
		SELECT
			ri.id,
			ri.event_id AS "eventId",
			ri.road_segment_id AS "roadSegmentId",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.impact_type AS "impactType",
			ri.diversion_note AS "diversionNote",
			ri.created_at AS "createdAt",
			rs.display_name AS "roadSegmentDisplayName",
			rs.coverage_area AS "roadSegmentCoverageArea",
			ST_AsGeoJSON(rs.geom)::json AS "roadSegmentGeometry"
		FROM road_impacts ri
		INNER JOIN road_segments rs ON ri.road_segment_id = rs.id
		WHERE ri.event_id = ${eventId}
		ORDER BY ri.planned_from ASC;
	`;

	const res = await db.execute(query);
	const impacts = res.rows.map((row) => ({
		id: row.id as string,
		eventId: row.eventId as string,
		roadSegmentId: row.roadSegmentId as string,
		plannedFrom: new Date(row.plannedFrom as string).toISOString(),
		plannedTo: new Date(row.plannedTo as string).toISOString(),
		impactType: row.impactType as string,
		diversionNote: (row.diversionNote as string | null) ?? null,
		createdAt: new Date(row.createdAt as string).toISOString(),
		roadSegment: {
			displayName: row.roadSegmentDisplayName as string,
			coverageArea: row.roadSegmentCoverageArea as string,
			geometry: row.roadSegmentGeometry,
		},
	}));

	return c.json({ impacts }, 200);
});

// PATCH /api/events/:eventId/road-impacts/:impactId - Update road impact
roadImpactsRouter.patch("/:eventId/road-impacts/:impactId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
	const impactId = c.req.param("impactId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	const impactIdValidation = uuidParamSchema.safeParse(impactId);
	if (!idValidation.success || !impactIdValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;
	const event = check.event;

	if (
		event.status === "published" ||
		event.status === "active"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road impacts can only be modified prior to publication. Current status: ${event.status}.`,
			409,
		);
	}
	if (
		event.status === "completed" ||
		event.status === "cancelled"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot modify road impacts of an event in terminal status: ${event.status}.`,
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = updateRoadImpactSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid update payload.",
			422,
		);
	}

	const data = parseResult.data;
	const db = c.get("db");

	// Fetch existing impact
	const existingImpacts = await db
		.select()
		.from(roadImpacts)
		.where(and(eq(roadImpacts.id, impactId), eq(roadImpacts.eventId, eventId)))
		.limit(1);

	const existingImpact = existingImpacts[0];
	if (!existingImpact) {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
	}

	// If segment changed, verify new segment
	if (data.roadSegmentId && data.roadSegmentId !== existingImpact.roadSegmentId) {
		const segmentRows = await db
			.select({
				id: roadSegments.id,
				verifiedBy: roadSegments.verifiedBy,
				verifiedAt: roadSegments.verifiedAt,
			})
			.from(roadSegments)
			.where(eq(roadSegments.id, data.roadSegmentId))
			.limit(1);

		const segment = segmentRows[0];
		if (!segment || !segment.verifiedBy || !segment.verifiedAt) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"New road segment does not exist or has not been verified.",
				422,
			);
		}
	}

	const newPlannedFrom = data.plannedFrom
		? new Date(data.plannedFrom)
		: existingImpact.plannedFrom;
	const newPlannedTo = data.plannedTo
		? new Date(data.plannedTo)
		: existingImpact.plannedTo;

	if (newPlannedTo <= newPlannedFrom) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"plannedTo must be strictly after plannedFrom.",
			422,
		);
	}

	const newSegmentId = data.roadSegmentId ?? existingImpact.roadSegmentId;
	const newImpactType = data.impactType ?? existingImpact.impactType;
	const newDiversionNote =
		data.diversionNote !== undefined
			? data.diversionNote
			: existingImpact.diversionNote;

	const auditId = crypto.randomUUID();
	const now = new Date();

	// Atomic update with authoritative lock checking draft/review status and organizer role
	const query = sql`
		WITH current_impact AS (
			SELECT ri.id, ri.event_id, ri.road_segment_id, ri.planned_from, ri.planned_to, ri.impact_type, ri.diversion_note, e.organization_id
			FROM road_impacts ri
			JOIN events e ON e.id = ri.event_id
			JOIN memberships m ON m.organization_id = e.organization_id
			WHERE ri.id = ${impactId} AND ri.event_id = ${eventId}
			  AND e.status IN ('draft', 'review')
			  AND m.user_id = ${currentUser.id}
			  AND m.role = 'organizer'
			FOR UPDATE OF ri
		),
		updated AS (
			UPDATE road_impacts ri
			SET
				road_segment_id = ${newSegmentId},
				planned_from = ${newPlannedFrom},
				planned_to = ${newPlannedTo},
				impact_type = ${newImpactType},
				diversion_note = ${newDiversionNote}
			FROM current_impact ci
			WHERE ri.id = ci.id
			RETURNING ri.*, ci.road_segment_id AS old_segment_id, ci.planned_from AS old_planned_from, ci.planned_to AS old_planned_to, ci.impact_type AS old_impact_type, ci.diversion_note AS old_diversion_note, ci.organization_id
		),
		updated_event AS (
			UPDATE events
			SET status = 'draft', verified_by = NULL, verified_at = NULL, updated_at = ${now}
			FROM current_impact ci
			WHERE events.id = ci.event_id AND events.status = 'review'
			RETURNING events.id
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, u.organization_id, ${eventId}, ${currentUser.id}, 'road_impact.updated', 'road_impact', u.id,
				json_build_object(
					'roadSegmentId', u.old_segment_id,
					'plannedFrom', u.old_planned_from,
					'plannedTo', u.old_planned_to,
					'impactType', u.old_impact_type,
					'diversionNote', u.old_diversion_note
				),
				json_build_object(
					'roadSegmentId', u.road_segment_id,
					'plannedFrom', u.planned_from,
					'plannedTo', u.planned_to,
					'impactType', u.impact_type,
					'diversionNote', u.diversion_note
				),
				${now}
			FROM updated u
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			road_segment_id AS "roadSegmentId",
			planned_from AS "plannedFrom",
			planned_to AS "plannedTo",
			impact_type AS "impactType",
			diversion_note AS "diversionNote",
			created_at AS "createdAt"
		FROM updated;
	`;

	const res = await db.execute(query);
	const row = res.rows[0];

	if (!row) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Road impact could not be updated. Ensure event is in draft or review status and you are an authorized organizer.",
			409,
		);
	}

	const impactData = {
		id: row.id as string,
		eventId: row.eventId as string,
		roadSegmentId: row.roadSegmentId as string,
		plannedFrom: new Date(row.plannedFrom as string).toISOString(),
		plannedTo: new Date(row.plannedTo as string).toISOString(),
		impactType: row.impactType as string,
		diversionNote: (row.diversionNote as string | null) ?? null,
		createdAt: new Date(row.createdAt as string).toISOString(),
	};

	return c.json(
		{
			impact: impactData,
			roadImpact: impactData,
		},
		200,
	);
});

// 3. Live Road Status Router: /api/road-impacts/:impactId/status
export const roadStatusRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

roadStatusRouter.use("*", requireAuth);

// Helper: Assert officer has traffic update assignment on the impact's event
async function assertEventTrafficOfficer(
	c: Parameters<typeof sendError>[0],
	eventId: string,
	userId: string,
) {
	const db = c.get("db");

	// 1. Check direct event assignment with canUpdateTraffic
	const assignments = await db
		.select()
		.from(eventAssignments)
		.where(
			and(
				eq(eventAssignments.eventId, eventId),
				eq(eventAssignments.userId, userId),
				eq(eventAssignments.canUpdateTraffic, true),
			),
		)
		.limit(1);

	if (assignments.length > 0) {
		return { authorized: true };
	}

	// 2. Alternatively, organizer of the hosting organization has administrative override
	const eventRows = await db
		.select({ organizationId: events.organizationId })
		.from(events)
		.where(eq(events.id, eventId))
		.limit(1);

	if (eventRows.length > 0) {
		const orgId = eventRows[0].organizationId;
		const memberRows = await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.organizationId, orgId),
					eq(memberships.userId, userId),
					eq(memberships.role, "organizer"),
				),
			)
			.limit(1);

		if (memberRows.length > 0) {
			return { authorized: true };
		}
	}

	return {
		error: sendError(
			c,
			"FORBIDDEN",
			"Field officer traffic update permission required for this event.",
			403,
		),
	};
}

// POST /api/road-impacts/:impactId/status - Update live road status
roadStatusRouter.post("/:impactId/status", async (c) => {
	const currentUser = c.get("user")!;
	const impactId = c.req.param("impactId");

	const idValidation = uuidParamSchema.safeParse(impactId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid road impact ID format.", 422);
	}

	const db = c.get("db");

	// Find road impact and event details
	const impactRows = await db
		.select({
			id: roadImpacts.id,
			eventId: roadImpacts.eventId,
			eventStatus: events.status,
			organizationId: events.organizationId,
		})
		.from(roadImpacts)
		.innerJoin(events, eq(roadImpacts.eventId, events.id))
		.where(eq(roadImpacts.id, impactId))
		.limit(1);

	const impact = impactRows[0];
	if (!impact) {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
	}

	// Verify event lifecycle: road status updates are live operations on published or active events
	if (
		impact.eventStatus !== "published" &&
		impact.eventStatus !== "active"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road status updates are only permitted on published or active events. Current event status: ${impact.eventStatus}.`,
			409,
		);
	}

	// Verify caller authorization
	const authCheck = await assertEventTrafficOfficer(
		c,
		impact.eventId,
		currentUser.id,
	);
	if (authCheck.error) return authCheck.error;

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createRoadStatusSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid road status update data.",
			422,
		);
	}

	const data = parseResult.data;
	const now = new Date();
	const observedDate = new Date(data.observedAt);

	// Observation timestamp cannot be more than 5 minutes in the future
	if (observedDate.getTime() > now.getTime() + 5 * 60 * 1000) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Observation timestamp cannot be more than 5 minutes in the future.",
			422,
		);
	}

	// Server enforces 30-minute status TTL from observation time
	const TTL_MS = 30 * 60 * 1000;
	const expiresAtDate = new Date(observedDate.getTime() + TTL_MS);

	// Fast-path Idempotency Check: compare entire normalized operation
	const existingUpdate = await db
		.select()
		.from(roadStatusUpdates)
		.where(eq(roadStatusUpdates.mutationId, data.mutationId))
		.limit(1);

	if (existingUpdate.length > 0) {
		const existing = existingUpdate[0];
		// Compare entire normalized operation: actor, tenant/impact, status, observation, note
		const isIdentical =
			existing.roadImpactId === impactId &&
			existing.updatedBy === currentUser.id &&
			existing.status === data.status &&
			Math.abs(existing.observedAt.getTime() - observedDate.getTime()) <= 1000 &&
			(existing.note ?? null) === (data.note ?? null);

		if (isIdentical) {
			return c.json(
				{
					status: existing.status,
					observedAt: existing.observedAt.toISOString(),
					expiresAt: existing.expiresAt.toISOString(),
					updatedBy: existing.updatedBy,
				},
				200,
			);
		}

		// Conflict: reused mutation ID with mismatched payload or actor (prevent cross-tenant leak)
		return sendError(
			c,
			"STATE_CONFLICT",
			"Mutation ID has already been used with different parameters.",
			409,
		);
	}

	const updateId = crypto.randomUUID();
	const auditId = crypto.randomUUID();

	// Atomic insert with authoritative lock verifying event is published/active and actor has traffic permissions
	const query = sql`
		WITH checked_impact AS (
			SELECT ri.id, e.id AS event_id, e.organization_id
			FROM road_impacts ri
			JOIN events e ON e.id = ri.event_id
			LEFT JOIN event_assignments ea ON ea.event_id = e.id AND ea.user_id = ${currentUser.id} AND ea.can_update_traffic = true
			LEFT JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = ${currentUser.id} AND m.role = 'organizer'
			WHERE ri.id = ${impactId}
			  AND e.status IN ('published', 'active')
			  AND (ea.id IS NOT NULL OR m.id IS NOT NULL)
			FOR UPDATE OF ri
		),
		inserted AS (
			INSERT INTO road_status_updates (
				id, road_impact_id, status, observed_at, expires_at, updated_by, note, mutation_id, created_at
			)
			SELECT
				${updateId}, ci.id, ${data.status}, ${observedDate}, ${expiresAtDate},
				${currentUser.id}, ${data.note ?? null}, ${data.mutationId}, ${now}
			FROM checked_impact ci
			ON CONFLICT (mutation_id) DO NOTHING
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ci.organization_id, ci.event_id, ${currentUser.id}, 'road_status.updated', 'road_status_update', i.id, null,
				json_build_object(
					'status', i.status,
					'observedAt', i.observed_at,
					'expiresAt', i.expires_at,
					'mutationId', i.mutation_id
				),
				${now}
			FROM inserted i
			JOIN checked_impact ci ON ci.id = i.road_impact_id
			RETURNING id
		)
		SELECT
			status,
			observed_at AS "observedAt",
			expires_at AS "expiresAt",
			updated_by AS "updatedBy"
		FROM inserted;
	`;

	const res = await db.execute(query);

	if (res.rows.length === 0) {
		// Concurrent execution collision: check if same mutation_id was inserted by a concurrent thread
		const concurrentRow = await db
			.select()
			.from(roadStatusUpdates)
			.where(eq(roadStatusUpdates.mutationId, data.mutationId))
			.limit(1);

		if (concurrentRow.length > 0) {
			const existing = concurrentRow[0];
			// Strictly compare normalized operation on concurrent path
			const isIdentical =
				existing.roadImpactId === impactId &&
				existing.updatedBy === currentUser.id &&
				existing.status === data.status &&
				Math.abs(existing.observedAt.getTime() - observedDate.getTime()) <= 1000 &&
				(existing.note ?? null) === (data.note ?? null);

			if (isIdentical) {
				return c.json(
					{
						status: existing.status,
						observedAt: existing.observedAt.toISOString(),
						expiresAt: existing.expiresAt.toISOString(),
						updatedBy: existing.updatedBy,
					},
					200,
				);
			}

			return sendError(
				c,
				"STATE_CONFLICT",
				"Mutation ID has already been used with different parameters.",
				409,
			);
		}

		return sendError(
			c,
			"STATE_CONFLICT",
			"Road status update could not be applied due to event lifecycle or assignment changes.",
			409,
		);
	}

	const row = res.rows[0];
	return c.json(
		{
			status: row.status as string,
			observedAt:
				row.observedAt instanceof Date
					? row.observedAt.toISOString()
					: (row.observedAt as string),
			expiresAt:
				row.expiresAt instanceof Date
					? row.expiresAt.toISOString()
					: (row.expiresAt as string),
			updatedBy: row.updatedBy as string,
		},
		200,
	);
});
