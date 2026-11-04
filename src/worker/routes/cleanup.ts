import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { user as userTable } from "../../db/auth-schema";
import {
	cleanupEvidence,
	cleanupTasks,
	eventAssignments,
	events,
	memberships,
	wasteRecords,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import {
	createCleanupTaskSchema,
	createWasteRecordSchema,
	detectPhotoMagicBytes,
	patchCleanupTaskSchema,
	reopenCleanupTaskSchema,
} from "../validators/cleanup";
import { checkUploadRateLimit } from "../validators/documents";

const uuidParamSchema = z.string().uuid();

// Helper to assert organizer membership for an event
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

// Helper to assert organizer or assigned cleanup officer for an event
async function assertCleanupAccessForEvent(
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
	if (!membership) {
		return {
			error: sendError(
				c,
				"FORBIDDEN",
				"You are not a member of the event organization.",
				403,
			),
		};
	}

	const isOrganizer = membership.role === "organizer";
	let canUpdateCleanup = isOrganizer;

	if (!isOrganizer) {
		const assignmentRows = await db
			.select({ canUpdateCleanup: eventAssignments.canUpdateCleanup })
			.from(eventAssignments)
			.where(
				and(
					eq(eventAssignments.eventId, eventId),
					eq(eventAssignments.userId, userId),
				),
			)
			.limit(1);

		const assignment = assignmentRows[0];
		if (!assignment || !assignment.canUpdateCleanup) {
			return {
				error: sendError(
					c,
					"FORBIDDEN",
					"You do not have cleanup permissions for this event.",
					403,
				),
			};
		}
		canUpdateCleanup = true;
	}

	return { event, isOrganizer, canUpdateCleanup };
}

// Helper to query task along with event
async function getTaskWithEvent(
	c: Parameters<typeof sendError>[0],
	taskId: string,
) {
	const db = c.get("db");
	const rows = await db
		.select({
			taskId: cleanupTasks.id,
			eventId: cleanupTasks.eventId,
			title: cleanupTasks.title,
			description: cleanupTasks.description,
			assignedUserId: cleanupTasks.assignedUserId,
			status: cleanupTasks.status,
			dueAt: cleanupTasks.dueAt,
			verifiedBy: cleanupTasks.verifiedBy,
			verifiedAt: cleanupTasks.verifiedAt,
			createdAt: cleanupTasks.createdAt,
			updatedAt: cleanupTasks.updatedAt,
			organizationId: events.organizationId,
			eventStatus: events.status,
		})
		.from(cleanupTasks)
		.innerJoin(events, eq(cleanupTasks.eventId, events.id))
		.where(eq(cleanupTasks.id, taskId))
		.limit(1);

	return rows[0] ?? null;
}

// 1. Events-scoped cleanup tasks and waste router: /api/events
export const eventsCleanupRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

eventsCleanupRouter.use("*", requireAuth);

// GET /api/events/:eventId/cleanup-tasks
eventsCleanupRouter.get("/:eventId/cleanup-tasks", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const access = await assertCleanupAccessForEvent(c, eventId, currentUser.id);
	if (access.error) return access.error;

	const db = c.get("db");

	// Query cleanup tasks with PostGIS Point as geojson/coordinates and evidence count
	const query = sql`
		SELECT
			ct.id,
			ct.event_id AS "eventId",
			ct.title,
			ct.description,
			CASE
				WHEN ct.location IS NOT NULL THEN
					json_build_object(
						'lng', ST_X(ct.location::geometry),
						'lat', ST_Y(ct.location::geometry)
					)
				ELSE NULL
			END AS location,
			ct.assigned_user_id AS "assignedUserId",
			u.name AS "assignedUserName",
			ct.status,
			ct.due_at AS "dueAt",
			ct.verified_by AS "verifiedBy",
			ct.verified_at AS "verifiedAt",
			ct.created_at AS "createdAt",
			ct.updated_at AS "updatedAt",
			COUNT(ce.id)::int AS "evidenceCount"
		FROM cleanup_tasks ct
		LEFT JOIN "user" u ON ct.assigned_user_id = u.id
		LEFT JOIN cleanup_evidence ce ON ct.id = ce.task_id
		WHERE ct.event_id = ${eventId}
		GROUP BY ct.id, u.name
		ORDER BY ct.created_at ASC;
	`;

	const res = await db.execute(query);
	const tasks = res.rows.map((row) => ({
		id: row.id as string,
		eventId: row.eventId as string,
		title: row.title as string,
		description: (row.description ?? null) as string | null,
		location: row.location as { lng: number; lat: number } | null,
		assignedUserId: (row.assignedUserId ?? null) as string | null,
		assignedUserName: (row.assignedUserName ?? null) as string | null,
		status: row.status as string,
		dueAt: row.dueAt ? new Date(row.dueAt as string) : null,
		verifiedBy: (row.verifiedBy ?? null) as string | null,
		verifiedAt: row.verifiedAt ? new Date(row.verifiedAt as string) : null,
		createdAt: new Date(row.createdAt as string),
		updatedAt: new Date(row.updatedAt as string),
		evidenceCount: Number(row.evidenceCount ?? 0),
	}));

	return c.json({ cleanupTasks: tasks }, 200);
});

