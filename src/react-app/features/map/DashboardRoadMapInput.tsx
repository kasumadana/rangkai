import { catalogVisibility, roadDetails } from "./road-details";
import {
	Layers,
	MapPin,
	MousePointerClick,
	RotateCcw,
	Undo2,
} from "lucide-react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { BALI_DISTRICTS_DATA } from "../../lib/bali-districts";
import {
	BALI_MAP_BOUNDS,
	BALI_MAP_MAX_ZOOM,
	BALI_MAP_MIN_ZOOM,
} from "../../lib/bali-villages";
import {
	normalizeRoadImpactType,
	type RoadImpactRecord,
	type RoadSegmentRecord,
} from "../../lib/events-api";
import { snapCoordinatesToRoad } from "../../lib/routing-engine";
import { useGpsTracking } from "./useGpsTracking";
import { showGpsAccuracy } from "./gpsAccuracy";
import { GpsControls } from "./GpsControls";

export type DashboardMapInteractionMode = "draw" | "catalog" | "operational";

export interface DashboardRoadMapInputProps {
	mode: DashboardMapInteractionMode;
	onModeChange?: (mode: DashboardMapInteractionMode) => void;
	/** Catalog road segments from GET /api/road-segments */
	catalogSegments?: RoadSegmentRecord[];
	selectedCatalogSegmentId?: string;
	onSelectCatalogSegment?: (segmentId: string) => void;
	/** Coordinates drawn by clicking on the map in 'draw' mode */
	drawnCoordinates?: Array<[number, number]>;
	draftCoordinates?: Array<[number, number]>;
	onChangeDrawnCoordinates?: (coords: Array<[number, number]>) => void;
	onDraftCoordinatesChange?: (coords: Array<[number, number]>) => void;
	/** Planned/active road impacts already attached to this event */
	roadImpacts?: RoadImpactRecord[];
	attachedRoadImpacts?: RoadImpactRecord[];
	selectedImpactId?: string;
	onSelectImpact?: (impactId: string) => void;
	/** Optional hint for initial camera location (e.g. Desa Adat / venueName) */
	locationHint?: string;
	height?: number | string;
	isCatalogLoading?: boolean;
	isCatalogError?: boolean;
	catalogErrorMessage?: string;
	catalogRequestId?: string;
	onRetryCatalog?: () => void;
}

const STREET_STYLE: maplibregl.StyleSpecification = {
	version: 8,
	sources: {
		"osm-street-tiles": {
			type: "raster",
			tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
			tileSize: 256,
			attribution: "© OpenStreetMap contributors",
		},
	},
	layers: [
		{
			id: "osm-street-bg",
			type: "background",
			paint: {
				"background-color": "#F3F2EE",
			},
		},
		{
			id: "osm-street-layer",
			type: "raster",
			source: "osm-street-tiles",
			minzoom: 0,
			maxzoom: 19,
		},
	],
};

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
	version: 8,
	sources: {
		"satellite-tiles": {
			type: "raster",
			tiles: [
				"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
			],
			tileSize: 256,
			attribution: "Source: Esri, Maxar, Earthstar Geographics",
		},
	},
	layers: [
		{
			id: "satellite-bg",
			type: "background",
			paint: {
				"background-color": "#151E28",
			},
		},
		{
			id: "satellite-layer",
			type: "raster",
			source: "satellite-tiles",
			minzoom: 0,
			maxzoom: 19,
		},
	],
};

function extractCoordinatesFromGeometry(
	geom: { type?: string; coordinates?: unknown } | null | undefined,
): Array<[number, number]> {
	if (!geom || !geom.coordinates) return [];
	if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
		return (geom.coordinates as Array<[number, number]>).filter(
			(pt) =>
				Array.isArray(pt) &&
				pt.length >= 2 &&
				typeof pt[0] === "number" &&
				typeof pt[1] === "number",
		);
	}
	if (
		geom.type === "MultiLineString" &&
		Array.isArray(geom.coordinates) &&
		Array.isArray(geom.coordinates[0])
	) {
		return (geom.coordinates[0] as Array<[number, number]>).filter(
			(pt) =>
				Array.isArray(pt) &&
				pt.length >= 2 &&
				typeof pt[0] === "number" &&
				typeof pt[1] === "number",
		);
	}
	return [];
}

