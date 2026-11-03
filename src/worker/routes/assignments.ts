import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { user as userTable } from "../../db/auth-schema";
import {
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

	// Check if an assignment already exists for this event and user
	const existingAssignmentRows = await db
		.select()
		.from(eventAssignments)
		.where(
			and(
				eq(eventAssignments.eventId, eventId),
				eq(eventAssignments.userId, userId),
			),
		)
		.limit(1);

	const existingAssignment = existingAssignmentRows[0];

	// Idempotent no-change: if identical permissions already exist, return 200 without creating a duplicate audit row
	if (
		existingAssignment &&
		existingAssignment.canUpdateTraffic === canUpdateTraffic &&
		existingAssignment.canUpdateCleanup === canUpdateCleanup
	) {
		return c.json(
			{
				assignment: {
					...existingAssignment,
					userName: targetMember.userName,
					userEmail: targetMember.userEmail,
				},
			},
			200,
		);
	}

	const assignmentId = existingAssignment
		? existingAssignment.id
		: crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const action = existingAssignment
		? "assignment.updated"
		: "assignment.created";
	const beforeJson = existingAssignment
		? JSON.stringify({
				userId: existingAssignment.userId,
				canUpdateTraffic: existingAssignment.canUpdateTraffic,
				canUpdateCleanup: existingAssignment.canUpdateCleanup,
			})
		: null;

	// Single atomic CTE: upsert assignment AND insert audit log referencing the actual RETURNING id!
	const query = sql`
		WITH upserted AS (
			INSERT INTO event_assignments (
				id, event_id, user_id, can_update_traffic, can_update_cleanup, created_at
			)
			VALUES (
				${assignmentId}, ${eventId}, ${userId}, ${canUpdateTraffic}, ${canUpdateCleanup}, ${now}
			)
			ON CONFLICT (event_id, user_id)
			DO UPDATE SET
				can_update_traffic = EXCLUDED.can_update_traffic,
				can_update_cleanup = EXCLUDED.can_update_cleanup
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				${check.event.organizationId},
				event_id,
				${currentUser.id},
				${action},
				'event_assignment',
				id,
				${beforeJson ? sql`${beforeJson}::jsonb` : sql`NULL`},
				json_build_object(
					'userId', user_id,
					'canUpdateTraffic', can_update_traffic,
					'canUpdateCleanup', can_update_cleanup
				),
				${now}
			FROM upserted
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			user_id AS "userId",
			can_update_traffic AS "canUpdateTraffic",
			can_update_cleanup AS "canUpdateCleanup",
			created_at AS "createdAt"
		FROM upserted;
	`;

	const res = await db.execute(query);
	const assignment = res.rows[0];

	return c.json(
		{
			assignment: {
				id: assignment.id as string,
				eventId: assignment.eventId as string,
				userId: assignment.userId as string,
				canUpdateTraffic: assignment.canUpdateTraffic as boolean,
				canUpdateCleanup: assignment.canUpdateCleanup as boolean,
				createdAt: new Date(assignment.createdAt as string),
				userName: targetMember.userName,
				userEmail: targetMember.userEmail,
			},
		},
		existingAssignment ? 200 : 201,
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
	const auditId = crypto.randomUUID();
	const now = new Date();

	// Single atomic CTE: assignment deletion + conditional audit log ONLY if row was deleted
	const query = sql`
		WITH deleted AS (
			DELETE FROM event_assignments
			WHERE id = ${assignmentId} AND event_id = ${eventId}
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				${check.event.organizationId},
				event_id,
				${currentUser.id},
				'assignment.revoked',
				'event_assignment',
				id,
				json_build_object(
					'userId', user_id,
					'canUpdateTraffic', can_update_traffic,
					'canUpdateCleanup', can_update_cleanup
				),
				null,
				${now}
			FROM deleted
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			user_id AS "userId"
		FROM deleted;
	`;

	const res = await db.execute(query);
	if (res.rows.length === 0) {
		return sendError(
			c,
			"NOT_FOUND",
			"Assignment not found or already revoked.",
			404,
		);
	}

	return c.json({ success: true, revokedId: res.rows[0].id as string }, 200);
});

export { assignmentsRouter };