// POST /api/events/:eventId/cleanup-tasks
eventsCleanupRouter.post("/:eventId/cleanup-tasks", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const organizerCheck = await assertOrganizerForEvent(c, eventId, currentUser.id);
	if (organizerCheck.error) return organizerCheck.error;
	const event = organizerCheck.event;

	if (event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot create cleanup tasks on a cancelled event.",
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Request body must be valid JSON.", 400);
	}

	const parsed = createCleanupTaskSchema.safeParse(body);
	if (!parsed.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parsed.error.issues[0]?.message || "Invalid cleanup task payload.",
			422,
		);
	}

	const input = parsed.data;
	const db = c.get("db");

	// If assignedUserId provided, verify assignee belongs to organization
	if (input.assignedUserId) {
		const assigneeMember = await db
			.select({ id: memberships.id })
			.from(memberships)
			.where(
				and(
					eq(memberships.organizationId, event.organizationId),
					eq(memberships.userId, input.assignedUserId),
				),
			)
			.limit(1);

		if (assigneeMember.length === 0) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Assigned user is not a member of the event organization.",
				422,
			);
		}
	}

	const taskId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const dueAtDate = input.dueAt ? new Date(input.dueAt) : null;

	const afterSnapshot = {
		title: input.title,
		description: input.description ?? null,
		location: input.location ?? null,
		assignedUserId: input.assignedUserId ?? null,
		status: "todo",
		dueAt: dueAtDate ? dueAtDate.toISOString() : null,
	};

	const locationSql = input.location
		? sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)`
		: sql`NULL`;

	const query = sql`
		WITH new_task AS (
			INSERT INTO cleanup_tasks (
				id, event_id, title, description, location, assigned_user_id, status, due_at, created_at, updated_at
			)
			VALUES (
				${taskId}, ${eventId}, ${input.title}, ${input.description ?? null},
				${locationSql}, ${input.assignedUserId ?? null}, 'todo', ${dueAtDate}, ${now}, ${now}
			)
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			VALUES (
				${auditId}, ${event.organizationId}, ${eventId}, ${currentUser.id},
				'cleanup_task.created', 'cleanup_task', ${taskId},
				NULL, ${JSON.stringify(afterSnapshot)}::jsonb, ${now}
			)
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			title,
			description,
			assigned_user_id AS "assignedUserId",
			status,
			due_at AS "dueAt",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM new_task;
	`;

	const res = await db.execute(query);
	const created = res.rows[0];

	return c.json(
		{
			cleanupTask: {
				id: created.id as string,
				eventId: created.eventId as string,
				title: created.title as string,
				description: (created.description ?? null) as string | null,
				location: input.location ?? null,
				assignedUserId: (created.assignedUserId ?? null) as string | null,
				status: created.status as string,
				dueAt: created.dueAt ? new Date(created.dueAt as string) : null,
				verifiedBy: null,
				verifiedAt: null,
				createdAt: new Date(created.createdAt as string),
				updatedAt: new Date(created.updatedAt as string),
			},
		},
		201,
	);
});

// GET /api/events/:eventId/waste-records
eventsCleanupRouter.get("/:eventId/waste-records", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const access = await assertCleanupAccessForEvent(c, eventId, currentUser.id);
	if (access.error) return access.error;

	const db = c.get("db");
	const records = await db
		.select({
			id: wasteRecords.id,
			eventId: wasteRecords.eventId,
			taskId: wasteRecords.taskId,
			category: wasteRecords.category,
			quantityKg: wasteRecords.quantityKg,
			sackCount: wasteRecords.sackCount,
			measurementMethod: wasteRecords.measurementMethod,
			destination: wasteRecords.destination,
			recordedBy: wasteRecords.recordedBy,
			recordedAt: wasteRecords.recordedAt,
			recordedByName: userTable.name,
		})
		.from(wasteRecords)
		.leftJoin(userTable, eq(wasteRecords.recordedBy, userTable.id))
		.where(eq(wasteRecords.eventId, eventId))
		.orderBy(desc(wasteRecords.recordedAt));

	return c.json({ wasteRecords: records }, 200);
});

// POST /api/events/:eventId/waste-records
eventsCleanupRouter.post("/:eventId/waste-records", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const access = await assertCleanupAccessForEvent(c, eventId, currentUser.id);
	if (access.error) return access.error;
	const event = access.event;

	if (event.status === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot record waste on a cancelled event.",
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Request body must be valid JSON.", 400);
	}

	const parsed = createWasteRecordSchema.safeParse(body);
	if (!parsed.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parsed.error.issues[0]?.message || "Invalid waste record payload.",
			422,
		);
	}

	const input = parsed.data;
	const db = c.get("db");

	// If taskId provided, verify it belongs to this event
	if (input.taskId) {
		const taskRows = await db
			.select({ id: cleanupTasks.id })
			.from(cleanupTasks)
			.where(
				and(
					eq(cleanupTasks.id, input.taskId),
					eq(cleanupTasks.eventId, eventId),
				),
			)
			.limit(1);

		if (taskRows.length === 0) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Referenced cleanup task does not belong to this event.",
				422,
			);
		}
	}

	const wasteId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();

	const afterSnapshot = {
		category: input.category,
		quantityKg: input.quantityKg ?? null,
		sackCount: input.sackCount ?? null,
		measurementMethod: input.measurementMethod,
		destination: input.destination ?? null,
		taskId: input.taskId ?? null,
		recordedBy: currentUser.id,
		recordedAt: now.toISOString(),
	};

	const query = sql`
		WITH new_waste AS (
			INSERT INTO waste_records (
				id, event_id, task_id, category, quantity_kg, sack_count, measurement_method, destination, recorded_by, recorded_at
			)
			VALUES (
				${wasteId}, ${eventId}, ${input.taskId ?? null}, ${input.category},
				${input.quantityKg !== undefined ? input.quantityKg.toString() : null},
				${input.sackCount ?? null},
				${input.measurementMethod},
				${input.destination ?? null},
				${currentUser.id},
				${now}
			)
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			VALUES (
				${auditId}, ${event.organizationId}, ${eventId}, ${currentUser.id},
				'waste_record.created', 'waste_record', ${wasteId},
				NULL, ${JSON.stringify(afterSnapshot)}::jsonb, ${now}
			)
			RETURNING id
		)
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
		FROM new_waste;
	`;

	const res = await db.execute(query);
	const created = res.rows[0];

	return c.json(
		{
			wasteRecord: {
				id: created.id as string,
				eventId: created.eventId as string,
				taskId: (created.taskId ?? null) as string | null,
				category: created.category as string,
				quantityKg: created.quantityKg ? Number(created.quantityKg) : null,
				sackCount: created.sackCount ? Number(created.sackCount) : null,
				measurementMethod: created.measurementMethod as string,
				destination: (created.destination ?? null) as string | null,
				recordedBy: created.recordedBy as string,
				recordedAt: new Date(created.recordedAt as string),
			},
		},
		201,
	);
});

// 2. Direct Cleanup Tasks Router: /api/cleanup-tasks
export const cleanupTasksRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

cleanupTasksRouter.use("*", requireAuth);

// PATCH /api/cleanup-tasks/:taskId
cleanupTasksRouter.patch("/:taskId", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	const idValidation = uuidParamSchema.safeParse(taskId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid cleanup task ID format.", 422);
	}

	const task = await getTaskWithEvent(c, taskId);
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await assertCleanupAccessForEvent(c, task.eventId, currentUser.id);
	if (access.error) return access.error;

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Request body must be valid JSON.", 400);
	}

	const parsed = patchCleanupTaskSchema.safeParse(body);
	if (!parsed.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parsed.error.issues[0]?.message || "Invalid cleanup task patch payload.",
			422,
		);
	}

	const input = parsed.data;

	// Role-dependent field enforcement (AGENTS §16, API-CONTRACT §8)
	if (!access.isOrganizer) {
		// Field officer: CANNOT change title, description, assignedUserId, dueAt, or set verified/reopened status
		if (
			input.title !== undefined ||
			input.description !== undefined ||
			input.assignedUserId !== undefined ||
			input.dueAt !== undefined ||
			input.location !== undefined
		) {
			return sendError(
				c,
				"FORBIDDEN",
				"Field officers may only update task progress status, not administrative task details.",
				403,
			);
		}

		if (input.status !== undefined) {
			// Officer can only transition from todo -> in_progress, or in_progress -> submitted
			const allowedFromTodo = task.status === "todo" && input.status === "in_progress";
			const allowedFromReopened = task.status === "reopened" && input.status === "in_progress";
			const allowedFromInProgress = task.status === "in_progress" && input.status === "submitted";

			if (!allowedFromTodo && !allowedFromReopened && !allowedFromInProgress) {
				return sendError(
					c,
					"STATE_CONFLICT",
					`Unauthorized status transition for officer from '${task.status}' to '${input.status}'.`,
					409,
				);
			}
		}
	} else {
		// Organizer status transitions: cannot directly set verified without /verify endpoint
		if (input.status === "verified") {
			return sendError(
				c,
				"STATE_CONFLICT",
				"Task verification requires using the explicit POST /api/cleanup-tasks/:taskId/verify endpoint.",
				409,
			);
		}
	}

	const db = c.get("db");

	// If assignedUserId updated by organizer, verify membership
	if (input.assignedUserId) {
		const member = await db
			.select({ id: memberships.id })
			.from(memberships)
			.where(
				and(
					eq(memberships.organizationId, task.organizationId),
					eq(memberships.userId, input.assignedUserId),
				),
			)
			.limit(1);

		if (member.length === 0) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Assigned user is not a member of the event organization.",
				422,
			);
		}
	}

	const now = new Date();
	const newTitle = input.title ?? task.title;
	const newDesc = input.description !== undefined ? input.description : task.description;
	const newAssignedUserId =
		input.assignedUserId !== undefined ? input.assignedUserId : task.assignedUserId;
	const newStatus = input.status ?? task.status;
	const newDueAt =
		input.dueAt !== undefined
			? input.dueAt
				? new Date(input.dueAt)
				: null
			: task.dueAt;

	const beforeSnapshot = {
		title: task.title,
		description: task.description,
		assignedUserId: task.assignedUserId,
		status: task.status,
		dueAt: task.dueAt ? task.dueAt.toISOString() : null,
	};

	const afterSnapshot = {
		title: newTitle,
		description: newDesc,
		assignedUserId: newAssignedUserId,
		status: newStatus,
		dueAt: newDueAt ? newDueAt.toISOString() : null,
	};

	const locationSql =
		input.location !== undefined
			? input.location
				? sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)`
				: sql`NULL`
			: sql`location`;

	const auditId = crypto.randomUUID();

	const query = sql`
		WITH updated AS (
			UPDATE cleanup_tasks
			SET
				title = ${newTitle},
				description = ${newDesc},
				location = ${locationSql},
				assigned_user_id = ${newAssignedUserId},
				status = ${newStatus},
				due_at = ${newDueAt},
				updated_at = ${now}
			WHERE id = ${taskId}
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			VALUES (
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.updated', 'cleanup_task', ${taskId},
				${JSON.stringify(beforeSnapshot)}::jsonb,
				${JSON.stringify(afterSnapshot)}::jsonb,
				${now}
			)
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			title,
			description,
			assigned_user_id AS "assignedUserId",
			status,
			due_at AS "dueAt",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM updated;
	`;

	const res = await db.execute(query);
	const updated = res.rows[0];

	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				location: input.location !== undefined ? input.location : undefined,
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt ? new Date(updated.dueAt as string) : null,
				verifiedBy: (updated.verifiedBy ?? null) as string | null,
				verifiedAt: updated.verifiedAt ? new Date(updated.verifiedAt as string) : null,
				createdAt: new Date(updated.createdAt as string),
				updatedAt: new Date(updated.updatedAt as string),
			},
		},
		200,
	);
});

