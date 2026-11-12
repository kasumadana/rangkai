import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

const SOURCE = "rangkai-gps-accuracy";
const LAYER = "rangkai-gps-accuracy-circle";

export function showGpsAccuracy(map: MapLibreMap, position: { coordinates: [number, number]; accuracy: number } | null) {
	if (!map.isStyleLoaded()) return;
	const valid = position && Number.isFinite(position.accuracy) && position.accuracy >= 0;
	const data = { type: "FeatureCollection" as const, features: valid ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: position.coordinates } }] : [] };
	const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
	if (source) source.setData(data); else map.addSource(SOURCE, { type: "geojson", data });
	if (!map.getLayer(LAYER)) map.addLayer({ id: LAYER, type: "circle", source: SOURCE, paint: { "circle-color": "#4D702F", "circle-opacity": 0.12, "circle-stroke-color": "#4D702F", "circle-stroke-opacity": 0.5, "circle-stroke-width": 1, "circle-radius": 0 } });
	if (valid) {
		const meters = Math.min(position.accuracy, 100000);
		const radiusAtZero = meters * 512 / (40075016.686 * Math.cos(position.coordinates[1] * Math.PI / 180));
		map.setPaintProperty(LAYER, "circle-radius", ["interpolate", ["exponential", 2], ["zoom"], 0, radiusAtZero, 20, radiusAtZero * 2 ** 20]);
	}
}
