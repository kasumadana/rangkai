import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SyntheticRoadFeature {
	type: "Feature";
	id: string;
	properties: {
		displayName: string;
		coverageArea: string;
		provenance: string;
		isRealRoad: boolean;
		verified: boolean;
		verifiedBy: string | null;
		verifiedAt: string | null;
	};
	geometry: {
		type: "LineString";
		coordinates: Array<[number, number]>;
	};
}

export interface SyntheticRoadFeatureCollection {
	type: "FeatureCollection";
	name: string;
	features: SyntheticRoadFeature[];
}

/**
 * Validates a GeoJSON FeatureCollection for road segments.
 * Enforces:
 * - WGS84 SRID 4326 finite coordinates within Bali bounding box (114.4 to 115.8 E, -9.0 to -8.0 S).
 * - Geometry type LineString with minimum length of 2 points.
 * - Truthful verification: synthetic data must have verified: false, verifiedBy: null, verifiedAt: null.
 * - Ready for C03 import: real roads require verified: true with non-null verifiedBy and valid ISO verifiedAt.
 */
export function validateRoadFeatureCollection(
	raw: unknown,
	isSynthetic = true,
): SyntheticRoadFeatureCollection {
	if (typeof raw !== "object" || raw === null) {
		throw new Error("Invalid GeoJSON: must be a non-null object.");
	}

	const obj = raw as Record<string, unknown>;
	if (obj.type !== "FeatureCollection" || !Array.isArray(obj.features)) {
		throw new Error("Invalid GeoJSON: root must be a FeatureCollection with features array.");
	}

	if (obj.features.length === 0) {
		throw new Error("Invalid GeoJSON: features array cannot be empty.");
	}

	const validatedFeatures: SyntheticRoadFeature[] = [];

	for (let i = 0; i < obj.features.length; i++) {
		const feat = obj.features[i] as Record<string, unknown>;
		if (feat.type !== "Feature" || typeof feat.id !== "string" || !feat.id) {
			throw new Error(`Feature[${i}] must have type 'Feature' and non-empty string 'id'.`);
		}

		const geom = feat.geometry as Record<string, unknown> | undefined;
		if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) {
			throw new Error(`Feature ${feat.id} geometry must be a LineString with coordinates array.`);
		}

		if (geom.coordinates.length < 2) {
			throw new Error(`Feature ${feat.id} LineString must contain at least 2 coordinate pairs.`);
		}

		const coords: Array<[number, number]> = [];
		for (let j = 0; j < geom.coordinates.length; j++) {
			const pt = geom.coordinates[j];
			if (!Array.isArray(pt) || pt.length < 2) {
				throw new Error(`Feature ${feat.id} coordinate[${j}] must be [lng, lat] pair.`);
			}
			const [lng, lat] = pt;
			if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) {
				throw new Error(`Feature ${feat.id} coordinate[${j}] has non-finite values: [${lng}, ${lat}].`);
			}
			// Bali bounding box check: WGS84 SRID 4326
			if (lng < 114.4 || lng > 115.8 || lat < -9.0 || lat > -8.0) {
				throw new Error(
					`Feature ${feat.id} coordinate [${lng}, ${lat}] is outside Bali bounding box (114.4 to 115.8 E, -9.0 to -8.0 S).`,
				);
			}
			coords.push([lng, lat]);
		}

		const props = feat.properties as Record<string, unknown> | undefined;
		if (!props || typeof props.displayName !== "string" || typeof props.coverageArea !== "string") {
			throw new Error(`Feature ${feat.id} properties must include displayName and coverageArea.`);
		}

		if (typeof props.provenance !== "string" || !props.provenance) {
			throw new Error(`Feature ${feat.id} properties must include provenance.`);
		}

		if (isSynthetic) {
			// Truthful synthetic invariant: NEVER fabricate verification metadata
			if (props.verified !== false || props.verifiedBy !== null || props.verifiedAt !== null) {
				throw new Error(
					`Synthetic feature ${feat.id} must have verified=false, verifiedBy=null, verifiedAt=null. Never fabricate verification metadata.`,
				);
			}
		} else {
			// Real C03 validation
			if (props.verified === true) {
				if (typeof props.verifiedBy !== "string" || !props.verifiedBy) {
					throw new Error(`Verified feature ${feat.id} must have non-empty verifiedBy.`);
				}
				if (typeof props.verifiedAt !== "string" || isNaN(Date.parse(props.verifiedAt))) {
					throw new Error(`Verified feature ${feat.id} must have valid ISO verifiedAt.`);
				}
			}
		}

		validatedFeatures.push({
			type: "Feature",
			id: feat.id,
			properties: {
				displayName: props.displayName,
				coverageArea: props.coverageArea,
				provenance: props.provenance,
				isRealRoad: Boolean(props.isRealRoad),
				verified: Boolean(props.verified),
				verifiedBy: (props.verifiedBy as string | null) ?? null,
				verifiedAt: (props.verifiedAt as string | null) ?? null,
			},
			geometry: {
				type: "LineString",
				coordinates: coords,
			},
		});
	}

	return {
		type: "FeatureCollection",
		name: typeof obj.name === "string" ? obj.name : "SYNTHETIC_ROADS",
		features: validatedFeatures,
	};
}

/**
 * Loads synthetic road fixtures and validates SRID 4326 lng/lat bounding coordinates.
 * This function also serves as the validation loader for future C03 pilot road datasets.
 */
export function loadSyntheticRoadFixtures(): SyntheticRoadFeatureCollection {
	const geoJsonPath = path.join(__dirname, "synthetic-roads.geojson");
	const raw = fs.readFileSync(geoJsonPath, "utf-8");
	const parsed = JSON.parse(raw);
	return validateRoadFeatureCollection(parsed, true);
}