function getImpactColor(impact: RoadImpactRecord, mode: DashboardMapInteractionMode): string {
	const eff = impact.operationalStatus?.effectiveStatus;
	if (mode === "operational") {
		if (impact.operationalStatus?.isStale) return "#6B7280";
		if (eff === "closed") return "#C8322B";
		if (eff === "intermittent") return "#D97706";
		if (eff === "open") return "#4D702F";
		return "#6B7280";
	}

	const norm = normalizeRoadImpactType(impact.impactType);
	if (norm === "closure") return "#C8322B";
	if (norm === "intermittent" || norm === "narrowing") return "#D97706";
	return "#4D702F";
}

const QUICK_AREAS: Array<{ label: string; center: [number, number]; zoom: number }> = [
	{ label: "Denpasar (Catur Muka)", center: [115.2169, -8.6559], zoom: 15.2 },
	{ label: "Ubud (Gianyar)", center: [115.2625, -8.5069], zoom: 15.0 },
	{ label: "Kuta / Legian (Badung)", center: [115.1745, -8.7184], zoom: 14.8 },
	{ label: "Sanur (Denpasar Selatan)", center: [115.2619, -8.6913], zoom: 14.8 },
	{ label: "Besakih (Karangasem)", center: [115.4509, -8.3743], zoom: 15.0 },
	{ label: "Mengwi / Taman Ayun", center: [115.1726, -8.5419], zoom: 14.8 },
	{ label: "Tabanan Kota", center: [115.1253, -8.5408], zoom: 14.8 },
	{ label: "Semarapura (Klungkung)", center: [115.4024, -8.5364], zoom: 14.8 },
	{ label: "Bangli Kota", center: [115.3549, -8.4542], zoom: 14.8 },
	{ label: "Singaraja (Buleleng)", center: [115.0882, -8.112], zoom: 14.6 },
];