// POST /api/cleanup-tasks/:taskId/submit - Officer submits completed work
cleanupTasksRouter.post("/:taskId/submit", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	const idValidation = uuidParamSchema.safeParse(taskId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid cleanup task ID format.", 422);
	}

	const task = await getTaskWithEvent(c, taskId);
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await assertCleanupAccessForEvent(c, task.eventId, currentUser.id);
	if (access.error) return access.error;

	if (task.status !== "in_progress" && task.status !== "todo" && task.status !== "reopened") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot submit cleanup task in '${task.status}' state. Only in_progress, todo, or reopened tasks can be submitted.`,
			409,
		);
	}

	const db = c.get("db");
	const auditId = crypto.randomUUID();
	const now = new Date();

	const query = sql`
		WITH updated AS (
			UPDATE cleanup_tasks
			SET
				status = 'submitted',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			WHERE id = ${taskId} AND status IN ('todo', 'in_progress', 'reopened')
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.submitted', 'cleanup_task', id,
				${JSON.stringify({ status: task.status })}::jsonb,
				${JSON.stringify({ status: "submitted" })}::jsonb,
				${now}
			FROM updated
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			title,
			description,
			assigned_user_id AS "assignedUserId",
			status,
			due_at AS "dueAt",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM updated;
	`;

	const res = await db.execute(query);
	if (res.rows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cleanup task could not be submitted. It may have been updated concurrently.",
			409,
		);
	}

	const updated = res.rows[0];
	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt ? new Date(updated.dueAt as string) : null,
				verifiedBy: null,
				verifiedAt: null,
				createdAt: new Date(updated.createdAt as string),
				updatedAt: new Date(updated.updatedAt as string),
			},
		},
		200,
	);
});

// POST /api/cleanup-tasks/:taskId/verify - Organizer verifies submitted task
cleanupTasksRouter.post("/:taskId/verify", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	const idValidation = uuidParamSchema.safeParse(taskId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid cleanup task ID format.", 422);
	}

	const task = await getTaskWithEvent(c, taskId);
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	// Organizer verification: ONLY organizer may verify (AGENTS §13, FR-053)
	const organizerCheck = await assertOrganizerForEvent(c, task.eventId, currentUser.id);
	if (organizerCheck.error) return organizerCheck.error;

	if (task.status !== "submitted") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot verify cleanup task in '${task.status}' state. Only submitted tasks can be verified.`,
			409,
		);
	}

	const db = c.get("db");
	const auditId = crypto.randomUUID();
	const now = new Date();

	// Independent invariant: Cleanup verification does NOT open or update roads!
	const query = sql`
		WITH updated AS (
			UPDATE cleanup_tasks
			SET
				status = 'verified',
				verified_by = ${currentUser.id},
				verified_at = ${now},
				updated_at = ${now}
			WHERE id = ${taskId} AND status = 'submitted'
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.verified', 'cleanup_task', id,
				${JSON.stringify({ status: "submitted" })}::jsonb,
				${JSON.stringify({ status: "verified", verifiedBy: currentUser.id, verifiedAt: now.toISOString() })}::jsonb,
				${now}
			FROM updated
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			title,
			description,
			assigned_user_id AS "assignedUserId",
			status,
			due_at AS "dueAt",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM updated;
	`;

	const res = await db.execute(query);
	if (res.rows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cleanup task could not be verified. It may have been updated concurrently.",
			409,
		);
	}

	const updated = res.rows[0];
	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt ? new Date(updated.dueAt as string) : null,
				verifiedBy: updated.verifiedBy as string,
				verifiedAt: new Date(updated.verifiedAt as string),
				createdAt: new Date(updated.createdAt as string),
				updatedAt: new Date(updated.updatedAt as string),
			},
		},
		200,
	);
});

