import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { BALI_ISLAND_CENTER } from "../../lib/bali-villages";

const style: maplibregl.StyleSpecification = {
	version: 8,
	sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
	layers: [
		{ id: "osm-background", type: "background", paint: { "background-color": "#ffffff" } },
		{ id: "osm-tiles", type: "raster", source: "osm", minzoom: 0, maxzoom: 19 },
	],
};

export type TerritoryGeometry = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
type PreviewGeometry = TerritoryGeometry | { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] };
type FeatureCollection = { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, never>; geometry: PreviewGeometry }> };
type Props = { geometry: TerritoryGeometry | null; editable: boolean; onChange: (geometry: TerritoryGeometry | null) => void };
const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

function asFeature(geometry: PreviewGeometry | null): FeatureCollection {
	return geometry ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry }] } : empty;
}

export function TerritoryMapEditor({ geometry, editable, onChange }: Props) {
	const container = useRef<HTMLDivElement>(null);
	const map = useRef<maplibregl.Map | null>(null);
	const points = useRef<Array<[number, number]>>([]);
	const editableRef = useRef(editable);
	const changeRef = useRef(onChange);
	const [mapError, setMapError] = useState(false);
	const [pointCount, setPointCount] = useState(0);

	useEffect(() => { editableRef.current = editable; changeRef.current = onChange; }, [editable, onChange]);
	useEffect(() => {
		if (!container.current) return;
		let instance: maplibregl.Map;
		try {
			instance = new maplibregl.Map({ container: container.current, style, center: BALI_ISLAND_CENTER, zoom: 9, attributionControl: false });
			instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
			map.current = instance;
			instance.on("load", () => {
				instance.addSource("territory-preview", { type: "geojson", data: empty });
				instance.addLayer({ id: "territory-fill", type: "fill", source: "territory-preview", paint: { "fill-color": "#526b42", "fill-opacity": 0.2 } });
				instance.addLayer({ id: "territory-line", type: "line", source: "territory-preview", paint: { "line-color": "#3c542e", "line-width": 3 } });
				instance.addLayer({ id: "territory-points", type: "circle", source: "territory-preview", paint: { "circle-color": "#3c542e", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
				setMapError(false);
			});
			instance.on("error", () => setMapError(true));
			instance.on("click", event => {
				if (!editableRef.current) return;
				points.current = [...points.current, [event.lngLat.lng, event.lngLat.lat]];
				setPointCount(points.current.length);
				if (points.current.length < 3) {
					const feature = { type: "Feature" as const, properties: {}, geometry: points.current.length === 1 ? { type: "Point" as const, coordinates: points.current[0] } : { type: "LineString" as const, coordinates: points.current } };
					(instance.getSource("territory-preview") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [feature] });
					changeRef.current(null);
					return;
				}
				const ring = [...points.current, points.current[0]];
				const next: TerritoryGeometry = { type: "Polygon", coordinates: [ring] };
				(instance.getSource("territory-preview") as maplibregl.GeoJSONSource | undefined)?.setData(asFeature(next));
				changeRef.current(next);
			});
		} catch { queueMicrotask(() => setMapError(true)); return; }
		return () => { instance.remove(); map.current = null; };
	}, []);

	useEffect(() => {
		const source = map.current?.getSource("territory-preview") as maplibregl.GeoJSONSource | undefined;
		if (source && geometry) source.setData(asFeature(geometry));
		else if (source && !editable) source.setData(empty);
	}, [geometry, editable]);

	const undo = () => {
		points.current = points.current.slice(0, -1);
		setPointCount(points.current.length);
		if (points.current.length >= 3) {
			const geometry: TerritoryGeometry = { type: "Polygon", coordinates: [[...points.current, points.current[0]]] };
			(map.current?.getSource("territory-preview") as maplibregl.GeoJSONSource | undefined)?.setData(asFeature(geometry));
			changeRef.current(geometry);
		} else {
			(map.current?.getSource("territory-preview") as maplibregl.GeoJSONSource | undefined)?.setData(empty);
			changeRef.current(null);
		}
	};
	const clear = () => { points.current = []; setPointCount(0); (map.current?.getSource("territory-preview") as maplibregl.GeoJSONSource | undefined)?.setData(empty); changeRef.current(null); };

	return <section aria-label="Pratinjau batas wilayah">
		<div ref={container} style={{ width: "100%", height: 360, border: "1px solid #d7dbe0", borderRadius: 8, overflow: "hidden" }} />
		{mapError && <p role="status">Peta dasar tidak termuat. Data GeoJSON tetap dapat disimpan setelah validasi server.</p>}
		{editable && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}><button className="ui-button" type="button" onClick={undo} disabled={!pointCount}>Urungkan titik</button><button className="ui-button" type="button" onClick={clear} disabled={!pointCount}>Hapus gambar</button><p>Ketuk peta minimal tiga titik untuk menggambar polygon. Koordinat hasil gambar memakai lon/lat WGS84.</p></div>}
	</section>;
}
