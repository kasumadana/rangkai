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

	const query = sql`
		WITH inserted AS (
			INSERT INTO road_impacts (
				id, event_id, road_segment_id, planned_from, planned_to, impact_type, diversion_note, created_at
			)
			VALUES (
				${impactId}, ${eventId}, ${data.roadSegmentId}, ${plannedFromDate}, ${plannedToDate},
				${data.impactType}, ${data.diversionNote ?? null}, ${now}
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
				${auditId}, ${event.organizationId}, ${eventId}, ${currentUser.id}, 'road_impact.created', 'road_impact', id, null,
				json_build_object(
					'roadSegmentId', road_segment_id,
					'plannedFrom', planned_from,
					'plannedTo', planned_to,
					'impactType', impact_type
				),
				${now}
			FROM inserted
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

	return c.json(
		{
			roadImpact: {
				id: row.id as string,
				eventId: row.eventId as string,
				roadSegmentId: row.roadSegmentId as string,
				plannedFrom: new Date(row.plannedFrom as string),
				plannedTo: new Date(row.plannedTo as string),
				impactType: row.impactType as string,
				diversionNote: (row.diversionNote ?? null) as string | null,
				createdAt: new Date(row.createdAt as string),
			},
		},
		201,
	);
});

// GET /api/events/:eventId/road-impacts - List impacts for an event
roadImpactsRouter.get("/:eventId/road-impacts", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");

	// Verify caller has access to view event
	const eventRows = await db
		.select()
		.from(events)
		.where(eq(events.id, eventId))
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}

	// Membership check
	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, event.organizationId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	const membership = memberRows[0];
	if (!membership) {
		return sendError(c, "FORBIDDEN", "You do not have access to this event.", 403);
	}

	// If officer, verify assignment
	if (membership.role === "officer") {
		const assignment = await db
			.select()
			.from(eventAssignments)
			.where(
				and(
					eq(eventAssignments.eventId, eventId),
					eq(eventAssignments.userId, currentUser.id),
				),
			)
			.limit(1);

		if (assignment.length === 0) {
			return sendError(
				c,
				"FORBIDDEN",
				"You are not assigned to this event.",
				403,
			);
		}
	}

	const query = sql`
		SELECT
			ri.id,
			ri.event_id AS "eventId",
			ri.road_segment_id AS "roadSegmentId",
			rs.display_name AS "roadSegmentName",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.impact_type AS "impactType",
			ri.diversion_note AS "diversionNote",
			ri.created_at AS "createdAt"
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
		roadSegmentName: row.roadSegmentName as string,
		plannedFrom: new Date(row.plannedFrom as string),
		plannedTo: new Date(row.plannedTo as string),
		impactType: row.impactType as string,
		diversionNote: (row.diversionNote ?? null) as string | null,
		createdAt: new Date(row.createdAt as string),
	}));

	return c.json({ roadImpacts: impacts }, 200);
});

