import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
	cleanupTasks,
	eventAssignments,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
	roadStatusUpdates,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import { evaluateEffectiveRoadStatus } from "./roads";

export const fieldRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

fieldRouter.use("*", requireAuth);

/**
 * GET /api/field/tasks
 * Returns the real list of assigned events and field responsibilities for the authenticated user.
 * (Ticket 04, SRS FR-004, FR-033–039, FR-050–056)
 */
fieldRouter.get("/tasks", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	// 1. Officer assignments
	const assignmentRows = await db
		.select({
			assignmentId: eventAssignments.id,
			eventId: events.id,
			eventTitle: events.title,
			eventCategory: events.category,
			venueName: events.venueName,
			status: events.status,
			isSimulation: events.isSimulation,
			startsAt: events.startsAt,
			endsAt: events.endsAt,
			canUpdateTraffic: eventAssignments.canUpdateTraffic,
			canUpdateCleanup: eventAssignments.canUpdateCleanup,
			organizationId: events.organizationId,
			orgName: organizations.name,
			orgVillage: organizations.village,
			orgDistrict: organizations.district,
		})
		.from(eventAssignments)
		.innerJoin(events, eq(eventAssignments.eventId, events.id))
		.innerJoin(organizations, eq(events.organizationId, organizations.id))
		.innerJoin(memberships, and(eq(memberships.organizationId, events.organizationId), eq(memberships.userId, eventAssignments.userId)))
		.where(eq(eventAssignments.userId, currentUser.id))
		.orderBy(desc(events.startsAt));

	// 2. Also check if caller has organizer membership in any organizations
	// Organizers have implicit field oversight on their organization's active/published events
	const organizerMemberships = await db
		.select({ organizationId: memberships.organizationId })
		.from(memberships)
		.where(
			and(
				eq(memberships.userId, currentUser.id),
				eq(memberships.role, "organizer"),
			),
		);

	let organizerEvents: typeof assignmentRows = [];
	if (organizerMemberships.length > 0) {
		const orgIds = organizerMemberships.map((m) => m.organizationId);
		const assignedEventIds = new Set(assignmentRows.map((a) => a.eventId));

		const orgEventRows = await db
			.select({
				eventId: events.id,
				eventTitle: events.title,
				eventCategory: events.category,
				venueName: events.venueName,
				status: events.status,
				isSimulation: events.isSimulation,
				startsAt: events.startsAt,
				endsAt: events.endsAt,
				organizationId: events.organizationId,
				orgName: organizations.name,
				orgVillage: organizations.village,
				orgDistrict: organizations.district,
			})
			.from(events)
			.innerJoin(organizations, eq(events.organizationId, organizations.id))
			.where(
				and(
					inArray(events.organizationId, orgIds),
					inArray(events.status, ["published", "active", "review", "completed"]),
				),
			)
			.orderBy(desc(events.startsAt));

		organizerEvents = orgEventRows
			.filter((e) => !assignedEventIds.has(e.eventId))
			.map((e) => ({
				assignmentId: `org-oversight-${e.eventId}`,
				eventId: e.eventId,
				eventTitle: e.eventTitle,
				eventCategory: e.eventCategory,
				venueName: e.venueName,
				status: e.status,
				isSimulation: e.isSimulation,
				startsAt: e.startsAt,
				endsAt: e.endsAt,
				canUpdateTraffic: true,
				canUpdateCleanup: true,
				organizationId: e.organizationId,
				orgName: e.orgName,
				orgVillage: e.orgVillage,
				orgDistrict: e.orgDistrict,
			}));
	}

	const allAssigned = [...assignmentRows, ...organizerEvents];

	return c.json({ assignments: allAssigned.map((item) => ({ ...item, organizationName: item.orgName, isOrganizerOversight: item.assignmentId.startsWith("org-oversight-") })) }, 200);
});

/**
 * GET /api/field/events/:id
 * Fetches single assigned event operational context: user's permissions, road impacts, and cleanup tasks.
 * Strictly verifies assignment or organizer membership.
 */
fieldRouter.get("/events/:id", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("id");

	const idValidation = uuidParamSchema.safeParse(eventId);
	if (!idValidation.success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);

	if (access === "NOT_FOUND") {
		return sendError(
			c,
			"NOT_FOUND",
			"Kegiatan tidak ditemukan atau Anda tidak ditugaskan pada kegiatan ini.",
			404,
		);
	}

	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"Akses ditolak. Anda tidak memiliki penugasan aktif untuk kegiatan ini.",
			403,
		);
	}

	const permissions = {
		isOrganizer: access.isOrganizer,
		canUpdateTraffic: access.isOrganizer || Boolean(access.assignment?.canUpdateTraffic),
		canUpdateCleanup: access.isOrganizer || Boolean(access.assignment?.canUpdateCleanup),
	};

	// 1. Fetch road impacts for traffic updates
	const impacts = await db
		.select({
			id: roadImpacts.id,
			eventId: roadImpacts.eventId,
			roadSegmentId: roadImpacts.roadSegmentId,
			roadName: roadSegments.displayName,
			plannedFrom: roadImpacts.plannedFrom,
			plannedTo: roadImpacts.plannedTo,
			impactType: roadImpacts.impactType,
			diversionNote: roadImpacts.diversionNote,
		})
		.from(roadImpacts)
		.innerJoin(roadSegments, eq(roadImpacts.roadSegmentId, roadSegments.id))
		.where(eq(roadImpacts.eventId, eventId));

	// Fetch latest status update for each impact
	const roadImpactsWithStatus = await Promise.all(
		impacts.map(async (imp) => {
			const updateRows = await db
				.select()
				.from(roadStatusUpdates)
				.where(eq(roadStatusUpdates.roadImpactId, imp.id))
				.orderBy(desc(roadStatusUpdates.observedAt), desc(roadStatusUpdates.createdAt))
				.limit(1);

			const latest = updateRows[0] || null;
			const evaluated = evaluateEffectiveRoadStatus(latest);

			return {
				...imp,
				displayName: imp.roadName,
				status: evaluated.effectiveStatus,
				currentStatus: evaluated.effectiveStatus,
				rawStatus: evaluated.rawStatus,
				isStale: evaluated.isStale,
				lastObservedAt: evaluated.observedAt,
				expiresAt: evaluated.expiresAt,
			};
		}),
	);

	// 2. Fetch cleanup tasks
	const tasks = await db
		.select({
			id: cleanupTasks.id,
			eventId: cleanupTasks.eventId,
			title: cleanupTasks.title,
			description: cleanupTasks.description,
			status: cleanupTasks.status,
			dueAt: cleanupTasks.dueAt,
			verifiedBy: cleanupTasks.verifiedBy,
			verifiedAt: cleanupTasks.verifiedAt,
			createdAt: cleanupTasks.createdAt,
		})
		.from(cleanupTasks)
		.where(eq(cleanupTasks.eventId, eventId))
		.orderBy(desc(cleanupTasks.createdAt));

	return c.json(
		{
			event: {
				id: access.event.id,
				title: access.event.title,
				category: access.event.category,
				venueName: access.event.venueName,
				startsAt: access.event.startsAt,
				endsAt: access.event.endsAt,
				status: access.event.status,
				isSimulation: access.event.isSimulation,
				organizationId: access.event.organizationId,
			},
			permissions,
			roadImpacts: roadImpactsWithStatus,
			cleanupTasks: tasks,
		},
		200,
	);
});
