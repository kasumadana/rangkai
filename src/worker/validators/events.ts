import { z } from "zod";
import { EVENT_STATUSES } from "../../db/schema";

// Explicit ISO 8601 regex requiring full date, time, and explicit timezone indicator (Z or +/-HH:MM)
const ISO_8601_WITH_TIMEZONE_REGEX =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;

export const isoDateSchema = z
	.string()
	.refine(
		(val) =>
			ISO_8601_WITH_TIMEZONE_REGEX.test(val) && !isNaN(Date.parse(val)),
		{
			message:
				"Invalid ISO 8601 timestamp format. Explicit timezone information is required (e.g. '2026-11-10T08:00:00Z' or '+08:00').",
		},
	);

export const uuidParamSchema = z.string().uuid("Invalid UUID format");

export const listEventsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	status: z.enum(EVENT_STATUSES).optional(),
	organizationId: z.string().uuid().optional(),
});

export const createEventSchema = z
	.object({
		organizationId: z.string().uuid("Invalid organization ID format"),
		title: z.string().trim().min(1, "Title is required").max(255),
		startsAt: isoDateSchema.optional().nullable(),
		endsAt: isoDateSchema.optional().nullable(),
		category: z.string().trim().max(100).optional().nullable(),
		description: z.string().trim().max(2000).optional().nullable(),
		venueName: z.string().trim().max(255).optional().nullable(),
		permitReference: z.string().trim().max(100).optional().nullable(),
	})
	.refine(
		(data) => {
			if (data.startsAt && data.endsAt) {
				return new Date(data.endsAt) > new Date(data.startsAt);
			}
			return true;
		},
		{
			message: "End time must be after start time",
			path: ["endsAt"],
		},
	);

export const updateEventSchema = z
	.object({
		title: z.string().trim().min(1, "Title cannot be empty").max(255).optional(),
		startsAt: isoDateSchema.optional().nullable(),
		endsAt: isoDateSchema.optional().nullable(),
		category: z.string().trim().max(100).optional().nullable(),
		description: z.string().trim().max(2000).optional().nullable(),
		venueName: z.string().trim().max(255).optional().nullable(),
		permitReference: z.string().trim().max(100).optional().nullable(),
	})
	.refine(
		(data) => {
			if (data.startsAt && data.endsAt) {
				return new Date(data.endsAt) > new Date(data.startsAt);
			}
			return true;
		},
		{
			message: "End time must be after start time",
			path: ["endsAt"],
		},
	);

export const cancelEventSchema = z.object({
	reason: z.string().trim().min(1, "Cancellation reason is required").max(1000),
});

export const createAssignmentSchema = z.object({
	userId: z.string().trim().min(1, "User ID is required"),
	canUpdateTraffic: z.boolean().default(false),
	canUpdateCleanup: z.boolean().default(false),
});
