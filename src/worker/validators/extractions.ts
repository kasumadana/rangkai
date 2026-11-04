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

export const extractedDateTimeFieldSchema = z.object({
	value: z
		.string()
		.nullable()
		.refine(
			(val) => {
				if (val === null) return true;
				const parsed = Date.parse(val);
				return !isNaN(parsed);
			},
			{ message: "Invalid date or time format. Expected ISO 8601 string." },
		)
		.transform((val) => (val === null ? null : new Date(val).toISOString())),
	evidence: z.string().nullable().optional(),
	needs_review: z.boolean().default(true),
});

export const extractedRoadSchema = z.object({
	name: z.string().min(1, "Road name cannot be empty"),
	evidence: z.string().nullable().optional(),
	needs_review: z.boolean().default(true),
});

export const aiExtractionOutputSchema = z.object({
	schema_version: z.string().default("1.0"),
	event_name: extractedFieldSchema,
	event_category: extractedFieldSchema.optional(),
	start_datetime: extractedDateTimeFieldSchema,
	end_datetime: extractedDateTimeFieldSchema,
	venue_name: extractedFieldSchema,
	affected_road_names: z.array(extractedRoadSchema).default([]),
	procession_description: extractedFieldSchema.optional(),
	traffic_impact_description: extractedFieldSchema.optional(),
	organizer_name: extractedFieldSchema.optional(),
	cleanup_location_notes: extractedFieldSchema.optional(),
	permit_reference_text: extractedFieldSchema.optional(),
	contact_information: extractedFieldSchema.optional(),
	issues: z.array(z.string()).default([]),
});

export type AiExtractionOutput = z.infer<typeof aiExtractionOutputSchema>;

export const patchExtractedFieldsSchema = z
	.object({
		title: z.string().trim().min(1, "Title cannot be empty").max(255).optional(),
		category: z.string().trim().max(100).optional().nullable(),
		startsAt: isoDateSchema.optional().nullable(),
		endsAt: isoDateSchema.optional().nullable(),
		venueName: z.string().trim().max(255).optional().nullable(),
		description: z.string().trim().max(2000).optional().nullable(),
		permitReference: z.string().trim().max(100).optional().nullable(),
		processionDescription: z.string().trim().max(2000).optional().nullable(),
		trafficImpactDescription: z.string().trim().max(2000).optional().nullable(),
		organizerName: z.string().trim().max(255).optional().nullable(),
		cleanupLocationNotes: z.string().trim().max(2000).optional().nullable(),
		contactInformation: z.string().trim().max(500).optional().nullable(),
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

export type PatchExtractedFieldsInput = z.infer<typeof patchExtractedFieldsSchema>;
