import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { user as userTable } from "../../db/auth-schema";
import { eventAssignments, events, memberships } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { recordAuditLog } from "../services/audit";
import type { AppVariables, Env } from "../types";
import { createAssignmentSchema } from "../validators/events";

const assignmentsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

assignmentsRouter.use("*", requireAuth);

// Helper: Assert caller is organizer of the event's organization
async function assertEventOrganizer(
	c: Parameters<typeof sendError>[0],
	eventId: string,
	userId: string,
) {
	const db = c.get("db");
	const eventRows = await db
		.select({
			id: events.id,
			organizationId: events.organizationId,
		})
		.from(events)
		.where(eq(events.id, eventId))
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return { error: sendError(c, "NOT_FOUND", "Event not found.", 404) };
	}

	const membershipRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, event.organizationId),
				eq(memberships.userId, userId),
			),
		)
		.limit(1);

	const membership = membershipRows[0];
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

// GET /api/events/:eventId/assignments
assignmentsRouter.get("/:eventId/assignments", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const check = await assertEventOrganizer(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const db = c.get("db");
	const rows = await db
		.select({
			id: eventAssignments.id,
			eventId: eventAssignments.eventId,
			userId: eventAssignments.userId,
			userName: userTable.name,
			userEmail: userTable.email,
			canUpdateTraffic: eventAssignments.canUpdateTraffic,
			canUpdateCleanup: eventAssignments.canUpdateCleanup,
			createdAt: eventAssignments.createdAt,
		})
		.from(eventAssignments)
		.innerJoin(userTable, eq(eventAssignments.userId, userTable.id))
		.where(eq(eventAssignments.eventId, eventId));

	return c.json({ assignments: rows }, 200);
});

// POST /api/events/:eventId/assignments
assignmentsRouter.post("/:eventId/assignments", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const check = await assertEventOrganizer(c, eventId, currentUser.id);
	if (check.error) return check.error;

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createAssignmentSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid assignment data.",
			422,
		);
	}

	const { userId, canUpdateTraffic, canUpdateCleanup } = parseResult.data;
	const db = c.get("db");

	// Verify target user exists
	const targetUserRows = await db
		.select({ id: userTable.id, name: userTable.name, email: userTable.email })
		.from(userTable)
		.where(eq(userTable.id, userId))
		.limit(1);

	if (targetUserRows.length === 0) {
		return sendError(c, "NOT_FOUND", "Target user does not exist.", 404);
	}

	// Insert or update assignment
	const insertedRows = await db
		.insert(eventAssignments)
		.values({
			eventId,
			userId,
			canUpdateTraffic,
			canUpdateCleanup,
		})
		.onConflictDoUpdate({
			target: [eventAssignments.eventId, eventAssignments.userId],
			set: {
				canUpdateTraffic,
				canUpdateCleanup,
			},
		})
		.returning();

	const assignment = insertedRows[0];

	// Append-only audit record
	await recordAuditLog(db, {
		organizationId: check.event.organizationId,
		eventId,
		actorId: currentUser.id,
		action: "assignment.created",
		entityType: "event_assignment",
		entityId: assignment.id,
		afterJson: {
			userId,
			canUpdateTraffic,
			canUpdateCleanup,
		},
	});

	return c.json(
		{
			assignment: {
				...assignment,
				userName: targetUserRows[0].name,
				userEmail: targetUserRows[0].email,
			},
		},
		201,
	);
});

// DELETE /api/events/:eventId/assignments/:assignmentId
assignmentsRouter.delete("/:eventId/assignments/:assignmentId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
	const assignmentId = c.req.param("assignmentId");

	const check = await assertEventOrganizer(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const db = c.get("db");
	const deletedRows = await db
		.delete(eventAssignments)
		.where(
			and(
				eq(eventAssignments.id, assignmentId),
				eq(eventAssignments.eventId, eventId),
			),
		)
		.returning();

	if (deletedRows.length === 0) {
		return sendError(c, "NOT_FOUND", "Assignment not found.", 404);
	}

	const deleted = deletedRows[0];

	// Append-only audit record
	await recordAuditLog(db, {
		organizationId: check.event.organizationId,
		eventId,
		actorId: currentUser.id,
		action: "assignment.revoked",
		entityType: "event_assignment",
		entityId: deleted.id,
		beforeJson: {
			userId: deleted.userId,
			canUpdateTraffic: deleted.canUpdateTraffic,
			canUpdateCleanup: deleted.canUpdateCleanup,
		},
	});

	return c.json({ success: true, revokedId: deleted.id }, 200);
});

export { assignmentsRouter };
