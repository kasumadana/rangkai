import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
	auditLogs,
	eventAssignments,
	events,
	memberships,
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

	const eventId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();

	// Atomic batch: event creation + append-only audit log committed together
	const [insertedRows] = await db.batch([
		db
			.insert(events)
			.values({
				id: eventId,
				organizationId: data.organizationId,
				createdBy: currentUser.id,
				title: data.title,
				category: data.category ?? null,
				description: data.description ?? null,
				venueName: data.venueName ?? null,
				startsAt: data.startsAt ? new Date(data.startsAt) : null,
				endsAt: data.endsAt ? new Date(data.endsAt) : null,
				permitReference: data.permitReference ?? null,
				status: "draft",
				createdAt: now,
				updatedAt: now,
			})
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: data.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "event.created",
			entityType: "event",
			entityId: eventId,
			afterJson: {
				title: data.title,
				status: "draft",
				startsAt: data.startsAt ? new Date(data.startsAt).toISOString() : null,
				endsAt: data.endsAt ? new Date(data.endsAt).toISOString() : null,
			},
			createdAt: now,
		}),
	]);

	return c.json({ event: insertedRows[0] }, 201);
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
			events: eventList,
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

	return c.json({ event: accessResult.event }, 200);
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

	// In published state, required core fields cannot be removed/nullified
	if (existingEvent.status === "published") {
		if (data.venueName === null || data.venueName === "") {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Cannot remove venue name from an already published event.",
				422,
			);
		}
		if (data.title !== undefined && data.title.trim().length === 0) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Title cannot be empty.",
				422,
			);
		}
		if (data.startsAt === null || data.endsAt === null) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Cannot remove event timing from an already published event.",
				422,
			);
		}
	}

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

	// Stale verification check: if event is in "review" and core fields are modified,
	// clear previous verification and reset status to "draft" for human re-review.
	let nextStatus = existingEvent.status;
	let nextVerifiedBy = existingEvent.verifiedBy;
	let nextVerifiedAt = existingEvent.verifiedAt;

	if (existingEvent.status === "review") {
		const coreFieldModified =
			(data.title !== undefined && data.title !== existingEvent.title) ||
			data.startsAt !== undefined ||
			data.endsAt !== undefined ||
			(data.venueName !== undefined && data.venueName !== existingEvent.venueName);

		if (coreFieldModified) {
			nextStatus = "draft";
			nextVerifiedBy = null;
			nextVerifiedAt = null;
		}
	}

	const now = new Date();
	const auditId = crypto.randomUUID();
	const db = c.get("db");

	// Atomic batch: event update + audit log
	const [updatedRows] = await db.batch([
		db
			.update(events)
			.set({
				title: data.title ?? existingEvent.title,
				category:
					data.category !== undefined
						? data.category
						: existingEvent.category,
				description:
					data.description !== undefined
						? data.description
						: existingEvent.description,
				venueName:
					data.venueName !== undefined
						? data.venueName
						: existingEvent.venueName,
				startsAt: startsAtDate,
				endsAt: endsAtDate,
				permitReference:
					data.permitReference !== undefined
						? data.permitReference
						: existingEvent.permitReference,
				status: nextStatus,
				verifiedBy: nextVerifiedBy,
				verifiedAt: nextVerifiedAt,
				updatedAt: now,
			})
			.where(
				and(
					eq(events.id, eventId),
					eq(events.status, existingEvent.status),
				),
			)
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: existingEvent.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "event.updated",
			entityType: "event",
			entityId: eventId,
			beforeJson: {
				title: existingEvent.title,
				status: existingEvent.status,
				startsAt: existingEvent.startsAt?.toISOString() ?? null,
				endsAt: existingEvent.endsAt?.toISOString() ?? null,
				venueName: existingEvent.venueName,
			},
			afterJson: {
				title: data.title ?? existingEvent.title,
				status: nextStatus,
				startsAt: startsAtDate?.toISOString() ?? null,
				endsAt: endsAtDate?.toISOString() ?? null,
				venueName:
					data.venueName !== undefined
						? data.venueName
						: existingEvent.venueName,
			},
			createdAt: now,
		}),
	]);

	const updatedEvent = updatedRows[0];
	return c.json({ event: updatedEvent }, 200);
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

	// Atomic batch: draft -> review transition + audit log
	const [updatedRows] = await db.batch([
		db
			.update(events)
			.set({
				status: "review",
				verifiedBy: currentUser.id,
				verifiedAt: now,
				updatedAt: now,
			})
			.where(and(eq(events.id, eventId), eq(events.status, "draft")))
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: event.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "event.reviewed",
			entityType: "event",
			entityId: eventId,
			beforeJson: { status: "draft" },
			afterJson: {
				status: "review",
				verifiedBy: currentUser.id,
				verifiedAt: now.toISOString(),
			},
			createdAt: now,
		}),
	]);

	if (updatedRows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented transitioning event to review.",
			409,
		);
	}

	return c.json({ event: updatedRows[0] }, 200);
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

	// 4. Verified road impacts prerequisite: join with road_segments and verify both existence and segment verification
	const impactRows = await db
		.select({
			impactId: roadImpacts.id,
			plannedFrom: roadImpacts.plannedFrom,
			plannedTo: roadImpacts.plannedTo,
			segmentId: roadSegments.id,
			segmentVerifiedBy: roadSegments.verifiedBy,
			segmentVerifiedAt: roadSegments.verifiedAt,
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
		if (!imp.segmentVerifiedBy || !imp.segmentVerifiedAt) {
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

	// 5. Generate unique public slug (preserving existing slug if set)
	const publicSlug =
		event.publicSlug || (await generateUniquePublicSlug(db, event.title));
	const now = new Date();
	const auditId = crypto.randomUUID();

	// 6. Atomic conditional publication: only updates if still in review status
	const [updatedRows] = await db.batch([
		db
			.update(events)
			.set({
				status: "published",
				publicSlug,
				publishedAt: event.publishedAt || now,
				updatedAt: now,
			})
			.where(and(eq(events.id, eventId), eq(events.status, "review")))
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: event.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "event.published",
			entityType: "event",
			entityId: eventId,
			beforeJson: { status: "review", publicSlug: event.publicSlug },
			afterJson: {
				status: "published",
				publicSlug,
				publishedAt: (event.publishedAt || now).toISOString(),
			},
			createdAt: now,
		}),
	]);

	if (updatedRows.length === 0) {
		// Concurrent publication occurred: fetch fresh state and return idempotently
		const freshEventRows = await db
			.select()
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);
		if (freshEventRows[0]?.status === "published") {
			return c.json({ event: freshEventRows[0] }, 200);
		}
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent publication state conflict.",
			409,
		);
	}

	return c.json({ event: updatedRows[0] }, 200);
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

	// Atomic batch: cancel status update + cancellation reason audit log
	const [updatedRows] = await db.batch([
		db
			.update(events)
			.set({
				status: "cancelled",
				updatedAt: now,
			})
			.where(
				and(
					eq(events.id, eventId),
					inArray(events.status, ["draft", "review", "published", "active"]),
				),
			)
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: event.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "event.cancelled",
			entityType: "event",
			entityId: eventId,
			beforeJson: { status: event.status },
			afterJson: {
				status: "cancelled",
				cancellationReason: parseResult.data.reason,
			},
			createdAt: now,
		}),
	]);

	if (updatedRows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented event cancellation.",
			409,
		);
	}

	return c.json(
		{ event: updatedRows[0], reason: parseResult.data.reason },
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

	// Allowed predecessor check: only published or active events can be completed
	if (event.status !== "published" && event.status !== "active") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Only published or active events can be completed. Current status: ${event.status}.`,
			409,
		);
	}

	const db = c.get("db");
	const now = new Date();
	const auditId = crypto.randomUUID();

	// Atomic batch: status complete + audit log
	const [updatedRows] = await db.batch([
		db
			.update(events)
			.set({
				status: "completed",
				updatedAt: now,
			})
			.where(
				and(
					eq(events.id, eventId),
					inArray(events.status, ["published", "active"]),
				),
			)
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: event.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "event.completed",
			entityType: "event",
			entityId: eventId,
			beforeJson: { status: event.status },
			afterJson: { status: "completed" },
			createdAt: now,
		}),
	]);

	if (updatedRows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Concurrent modification prevented event completion.",
			409,
		);
	}

	return c.json({ event: updatedRows[0] }, 200);
});

export { eventsRouter };
