import { z } from "zod";
import { isoDateSchema, uuidParamSchema } from "./events";

export const createExtractionSchema = z.object({
	documentId: uuidParamSchema,
});

export const extractedFieldSchema = z.object({
	value: z.string().nullable(),
	evidence: z.string().nullable().optional(),
	needs_review: z.boolean().default(true),
});

export const extractedRoadSchema = z.object({
	name: z.string(),
	evidence: z.string().nullable().optional(),
	needs_review: z.boolean().default(true),
});

export const aiExtractionOutputSchema = z.object({
	schema_version: z.string().default("1.0"),
	event_name: extractedFieldSchema.optional(),
	start_datetime: extractedFieldSchema.optional(),
	end_datetime: extractedFieldSchema.optional(),
	venue_name: extractedFieldSchema.optional(),
	affected_road_names: z.array(extractedRoadSchema).default([]),
	traffic_impact_description: extractedFieldSchema.optional(),
	issues: z.array(z.string()).default([]),
});

export type AiExtractionOutput = z.infer<typeof aiExtractionOutputSchema>;

export const patchExtractedFieldsSchema = z
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