// POST /api/cleanup-tasks/:taskId/reopen - Organizer reopens submitted or verified task
cleanupTasksRouter.post("/:taskId/reopen", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	const idValidation = uuidParamSchema.safeParse(taskId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid cleanup task ID format.", 422);
	}

	const task = await getTaskWithEvent(c, taskId);
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	// Organizer reopen: ONLY organizer may reopen (FR-053)
	const organizerCheck = await assertOrganizerForEvent(c, task.eventId, currentUser.id);
	if (organizerCheck.error) return organizerCheck.error;

	if (task.status !== "submitted" && task.status !== "verified") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot reopen cleanup task in '${task.status}' state. Only submitted or verified tasks can be reopened.`,
			409,
		);
	}

	let body: unknown = {};
	try {
		body = await c.req.json();
	} catch {
		// Empty body is allowed for reopen
	}

	const parsed = reopenCleanupTaskSchema.safeParse(body);
	const reason = parsed.success ? parsed.data.reason : undefined;

	const db = c.get("db");
	const auditId = crypto.randomUUID();
	const now = new Date();

	const beforeSnapshot = {
		status: task.status,
		verifiedBy: task.verifiedBy,
		verifiedAt: task.verifiedAt ? task.verifiedAt.toISOString() : null,
	};

	const afterSnapshot = {
		status: "reopened",
		verifiedBy: null,
		verifiedAt: null,
		reason: reason ?? null,
	};

	const query = sql`
		WITH updated AS (
			UPDATE cleanup_tasks
			SET
				status = 'reopened',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			WHERE id = ${taskId} AND status IN ('submitted', 'verified')
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.reopened', 'cleanup_task', id,
				${JSON.stringify(beforeSnapshot)}::jsonb,
				${JSON.stringify(afterSnapshot)}::jsonb,
				${now}
			FROM updated
			RETURNING id
		)
		SELECT
			id,
			event_id AS "eventId",
			title,
			description,
			assigned_user_id AS "assignedUserId",
			status,
			due_at AS "dueAt",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM updated;
	`;

	const res = await db.execute(query);
	if (res.rows.length === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cleanup task could not be reopened. It may have been updated concurrently.",
			409,
		);
	}

	const updated = res.rows[0];
	return c.json(
		{
			cleanupTask: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				title: updated.title as string,
				description: (updated.description ?? null) as string | null,
				assignedUserId: (updated.assignedUserId ?? null) as string | null,
				status: updated.status as string,
				dueAt: updated.dueAt ? new Date(updated.dueAt as string) : null,
				verifiedBy: null,
				verifiedAt: null,
				createdAt: new Date(updated.createdAt as string),
				updatedAt: new Date(updated.updatedAt as string),
			},
		},
		200,
	);
});

// POST /api/cleanup-tasks/:taskId/evidence - Multipart photo evidence upload
cleanupTasksRouter.post("/:taskId/evidence", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");

	const idValidation = uuidParamSchema.safeParse(taskId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid cleanup task ID format.", 422);
	}

	const task = await getTaskWithEvent(c, taskId);
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	const access = await assertCleanupAccessForEvent(c, task.eventId, currentUser.id);
	if (access.error) return access.error;

	if (task.eventStatus === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot upload cleanup evidence on a cancelled event.",
			409,
		);
	}

	// Rate limit check
	if (!checkUploadRateLimit(currentUser.id)) {
		return sendError(
			c,
			"TOO_MANY_REQUESTS",
			"Upload rate limit exceeded. Please retry later.",
			429,
		);
	}

	// Parse multipart form
	let formData: FormData;
	try {
		formData = await c.req.formData();
	} catch {
		return sendError(
			c,
			"BAD_REQUEST",
			"Failed to parse multipart/form-data payload.",
			400,
		);
	}

	const stageParam = formData.get("stage");
	if (stageParam !== "before" && stageParam !== "after") {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Stage must be 'before' or 'after'.",
			422,
		);
	}

	const fileField = formData.get("file");
	if (!fileField || !(fileField instanceof File)) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Evidence photo file is required.",
			422,
		);
	}

	// Size limit: 8MB
	const MAX_SIZE = 8 * 1024 * 1024;
	if (fileField.size === 0) {
		return sendError(c, "VALIDATION_FAILED", "Uploaded file is empty.", 422);
	}
	if (fileField.size > MAX_SIZE) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			`File size exceeds 8MB limit (got ${fileField.size} bytes).`,
			422,
		);
	}

	// Read bytes and verify magic bytes
	const arrayBuffer = await fileField.arrayBuffer();
	const bytes = new Uint8Array(arrayBuffer);
	const magic = detectPhotoMagicBytes(bytes);

	if (!magic.isValid || !magic.mimeType || !magic.extension) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid image file format. Only authentic JPEG and PNG photos are accepted for evidence.",
			422,
		);
	}

	// Check R2 bucket binding
	const bucket =
		c.env.rangkai_documents_dev ??
		((c.env as Record<string, unknown>).DOCUMENTS as R2Bucket | undefined);

	if (!bucket) {
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Storage service binding is unavailable.",
			500,
		);
	}

	const evidenceId = crypto.randomUUID();
	const r2Key = `events/${task.eventId}/cleanup-tasks/${taskId}/${stageParam}-${crypto.randomUUID()}.${magic.extension}`;

	// Store in R2
	try {
		await bucket.put(r2Key, arrayBuffer, {
			httpMetadata: {
				contentType: magic.mimeType,
			},
			customMetadata: {
				eventId: task.eventId,
				taskId: taskId,
				uploadedBy: currentUser.id,
				stage: stageParam,
			},
		});
	} catch {
		return sendError(
			c,
			"SERVICE_UNAVAILABLE",
			"Failed to store photo evidence in storage.",
			503,
		);
	}

	// Persist metadata in Neon
	const db = c.get("db");
	const auditId = crypto.randomUUID();
	const now = new Date();

	const afterSnapshot = {
		id: evidenceId,
		taskId: taskId,
		stage: stageParam,
		uploadedBy: currentUser.id,
		mimeType: magic.mimeType,
	};

	try {
		const query = sql`
			WITH new_evidence AS (
				INSERT INTO cleanup_evidence (
					id, task_id, uploaded_by, r2_key, stage, created_at
				)
				VALUES (
					${evidenceId}, ${taskId}, ${currentUser.id}, ${r2Key}, ${stageParam}, ${now}
				)
				RETURNING *
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				VALUES (
					${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
					'cleanup_evidence.uploaded', 'cleanup_evidence', ${evidenceId},
					NULL, ${JSON.stringify(afterSnapshot)}::jsonb, ${now}
				)
				RETURNING id
			)
			SELECT id, task_id AS "taskId", stage, created_at AS "createdAt"
			FROM new_evidence;
		`;

		const res = await db.execute(query);
		const created = res.rows[0];

		// Return safe metadata ONLY - never raw R2 key or public URL!
		return c.json(
			{
				evidence: {
					id: created.id as string,
					taskId: created.taskId as string,
					stage: created.stage as string,
					createdAt: new Date(created.createdAt as string),
				},
			},
			201,
		);
	} catch {
		// Compensation: delete R2 object on DB failure to avoid orphaned storage
		try {
			await bucket.delete(r2Key);
		} catch {
			// Best effort cleanup
		}
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Failed to record evidence metadata.",
			500,
		);
	}
});

// GET /api/cleanup-tasks/:taskId/evidence/:evidenceId - Controlled photo download
cleanupTasksRouter.get("/:taskId/evidence/:evidenceId", async (c) => {
	const currentUser = c.get("user")!;
	const taskId = c.req.param("taskId");
	const evidenceId = c.req.param("evidenceId");

	const idValidation = uuidParamSchema.safeParse(taskId);
	const evValidation = uuidParamSchema.safeParse(evidenceId);
	if (!idValidation.success || !evValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid ID format.", 422);
	}

	const task = await getTaskWithEvent(c, taskId);
	if (!task) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	// Must be organizer or assigned cleanup officer for this event
	const access = await assertCleanupAccessForEvent(c, task.eventId, currentUser.id);
	if (access.error) return access.error;

	const db = c.get("db");
	const evidenceRows = await db
		.select()
		.from(cleanupEvidence)
		.where(
			and(
				eq(cleanupEvidence.id, evidenceId),
				eq(cleanupEvidence.taskId, taskId),
			),
		)
		.limit(1);

	const evidence = evidenceRows[0];
	if (!evidence) {
		return sendError(c, "NOT_FOUND", "Cleanup evidence photo not found.", 404);
	}

	const bucket =
		c.env.rangkai_documents_dev ??
		((c.env as Record<string, unknown>).DOCUMENTS as R2Bucket | undefined);

	if (!bucket) {
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Storage service binding is unavailable.",
			500,
		);
	}

	const object = await bucket.get(evidence.r2Key);
	if (!object) {
		return sendError(
			c,
			"NOT_FOUND",
			"Photo file not found in storage.",
			404,
		);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
	headers.set("Content-Disposition", "inline");

	return new Response(object.body, {
		status: 200,
		headers,
	});
});
