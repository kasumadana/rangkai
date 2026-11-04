import { z } from "zod";

// Helper for ISO timestamp with explicit timezone offset
const isoTimestampWithTimezone = z
	.string()
	.refine(
		(val) => {
			if (!val || typeof val !== "string") return false;
			const hasExplicitTz = /([+-]\d{2}:\d{2}|Z)$/i.test(val);
			if (!hasExplicitTz) return false;
			const d = new Date(val);
			return !isNaN(d.getTime());
		},
		{
			message:
				"Timestamp must be a valid ISO 8601 string with explicit timezone offset (e.g. '2026-03-29T10:00:00+08:00' or '2026-03-29T02:00:00Z').",
		},
	);

// Schema for POST /api/events/:eventId/cleanup-tasks
export const createCleanupTaskSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, "Title is required")
		.max(200, "Title cannot exceed 200 characters"),
	description: z
		.string()
		.trim()
		.max(2000, "Description cannot exceed 2000 characters")
		.optional(),
	location: z
		.object({
			lng: z.number().min(-180).max(180),
			lat: z.number().min(-90).max(90),
		})
		.optional(),
	assignedUserId: z.string().trim().min(1).optional(),
	dueAt: isoTimestampWithTimezone.optional(),
});

export type CreateCleanupTaskInput = z.infer<typeof createCleanupTaskSchema>;

// Schema for PATCH /api/cleanup-tasks/:taskId
export const patchCleanupTaskSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, "Title must not be empty")
		.max(200, "Title cannot exceed 200 characters")
		.optional(),
	description: z
		.string()
		.trim()
		.max(2000, "Description cannot exceed 2000 characters")
		.nullable()
		.optional(),
	location: z
		.object({
			lng: z.number().min(-180).max(180),
			lat: z.number().min(-90).max(90),
		})
		.nullable()
		.optional(),
	assignedUserId: z.string().trim().min(1).nullable().optional(),
	dueAt: isoTimestampWithTimezone.nullable().optional(),
	status: z
		.enum(["todo", "in_progress", "submitted", "verified", "reopened"])
		.optional(),
});

export type PatchCleanupTaskInput = z.infer<typeof patchCleanupTaskSchema>;

// Schema for evidence upload stage
export const uploadEvidenceSchema = z.object({
	stage: z.enum(["before", "after"], {
		message: "Stage must be 'before' or 'after'.",
	}),
});

// Schema for reopening cleanup task
export const reopenCleanupTaskSchema = z.object({
	reason: z.string().trim().max(500, "Reason cannot exceed 500 characters").optional(),
});

// Schema for waste records: POST /api/events/:eventId/waste-records
export const createWasteRecordSchema = z
	.object({
		category: z.enum(["organic", "recyclable", "residual"], {
			message: "Category must be 'organic', 'recyclable', or 'residual'.",
		}),
		quantityKg: z
			.number()
			.finite("Quantity must be finite")
			.nonnegative("quantityKg must be non-negative")
			.max(1000000, "quantityKg exceeds maximum allowed value")
			.optional(),
		sackCount: z
			.number()
			.int("sackCount must be an integer")
			.nonnegative("sackCount must be non-negative")
			.max(100000, "sackCount exceeds maximum allowed value")
			.optional(),
		measurementMethod: z.enum(["weighed", "estimated"], {
			message: "Measurement method must be 'weighed' or 'estimated'.",
		}),
		destination: z
			.string()
			.trim()
			.max(255, "Destination cannot exceed 255 characters")
			.optional(),
		taskId: z.string().uuid("Invalid task ID format").optional(),
	})
	.refine(
		(data) => data.quantityKg !== undefined || data.sackCount !== undefined,
		{
			message:
				"At least one of quantityKg or sackCount must be provided.",
			path: ["quantityKg"],
		},
	);

export type CreateWasteRecordInput = z.infer<typeof createWasteRecordSchema>;

/**
 * Magic byte detection for cleanup photo evidence.
 * Only JPEG and PNG are allowed for photo evidence.
 */
export function detectPhotoMagicBytes(bytes: Uint8Array): {
	isValid: boolean;
	mimeType?: "image/jpeg" | "image/png";
	extension?: "jpg" | "png";
} {
	if (bytes.length < 4) {
		return { isValid: false };
	}

	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return { isValid: true, mimeType: "image/jpeg", extension: "jpg" };
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return { isValid: true, mimeType: "image/png", extension: "png" };
	}

	return { isValid: false };
}
