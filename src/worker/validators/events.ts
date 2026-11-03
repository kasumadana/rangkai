import { z } from "zod";

export const isoDateSchema = z.string().refine(
	(val) => !isNaN(Date.parse(val)),
	{ message: "Invalid ISO 8601 date format" },
);

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
		title: z.string().trim().min(1, "Title is required").max(255).optional(),
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
