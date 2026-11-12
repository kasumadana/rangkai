import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
	eventAssignments,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import { generateUniquePublicSlug } from "../services/slug";
import type { AppVariables, Env } from "../types";
import {
	cancelEventSchema,
	createEventSchema,
	listEventsQuerySchema,
	updateEventSchema,
	uuidParamSchema,
} from "../validators/events";

const eventsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

eventsRouter.use("*", requireAuth);

// Helper: Map SQL CTE row to typed Event structure
function mapEventRow(row: Record<string, unknown>) {
	return {
		id: row.id as string,
		organizationId: row.organizationId as string,
		createdBy: row.createdBy as string,
		title: row.title as string,
		category: (row.category ?? null) as string | null,
		description: (row.description ?? null) as string | null,
		venueName: (row.venueName ?? null) as string | null,
		venueLocation: row.venueLocation ?? null,
		startsAt: row.startsAt ? new Date(row.startsAt as string) : null,
		endsAt: row.endsAt ? new Date(row.endsAt as string) : null,
		status: row.status as string,
		isSimulation: row.isSimulation !== undefined ? Boolean(row.isSimulation) : true,
		publicSlug: (row.publicSlug ?? null) as string | null,
		permitReference: (row.permitReference ?? null) as string | null,
		verifiedBy: (row.verifiedBy ?? null) as string | null,
		verifiedAt: row.verifiedAt ? new Date(row.verifiedAt as string) : null,
		publishedAt: row.publishedAt ? new Date(row.publishedAt as string) : null,
		createdAt: new Date(row.createdAt as string),
		updatedAt: new Date(row.updatedAt as string),
	};
}

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

