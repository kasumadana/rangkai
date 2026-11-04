import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	DISPUTED_HASANUDIN_SEGMENT_ID,
	PILOT_ROAD_SEGMENTS,
	PILOT_ROAD_SEGMENTS_GEOJSON,
	coordinatesToLineStringEWKT,
	pilotRoadSegmentsFeatureCollectionSchema,
} from "../../src/db/fixtures/road-segments";
import { SIMULATED_DATA } from "../../src/db/seed";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const geojsonPath = path.resolve(
	currentDir,
	"../fixtures/geo/pilot-catur-muka.geojson",
);
const rawJson = JSON.parse(fs.readFileSync(geojsonPath, "utf-8"));

describe("Pilot Road Segments (Task C03)", () => {
	it("should have 11 total pilot segments defined", () => {
		expect(PILOT_ROAD_SEGMENTS.length).toBe(11);
	});

	it("should match features defined in canonical geojson file with runtime validation", () => {
		const raw = pilotRoadSegmentsFeatureCollectionSchema.parse(rawJson);
		expect(raw.type).toBe("FeatureCollection");
		expect(raw.features.length).toBe(11);
		expect(raw.metadata.source).toContain("geojson.io");
		expect(raw.metadata.is_simulated).toBe(true);
		expect(raw).toEqual(PILOT_ROAD_SEGMENTS_GEOJSON);
	});

	it("should have 10 verified road segments and 1 disputed segment pending human recheck", () => {
		expect(PILOT_ROAD_SEGMENTS.length).toBe(11);
		const verifiedSegments = PILOT_ROAD_SEGMENTS.filter(
			(s) => s.verifiedBy !== null && s.verifiedAt !== null,
		);
		const unverifiedSegments = PILOT_ROAD_SEGMENTS.filter(
			(s) => s.verifiedBy === null || s.verifiedAt === null,
		);

		expect(verifiedSegments.length).toBe(10);
		expect(unverifiedSegments.length).toBe(1);
		expect(unverifiedSegments[0].id).toBe(DISPUTED_HASANUDIN_SEGMENT_ID);
		expect(unverifiedSegments[0].displayName).toContain("Jl. Hasanudin");
		expect(unverifiedSegments[0].verifiedBy).toBeNull();
		expect(unverifiedSegments[0].verifiedAt).toBeNull();

		for (const segment of verifiedSegments) {
			expect(segment.verifiedBy).toBe("Okta");
			expect(segment.verifiedAt).toBeInstanceOf(Date);
		}
	});

	it("should keep synthetic SIMULATED_DATA.roadSegment strictly unverified", () => {
		expect(SIMULATED_DATA.roadSegment.verifiedBy).toBeNull();
		expect(SIMULATED_DATA.roadSegment.verifiedAt).toBeNull();
	});

	it("should have valid LineString coordinates in Bali bounding box", () => {
		// Bali bounding box approx: lng [114.4, 115.8], lat [-8.9, -8.0]
		const BALI_BOUNDS = {
			minLng: 114.4,
			maxLng: 115.8,
			minLat: -8.9,
			maxLat: -8.0,
		};

		for (const feature of PILOT_ROAD_SEGMENTS_GEOJSON.features) {
			expect(feature.geometry.type).toBe("LineString");
			expect(feature.geometry.coordinates.length).toBeGreaterThanOrEqual(2);

			for (const [lng, lat] of feature.geometry.coordinates) {
				expect(lng).toBeGreaterThan(BALI_BOUNDS.minLng);
				expect(lng).toBeLessThan(BALI_BOUNDS.maxLng);
				expect(lat).toBeGreaterThan(BALI_BOUNDS.minLat);
				expect(lat).toBeLessThan(BALI_BOUNDS.maxLat);
			}
		}
	});

	it("should produce valid PostGIS EWKT LINESTRING strings for all segments", () => {
		for (const segment of PILOT_ROAD_SEGMENTS) {
			expect(segment.geom).toMatch(
				/^SRID=4326;LINESTRING\((?:[0-9.-]+ [0-9.-]+, )*[0-9.-]+ [0-9.-]+\)$/,
			);
			expect(segment.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
			expect(segment.displayName).toContain("[SIMULATED]");
			expect(segment.coverageArea).toBe("Denpasar Kota - Kawasan Catur Muka");
		}
	});

	it("correctly converts coordinates array to PostGIS LineString EWKT", () => {
		const coords: [number, number][] = [
			[115.216, -8.655],
			[115.21, -8.654],
		];
		const ewkt = coordinatesToLineStringEWKT(coords, 4326);
		expect(ewkt).toBe("SRID=4326;LINESTRING(115.216 -8.655, 115.21 -8.654)");
	});
});
