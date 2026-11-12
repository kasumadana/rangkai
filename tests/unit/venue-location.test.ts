import { describe, expect, it } from "vitest";
import { createEventSchema, updateEventSchema, venueLocationSchema } from "../../src/worker/validators/events";
import { patchExtractedFieldsSchema } from "../../src/worker/validators/extractions";

describe("event venue location validation", () => {
	it("accepts a point within Bali in longitude-latitude order", () => {
		expect(venueLocationSchema.safeParse({ type: "Point", coordinates: [115.21, -8.65] }).success).toBe(true);
	});
	it("rejects inverted, incomplete, non-finite, out-of-bounds and non-point data", () => {
		for (const value of [
			{ type: "Point", coordinates: [-8.65, 115.21] },
			{ type: "Point", coordinates: [115.21] },
			{ type: "Point", coordinates: [Infinity, -8.65] },
			{ type: "Point", coordinates: [100, -8.65] },
			{ type: "LineString", coordinates: [115.21, -8.65] },
		]) expect(venueLocationSchema.safeParse(value).success).toBe(false);
	});
	it("accepts optional, cleared, and valid locations at event API boundaries", () => {
		const point = { type: "Point", coordinates: [115.21, -8.65] };
		expect(updateEventSchema.safeParse({ venueLocation: point }).success).toBe(true);
		expect(updateEventSchema.safeParse({ venueLocation: null }).success).toBe(true);
		expect(updateEventSchema.safeParse({}).success).toBe(true);
		expect(updateEventSchema.parse({ venueLocation: point }).isSimulation).toBeUndefined();
		expect(updateEventSchema.safeParse({ venueLocation: { ...point, coordinates: [-8.65, 115.21] } }).success).toBe(false);
		expect(createEventSchema.safeParse({ organizationId: "01234567-89ab-4cde-8f01-23456789abcd", title: "Kegiatan", venueLocation: point }).success).toBe(true);
		expect(patchExtractedFieldsSchema.safeParse({ venueLocation: point }).success).toBe(true);
		for (const category of ["odalan", "melasti", "pengerupukan", "karya"]) expect(patchExtractedFieldsSchema.safeParse({ category }).success).toBe(true);
		expect(patchExtractedFieldsSchema.safeParse({ venueLocation: null }).success).toBe(true);
		expect(patchExtractedFieldsSchema.safeParse({ venueLocation: { ...point, coordinates: [-8.65, 115.21] } }).success).toBe(false);
	});
});