// POST /api/events - Create draft event atomically with audit log
eventsRouter.post("/", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createEventSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid event data.",
			422,
		);
	}

	const data = parseResult.data;

	// Verify caller is an organizer in the target organization
	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, data.organizationId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	const membership = memberRows[0];
	if (!membership) {
		return sendError(
			c,
			"FORBIDDEN",
			"You are not a member of this organization.",
			403,
		);
	}

	if (membership.role !== "organizer") {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to create events.",
			403,
		);
	}

	const isSimulation = data.isSimulation !== false;
	if (!isSimulation) {
		const orgRows = await db
			.select({ hasOperationalAuthority: organizations.hasOperationalAuthority })
			.from(organizations)
			.where(eq(organizations.id, data.organizationId))
			.limit(1);

		if (!orgRows[0]?.hasOperationalAuthority) {
			return sendError(
				c,
				"FORBIDDEN",
				"Organisasi belum memiliki otoritas operasional resmi. Kegiatan hanya dapat dibuat dalam mode simulasi.",
				403,
			);
		}
	}

	const eventId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const startsAtDate = data.startsAt ? new Date(data.startsAt) : null;
	const endsAtDate = data.endsAt ? new Date(data.endsAt) : null;

	// Single atomic CTE: event creation + conditional append-only audit log
	const query = sql`
		WITH inserted AS (
			INSERT INTO events (
				id, organization_id, created_by, title, category, description,
				venue_name, venue_location, starts_at, ends_at, permit_reference, status, is_simulation, created_at, updated_at
			)
			VALUES (
				${eventId}, ${data.organizationId}, ${currentUser.id}, ${data.title},
				${data.category ?? null}, ${data.description ?? null}, ${data.venueName ?? null}, ${data.venueLocation ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.venueLocation)}), 4326)` : sql`NULL`},
				${startsAtDate}, ${endsAtDate}, ${data.permitReference ?? null}, 'draft', ${isSimulation}, ${now}, ${now}
			)
			RETURNING *
		),
		stale_reviews AS (
			UPDATE road_review_requests q SET status='superseded',reason='Event time or simulation mode changed after reviewer submission.'
			FROM inserted e
			WHERE q.event_id=e.id AND q.status IN ('pending','approved')
				AND (q.event_starts_at IS DISTINCT FROM e.starts_at OR q.event_ends_at IS DISTINCT FROM e.ends_at OR q.is_simulation IS DISTINCT FROM e.is_simulation)
			RETURNING q.id
		),
		stale_review_audit AS (
			INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id)
			SELECT ${currentUser.id},'road_review.superseded','road_review_request',id::text,'Event time or simulation mode changed after reviewer submission.',${c.get("requestId")}
			FROM stale_reviews RETURNING id
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, organization_id, id, ${currentUser.id}, 'event.created', 'event', id, null,
				json_build_object(
					'title', title,
					'status', status,
					'isSimulation', is_simulation,
					'venueLocation', ST_AsGeoJSON(venue_location)::json,
					'startsAt', starts_at,
					'endsAt', ends_at
				),
				${now}
			FROM inserted
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
			ST_AsGeoJSON(venue_location)::json AS "venueLocation",
			starts_at AS "startsAt",
			ends_at AS "endsAt",
			status,
			is_simulation AS "isSimulation",
			public_slug AS "publicSlug",
			permit_reference AS "permitReference",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			published_at AS "publishedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM inserted;
	`;

	const res = await db.execute(query);
	return c.json({ event: mapEventRow(res.rows[0]) }, 201);
});

// GET /api/events - List accessible events with bounded pagination and officer assignment scoping
eventsRouter.get("/", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	const queryParse = listEventsQuerySchema.safeParse(c.req.query());
	if (!queryParse.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			queryParse.error.issues[0]?.message || "Invalid query parameters.",
			422,
		);
	}
	const { page, limit, status: queryStatus, organizationId: queryOrgId } =
		queryParse.data;

	// Query organizations where user has active membership
	const userMemberships = await db
		.select({
			organizationId: memberships.organizationId,
			role: memberships.role,
		})
		.from(memberships)
		.where(eq(memberships.userId, currentUser.id));

	if (userMemberships.length === 0) {
		return c.json(
			{
				events: [],
				pagination: { page, limit, total: 0, totalPages: 0 },
			},
			200,
		);
	}

	const accessibleOrgIds = userMemberships.map((m) => m.organizationId);

	// Filter by specific organizationId if requested
	let effectiveMemberships = userMemberships;
	if (queryOrgId) {
		if (!accessibleOrgIds.includes(queryOrgId)) {
			return sendError(
				c,
				"FORBIDDEN",
				"You are not a member of the requested organization.",
				403,
			);
		}
		effectiveMemberships = userMemberships.filter(
			(m) => m.organizationId === queryOrgId,
		);
	}

	const organizerOrgIds = effectiveMemberships
		.filter((m) => m.role === "organizer")
		.map((m) => m.organizationId);
	const officerOrgIds = effectiveMemberships
		.filter((m) => m.role === "officer")
		.map((m) => m.organizationId);

	let assignedEventIds: string[] = [];
	if (officerOrgIds.length > 0) {
		const officerAssignments = await db
			.select({ eventId: eventAssignments.eventId })
			.from(eventAssignments)
			.innerJoin(events, eq(eventAssignments.eventId, events.id))
			.where(
				and(
					eq(eventAssignments.userId, currentUser.id),
					inArray(events.organizationId, officerOrgIds),
				),
			);
		assignedEventIds = officerAssignments.map((a) => a.eventId);
	}

	// Build visibility predicate: organizers see org events; officers see ONLY assigned events
	const scopeConditions: ReturnType<typeof sql>[] = [];
	if (organizerOrgIds.length > 0 && assignedEventIds.length > 0) {
		scopeConditions.push(
			sql`(${inArray(events.organizationId, organizerOrgIds)} OR ${inArray(events.id, assignedEventIds)})`,
		);
	} else if (organizerOrgIds.length > 0) {
		scopeConditions.push(inArray(events.organizationId, organizerOrgIds));
	} else if (assignedEventIds.length > 0) {
		scopeConditions.push(inArray(events.id, assignedEventIds));
	} else {
		// User is an officer with zero assignments in requested org(s) -> empty result
		return c.json(
			{
				events: [],
				pagination: { page, limit, total: 0, totalPages: 0 },
			},
			200,
		);
	}

	const filterConditions = [...scopeConditions];
	if (queryStatus) {
		filterConditions.push(eq(events.status, queryStatus));
	}
	const whereClause = and(...filterConditions);

	// Query total count for stable pagination
	const countResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(events)
		.where(whereClause);
	const total = countResult[0]?.count ?? 0;
	const totalPages = Math.ceil(total / limit);
	const offset = (page - 1) * limit;

	const eventList = await db
		.select()
		.from(events)
		.where(whereClause)
		.orderBy(desc(events.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json(
		{
			events: eventList.map((ev) => {
				if (organizerOrgIds.includes(ev.organizationId)) {
					return ev;
				}
				const officerSafe = { ...ev };
				delete (officerSafe as { contactInformation?: unknown }).contactInformation;
				return officerSafe;
			}),
			pagination: {
				page,
				limit,
				total,
				totalPages,
			},
		},
		200,
	);
});

// GET /api/events/:eventId - Detail view with assignment-scoped access check
eventsRouter.get("/:eventId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const accessResult = await getEventAndCheckAccess(
		db,
		eventId,
		currentUser.id,
	);

	if (accessResult === "NOT_FOUND") {
		return sendError(
			c,
			"NOT_FOUND",
			"Event not found or not accessible.",
			404,
		);
	}

	if (accessResult === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to view this event.",
			403,
		);
	}

	const venueRows = await db.select({ venueLocation: sql<unknown>`ST_AsGeoJSON(${events.venueLocation})::json` }).from(events).where(eq(events.id, eventId)).limit(1);
	const venueLocation = venueRows[0]?.venueLocation ?? null;
	if (!accessResult.isOrganizer) {
		const officerSafe = { ...accessResult.event };
		delete (officerSafe as { contactInformation?: unknown }).contactInformation;
		return c.json({ event: { ...officerSafe, venueLocation } }, 200);
	}
	return c.json({ event: { ...accessResult.event, venueLocation } }, 200);
});

// PATCH /api/events/:eventId - Edit event details (Organizer only)
eventsRouter.patch("/:eventId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const existingEvent = check.event;

	// Published and active events cannot be edited via PATCH (FR-011: edits must occur prior to publication)
	if (
		existingEvent.status === "published" ||
		existingEvent.status === "active"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Published and active events cannot be edited via PATCH. Current status: ${existingEvent.status}. Edits must occur prior to publication.`,
			409,
		);
	}

	// Terminal lifecycle states cannot be edited
	if (
		existingEvent.status === "completed" ||
		existingEvent.status === "cancelled"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot edit an event in terminal status: ${existingEvent.status}.`,
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = updateEventSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid update data.",
			422,
		);
	}

	const data = parseResult.data;
	const venueRows = await c.get("db").select({ venueLocation: sql<unknown>`ST_AsGeoJSON(${events.venueLocation})::json` }).from(events).where(eq(events.id, eventId)).limit(1);
	const previousVenue = venueRows[0]?.venueLocation ?? null;

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

	// Stale verification check: if event is in "review" and ANY editable field is modified,
	// clear previous verification and reset status to "draft" for human re-review.
	let nextStatus = existingEvent.status;
	let nextVerifiedBy = existingEvent.verifiedBy;
	let nextVerifiedAt = existingEvent.verifiedAt;

	if (existingEvent.status === "review") {
		const isModified =
			(data.isSimulation !== undefined && data.isSimulation !== existingEvent.isSimulation) ||
			(data.title !== undefined && data.title !== existingEvent.title) ||
			(data.category !== undefined && data.category !== existingEvent.category) ||
			(data.description !== undefined && data.description !== existingEvent.description) ||
			(data.venueName !== undefined && data.venueName !== existingEvent.venueName) ||
			(data.venueLocation !== undefined && JSON.stringify(data.venueLocation) !== JSON.stringify(previousVenue)) ||
			(data.permitReference !== undefined && data.permitReference !== existingEvent.permitReference) ||
			(data.startsAt !== undefined && startsAtDate?.getTime() !== existingEvent.startsAt?.getTime()) ||
			(data.endsAt !== undefined && endsAtDate?.getTime() !== existingEvent.endsAt?.getTime());

		if (isModified) {
			nextStatus = "draft";
			nextVerifiedBy = null;
			nextVerifiedAt = null;
		}
	}

	const newTitle = data.title ?? existingEvent.title;
	const newCategory =
		data.category !== undefined ? data.category : existingEvent.category;
	const newDescription =
		data.description !== undefined ? data.description : existingEvent.description;
	const newVenueName =
		data.venueName !== undefined ? data.venueName : existingEvent.venueName;
	const newPermitReference =
		data.permitReference !== undefined
			? data.permitReference
			: existingEvent.permitReference;

	const now = new Date();
	const auditId = crypto.randomUUID();
	const db = c.get("db");
	const nextSimulation = data.isSimulation ?? existingEvent.isSimulation;
	if (!nextSimulation || !existingEvent.isSimulation) {
		const [org] = await db.select({ authorized: organizations.hasOperationalAuthority }).from(organizations).where(eq(organizations.id, existingEvent.organizationId));
		if (!org?.authorized) return sendError(c, "FORBIDDEN", "Wewenang operasional organisasi tidak aktif.", 403);
	}

	// Single atomic CTE: event update with full-field snapshot CAS verification
	// and conditional audit log ONLY if row was actually updated
	const query = sql`
		WITH authority AS MATERIALIZED (
			SELECT has_operational_authority FROM organizations WHERE id = ${existingEvent.organizationId} FOR SHARE
		), updated AS (
			UPDATE events
			SET
				title = ${data.title !== undefined ? newTitle : existingEvent.title},
				category = ${data.category !== undefined ? newCategory : existingEvent.category},
				description = ${data.description !== undefined ? newDescription : existingEvent.description},
				venue_name = ${data.venueName !== undefined ? newVenueName : existingEvent.venueName},
				venue_location = ${data.venueLocation === undefined ? sql`venue_location` : data.venueLocation === null ? sql`NULL` : sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.venueLocation)}), 4326)`},
				starts_at = ${data.startsAt !== undefined ? startsAtDate : existingEvent.startsAt},
				ends_at = ${data.endsAt !== undefined ? endsAtDate : existingEvent.endsAt},
				permit_reference = ${data.permitReference !== undefined ? newPermitReference : existingEvent.permitReference},
				is_simulation = ${nextSimulation},
				status = ${nextStatus},
				verified_by = ${nextVerifiedBy},
				verified_at = ${nextVerifiedAt},
				updated_at = ${now}
			WHERE id = ${eventId}
				AND ((${nextSimulation} AND ${existingEvent.isSimulation}) OR EXISTS (SELECT 1 FROM authority WHERE has_operational_authority))
				AND is_simulation = ${existingEvent.isSimulation}
				AND status = ${existingEvent.status}
				AND title = ${existingEvent.title}
				AND category IS NOT DISTINCT FROM ${existingEvent.category}
				AND description IS NOT DISTINCT FROM ${existingEvent.description}
				AND venue_name IS NOT DISTINCT FROM ${existingEvent.venueName}
				AND venue_location IS NOT DISTINCT FROM ${existingEvent.venueLocation}::geometry
				AND (starts_at IS NOT DISTINCT FROM ${existingEvent.startsAt} OR abs(extract(epoch from (starts_at - ${existingEvent.startsAt}::timestamptz))) < 0.005)
				AND (ends_at IS NOT DISTINCT FROM ${existingEvent.endsAt} OR abs(extract(epoch from (ends_at - ${existingEvent.endsAt}::timestamptz))) < 0.005)
				AND permit_reference IS NOT DISTINCT FROM ${existingEvent.permitReference}
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				organization_id,
				id,
				${currentUser.id},
				'event.updated',
				'event',
				id,
				${JSON.stringify({
					title: existingEvent.title,
					category: existingEvent.category,
					description: existingEvent.description,
					venueName: existingEvent.venueName,
					venueLocation: previousVenue,
					startsAt: existingEvent.startsAt?.toISOString() ?? null,
					endsAt: existingEvent.endsAt?.toISOString() ?? null,
					permitReference: existingEvent.permitReference,
					status: existingEvent.status,
				})}::jsonb,
				json_build_object(
					'title', title,
					'category', category,
					'description', description,
					'venueName', venue_name,
					'venueLocation', ST_AsGeoJSON(venue_location)::json,
					'startsAt', starts_at,
					'endsAt', ends_at,
					'permitReference', permit_reference,
					'status', status
				),
				${now}
			FROM updated
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
			ST_AsGeoJSON(venue_location)::json AS "venueLocation",
			starts_at AS "startsAt",
			ends_at AS "endsAt",
			status,
			is_simulation AS "isSimulation",
			public_slug AS "publicSlug",
			permit_reference AS "permitReference",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			published_at AS "publishedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
			,(SELECT count(*)::int FROM stale_reviews) AS "invalidatedReviewCount"
		FROM updated;
	`;

	const res = await db.execute(query);
	if (res.rows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented event update.",
			409,
		);
	}

	return c.json({ event: mapEventRow(res.rows[0]) }, 200);
});

