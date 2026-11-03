import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
	events,
	memberships,
	roadImpacts,
	type EventStatus,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import {
	getEventAndCheckAccess,
} from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import { recordAuditLog } from "../services/audit";
import { generateUniquePublicSlug } from "../services/slug";
import type { AppVariables, Env } from "../types";
import {
	cancelEventSchema,
	createEventSchema,
	updateEventSchema,
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

// POST /api/events - Create draft event
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

	const insertedRows = await db
		.insert(events)
		.values({
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
		})
		.returning();

	const createdEvent = insertedRows[0];

	// Append-only audit record
	await recordAuditLog(db, {
		organizationId: data.organizationId,
		eventId: createdEvent.id,
		actorId: currentUser.id,
		action: "event.created",
		entityType: "event",
		entityId: createdEvent.id,
		afterJson: {
			title: createdEvent.title,
			status: createdEvent.status,
			startsAt: createdEvent.startsAt?.toISOString() ?? null,
			endsAt: createdEvent.endsAt?.toISOString() ?? null,
		},
	});

	return c.json({ event: createdEvent }, 201);
});

// GET /api/events - List accessible events for authenticated member
eventsRouter.get("/", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	// Find all organizations where current user has membership
	const userMemberships = await db
		.select({
			organizationId: memberships.organizationId,
			role: memberships.role,
		})
		.from(memberships)
		.where(eq(memberships.userId, currentUser.id));

	if (userMemberships.length === 0) {
		return c.json({ events: [] }, 200);
	}

	const accessibleOrgIds = userMemberships.map((m) => m.organizationId);

	// Filter by specific organizationId if requested
	const queryOrgId = c.req.query("organizationId");
	let filterOrgIds = accessibleOrgIds;
	if (queryOrgId) {
		if (!accessibleOrgIds.includes(queryOrgId)) {
			return sendError(
				c,
				"FORBIDDEN",
				"You are not a member of the requested organization.",
				403,
			);
		}
		filterOrgIds = [queryOrgId];
	}

	const queryStatus = c.req.query("status") as EventStatus | undefined;

	const query = db
		.select()
		.from(events)
		.where(
			queryStatus
				? and(
						inArray(events.organizationId, filterOrgIds),
						eq(events.status, queryStatus),
					)
				: inArray(events.organizationId, filterOrgIds),
		)
		.orderBy(desc(events.createdAt));

	const eventList = await query;
	return c.json({ events: eventList }, 200);
});

// GET /api/events/:eventId - Detail view
eventsRouter.get("/:eventId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
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

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const existingEvent = check.event;

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
	const db = c.get("db");

	// Determine updated startsAt and endsAt for cross-field ordering validation
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

	const updatedRows = await db
		.update(events)
		.set({
			title: data.title ?? existingEvent.title,
			category: data.category !== undefined ? data.category : existingEvent.category,
			description: data.description !== undefined ? data.description : existingEvent.description,
			venueName: data.venueName !== undefined ? data.venueName : existingEvent.venueName,
			startsAt: startsAtDate,
			endsAt: endsAtDate,
			permitReference: data.permitReference !== undefined ? data.permitReference : existingEvent.permitReference,
			updatedAt: new Date(),
		})
		.where(eq(events.id, eventId))
		.returning();

	const updatedEvent = updatedRows[0];

	// Append-only audit record
	await recordAuditLog(db, {
		organizationId: existingEvent.organizationId,
		eventId: updatedEvent.id,
		actorId: currentUser.id,
		action: "event.updated",
		entityType: "event",
		entityId: updatedEvent.id,
		beforeJson: {
			title: existingEvent.title,
			startsAt: existingEvent.startsAt?.toISOString() ?? null,
			endsAt: existingEvent.endsAt?.toISOString() ?? null,
			venueName: existingEvent.venueName,
		},
		afterJson: {
			title: updatedEvent.title,
			startsAt: updatedEvent.startsAt?.toISOString() ?? null,
			endsAt: updatedEvent.endsAt?.toISOString() ?? null,
			venueName: updatedEvent.venueName,
		},
	});

	return c.json({ event: updatedEvent }, 200);
});

