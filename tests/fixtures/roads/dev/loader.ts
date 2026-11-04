import rawGeoJson from "./synthetic-roads.geojson";

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
 * Loads synthetic road fixtures and validates SRID 4326 lng/lat bounding coordinates.
 *
 * This function also serves as the validation loader for future C03 pilot road datasets.
 */
export function loadSyntheticRoadFixtures(): SyntheticRoadFeatureCollection {
	const collection = rawGeoJson as unknown as SyntheticRoadFeatureCollection;

	if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
		throw new Error("Invalid GeoJSON FeatureCollection structure.");
	}

	for (const feature of collection.features) {
		if (feature.geometry.type !== "LineString") {
			throw new Error(`Feature ${feature.id} must be of geometry type LineString.`);
		}
		for (const [lng, lat] of feature.geometry.coordinates) {
			if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
				throw new Error(
					`Feature ${feature.id} has invalid coordinates: lng ${lng}, lat ${lat}. Expected WGS84 SRID 4326.`,
				);
			}
		}
	}

	return collection;
}