// POST /api/events/:eventId/review - Move draft -> review
eventsRouter.post("/:eventId/review", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;

	// Allowed predecessor check: only draft can move to review
	if (event.status !== "draft") {
		if (event.status === "review") {
			return c.json({ event }, 200); // Idempotent return
		}
		return sendError(
			c,
			"STATE_CONFLICT",
			`Event cannot transition to review from status: ${event.status}. Only draft events may be reviewed.`,
			409,
		);
	}

	// Review validation: core fields must be present and verified
	if (!event.title || !event.startsAt || !event.endsAt || !event.venueName) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Event review requires confirmed core fields: title, startsAt, endsAt, venueName.",
			422,
		);
	}

	const now = new Date();
	const auditId = crypto.randomUUID();
	const db = c.get("db");

	// Atomic single CTE: transition draft -> review AND audit log only if actually transitioned
	const query = sql`
		WITH updated AS (
			UPDATE events
			SET
				status = 'review',
				verified_by = ${currentUser.id},
				verified_at = ${now},
				updated_at = ${now}
			WHERE id = ${eventId}
				AND status = 'draft'
				AND title = ${event.title}
				AND category IS NOT DISTINCT FROM ${event.category}
				AND description IS NOT DISTINCT FROM ${event.description}
				AND venue_name IS NOT DISTINCT FROM ${event.venueName}
				AND venue_location IS NOT DISTINCT FROM ${event.venueLocation}::geometry
				AND (starts_at IS NOT DISTINCT FROM ${event.startsAt} OR abs(extract(epoch from (starts_at - ${event.startsAt}::timestamptz))) < 0.005)
				AND (ends_at IS NOT DISTINCT FROM ${event.endsAt} OR abs(extract(epoch from (ends_at - ${event.endsAt}::timestamptz))) < 0.005)
				AND permit_reference IS NOT DISTINCT FROM ${event.permitReference}
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				organization_id,
				id,
				${currentUser.id},
				'event.reviewed',
				'event',
				id,
				${JSON.stringify({ status: "draft" })}::jsonb,
				${JSON.stringify({ status: "review", verifiedBy: currentUser.id, verifiedAt: now.toISOString() })}::jsonb,
				${now}
			FROM updated
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
			is_simulation AS "isSimulation",
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
	if (res.rows.length === 0) {
		const freshRows = await db
			.select()
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);
		if (freshRows[0]?.status === "review") {
			return c.json({ event: freshRows[0] }, 200);
		}
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented transitioning event to review.",
			409,
		);
	}

	return c.json({ event: mapEventRow(res.rows[0]) }, 200);
});

// POST /api/events/:eventId/publish - Publish verified event
eventsRouter.post("/:eventId/publish", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;
	const db = c.get("db");

	// 1. Lifecycle predecessor check
	if (event.status === "completed" || event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot publish an event in terminal status: ${event.status}.`,
			409,
		);
	}

	// Idempotent retry: if already published, return existing event without duplicate audit or new slug
	if (event.status === "published" || event.status === "active") {
		if (!event.isSimulation) {
			const [org] = await db.select({ authorized: organizations.hasOperationalAuthority }).from(organizations).where(eq(organizations.id, event.organizationId));
			if (!org?.authorized) return sendError(c, "FORBIDDEN", "Wewenang operasional organisasi tidak aktif.", 403);
		}
		return c.json({ event }, 200);
	}

	if (event.status !== "review") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Event must be in review status before publication. Current status is ${event.status}. Human review is required.`,
			409,
		);
	}

	// 2. Human review verification prerequisite
	if (!event.verifiedBy || !event.verifiedAt) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Event must have explicit human review verification before publication.",
			422,
		);
	}

	// 3. Core fields prerequisite
	if (!event.title || !event.startsAt || !event.endsAt || !event.venueName) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Event publication requires confirmed core fields: title, startsAt, endsAt, venueName.",
			422,
		);
	}

	// 5. Operational authority gate (Ticket 03, SRS FR-014–017, FR-060–064)
	let publishAsSimulation = event.isSimulation !== false;
	try {
		const publishBody = await c.req.json();
		if (
			typeof publishBody === "object" &&
			publishBody !== null &&
			"isSimulation" in publishBody
		) {
			if (typeof publishBody.isSimulation !== "boolean") {
				return sendError(c, "VALIDATION_FAILED", "isSimulation must be a boolean.", 422);
			}
			publishAsSimulation = publishBody.isSimulation;
		}
	} catch {
		// Empty body is allowed, defaults to event.isSimulation
	}
	if (!event.isSimulation && publishAsSimulation) return sendError(c, "STATE_CONFLICT", "Ubah mode draf secara eksplisit sebelum menerbitkan.", 409);

	if (!publishAsSimulation) {
		const orgRows = await db
			.select({
				id: organizations.id,
				hasOperationalAuthority: organizations.hasOperationalAuthority,
			})
			.from(organizations)
			.where(eq(organizations.id, event.organizationId))
			.limit(1);

		if (!orgRows[0] || !orgRows[0].hasOperationalAuthority) {
			return sendError(
				c,
				"FORBIDDEN",
				"Organisasi belum memiliki hak publikasi operasional resmi untuk penutupan jalan nyata. Publikasikan kegiatan sebagai simulasi atau ajukan permohonan otoritas percontohan resmi ke administrator.",
				403,
			);
		}
	}

	// 4. Verified road impacts prerequisite: join with road_segments and verify both existence and segment verification
	const impactRows = await db
		.select({
			impactId: roadImpacts.id,
			plannedFrom: roadImpacts.plannedFrom,
			plannedTo: roadImpacts.plannedTo,
			segmentId: roadSegments.id,
			segmentVerifiedBy: roadSegments.verifiedBy,
			segmentVerifiedAt: roadSegments.verifiedAt,
			sourceType: roadSegments.sourceType,
			segmentOrganizationId: roadSegments.organizationId,
		})
		.from(roadImpacts)
		.innerJoin(roadSegments, eq(roadImpacts.roadSegmentId, roadSegments.id))
		.where(eq(roadImpacts.eventId, eventId));

	if (impactRows.length === 0) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Event publication requires at least one road impact referencing a verified road segment.",
			422,
		);
	}

	for (const imp of impactRows) {
		if (!((imp.sourceType === "catalog" && imp.segmentVerifiedBy && imp.segmentVerifiedAt) || (publishAsSimulation && imp.sourceType === "simulation_draft" && imp.segmentOrganizationId === event.organizationId))) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Road impact references an unverified road segment. All referenced road segments must be verified before publication.",
				422,
			);
		}
		if (new Date(imp.plannedTo) <= new Date(imp.plannedFrom)) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Road impact planned end time must be after planned start time.",
				422,
			);
		}
	}

	// 6. Generate unique public slug (preserving existing slug if set)
	const publicSlug =
		event.publicSlug || (await generateUniquePublicSlug(db, event.title));
	const now = new Date();
	const auditId = crypto.randomUUID();

	// 7. Atomic conditional publication via single CTE:
	// Only updates if still in review status; audit is ONLY inserted if a row was actually updated!
	const query = sql`
		WITH authority AS MATERIALIZED (
			SELECT has_operational_authority FROM organizations WHERE id = ${event.organizationId} FOR SHARE
		), organizer AS MATERIALIZED (
			SELECT id FROM memberships WHERE organization_id = ${event.organizationId}
				AND user_id = ${currentUser.id} AND role = 'organizer' FOR SHARE
		), updated AS (
			UPDATE events
			SET
				status = 'published',
				is_simulation = ${publishAsSimulation},
				public_slug = COALESCE(events.public_slug, ${publicSlug}),
				published_at = COALESCE(events.published_at, ${now}),
				updated_at = ${now}
			WHERE id = ${eventId} AND status = 'review'
				AND EXISTS (SELECT 1 FROM organizer)
				AND (${publishAsSimulation} OR EXISTS (SELECT 1 FROM authority WHERE has_operational_authority))
				AND NOT EXISTS (
					SELECT 1 FROM road_impacts ri JOIN road_segments rs ON rs.id = ri.road_segment_id
					WHERE ri.event_id = events.id AND NOT (
						(rs.source_type = 'catalog' AND rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL)
						OR (${publishAsSimulation} AND rs.source_type = 'simulation_draft' AND rs.organization_id = events.organization_id)
					)
				)
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				organization_id,
				id,
				${currentUser.id},
				'event.published',
				'event',
				id,
				${JSON.stringify({ status: "review", publicSlug: event.publicSlug, isSimulation: event.isSimulation })}::jsonb,
				json_build_object(
					'status', 'published',
					'isSimulation', is_simulation,
					'publicSlug', public_slug,
					'publishedAt', published_at
				)::jsonb,
				${now}
			FROM updated
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
			is_simulation AS "isSimulation",
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
	if (res.rows.length === 0) {
		// Concurrent publication occurred: fetch authoritative published state and return idempotently
		const freshEventRows = await db
			.select()
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);
		const freshEvent = freshEventRows[0];
		if (freshEvent && (freshEvent.status === "published" || freshEvent.status === "active")) {
			return c.json({ event: freshEvent }, 200);
		}
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent publication state conflict.",
			409,
		);
	}

	return c.json({ event: mapEventRow(res.rows[0]) }, 200);
});

