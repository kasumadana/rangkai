import crypto from "node:crypto";
import path from "node:path";
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
import {
	ALLOWED_PHOTO_EXTENSIONS,
	checkUploadRateLimit,
	MAX_PHOTO_SIZE_BYTES,
	readBoundedRequestBody,
	sanitizeFilename,
} from "../validators/documents";

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

	// Query cleanup tasks with PostGIS Point coordinates and evidence count
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
		WITH current_event AS (
			SELECT e.id, e.organization_id
			FROM events e
			JOIN memberships m ON m.organization_id = e.organization_id
			WHERE e.id = ${eventId}
			  AND e.status != 'cancelled'
			  AND m.user_id = ${currentUser.id}
			  AND m.role = 'organizer'
			FOR UPDATE OF e
		),
		new_task AS (
			INSERT INTO cleanup_tasks (
				id, event_id, title, description, location, assigned_user_id, status, due_at, created_at, updated_at
			)
			SELECT
				${taskId}, ce.id, ${input.title}, ${input.description ?? null},
				${locationSql}, ${input.assignedUserId ?? null}, 'todo', ${dueAtDate}, ${now}, ${now}
			FROM current_event ce
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ce.organization_id, ${eventId}, ${currentUser.id},
				'cleanup_task.created', 'cleanup_task', nt.id,
				NULL, ${JSON.stringify(afterSnapshot)}::jsonb, ${now}
			FROM new_task nt
			JOIN current_event ce ON ce.id = nt.event_id
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
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM new_task;
	`;

	const res = await db.execute(query);
	const created = res.rows[0];

	if (!created) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cleanup task could not be created due to event status or permission changes.",
			409,
		);
	}

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
		const task = await db
			.select({ id: cleanupTasks.id })
			.from(cleanupTasks)
			.where(
				and(
					eq(cleanupTasks.id, input.taskId),
					eq(cleanupTasks.eventId, eventId),
				),
			)
			.limit(1);

		if (task.length === 0) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Referenced cleanup task does not exist for this event.",
				422,
			);
		}
	}

	const recordId = crypto.randomUUID();
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
	};

	const query = sql`
		WITH new_record AS (
			INSERT INTO waste_records (
				id, event_id, task_id, category, quantity_kg, sack_count, measurement_method, destination, recorded_by, recorded_at
			)
			VALUES (
				${recordId}, ${eventId}, ${input.taskId ?? null}, ${input.category},
				${input.quantityKg !== undefined ? String(input.quantityKg) : null},
				${input.sackCount ?? null}, ${input.measurementMethod}, ${input.destination ?? null},
				${currentUser.id}, ${now}
			)
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			VALUES (
				${auditId}, ${event.organizationId}, ${eventId}, ${currentUser.id},
				'waste_record.created', 'waste_record', ${recordId},
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
		FROM new_record;
	`;

	const res = await db.execute(query);
	const row = res.rows[0];

	return c.json(
		{
			wasteRecord: {
				id: row.id as string,
				eventId: row.eventId as string,
				taskId: (row.taskId ?? null) as string | null,
				category: row.category as string,
				quantityKg: row.quantityKg ? Number(row.quantityKg) : null,
				sackCount: row.sackCount ? Number(row.sackCount) : null,
				measurementMethod: row.measurementMethod as string,
				destination: (row.destination ?? null) as string | null,
				recordedBy: row.recordedBy as string,
				recordedAt: new Date(row.recordedAt as string).toISOString(),
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
	const rows = await db
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
			recordedByName: userTable.name,
			recordedAt: wasteRecords.recordedAt,
		})
		.from(wasteRecords)
		.leftJoin(userTable, eq(wasteRecords.recordedBy, userTable.id))
		.where(eq(wasteRecords.eventId, eventId))
		.orderBy(desc(wasteRecords.recordedAt));

	const records = rows.map((r) => ({
		id: r.id,
		eventId: r.eventId,
		taskId: r.taskId ?? null,
		category: r.category,
		quantityKg: r.quantityKg ? Number(r.quantityKg) : null,
		sackCount: r.sackCount ? Number(r.sackCount) : null,
		measurementMethod: r.measurementMethod,
		destination: r.destination ?? null,
		recordedBy: r.recordedBy,
		recordedByName: r.recordedByName ?? null,
		recordedAt: r.recordedAt.toISOString(),
	}));

	return c.json({ wasteRecords: records }, 200);
});

// 2. Cleanup Tasks individual router: /api/cleanup-tasks
export const cleanupTasksRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

cleanupTasksRouter.use("*", requireAuth);

// GET /api/cleanup-tasks/:taskId
cleanupTasksRouter.get("/:taskId", async (c) => {
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

	const db = c.get("db");

	// Query task with coordinates and evidence list
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
			ct.updated_at AS "updatedAt"
		FROM cleanup_tasks ct
		LEFT JOIN "user" u ON ct.assigned_user_id = u.id
		WHERE ct.id = ${taskId}
		LIMIT 1;
	`;

	const res = await db.execute(query);
	const row = res.rows[0];

	if (!row) {
		return sendError(c, "NOT_FOUND", "Cleanup task not found.", 404);
	}

	// Fetch evidence items
	const evidenceRows = await db
		.select({
			id: cleanupEvidence.id,
			taskId: cleanupEvidence.taskId,
			stage: cleanupEvidence.stage,
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
				location: row.location as { lng: number; lat: number } | null,
				assignedUserId: (row.assignedUserId ?? null) as string | null,
				assignedUserName: (row.assignedUserName ?? null) as string | null,
				status: row.status as string,
				dueAt: row.dueAt ? new Date(row.dueAt as string) : null,
				verifiedBy: (row.verifiedBy ?? null) as string | null,
				verifiedAt: row.verifiedAt ? new Date(row.verifiedAt as string) : null,
				createdAt: new Date(row.createdAt as string),
				updatedAt: new Date(row.updatedAt as string),
				evidence: evidenceRows.map((e) => ({
					id: e.id,
					stage: e.stage,
					createdAt: e.createdAt.toISOString(),
				})),
			},
		},
		200,
	);
});

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

	// Invariant: Once verified, a task cannot be modified via PATCH (must use /reopen)
	if (task.status === "verified") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Verified tasks cannot be edited via PATCH; use explicit POST /api/cleanup-tasks/:taskId/reopen to reopen.",
			409,
		);
	}

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

	// Role-dependent field enforcement & task ownership (AGENTS §16, API-CONTRACT §8)
	if (!access.isOrganizer) {
		// Field officer: must be assigned to this task!
		if (task.assignedUserId !== currentUser.id) {
			return sendError(
				c,
				"FORBIDDEN",
				"Field officers may only update tasks assigned to them.",
				403,
			);
		}

		// Field officer CANNOT change title, description, assignedUserId, dueAt, or location
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
			// Officer can only transition from todo -> in_progress, reopened -> in_progress, or in_progress -> submitted
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

	// If transitioning to 'submitted', enforce after-photo evidence requirement!
	if (input.status === "submitted" && task.status !== "submitted") {
		const afterCount = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(cleanupEvidence)
			.where(and(eq(cleanupEvidence.taskId, taskId), eq(cleanupEvidence.stage, "after")));

		if ((afterCount[0]?.count ?? 0) === 0) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"Task cannot be submitted without at least one 'after' photo evidence.",
				409,
			);
		}
	}

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
		verifiedBy: task.verifiedBy,
		verifiedAt: task.verifiedAt ? task.verifiedAt.toISOString() : null,
	};

	const afterSnapshot = {
		title: newTitle,
		description: newDesc,
		assignedUserId: newAssignedUserId,
		status: newStatus,
		dueAt: newDueAt ? newDueAt.toISOString() : null,
		verifiedBy: null, // Any material change or reopen clears verification!
		verifiedAt: null,
	};

	const locationSql =
		input.location !== undefined
			? input.location
				? sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)`
				: sql`NULL`
			: sql`ct.location`;

	const auditId = crypto.randomUUID();

	// Atomic update with authoritative lock: prevent stale updates on verified task or revoked assignment
	const officerPredicate = access.isOrganizer
		? sql`TRUE`
		: sql`ct.assigned_user_id = ${currentUser.id}`;

	const query = sql`
		WITH current_task AS (
			SELECT ct.*
			FROM cleanup_tasks ct
			JOIN events e ON e.id = ct.event_id
			WHERE ct.id = ${taskId}
			  AND ct.status != 'verified'
			  AND e.status != 'cancelled'
			  AND ${officerPredicate}
			FOR UPDATE
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				title = ${newTitle},
				description = ${newDesc},
				location = ${locationSql},
				assigned_user_id = ${newAssignedUserId},
				status = ${newStatus},
				due_at = ${newDueAt},
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			FROM current_task ctk
			WHERE ct.id = ctk.id
			RETURNING ct.*
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.updated', 'cleanup_task', u.id,
				${JSON.stringify(beforeSnapshot)}::jsonb,
				${JSON.stringify(afterSnapshot)}::jsonb,
				${now}
			FROM updated u
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

	if (!updated) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cleanup task could not be updated. Ensure the task is not verified, event is not cancelled, and you have active assignment.",
			409,
		);
	}

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
				verifiedBy: null,
				verifiedAt: null,
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

	// Officer task ownership
	if (!access.isOrganizer && task.assignedUserId !== currentUser.id) {
		return sendError(
			c,
			"FORBIDDEN",
			"Field officers may only submit tasks assigned to them.",
			403,
		);
	}

	if (task.status !== "in_progress" && task.status !== "todo" && task.status !== "reopened") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot submit cleanup task in '${task.status}' state. Only in_progress, todo, or reopened tasks can be submitted.`,
			409,
		);
	}

	const db = c.get("db");

	// Enforce after-evidence requirement!
	const afterCount = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(cleanupEvidence)
		.where(and(eq(cleanupEvidence.taskId, taskId), eq(cleanupEvidence.stage, "after")));

	if ((afterCount[0]?.count ?? 0) === 0) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Task cannot be submitted without at least one 'after' photo evidence.",
			409,
		);
	}

	const auditId = crypto.randomUUID();
	const now = new Date();

	const officerPredicate = access.isOrganizer
		? sql`TRUE`
		: sql`ct.assigned_user_id = ${currentUser.id}`;

	const query = sql`
		WITH current_task AS (
			SELECT ct.*
			FROM cleanup_tasks ct
			JOIN events e ON e.id = ct.event_id
			WHERE ct.id = ${taskId}
			  AND ct.status IN ('todo', 'in_progress', 'reopened')
			  AND e.status != 'cancelled'
			  AND ${officerPredicate}
			FOR UPDATE OF ct
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				status = 'submitted',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			FROM current_task ctk
			WHERE ct.id = ctk.id
			RETURNING ct.*
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.submitted', 'cleanup_task', u.id,
				${JSON.stringify({ status: task.status })}::jsonb,
				${JSON.stringify({ status: "submitted" })}::jsonb,
				${now}
			FROM updated u
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
			"Cleanup task could not be submitted. It may have been updated concurrently or assignment changed.",
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
		WITH current_task AS (
			SELECT ct.*
			FROM cleanup_tasks ct
			JOIN events e ON e.id = ct.event_id
			JOIN memberships m ON m.organization_id = e.organization_id
			WHERE ct.id = ${taskId}
			  AND ct.status = 'submitted'
			  AND m.user_id = ${currentUser.id}
			  AND m.role = 'organizer'
			FOR UPDATE OF ct
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				status = 'verified',
				verified_by = ${currentUser.id},
				verified_at = ${now},
				updated_at = ${now}
			FROM current_task ctk
			WHERE ct.id = ctk.id
			RETURNING ct.*
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.verified', 'cleanup_task', u.id,
				${JSON.stringify({ status: "submitted" })}::jsonb,
				${JSON.stringify({ status: "verified", verifiedBy: currentUser.id, verifiedAt: now.toISOString() })}::jsonb,
				${now}
			FROM updated u
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
		WITH current_task AS (
			SELECT ct.*
			FROM cleanup_tasks ct
			JOIN events e ON e.id = ct.event_id
			JOIN memberships m ON m.organization_id = e.organization_id
			WHERE ct.id = ${taskId}
			  AND ct.status IN ('submitted', 'verified')
			  AND m.user_id = ${currentUser.id}
			  AND m.role = 'organizer'
			FOR UPDATE OF ct
		),
		updated AS (
			UPDATE cleanup_tasks ct
			SET
				status = 'reopened',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			FROM current_task ctk
			WHERE ct.id = ctk.id
			RETURNING ct.*
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
				'cleanup_task.reopened', 'cleanup_task', u.id,
				${JSON.stringify(beforeSnapshot)}::jsonb,
				${JSON.stringify(afterSnapshot)}::jsonb,
				${now}
			FROM updated u
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

	// Officer task ownership: cannot upload photo to another officer's task
	if (!access.isOrganizer && task.assignedUserId !== currentUser.id) {
		return sendError(
			c,
			"FORBIDDEN",
			"Field officers may only upload evidence for tasks assigned to them.",
			403,
		);
	}

	if (task.eventStatus === "cancelled") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot upload cleanup evidence on a cancelled event.",
			409,
		);
	}

	if (task.status === "verified") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot upload evidence to a verified task. Task must be reopened first.",
			409,
		);
	}

	// Rate limit check
	if (!checkUploadRateLimit(currentUser.id)) {
		return sendError(
			c,
			"RATE_LIMITED",
			"Upload rate limit exceeded. Please retry later.",
			429,
		);
	}

	// 1. Content-Length pre-check
	const contentLengthHeader = c.req.header("content-length");
	if (contentLengthHeader) {
		const cl = parseInt(contentLengthHeader, 10);
		if (!isNaN(cl) && cl > MAX_PHOTO_SIZE_BYTES + 65536) {
			return sendError(
				c,
				"FILE_TOO_LARGE",
				`Photo exceeds maximum permitted size of ${MAX_PHOTO_SIZE_BYTES} bytes (5 MB).`,
				413,
			);
		}
	}

	// 2. Stream-bound request body before buffering
	const bounded = await readBoundedRequestBody(c.req.raw, MAX_PHOTO_SIZE_BYTES + 65536);
	if (bounded.error === "FILE_TOO_LARGE") {
		return sendError(
			c,
			"FILE_TOO_LARGE",
			`Photo exceeds maximum permitted size of ${MAX_PHOTO_SIZE_BYTES} bytes (5 MB).`,
			413,
		);
	}

	// 3. Parse bounded multipart form
	let formData: FormData;
	try {
		const boundedReq = new Request(c.req.raw.url, {
			method: c.req.raw.method,
			headers: c.req.raw.headers,
			body: bounded.buffer,
		});
		formData = await boundedReq.formData();
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

	// 4. Enforce exactly one file in the multipart payload
	let fileCount = 0;
	let photoFile: File | null = null;
	for (const [key, value] of formData.entries()) {
		if (
			value instanceof File ||
			(typeof value === "object" && value !== null && "arrayBuffer" in value)
		) {
			fileCount++;
			if ((key === "file" || key === "photo") && !photoFile) {
				photoFile = value as File;
			}
		}
	}

	if (fileCount !== 1 || !photoFile) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Exactly one evidence photo file is required.",
			422,
		);
	}

	if (photoFile.size === 0) {
		return sendError(c, "VALIDATION_FAILED", "Uploaded file is empty.", 422);
	}
	if (photoFile.size > MAX_PHOTO_SIZE_BYTES) {
		return sendError(
			c,
			"FILE_TOO_LARGE",
			`File size exceeds 5MB limit (got ${photoFile.size} bytes).`,
			413,
		);
	}

	// 5. Allowed extension check
	const originalName = sanitizeFilename(photoFile.name || "photo.jpg");
	const ext = path.extname(originalName).toLowerCase();
	if (!ALLOWED_PHOTO_EXTENSIONS.has(ext)) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			`Photo extension '${ext}' is not permitted. Only .jpg, .jpeg, and .png photos are accepted.`,
			422,
		);
	}

	// 6. Magic bytes check
	const arrayBuffer = await photoFile.arrayBuffer();
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

	// 7. Claimed MIME check
	if (
		photoFile.type &&
		photoFile.type !== magic.mimeType &&
		!(photoFile.type === "image/jpg" && magic.mimeType === "image/jpeg")
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Claimed Content-Type does not match inspected photo signature.",
			422,
		);
	}

	// 8. Put photo to R2
	const bucket =
		c.env.rangkai_documents_dev ??
		((c.env as Record<string, unknown>).DOCUMENTS as R2Bucket | undefined);

	if (!bucket) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Storage service binding is unavailable.",
			503,
		);
	}

	const evidenceId = crypto.randomUUID();
	const r2Key = `events/${task.eventId}/cleanup-tasks/${taskId}/${stageParam}-${crypto.randomUUID()}.${magic.extension}`;

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
			"DEPENDENCY_UNAVAILABLE",
			"Failed to store photo evidence in storage.",
			503,
		);
	}

	// 9. Persist metadata in DB with authoritative check
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
		const officerPredicate = access.isOrganizer
			? sql`TRUE`
			: sql`ct.assigned_user_id = ${currentUser.id}`;

		const query = sql`
			WITH current_task AS (
				SELECT ct.id
				FROM cleanup_tasks ct
				JOIN events e ON e.id = ct.event_id
				WHERE ct.id = ${taskId}
				  AND ct.status != 'verified'
				  AND e.status != 'cancelled'
				  AND ${officerPredicate}
				FOR UPDATE OF ct
			),
			new_evidence AS (
				INSERT INTO cleanup_evidence (
					id, task_id, uploaded_by, r2_key, stage, created_at
				)
				SELECT
					${evidenceId}, ct.id, ${currentUser.id}, ${r2Key}, ${stageParam}, ${now}
				FROM current_task ct
				RETURNING *
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId}, ${task.organizationId}, ${task.eventId}, ${currentUser.id},
					'cleanup_evidence.uploaded', 'cleanup_evidence', ne.id,
					NULL, ${JSON.stringify(afterSnapshot)}::jsonb, ${now}
				FROM new_evidence ne
				RETURNING id
			)
			SELECT id, task_id AS "taskId", stage, created_at AS "createdAt"
			FROM new_evidence;
		`;

		const res = await db.execute(query);
		const created = res.rows[0];

		if (!created) {
			// Winning mutation check failed: compensate by deleting from R2
			let compensationSuccess = true;
			try {
				await bucket.delete(r2Key);
			} catch (compErr) {
				compensationSuccess = false;
				console.error("COMPENSATION_FAILURE: R2 orphan photo requires manual reconciliation", {
					taskId,
					evidenceId,
					error: compErr instanceof Error ? compErr.message : String(compErr),
				});
			}

			if (!compensationSuccess) {
				return sendError(
					c,
					"DEPENDENCY_UNAVAILABLE",
					"Task state conflict occurred and storage cleanup requires manual reconciliation.",
					503,
				);
			}

			return sendError(
				c,
				"STATE_CONFLICT",
				"Cleanup task is verified, cancelled, or assignment changed.",
				409,
			);
		}

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
		let compensationSuccess = true;
		try {
			await bucket.delete(r2Key);
		} catch (compErr) {
			compensationSuccess = false;
			console.error("COMPENSATION_FAILURE: R2 orphan photo requires manual reconciliation", {
				taskId,
				evidenceId,
				error: compErr instanceof Error ? compErr.message : String(compErr),
			});
		}

		if (!compensationSuccess) {
			return sendError(
				c,
				"DEPENDENCY_UNAVAILABLE",
				"Failed to record evidence metadata and storage cleanup failed. Manual reconciliation required.",
				503,
			);
		}

		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Failed to record evidence metadata.",
			503,
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
	const rows = await db
		.select()
		.from(cleanupEvidence)
		.where(
			and(
				eq(cleanupEvidence.id, evidenceId),
				eq(cleanupEvidence.taskId, taskId),
			),
		)
		.limit(1);

	const evidence = rows[0];
	if (!evidence) {
		return sendError(c, "NOT_FOUND", "Evidence not found.", 404);
	}

	const bucket =
		c.env.rangkai_documents_dev ??
		((c.env as Record<string, unknown>).DOCUMENTS as R2Bucket | undefined);

	if (!bucket) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Storage service binding is unavailable.",
			503,
		);
	}

	const object = await bucket.get(evidence.r2Key);
	if (!object) {
		return sendError(c, "NOT_FOUND", "Evidence file not found in storage.", 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Cache-Control", "private, no-store");

	return new Response(object.body, { headers });
});