export function DashboardRoadMapInput({
	mode,
	onModeChange,
	catalogSegments = [],
	selectedCatalogSegmentId = "",
	onSelectCatalogSegment,
	drawnCoordinates: drawnCoordinatesProp,
	draftCoordinates,
	onChangeDrawnCoordinates: onChangeDrawnCoordinatesProp,
	onDraftCoordinatesChange,
	roadImpacts: roadImpactsProp,
	attachedRoadImpacts,
	selectedImpactId = "",
	onSelectImpact,
	locationHint = "",
	height = 420,
	isCatalogLoading = false,
	isCatalogError = false,
	catalogErrorMessage = "",
	catalogRequestId = "",
	onRetryCatalog,
}: DashboardRoadMapInputProps) {
	const drawnCoordinates = useMemo(
		() => drawnCoordinatesProp ?? draftCoordinates ?? [],
		[drawnCoordinatesProp, draftCoordinates],
	);
	const onChangeDrawnCoordinates =
		onChangeDrawnCoordinatesProp ?? onDraftCoordinatesChange;
	const roadImpacts = useMemo(
		() => roadImpactsProp ?? attachedRoadImpacts ?? [],
		[roadImpactsProp, attachedRoadImpacts],
	);
	const mapContainerRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const drawnMarkersRef = useRef<maplibregl.Marker[]>([]);

	const [baseStyle, setBaseStyle] = useState<"street" | "satellite">("street");
	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [styleEpoch, setStyleEpoch] = useState(0);
	const gps = useGpsTracking();
	const [isSnappingRoad, setIsSnappingRoad] = useState(false);
	const [mapError, setMapError] = useState<string | null>(null);
	const [selectedQuickArea, setSelectedQuickArea] = useState<string>("");

	// Keep refs for event handlers inside MapLibre listeners
	const modeRef = useRef(mode);
	const drawnCoordsRef = useRef(drawnCoordinates);
	const onChangeDrawnRef = useRef(onChangeDrawnCoordinates);
	const onSelectCatalogRef = useRef(onSelectCatalogSegment);
	const onSelectImpactRef = useRef(onSelectImpact);
 const roadDataRef = useRef({ roadImpacts, catalogSegments });
 useEffect(() => { roadDataRef.current = { roadImpacts, catalogSegments }; }, [roadImpacts, catalogSegments]);

	useEffect(() => {
		modeRef.current = mode;
	}, [mode]);
	useEffect(() => {
		drawnCoordsRef.current = drawnCoordinates;
	}, [drawnCoordinates]);
	useEffect(() => {
		onChangeDrawnRef.current = onChangeDrawnCoordinates;
	}, [onChangeDrawnCoordinates]);
	useEffect(() => {
		onSelectCatalogRef.current = onSelectCatalogSegment;
	}, [onSelectCatalogSegment]);
	useEffect(() => {
		onSelectImpactRef.current = onSelectImpact;
	}, [onSelectImpact]);

	// Compute initial center from existing road impacts, locationHint, or Denpasar Catur Muka default
	const initialView = useMemo((): { center: [number, number]; zoom: number } => {
		for (const imp of roadImpacts) {
			const coords = extractCoordinatesFromGeometry(imp.geometry);
			if (coords.length > 0) {
				const mid = coords[Math.floor(coords.length / 2)];
				if (mid) return { center: [mid[0], mid[1]], zoom: 15.2 };
			}
		}

		if (locationHint.trim()) {
			const q = locationHint.toLowerCase();
			for (const area of QUICK_AREAS) {
				if (
					area.label.toLowerCase().includes(q) ||
					q.includes(area.label.split(" ")[0].toLowerCase())
				) {
					return { center: area.center, zoom: area.zoom };
				}
			}
			const matchedDistrict = BALI_DISTRICTS_DATA.features.find((f) => {
				const dName = f.properties.name.toLowerCase().replace("kecamatan ", "");
				const kName = f.properties.kabupaten
					.toLowerCase()
					.replace("kabupaten ", "")
					.replace("kota ", "");
				return q.includes(dName) || dName.includes(q) || q.includes(kName);
			});
			if (matchedDistrict) {
				return { center: matchedDistrict.properties.center, zoom: 14.5 };
			}
		}

		// Default to Denpasar Catur Muka where pilot verified road segments are located
		return { center: [115.2169, -8.6559], zoom: 15.0 };
	}, [roadImpacts, locationHint]);

	// Initialize MapLibre instance
	useEffect(() => {
		if (!mapContainerRef.current) return;

		let mapInstance: maplibregl.Map | null = null;
		try {
			mapInstance = new maplibregl.Map({
				container: mapContainerRef.current,
				style: baseStyle === "street" ? STREET_STYLE : SATELLITE_STYLE,
				center: initialView.center,
				zoom: initialView.zoom,
				maxBounds: BALI_MAP_BOUNDS,
				minZoom: BALI_MAP_MIN_ZOOM,
				maxZoom: BALI_MAP_MAX_ZOOM,
				attributionControl: false,
			});

			mapInstance.addControl(
				new maplibregl.NavigationControl({ showCompass: true }),
				"bottom-right",
			);

			mapInstance.on("load", () => {
				setIsMapLoaded(true);
				setMapError(null);
				mapInstance?.resize();
			});
			mapInstance.on("style.load", () => {
				setStyleEpoch((epoch) => epoch + 1);
			});

			mapInstance.on("click", (e: maplibregl.MapMouseEvent) => {
				if (!mapInstance) return;

				// Check if user clicked an existing layer feature first
				const interactiveLayers = [
					"dashboard-impacts-line",
					"dashboard-catalog-line",
				].filter((id) => Boolean(mapInstance?.getLayer(id)));

				if (modeRef.current !== "draw" && interactiveLayers.length > 0) {
					const hitFeatures = mapInstance.queryRenderedFeatures(e.point, {
						layers: interactiveLayers,
					});
					if (hitFeatures.length > 0) {
						const topFeature = hitFeatures[0];
						const layerId = topFeature.layer.id;
						const propId = topFeature.properties?.id as string | undefined;

						if (layerId === "dashboard-catalog-line" && propId) {
							onSelectCatalogRef.current?.(propId);
							const data = roadDataRef.current;
							const impact = data.roadImpacts.find(r => r.roadSegmentId === propId);
							const segment = data.catalogSegments.find(r => r.id === propId);
							new maplibregl.Popup().setLngLat(e.lngLat).setText(impact ? roadDetails(impact) : `${segment?.displayName || "Nama ruas belum tersedia"} - Belum ada jadwal dampak pada kegiatan ini.`).addTo(mapInstance);
							return;
						}
						if (
							layerId === "dashboard-impacts-line" &&
							propId
						) {
							onSelectImpactRef.current?.(propId);
							const impact = roadDataRef.current.roadImpacts.find(r => r.id === propId);
							if (impact) new maplibregl.Popup().setLngLat(e.lngLat).setText(roadDetails(impact)).addTo(mapInstance);
							return;
						}
					}
				}

				if (modeRef.current !== "draw") {
							new maplibregl.Popup().setLngLat(e.lngLat).setText("Ruas ini belum tersedia dalam katalog yang dimuat. Pilih ruas katalog atau konfirmasi kepada penyelenggara.").addTo(mapInstance);
 }
 // In 'draw' mode, clicking on the map adds a vertex to drawnCoordinates
				if (modeRef.current === "draw" && onChangeDrawnRef.current) {
					const nextPoint: [number, number] = [
						Number(e.lngLat.lng.toFixed(6)),
						Number(e.lngLat.lat.toFixed(6)),
					];
					onChangeDrawnRef.current([...drawnCoordsRef.current, nextPoint]);
				}
			});

			mapRef.current = mapInstance;
		} catch (err) {
			setMapError(
				err instanceof Error
					? err.message
					: "Peta interaktif tidak dapat dimuat pada peramban ini.",
			);
		}

		let resizeObserver: ResizeObserver | null = null;
		if (mapContainerRef.current && typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				mapInstance?.resize();
			});
			resizeObserver.observe(mapContainerRef.current);
		}

		const t1 = setTimeout(() => mapInstance?.resize(), 120);
		const t2 = setTimeout(() => mapInstance?.resize(), 400);

		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
			resizeObserver?.disconnect();
			drawnMarkersRef.current.forEach((m) => m.remove());
			drawnMarkersRef.current = [];
			mapInstance?.remove();
			mapRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Update cursor based on mode
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;
		map.getCanvas().style.cursor = mode === "draw" ? "crosshair" : "";
	}, [mode, isMapLoaded]);

	// Switch base raster tile style (Street vs Satellite)
	function handleToggleBaseStyle() {
		const map = mapRef.current;
		const next = baseStyle === "street" ? "satellite" : "street";
		setBaseStyle(next);
		if (!map) return;
		map.setStyle(next === "street" ? STREET_STYLE : SATELLITE_STYLE);
	}

	async function handleSnapDrawnToRoad() {
		if (drawnCoordinates.length < 2 || !onChangeDrawnCoordinates) return;
		setIsSnappingRoad(true);
		try {
			const snapped = await snapCoordinatesToRoad(drawnCoordinates);
			if (snapped.coordinates.length >= 2) {
				onChangeDrawnCoordinates(snapped.coordinates);
			}
		} finally {
			setIsSnappingRoad(false);
		}
	}

	// Render Catalog Road Segments + Event Road Impacts + Drawn LineString
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		// 1. Catalog Segments Layer
		const catalogSourceId = "dashboard-catalog-source";
		const catalogGeoJson = {
			type: "FeatureCollection" as const,
			features: catalogSegments
				.map((seg) => {
					const coords = extractCoordinatesFromGeometry(seg.geometry);
					if (coords.length < 2) return null;
					return {
						type: "Feature" as const,
						properties: {
							id: seg.id,
							displayName: seg.displayName,
							isSelected: seg.id === selectedCatalogSegmentId,
						},
						geometry: {
							type: "LineString" as const,
							coordinates: coords,
						},
					};
				})
				.filter((f): f is NonNullable<typeof f> => f !== null),
		};

		if (map.getSource(catalogSourceId)) {
			(map.getSource(catalogSourceId) as maplibregl.GeoJSONSource).setData(
				catalogGeoJson,
			);
		} else {
			map.addSource(catalogSourceId, {
				type: "geojson",
				data: catalogGeoJson,
			});
			map.addLayer({
				id: "dashboard-catalog-halo",
				type: "line",
				source: catalogSourceId,
				layout: { "line-join": "round", "line-cap": "round" },
				paint: {
					"line-color": "#FFFFFF",
					"line-width": ["case", ["get", "isSelected"], 11, 7],
					"line-opacity": mode === "operational" ? 0.15 : 0.85,
				},
			});
			map.addLayer({
				id: "dashboard-catalog-line",
				type: "line",
				source: catalogSourceId,
				layout: { "line-join": "round", "line-cap": "round" },
				paint: {
					"line-color": [
						"case",
						["get", "isSelected"],
						"#4D702F",
						"#0284C7",
					],
					"line-width": ["case", ["get", "isSelected"], 6, 4],
					"line-dasharray": [2, 1.5],
					"line-opacity": mode === "operational" ? 0.2 : 0.9,
				},
			});
		}

		for (const id of ["dashboard-catalog-halo", "dashboard-catalog-line"]) {
 map.setLayoutProperty(id, "visibility", catalogVisibility(mode));
 }
 // 2. Attached Event Road Impacts Layer
		const impactsSourceId = "dashboard-impacts-source";
		const impactsGeoJson = {
			type: "FeatureCollection" as const,
			features: roadImpacts
				.map((imp) => {
					const coords = extractCoordinatesFromGeometry(imp.geometry);
					if (coords.length < 2) return null;
					return {
						type: "Feature" as const,
						properties: {
							id: imp.id,
							displayName: imp.displayName || "Ruas Jalan Terdampak",
							color: getImpactColor(imp, mode),
							isSelected: imp.id === selectedImpactId,
						},
						geometry: {
							type: "LineString" as const,
							coordinates: coords,
						},
					};
				})
				.filter((f): f is NonNullable<typeof f> => f !== null),
		};

		if (map.getSource(impactsSourceId)) {
			(map.getSource(impactsSourceId) as maplibregl.GeoJSONSource).setData(
				impactsGeoJson,
			);
		} else {
			map.addSource(impactsSourceId, {
				type: "geojson",
				data: impactsGeoJson,
			});
			map.addLayer({
				id: "dashboard-impacts-halo",
				type: "line",
				source: impactsSourceId,
				layout: { "line-join": "round", "line-cap": "round" },
				paint: {
					"line-color": "#FFFFFF",
					"line-width": ["case", ["get", "isSelected"], 12, 9],
				},
			});
			map.addLayer({
				id: "dashboard-impacts-line",
				type: "line",
				source: impactsSourceId,
				layout: { "line-join": "round", "line-cap": "round" },
				paint: {
					"line-color": ["get", "color"],
					"line-width": ["case", ["get", "isSelected"], 7, 5],
				},
			});
		}

		// 3. Active Drawn Coordinates LineString & Vertex Pins
		const drawnSourceId = "dashboard-drawn-source";
		const drawnGeoJson = {
			type: "FeatureCollection" as const,
			features:
				drawnCoordinates.length >= 2
					? [
							{
								type: "Feature" as const,
								properties: {},
								geometry: {
									type: "LineString" as const,
									coordinates: drawnCoordinates,
								},
							},
						]
					: [],
		};

		if (map.getSource(drawnSourceId)) {
			(map.getSource(drawnSourceId) as maplibregl.GeoJSONSource).setData(
				drawnGeoJson,
			);
		} else {
			map.addSource(drawnSourceId, {
				type: "geojson",
				data: drawnGeoJson,
			});
			map.addLayer({
				id: "dashboard-drawn-halo",
				type: "line",
				source: drawnSourceId,
				layout: { "line-join": "round", "line-cap": "round" },
				paint: {
					"line-color": "#FFFFFF",
					"line-width": 10,
				},
			});
			map.addLayer({
				id: "dashboard-drawn-line",
				type: "line",
				source: drawnSourceId,
				layout: { "line-join": "round", "line-cap": "round" },
				paint: {
					"line-color": "#B91C1C",
					"line-width": 5,
					"line-dasharray": [1.5, 1.2],
				},
			});
		}

		drawnMarkersRef.current.forEach((m) => m.remove());
		drawnMarkersRef.current = [];
		drawnCoordinates.forEach((coord, idx) => {
			const el = document.createElement("div");
			const isFirst = idx === 0;
			const isLast = idx === drawnCoordinates.length - 1 && drawnCoordinates.length > 1;
			el.style.cssText = `
				width: 24px;
				height: 24px;
				border-radius: 50%;
				background: ${isFirst ? "#4D702F" : isLast ? "#B91C1C" : "#D97706"};
				color: #FFFFFF;
				border: 2.5px solid #FFFFFF;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 11px;
				font-weight: 700;
				font-family: 'Plus Jakarta Sans', sans-serif;
				box-shadow: 0 2px 8px rgba(0,0,0,0.25);
			`;
			el.textContent = String(idx + 1);
			const marker = new maplibregl.Marker({ element: el, anchor: "center" })
				.setLngLat(coord)
				.addTo(map);
			drawnMarkersRef.current.push(marker);
		});
	}, [
		isMapLoaded,
		styleEpoch,
		mode,
		catalogSegments,
		selectedCatalogSegmentId,
		roadImpacts,
		selectedImpactId,
		drawnCoordinates,
	]);

	// Fly camera when a catalog segment is selected from dropdown
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !selectedCatalogSegmentId) return;
		const found = catalogSegments.find((s) => s.id === selectedCatalogSegmentId);
		if (!found) return;
		const coords = extractCoordinatesFromGeometry(found.geometry);
		if (coords.length > 0) {
			const mid = coords[Math.floor(coords.length / 2)];
			if (mid) {
				map.flyTo({ center: mid, zoom: 15.8, duration: 850 });
			}
		}
	}, [selectedCatalogSegmentId, catalogSegments, isMapLoaded]);

	// Fly camera when an existing road impact is selected
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !selectedImpactId) return;
		const found = roadImpacts.find((r) => r.id === selectedImpactId);
		if (!found) return;
		const coords = extractCoordinatesFromGeometry(found.geometry);
		if (coords.length > 0) {
			const mid = coords[Math.floor(coords.length / 2)];
			if (mid) {
				map.flyTo({ center: mid, zoom: 15.8, duration: 850 });
			}
		}
	}, [selectedImpactId, roadImpacts, isMapLoaded]);

	function handleQuickAreaChange(areaLabel: string) {
		setSelectedQuickArea(areaLabel);
		const map = mapRef.current;
		if (!map) return;
		const target = QUICK_AREAS.find((a) => a.label === areaLabel);
		if (target) {
			map.flyTo({ center: target.center, zoom: target.zoom, duration: 900 });
		}
	}

	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;
		showGpsAccuracy(map, gps.position);
		if (!gps.position) return;
		const marker = new maplibregl.Marker({ color: "#4D702F" }).setLngLat(gps.position.coordinates).addTo(map);
		marker.getElement().setAttribute("aria-label", "Lokasi Anda");
		return () => { marker.remove(); };
	}, [gps.position, isMapLoaded, styleEpoch]);
	useEffect(() => {
		const map = mapRef.current;
		if (map && gps.following && gps.position) map.easeTo({ center: gps.position.coordinates, zoom: Math.max(map.getZoom(), 14), duration: 500 });
	}, [gps.position, gps.following]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;
		map.on("dragstart", gps.pauseFollowing);
		return () => { map.off("dragstart", gps.pauseFollowing); };
	}, [gps.pauseFollowing, isMapLoaded]);

	return (
		<div className="teduh-dashboard-map-wrapper">
			{/* Top Operational Map Control Bar */}
			<div className="teduh-dashboard-map-toolbar">
				<div className="teduh-dashboard-map-toolbar-group">
					{mode !== "operational" && onModeChange ? (
						<div className="teduh-map-mode-pills" role="tablist" aria-label="Metode Input Peta">
							<button
								type="button"
								role="tab"
								aria-selected={mode === "draw"}
								className={`teduh-map-mode-pill ${mode === "draw" ? "is-active" : ""}`}
								onClick={() => onModeChange("draw")}
							>
								<MousePointerClick size={14} />
								<span>Tandai Titik Jalan di Peta</span>
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={mode === "catalog"}
								className={`teduh-map-mode-pill ${mode === "catalog" ? "is-active" : ""}`}
								onClick={() => onModeChange("catalog")}
							>
								<MapPin size={14} />
								<span>
									Pilih Katalog Terverifikasi
									{isCatalogLoading
										? " (Memuat...)"
										: isCatalogError
											? " (Gagal memuat)"
											: ` (${catalogSegments.length})`}
								</span>
							</button>
						</div>
					) : (
						<div className="teduh-map-operational-badge">
							<MapPin size={14} />
							<span>Peta Operasional Ruas Jalan Desa ({roadImpacts.length} Ruas)</span>
						</div>
					)}
				</div>

				<div className="teduh-dashboard-map-toolbar-group">
					<select
						className="teduh-map-area-select"
						value={selectedQuickArea}
						onChange={(e) => handleQuickAreaChange(e.target.value)}
						aria-label="Fokus ke Kawasan di Bali"
					>
						<option value="">Lompat ke Kawasan / Desa...</option>
						{QUICK_AREAS.map((a) => (
							<option key={a.label} value={a.label}>
								{a.label}
							</option>
						))}
					</select>

					<button
						type="button"
						className="teduh-map-tool-btn"
						onClick={handleToggleBaseStyle}
					>
						<Layers size={14} />
						<span>{baseStyle === "street" ? "Satelit" : "Peta Jalan"}</span>
					</button>
				</div>
			</div>

			{/* Contextual Instruction Bar ABOVE Map (keeps map canvas 100% unobstructed) */}
			<div className="teduh-dashboard-map-hint">
				{mode === "draw" ? (
					<>
						<span className="teduh-hint-dot is-draw" />
						<span>
							<strong>Klik langsung di atas jalan pada peta</strong> untuk menandai
							titik awal hingga akhir penutupan ({drawnCoordinates.length} titik
							ditandai).
						</span>
					</>
				) : mode === "catalog" ? (
					<>
						<span className={`teduh-hint-dot ${isCatalogError ? "is-danger" : "is-catalog"}`} />
						{isCatalogError ? (
							<span role="alert" style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
								<strong>{catalogErrorMessage || "Gagal memuat katalog terverifikasi."}</strong>
								{catalogRequestId ? `(ID: ${catalogRequestId})` : ""}
								{onRetryCatalog ? (
									<button
										type="button"
										onClick={onRetryCatalog}
										style={{
											padding: "8px 14px",
											minHeight: 49,
											borderRadius: 8,
											background: "#C8322B",
											color: "#FFFFFF",
											fontWeight: 600,
											fontSize: 12,
											border: "none",
											cursor: "pointer",
										}}
									>
										Coba Lagi
									</button>
								) : null}
							</span>
						) : (
							<span>
								Klik garis jalan biru putus-putus pada peta atau pilih dari daftar
								katalog di bawah ({catalogSegments.length} ruas tersedia).
							</span>
						)}
					</>
				) : (
					<>
						<span className="teduh-hint-dot is-ops" />
						<span>
							Klik garis ruas jalan pada peta untuk memilih dan memperbarui status
							Pecalang.
						</span>
					</>
				)}
			</div>

			{/* Draw Controls Bar (Snap to Road / Undo / Clear) when points are placed */}
			{mode === "draw" && drawnCoordinates.length > 0 ? (
				<div className="teduh-dashboard-map-draw-actions">
					{drawnCoordinates.length >= 2 ? (
						<button
							type="button"
							className="teduh-map-tool-btn"
							onClick={handleSnapDrawnToRoad}
							disabled={isSnappingRoad}
						>
							<MapPin size={13} />
							<span>
								{isSnappingRoad
									? "Merapikan Jalur..."
									: "Sesuaikan ke Jalur Jalan"}
							</span>
						</button>
					) : null}
					<button
						type="button"
						className="teduh-map-tool-btn"
						onClick={() =>
							onChangeDrawnCoordinates?.(drawnCoordinates.slice(0, -1))
						}
					>
						<Undo2 size={13} />
						<span>Hapus Titik Terakhir</span>
					</button>
					<button
						type="button"
						className="teduh-map-tool-btn is-danger"
						onClick={() => onChangeDrawnCoordinates?.([])}
					>
						<RotateCcw size={13} />
						<span>Ulangi Garis</span>
					</button>
				</div>
			) : null}

			{/* Main Map Canvas (Unobstructed) */}
			<div
				style={{
					position: "relative",
					width: "100%",
					height: typeof height === "number" ? `${height}px` : height,
					minHeight: typeof height === "number" ? `${height}px` : 380,
					background: "#E6E4DF",
				}}
			>
				<div
					ref={mapContainerRef}
					style={{
						position: "absolute",
						inset: 0,
						width: "100%",
						height: "100%",
					}}
				/>
				{!mapError && <GpsControls gps={gps} />}

				{mapError ? (
					<div
						style={{
							position: "absolute",
							inset: 0,
							background: "#FBFBFA",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: 24,
							textAlign: "center",
							color: "#545B67",
							fontSize: 13.5,
						}}
					>
						{mapError}
					</div>
				) : null}
			</div>

			{/* Legend Bar BELOW Map (keeps map canvas unobstructed) */}
			<div className="teduh-dashboard-map-legend">
				{mode !== "operational" ? <span className="teduh-legend-title">Rencana dampak:</span> : null}
				<span className="teduh-legend-item">
					<i style={{ background: "#C8322B" }} /> Ditutup Penuh
				</span>
				<span className="teduh-legend-item">
					<i style={{ background: "#D97706" }} /> Buka-Tutup / Penyempitan
				</span>
				<span className="teduh-legend-item">
					<i style={{ background: "#4D702F" }} /> Terbuka / Normal
				</span>
				{mode === "operational" ? <span className="teduh-legend-item"><i style={{ background: "#6B7280" }} /> Belum dikonfirmasi</span> : null}
				{mode !== "operational" ? (
					<span className="teduh-legend-item">
						<i style={{ background: "#0284C7" }} /> Katalog Terverifikasi
					</span>
				) : null}
			</div>
		</div>
	);
}
