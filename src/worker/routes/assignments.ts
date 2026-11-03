import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { user as userTable } from "../../db/auth-schema";
import {
	auditLogs,
	eventAssignments,
	events,
	memberships,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import {
	createAssignmentSchema,
	uuidParamSchema,
} from "../validators/events";

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

// GET /api/events/:eventId/assignments - List officers assigned to event
assignmentsRouter.get("/:eventId/assignments", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

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

// POST /api/events/:eventId/assignments - Grant/update officer assignment atomically
assignmentsRouter.post("/:eventId/assignments", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

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

	// Verify target user exists and is a member of the event's organization
	const targetMemberRows = await db
		.select({
			userId: memberships.userId,
			role: memberships.role,
			userName: userTable.name,
			userEmail: userTable.email,
		})
		.from(memberships)
		.innerJoin(userTable, eq(memberships.userId, userTable.id))
		.where(
			and(
				eq(memberships.organizationId, check.event.organizationId),
				eq(memberships.userId, userId),
			),
		)
		.limit(1);

	if (targetMemberRows.length === 0) {
		return sendError(
			c,
			"NOT_FOUND",
			"Target user is not a member of this event's organization.",
			404,
		);
	}

	const targetMember = targetMemberRows[0];
	const assignmentId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();

	// Atomic batch: event assignment mutation + append-only audit record
	const [insertedRows] = await db.batch([
		db
			.insert(eventAssignments)
			.values({
				id: assignmentId,
				eventId,
				userId,
				canUpdateTraffic,
				canUpdateCleanup,
				createdAt: now,
			})
			.onConflictDoUpdate({
				target: [eventAssignments.eventId, eventAssignments.userId],
				set: {
					canUpdateTraffic,
					canUpdateCleanup,
				},
			})
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: check.event.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "assignment.created",
			entityType: "event_assignment",
			entityId: assignmentId,
			afterJson: {
				userId,
				canUpdateTraffic,
				canUpdateCleanup,
			},
			createdAt: now,
		}),
	]);

	const assignment = insertedRows[0];

	return c.json(
		{
			assignment: {
				...assignment,
				userName: targetMember.userName,
				userEmail: targetMember.userEmail,
			},
		},
		201,
	);
});

// DELETE /api/events/:eventId/assignments/:assignmentId - Revoke assignment atomically
assignmentsRouter.delete("/:eventId/assignments/:assignmentId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
	const assignmentId = c.req.param("assignmentId");

	const eventIdValidation = uuidParamSchema.safeParse(eventId);
	const assignmentIdValidation = uuidParamSchema.safeParse(assignmentId);
	if (!eventIdValidation.success || !assignmentIdValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid UUID format.", 422);
	}

	const check = await assertEventOrganizer(c, eventId, currentUser.id);
	if (check.error) return check.error;

	const db = c.get("db");

	// Verify target assignment exists before mutation
	const existingRows = await db
		.select()
		.from(eventAssignments)
		.where(
			and(
				eq(eventAssignments.id, assignmentId),
				eq(eventAssignments.eventId, eventId),
			),
		)
		.limit(1);

	const existingAssignment = existingRows[0];
	if (!existingAssignment) {
		return sendError(c, "NOT_FOUND", "Assignment not found.", 404);
	}

	const auditId = crypto.randomUUID();
	const now = new Date();

	// Atomic batch: assignment deletion + append-only audit record
	const [deletedRows] = await db.batch([
		db
			.delete(eventAssignments)
			.where(
				and(
					eq(eventAssignments.id, assignmentId),
					eq(eventAssignments.eventId, eventId),
				),
			)
			.returning(),
		db.insert(auditLogs).values({
			id: auditId,
			organizationId: check.event.organizationId,
			eventId,
			actorId: currentUser.id,
			action: "assignment.revoked",
			entityType: "event_assignment",
			entityId: existingAssignment.id,
			beforeJson: {
				userId: existingAssignment.userId,
				canUpdateTraffic: existingAssignment.canUpdateTraffic,
				canUpdateCleanup: existingAssignment.canUpdateCleanup,
			},
			createdAt: now,
		}),
	]);

	return c.json({ success: true, revokedId: deletedRows[0]?.id ?? assignmentId }, 200);
});

export { assignmentsRouter };