// POST /api/events/:eventId/cancel - Cancel event with mandatory reason
eventsRouter.post("/:eventId/cancel", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;

	if (event.status === "completed" || event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot cancel an event that is already ${event.status}.`,
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = cancelEventSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Cancellation reason is required.",
			422,
		);
	}

	const db = c.get("db");
	const now = new Date();
	const auditId = crypto.randomUUID();

	// Single atomic CTE: event cancellation with authoritative status predecessor derived in SQL
	// and conditional audit log ONLY if row was updated
	const query = sql`
		WITH current_event AS (
			SELECT id, status
			FROM events
			WHERE id = ${eventId} AND status IN ('draft', 'review', 'published', 'active')
		),
		updated AS (
			UPDATE events e
			SET
				status = 'cancelled',
				updated_at = ${now}
			FROM current_event c
			WHERE e.id = c.id
				AND e.status = c.status
				AND e.status IN ('draft', 'review', 'published', 'active')
			RETURNING e.*, c.status AS prev_status
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				organization_id,
				id,
				${currentUser.id},
				'event.cancelled',
				'event',
				id,
				json_build_object('status', prev_status),
				${JSON.stringify({
					status: "cancelled",
					cancellationReason: parseResult.data.reason,
				})}::jsonb,
				${now}
			FROM updated
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
			is_simulation AS "isSimulation",
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
	if (res.rows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented event cancellation.",
			409,
		);
	}

	return c.json(
		{ event: mapEventRow(res.rows[0]), reason: parseResult.data.reason },
		200,
	);
});

// POST /api/events/:eventId/complete - Close operational event lifecycle
eventsRouter.post("/:eventId/complete", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;

	// Authoritative lifecycle: only active events can be completed (AGENTS §13: DRAFT -> REVIEW -> PUBLISHED -> ACTIVE -> COMPLETED)
	if (event.status !== "active") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Only active events can be completed. Current status: ${event.status}.`,
			409,
		);
	}

	const db = c.get("db");
	const now = new Date();
	const auditId = crypto.randomUUID();

	// Single atomic CTE: event completion + conditional audit log ONLY if row was updated
	const query = sql`
		WITH updated AS (
			UPDATE events
			SET
				status = 'completed',
				updated_at = ${now}
			WHERE id = ${eventId} AND status = 'active'
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				organization_id,
				id,
				${currentUser.id},
				'event.completed',
				'event',
				id,
				${JSON.stringify({ status: "active" })}::jsonb,
				${JSON.stringify({ status: "completed" })}::jsonb,
				${now}
			FROM updated
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
			is_simulation AS "isSimulation",
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
	if (res.rows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented event completion.",
			409,
		);
	}

	return c.json({ event: mapEventRow(res.rows[0]) }, 200);
});

export { eventsRouter };
