import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../db/index";
import {
	eventAssignments,
	events,
	memberships,
	type EventStatus,
} from "../../db/schema";

export interface EventAccessResult {
	event: {
		id: string;
		organizationId: string;
		createdBy: string;
		title: string;
		category: string | null;
		description: string | null;
		venueName: string | null;
		startsAt: Date | null;
		endsAt: Date | null;
		status: EventStatus;
		publicSlug: string | null;
		permitReference: string | null;
		verifiedBy: string | null;
		verifiedAt: Date | null;
		publishedAt: Date | null;
		createdAt: Date;
		updatedAt: Date;
	};
	isOrganizer: boolean;
	assignment?: {
		id: string;
		canUpdateTraffic: boolean;
		canUpdateCleanup: boolean;
	};
}

export async function getEventAndCheckAccess(
	db: DbClient,
	eventId: string,
	userId: string,
	requiredPermission?: "traffic" | "cleanup",
): Promise<EventAccessResult | "NOT_FOUND" | "FORBIDDEN"> {
	const eventRows = await db
		.select()
		.from(events)
		.where(eq(events.id, eventId))
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return "NOT_FOUND";
	}

	// 1. Check organization membership
	const memberRows = await db
		.select()
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
		return "NOT_FOUND"; // Hide existence from non-members
	}

	if (membership.role === "organizer") {
		return { event, isOrganizer: true };
	}

	// 2. Officer: must have an active assignment for this specific event
	const assignmentRows = await db
		.select()
		.from(eventAssignments)
		.where(
			and(
				eq(eventAssignments.eventId, eventId),
				eq(eventAssignments.userId, userId),
			),
		)
		.limit(1);

	const assignment = assignmentRows[0];
	if (!assignment) {
		return "FORBIDDEN";
	}

	if (requiredPermission === "traffic" && !assignment.canUpdateTraffic) {
		return "FORBIDDEN";
	}

	if (requiredPermission === "cleanup" && !assignment.canUpdateCleanup) {
		return "FORBIDDEN";
	}

	return {
		event,
		isOrganizer: false,
		assignment: {
			id: assignment.id,
			canUpdateTraffic: assignment.canUpdateTraffic,
			canUpdateCleanup: assignment.canUpdateCleanup,
		},
	};
}