// PATCH /api/events/:eventId/road-impacts/:impactId - Edit road impact
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

	if (event.status === "published" || event.status === "active") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road impacts can only be modified prior to publication. Current status: ${event.status}.`,
			409,
		);
	}
	if (event.status === "completed" || event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot edit road impacts on an event in terminal status: ${event.status}.`,
			409,
		);
	}

	const db = c.get("db");
	const impactRows = await db
		.select()
		.from(roadImpacts)
		.where(
			and(eq(roadImpacts.id, impactId), eq(roadImpacts.eventId, eventId)),
		)
		.limit(1);

	const existingImpact = impactRows[0];
	if (!existingImpact) {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
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
			parseResult.error.issues[0]?.message || "Invalid update data.",
			422,
		);
	}

	const data = parseResult.data;

	let newSegmentId = existingImpact.roadSegmentId;
	if (data.roadSegmentId && data.roadSegmentId !== existingImpact.roadSegmentId) {
		const segRows = await db
			.select({
				id: roadSegments.id,
				verifiedBy: roadSegments.verifiedBy,
				verifiedAt: roadSegments.verifiedAt,
			})
			.from(roadSegments)
			.where(eq(roadSegments.id, data.roadSegmentId))
			.limit(1);

		const seg = segRows[0];
		if (!seg || !seg.verifiedBy || !seg.verifiedAt) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Referenced road segment does not exist or has not been verified.",
				422,
			);
		}
		newSegmentId = data.roadSegmentId;
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

	const newImpactType = data.impactType ?? existingImpact.impactType;
	const newDiversionNote =
		data.diversionNote !== undefined
			? data.diversionNote
			: existingImpact.diversionNote;

	const auditId = crypto.randomUUID();
	const now = new Date();

	const beforeSnapshot = {
		roadSegmentId: existingImpact.roadSegmentId,
		plannedFrom: existingImpact.plannedFrom.toISOString(),
		plannedTo: existingImpact.plannedTo.toISOString(),
		impactType: existingImpact.impactType,
		diversionNote: existingImpact.diversionNote,
	};

	const afterSnapshot = {
		roadSegmentId: newSegmentId,
		plannedFrom: newPlannedFrom.toISOString(),
		plannedTo: newPlannedTo.toISOString(),
		impactType: newImpactType,
		diversionNote: newDiversionNote,
	};

	const query = sql`
		WITH updated AS (
			UPDATE road_impacts
			SET
				road_segment_id = ${newSegmentId},
				planned_from = ${newPlannedFrom},
				planned_to = ${newPlannedTo},
				impact_type = ${newImpactType},
				diversion_note = ${newDiversionNote}
			WHERE id = ${impactId} AND event_id = ${eventId}
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
				${auditId}, ${event.organizationId}, ${eventId}, ${currentUser.id}, 'road_impact.updated', 'road_impact', id,
				${JSON.stringify(beforeSnapshot)}::jsonb,
				${JSON.stringify(afterSnapshot)}::jsonb,
				${now}
			FROM updated
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
	if (res.rows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Road impact could not be updated.",
			409,
		);
	}

	const row = res.rows[0];
	return c.json(
		{
			roadImpact: {
				id: row.id as string,
				eventId: row.eventId as string,
				roadSegmentId: row.roadSegmentId as string,
				plannedFrom: new Date(row.plannedFrom as string),
				plannedTo: new Date(row.plannedTo as string),
				impactType: row.impactType as string,
				diversionNote: (row.diversionNote ?? null) as string | null,
				createdAt: new Date(row.createdAt as string),
			},
		},
		200,
	);
});

// 3. Road Status Updates Router: POST /api/road-impacts/:impactId/status
export const roadStatusRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

roadStatusRouter.use("*", requireAuth);

roadStatusRouter.post("/:impactId/status", async (c) => {
	const currentUser = c.get("user")!;
	const impactId = c.req.param("impactId");

	const idValidation = uuidParamSchema.safeParse(impactId);
	if (!idValidation.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid road impact ID format.",
			422,
		);
	}

	const db = c.get("db");

	// Query impact and associated event
	const impactRows = await db
		.select({
			impactId: roadImpacts.id,
			eventId: roadImpacts.eventId,
			organizationId: events.organizationId,
			eventStatus: events.status,
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

	// Authorization check: organizer of organization OR assigned officer with canUpdateTraffic
	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, impact.organizationId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	const membership = memberRows[0];
	if (!membership) {
		return sendError(
			c,
			"FORBIDDEN",
			"You are not a member of the event organization.",
			403,
		);
	}

	if (membership.role !== "organizer") {
		// Field officer: must have active event assignment with canUpdateTraffic
		const assignmentRows = await db
			.select({ canUpdateTraffic: eventAssignments.canUpdateTraffic })
			.from(eventAssignments)
			.where(
				and(
					eq(eventAssignments.eventId, impact.eventId),
					eq(eventAssignments.userId, currentUser.id),
				),
			)
			.limit(1);

		const assignment = assignmentRows[0];
		if (!assignment || !assignment.canUpdateTraffic) {
			return sendError(
				c,
				"FORBIDDEN",
				"You do not have traffic update permissions for this event.",
				403,
			);
		}
	}

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
			parseResult.error.issues[0]?.message || "Invalid status payload.",
			422,
		);
	}

	const data = parseResult.data;
	const now = new Date();
	const observedDate = new Date(data.observedAt);

	// Validate observation timestamp bounds: reject future timestamps beyond 5m skew, or older than 24h
	const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000; // 5 minutes
	const MAX_PAST_SKEW_MS = 24 * 60 * 60 * 1000; // 24 hours

	if (observedDate.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Observed time cannot be more than 5 minutes in the future.",
			422,
		);
	}
	if (observedDate.getTime() < now.getTime() - MAX_PAST_SKEW_MS) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Observed time cannot be older than 24 hours.",
			422,
		);
	}

	// Server assigns authoritative TTL = 30 minutes
	const TTL_MS = 30 * 60 * 1000;
	const expiresAtDate = new Date(now.getTime() + TTL_MS);

	// Idempotency check via mutationId
	const existingUpdate = await db
		.select()
		.from(roadStatusUpdates)
		.where(eq(roadStatusUpdates.mutationId, data.mutationId))
		.limit(1);

	if (existingUpdate.length > 0) {
		const existing = existingUpdate[0];
		// If identical payload & actor, return original result idempotently
		const isIdentical =
			existing.roadImpactId === impactId &&
			existing.status === data.status &&
			existing.updatedBy === currentUser.id;

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

		// Conflict: reused mutation ID with mismatched payload or actor
		return sendError(
			c,
			"STATE_CONFLICT",
			"Mutation ID has already been used with different parameters.",
			409,
		);
	}

	const updateId = crypto.randomUUID();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH inserted AS (
			INSERT INTO road_status_updates (
				id, road_impact_id, status, observed_at, expires_at, updated_by, note, mutation_id, created_at
			)
			VALUES (
				${updateId}, ${impactId}, ${data.status}, ${observedDate}, ${expiresAtDate},
				${currentUser.id}, ${data.note ?? null}, ${data.mutationId}, ${now}
			)
			ON CONFLICT (mutation_id) DO NOTHING
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${impact.organizationId}, ${impact.eventId}, ${currentUser.id}, 'road_status.updated', 'road_status_update', id, null,
				json_build_object(
					'status', status,
					'observedAt', observed_at,
					'expiresAt', expires_at,
					'mutationId', mutation_id
				),
				${now}
			FROM inserted
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
		// Concurrent execution established the mutation row
		const concurrentRow = await db
			.select()
			.from(roadStatusUpdates)
			.where(eq(roadStatusUpdates.mutationId, data.mutationId))
			.limit(1);

		if (concurrentRow.length > 0) {
			const existing = concurrentRow[0];
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
			"Road status update could not be applied.",
			409,
		);
	}

	const row = res.rows[0];
	return c.json(
		{
			status: row.status as string,
			observedAt: new Date(row.observedAt as string).toISOString(),
			expiresAt: new Date(row.expiresAt as string).toISOString(),
			updatedBy: row.updatedBy as string,
		},
		200,
	);
});