// POST /api/events/:eventId/review - Move draft -> review
eventsRouter.post("/:eventId/review", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;
	const db = c.get("db");

	// Review validation: core fields must be present
	if (!event.title || !event.startsAt || !event.endsAt || !event.venueName) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Event review requires confirmed core fields: title, startsAt, endsAt, venueName.",
			422,
		);
	}

	const now = new Date();
	const updatedRows = await db
		.update(events)
		.set({
			status: "review",
			verifiedBy: currentUser.id,
			verifiedAt: now,
			updatedAt: now,
		})
		.where(eq(events.id, eventId))
		.returning();

	const reviewedEvent = updatedRows[0];

	await recordAuditLog(db, {
		organizationId: event.organizationId,
		eventId: reviewedEvent.id,
		actorId: currentUser.id,
		action: "event.reviewed",
		entityType: "event",
		entityId: reviewedEvent.id,
		beforeJson: { status: event.status },
		afterJson: {
			status: reviewedEvent.status,
			verifiedBy: currentUser.id,
			verifiedAt: now.toISOString(),
		},
	});

	return c.json({ event: reviewedEvent }, 200);
});

// POST /api/events/:eventId/publish - Publish verified event
eventsRouter.post("/:eventId/publish", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;
	const db = c.get("db");

	// 1. Core fields prerequisite
	if (!event.title || !event.startsAt || !event.endsAt || !event.venueName) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Event publication requires confirmed core fields (title, startsAt, endsAt, venueName).",
			422,
		);
	}

	// 2. Road impacts prerequisite: event must have at least one verified road impact
	const impacts = await db
		.select({ id: roadImpacts.id })
		.from(roadImpacts)
		.where(eq(roadImpacts.eventId, eventId))
		.limit(1);

	if (impacts.length === 0) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Event publication requires at least one verified road impact. Publish rejected.",
			422,
		);
	}

	// 3. Generate unique public slug (idempotent if already published)
	const publicSlug =
		event.publicSlug || (await generateUniquePublicSlug(db, event.title));
	const now = new Date();

	const updatedRows = await db
		.update(events)
		.set({
			status: "published",
			publicSlug,
			verifiedBy: currentUser.id,
			verifiedAt: now,
			publishedAt: event.publishedAt || now,
			updatedAt: now,
		})
		.where(eq(events.id, eventId))
		.returning();

	const publishedEvent = updatedRows[0];

	// Append-only audit record
	await recordAuditLog(db, {
		organizationId: event.organizationId,
		eventId: publishedEvent.id,
		actorId: currentUser.id,
		action: "event.published",
		entityType: "event",
		entityId: publishedEvent.id,
		beforeJson: { status: event.status, publicSlug: event.publicSlug },
		afterJson: {
			status: publishedEvent.status,
			publicSlug: publishedEvent.publicSlug,
			publishedAt: publishedEvent.publishedAt?.toISOString(),
		},
	});

	return c.json({ event: publishedEvent }, 200);
});

// POST /api/events/:eventId/cancel - Cancel event
eventsRouter.post("/:eventId/cancel", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;

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

	const updatedRows = await db
		.update(events)
		.set({
			status: "cancelled",
			updatedAt: now,
		})
		.where(eq(events.id, eventId))
		.returning();

	const cancelledEvent = updatedRows[0];

	// Append-only audit record
	await recordAuditLog(db, {
		organizationId: event.organizationId,
		eventId: cancelledEvent.id,
		actorId: currentUser.id,
		action: "event.cancelled",
		entityType: "event",
		entityId: cancelledEvent.id,
		beforeJson: { status: event.status },
		afterJson: {
			status: cancelledEvent.status,
			cancellationReason: parseResult.data.reason,
		},
	});

	return c.json(
		{ event: cancelledEvent, reason: parseResult.data.reason },
		200,
	);
});

// POST /api/events/:eventId/complete - Close operational event lifecycle
eventsRouter.post("/:eventId/complete", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const check = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const event = check.event;
	const db = c.get("db");
	const now = new Date();

	const updatedRows = await db
		.update(events)
		.set({
			status: "completed",
			updatedAt: now,
		})
		.where(eq(events.id, eventId))
		.returning();

	const completedEvent = updatedRows[0];

	// Append-only audit record
	await recordAuditLog(db, {
		organizationId: event.organizationId,
		eventId: completedEvent.id,
		actorId: currentUser.id,
		action: "event.completed",
		entityType: "event",
		entityId: completedEvent.id,
		beforeJson: { status: event.status },
		afterJson: { status: completedEvent.status },
	});

	return c.json({ event: completedEvent }, 200);
});

export { eventsRouter };
