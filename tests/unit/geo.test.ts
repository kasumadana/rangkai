import { describe, expect, it } from "vitest";
import {
	PILOT_ROAD_SEGMENTS,
	PILOT_ROAD_SEGMENTS_GEOJSON,
	coordinatesToLineStringEWKT,
} from "../../src/db/fixtures/road-segments";
import geojsonFile from "../fixtures/geo/pilot-catur-muka.geojson";

describe("Pilot Road Segments (Task C03)", () => {
	it("should have at least 5 to 10 verified road segments", () => {
		expect(PILOT_ROAD_SEGMENTS.length).toBeGreaterThanOrEqual(5);
		expect(PILOT_ROAD_SEGMENTS.length).toBeLessThanOrEqual(15);
		expect(PILOT_ROAD_SEGMENTS.length).toBe(11);
	});

	it("should match features defined in canonical geojson file", () => {
		const raw = geojsonFile as unknown as typeof PILOT_ROAD_SEGMENTS_GEOJSON;
		expect(raw.type).toBe("FeatureCollection");
		expect(raw.features.length).toBe(11);
		expect(raw.metadata.source).toContain("geojson.io");
		expect(raw.metadata.is_simulated).toBe(true);
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

	it("should produce valid PostGIS EWKT LINESTRING strings", () => {
		for (const segment of PILOT_ROAD_SEGMENTS) {
			expect(segment.geom).toMatch(
				/^SRID=4326;LINESTRING\((?:[0-9.-]+ [0-9.-]+, )*[0-9.-]+ [0-9.-]+\)$/,
			);
			expect(segment.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
			expect(segment.displayName).toContain("[SIMULATED]");
			expect(segment.coverageArea).toBe("Denpasar Kota - Kawasan Catur Muka");
			expect(segment.verifiedBy).toBe("Okta");
		}
	});

	it("correctly converts coordinates array to PostGIS LineString EWKT", () => {
		const coords: [number, number][] = [
			[115.216, -8.655],
			[115.210, -8.654],
		];
		const ewkt = coordinatesToLineStringEWKT(coords, 4326);
		expect(ewkt).toBe("SRID=4326;LINESTRING(115.216 -8.655, 115.21 -8.654)");
	});
});
