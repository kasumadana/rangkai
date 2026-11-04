import { z } from "zod";

export const EVENT_CATEGORIES = [
	"upacara",
	"upacara_adat",
	"pawai",
	"procession",
	"lomba",
	"pesta_rakyat",
	"bazar",
	"musik",
	"seni",
	"olahraga",
	"festival",
	"keagamaan",
	"budaya",
	"lainnya",
] as const;

export const GEMINI_MODEL_NAME = "gemini-2.5-flash";
export const GEMINI_PROMPT_VERSION = "v1.1";
export const GEMINI_SCHEMA_VERSION = "1.0";

const STRICT_ISO_DATETIME_REGEX =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Validates that a string is a strict ISO 8601 datetime with explicit timezone
 * (Z or ±HH:MM) and a real calendar date (rejecting rollovers like Feb 30 or month 13).
 */
export function isValidIsoDatetimeWithTimezone(val: string): boolean {
	const match = STRICT_ISO_DATETIME_REGEX.exec(val);
	if (!match) return false;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	const tzRaw = match[8];
	const tzSign = match[9];
	const tzHour = match[10] ? Number(match[10]) : 0;
	const tzMinute = match[11] ? Number(match[11]) : 0;

	if (month < 1 || month > 12) return false;
	if (day < 1 || day > 31) return false;
	if (hour > 23 || minute > 59 || second > 59) return false;
	if (tzRaw !== "Z" && (tzHour > 23 || tzMinute > 59)) return false;

	// Verify exact calendar date without rollover (e.g. 2026-02-30 -> March 2)
	const localUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
	const checkDate = new Date(localUtcMs);
	if (
		checkDate.getUTCFullYear() !== year ||
		checkDate.getUTCMonth() + 1 !== month ||
		checkDate.getUTCDate() !== day ||
		checkDate.getUTCHours() !== hour ||
		checkDate.getUTCMinutes() !== minute ||
		checkDate.getUTCSeconds() !== second
	) {
		return false;
	}

	const parsedMs = Date.parse(val);
	if (Number.isNaN(parsedMs)) return false;

	const offsetMinutes =
		tzRaw === "Z" ? 0 : (tzSign === "+" ? 1 : -1) * (tzHour * 60 + tzMinute);
	const expectedUtcMs = localUtcMs - offsetMinutes * 60_000;
	if (Math.abs(parsedMs - expectedUtcMs) >= 1000) {
		return false;
	}

	return true;
}

/**
 * Strict ISO 8601 datetime validator requiring explicit timezone and valid calendar date,
 * normalized to canonical UTC ISO 8601 string.
 */
export const strictIsoDatetimeSchema = z
	.string()
	.refine(
		isValidIsoDatetimeWithTimezone,
		"Must be a valid ISO 8601 datetime with explicit timezone (e.g., 2026-03-25T06:00:00+08:00 or 2026-03-25T06:00:00Z)",
	)
	.transform((val) => new Date(val).toISOString());

export const triggerExtractionSchema = z.object({
	documentId: z.string().uuid("Invalid document ID format"),
	processingConsent: z.boolean().optional(),
	aiProcessingConsent: z.boolean().optional(),
});

export const extractionFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
	z.object({
		value: valueSchema.nullable(),
		evidence: z.string().nullable(),
		needs_review: z.boolean(),
	});

export const roadCandidateSchema = z.object({
	name: z.string().min(1),
	evidence: z.string().nullable(),
	needs_review: z.boolean(),
});

/**
 * Authoritative AI-SPEC §3 extraction schema:
 * All 9 required candidate fields + schema_version + issues must be present.
 * Only cleanup_location_notes, permit_reference_text, and contact_information are optional.
 */
export const geminiExtractionResultSchema = z.object({
	schema_version: z.string().min(1),
	event_name: extractionFieldSchema(z.string()),
	event_category: extractionFieldSchema(z.enum(EVENT_CATEGORIES)),
	start_datetime: extractionFieldSchema(strictIsoDatetimeSchema),
	end_datetime: extractionFieldSchema(strictIsoDatetimeSchema),
	venue_name: extractionFieldSchema(z.string()),
	affected_road_names: z.array(roadCandidateSchema),
	procession_description: extractionFieldSchema(z.string()),
	traffic_impact_description: extractionFieldSchema(z.string()),
	organizer_name: extractionFieldSchema(z.string()),
	cleanup_location_notes: extractionFieldSchema(z.string())
		.nullable()
		.optional(),
	permit_reference_text: extractionFieldSchema(z.string())
		.nullable()
		.optional(),
	contact_information: extractionFieldSchema(z.string()).nullable().optional(),
	issues: z.array(z.string()),
});

export type GeminiExtractionResult = z.infer<
	typeof geminiExtractionResultSchema
>;

const patchExtractedFieldsObjectSchema = z
	.object({
		title: z.string().trim().min(3).max(200).optional(),
		category: z.enum(EVENT_CATEGORIES).nullable().optional(),
		startsAt: strictIsoDatetimeSchema.nullable().optional(),
		endsAt: strictIsoDatetimeSchema.nullable().optional(),
		venueName: z.string().trim().max(300).nullable().optional(),
		description: z.string().trim().max(5000).nullable().optional(),
		permitReference: z.string().trim().max(200).nullable().optional(),
		processionDescription: z.string().trim().max(2000).nullable().optional(),
		trafficImpactDescription: z.string().trim().max(2000).nullable().optional(),
		organizerName: z.string().trim().max(200).nullable().optional(),
		cleanupLocationNotes: z.string().trim().max(2000).nullable().optional(),
		contactInformation: z.string().trim().max(500).nullable().optional(),
	})
	.strict()
	.refine(
		(data) => Object.keys(data).some((k) => data[k as keyof typeof data] !== undefined),
		{
			message: "At least one extracted field correction must be provided.",
		},
	)
	.refine(
		(data) => {
			if (data.startsAt && data.endsAt) {
				return new Date(data.endsAt) > new Date(data.startsAt);
			}
			return true;
		},
		{
			message: "End time must be after start time.",
			path: ["endsAt"],
		},
	);

export const patchExtractedFieldsSchema = z.preprocess((val) => {
	if (
		typeof val === "object" &&
		val !== null &&
		!Array.isArray(val) &&
		"corrections" in val &&
		typeof (val as { corrections?: unknown }).corrections === "object" &&
		(val as { corrections?: unknown }).corrections !== null
	) {
		return (val as { corrections: unknown }).corrections;
	}
	return val;
}, patchExtractedFieldsObjectSchema);
