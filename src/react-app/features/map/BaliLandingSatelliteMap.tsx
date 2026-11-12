import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CeremonyDetailModal,
	MapFallbackRoadList,
	type CeremonyDetailItem,
	type RoadSegmentFallbackItem,
} from "../../components/rangkai";
import {
	BALI_ISLAND_CENTER,
	BALI_ISLAND_ZOOM,
	BALI_MAP_BOUNDS,
	BALI_MAP_MAX_ZOOM,
	BALI_MAP_MIN_ZOOM,
	type BaliVillageCeremonyProfile,
} from "../../lib/bali-villages";
import type { OperationalRoadStatus } from "../../lib/road-status";
import { useGpsTracking } from "./useGpsTracking";
import { showGpsAccuracy } from "./gpsAccuracy";
import { GpsControls } from "./GpsControls";

type BasemapStyle = "osm" | "satellite";

const BASEMAP_STYLES: Record<BasemapStyle, maplibregl.StyleSpecification> = {
	osm: {
		version: 8,
		sources: {
			"osm-tiles": {
				type: "raster",
				tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
				tileSize: 256,
				attribution: "© OpenStreetMap contributors • Rangkai Bali",
			},
		},
		layers: [
			{
				id: "osm-layer",
				type: "raster",
				source: "osm-tiles",
				minzoom: 0,
				maxzoom: 19,
			},
		],
	},
	satellite: {
		version: 8,
		sources: {
			"satellite-tiles": {
				type: "raster",
				tiles: [
					"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
				],
				tileSize: 256,
				attribution: "Esri, Maxar, Earthstar Geographics • Rangkai Bali",
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
	},
};

function getStatusBadgeConfig(status: OperationalRoadStatus) {
	switch (status) {
		case "closed":
			return {
				label: "Ditutup Total",
				className: "status-closed",
				pinColor: "#C8322B",
			};
		case "intermittent":
			return {
				label: "Buka-Tutup",
				className: "status-intermittent",
				pinColor: "#D97706",
			};
		case "open":
			return {
				label: "Jalur Normal",
				className: "status-open",
				pinColor: "#4D702F",
			};
		default:
			return {
				label: "Konfirmasi",
				className: "status-unknown",
				pinColor: "#57534E",
			};
	}
}

interface BaliLandingSatelliteMapProps {
	ceremonies?: BaliVillageCeremonyProfile[];
}

export function BaliLandingSatelliteMap({
	ceremonies = [],
}: BaliLandingSatelliteMapProps) {
	const mapContainerRef = useRef<HTMLDivElement | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const ceremonyMarkersRef = useRef<maplibregl.Marker[]>([]);
	const activePopupRef = useRef<maplibregl.Popup | null>(null);

	const allFallbackSegments: RoadSegmentFallbackItem[] = useMemo(() => {
		const result: RoadSegmentFallbackItem[] = [];
		for (const ceremony of ceremonies) {
			for (const seg of ceremony.roadSegments || []) {
				const rawImpact = (seg.impactType || "").toLowerCase();
				const mappedImpact: RoadSegmentFallbackItem["impactType"] =
					rawImpact.includes("intermittent") || rawImpact.includes("buka_tutup")
						? "intermittent_flow"
						: rawImpact.includes("parking")
							? "parking_restriction"
							: rawImpact.includes("procession")
								? "procession_route"
								: "closure";

				result.push({
					id: seg.id,
					segmentName: seg.roadName,
					corridorArea: seg.corridorSection || ceremony.desaAdatName,
					impactType: mappedImpact,
					plannedFrom:
						seg.plannedFrom ||
						ceremony.scheduleIso?.startsAt ||
						new Date().toISOString(),
					plannedTo:
						seg.plannedTo ||
						ceremony.scheduleIso?.endsAt ||
						new Date().toISOString(),
					observedAt: seg.observedAt || null,
					expiresAt: seg.expiresAt || null,
					diversionNote: seg.guidanceNote || null,
					isSimulation: ceremony.isSimulation !== false,
					status: (seg.status === "closed"
						? "closed"
						: seg.status === "intermittent"
							? "intermittent"
							: seg.status === "open"
								? "open"
								: "unknown") as OperationalRoadStatus,
				});
			}
		}
		return result;
	}, [ceremonies]);

	const roadGeoJson = useMemo(() => {
		const features: Array<{
			type: "Feature";
			properties: {
				id: string;
				ceremonyId: string;
				roadName: string;
				status: OperationalRoadStatus;
				stroke: string;
				halo: string;
			};
			geometry: {
				type: "LineString" | "MultiLineString";
				coordinates: Array<[number, number]> | Array<Array<[number, number]>>;
			};
		}> = [];

		for (const ceremony of ceremonies) {
			for (const seg of ceremony.roadSegments || []) {
				const parts = (
					seg.coordinateParts?.length
						? seg.coordinateParts
						: [seg.coordinates]
				)
					.map((part) =>
						part.filter(
							(pt): pt is [number, number] =>
								Array.isArray(pt) &&
								pt.length === 2 &&
								Number.isFinite(pt[0]) &&
								Number.isFinite(pt[1]),
						),
					)
					.filter((part) => part.length >= 2);
				if (parts.length === 0) continue;

				const stroke =
					seg.status === "closed"
						? "#C8322B"
						: seg.status === "intermittent"
							? "#D97706"
							: seg.status === "open"
								? "#4D702F"
								: "#57534E";
				const halo =
					seg.status === "closed"
						? "rgba(200, 50, 43, 0.30)"
						: seg.status === "intermittent"
							? "rgba(217, 119, 6, 0.28)"
							: seg.status === "open"
								? "rgba(92, 132, 55, 0.28)"
								: "rgba(87, 83, 78, 0.25)";

				features.push({
					type: "Feature",
					properties: {
						id: seg.id,
						ceremonyId: ceremony.id,
						roadName: seg.roadName,
						status: seg.status,
						stroke,
						halo,
					},
					geometry:
						parts.length === 1
							? { type: "LineString", coordinates: parts[0] }
							: { type: "MultiLineString", coordinates: parts },
				});
			}
		}

		return {
			type: "FeatureCollection" as const,
			features,
		};
	}, [ceremonies]);

	const roadGeoJsonRef = useRef(roadGeoJson);
	useEffect(() => {
		roadGeoJsonRef.current = roadGeoJson;
	}, [roadGeoJson]);

	const altRoutesGeoJson = useMemo(() => {
		const features: Array<{
			type: "Feature";
			properties: {
				id: string;
				ceremonyId: string;
				name: string;
			};
			geometry: {
				type: "LineString";
				coordinates: Array<[number, number]>;
			};
		}> = [];

		for (const ceremony of ceremonies) {
			for (const route of ceremony.alternativeRoutes || []) {
				const validCoords = (route.coordinates || []).filter(
					(pt): pt is [number, number] =>
						Array.isArray(pt) &&
						pt.length === 2 &&
						Number.isFinite(pt[0]) &&
						Number.isFinite(pt[1]),
				);
				if (validCoords.length < 2) continue;
				features.push({
					type: "Feature",
					properties: {
						id: route.id,
						ceremonyId: ceremony.id,
						name: route.name,
					},
					geometry: {
						type: "LineString",
						coordinates: validCoords,
					},
				});
			}
		}

		return {
			type: "FeatureCollection" as const,
			features,
		};
	}, [ceremonies]);

	const altRoutesGeoJsonRef = useRef(altRoutesGeoJson);
	useEffect(() => {
		altRoutesGeoJsonRef.current = altRoutesGeoJson;
	}, [altRoutesGeoJson]);

	const [activeBasemap, setActiveBasemap] = useState<BasemapStyle>("satellite");
	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [mapError, setMapError] = useState<string | null>(null);
	const [activeCeremonyId, setActiveCeremonyId] = useState<string | null>(null);
	const [activeDetailCeremony, setActiveDetailCeremony] =
		useState<CeremonyDetailItem | null>(null);

	// User location tracking & green bypass guidance route state
	const gps = useGpsTracking();
	const userLocation = gps.position?.coordinates ?? null;
	const userMarkerRef = useRef<maplibregl.Marker | null>(null);

	// Cooperative map activation state (prevents wheel & touch drag scroll-trapping while scrolling page)
	const [isMapInteracting, setIsMapInteracting] = useState(false);

	const handleActivateMap = useCallback(() => {
		setIsMapInteracting(true);
		mapRef.current?.scrollZoom.enable();
		mapRef.current?.dragPan.enable();
		mapRef.current?.touchZoomRotate.enable();
	}, []);

	const handleDeactivateMap = useCallback(() => {
		setIsMapInteracting(false);
		mapRef.current?.scrollZoom.disable();
		mapRef.current?.dragPan.disable();
		mapRef.current?.touchZoomRotate.disable();
	}, []);

	// Click outside the map container to release focus and restore smooth page scroll
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(event.target as Node)
			) {
				handleDeactivateMap();
			}
		}

		if (isMapInteracting) {
			window.addEventListener("pointerdown", handleClickOutside);
			return () =>
				window.removeEventListener("pointerdown", handleClickOutside);
		}
	}, [isMapInteracting, handleDeactivateMap]);

	// Open Compact Map Popup directly above the ceremony point
	const openCeremonyPopup = useCallback(
		(ceremony: BaliVillageCeremonyProfile) => {
			const map = mapRef.current;
			const pinCoords = ceremony.venueLocation;
			if (!map || !pinCoords) return;

			if (activePopupRef.current) {
				activePopupRef.current.remove();
				activePopupRef.current = null;
			}

			const badge = getStatusBadgeConfig(ceremony.primaryStatus);
			const isSim = ceremony.isSimulation !== false;
			const firstRoadName =
				ceremony.roadSegments[0]?.roadName ||
				ceremony.destinationName ||
				"Ruas belum ditentukan";
			const altRouteLabel =
				ceremony.alternativeRoutes?.[0]?.name ||
				ceremony.alternativeRouteSummary ||
				"Jalur alternatif tersedia di peta";

			const popupNode = document.createElement("div");
			popupNode.className = "map-popup-card";
			popupNode.innerHTML = `
				<div class="map-popup-header">
					<div class="map-popup-location"></div>
					<div class="map-popup-top-badges">
						<span class="map-popup-badge ${badge.className}">${badge.label}</span>
						${isSim ? '<span class="map-popup-badge simulation-token">SIMULASI</span>' : ""}
					</div>
				</div>
				<h4 class="map-popup-title"></h4>
				<div class="map-popup-meta-box">
					<div class="map-popup-meta-row">
						<span class="map-popup-meta-label">Jalur:</span>
						<span class="map-popup-meta-val"></span>
					</div>
					<div class="map-popup-meta-row">
						<span class="map-popup-meta-label">Alternatif:</span>
						<span class="map-popup-meta-val"></span>
					</div>
					<div class="map-popup-meta-row">
						<span class="map-popup-meta-label">Waktu:</span>
						<span class="map-popup-meta-val"></span>
					</div>
				</div>
				<div class="map-popup-actions">
					<button type="button" class="map-popup-btn">
						<span>Lihat Detail</span>
						<span aria-hidden="true">→</span>
					</button>
				</div>
			`;

			const location = popupNode.querySelector(".map-popup-location");
			const title = popupNode.querySelector(".map-popup-title");
			const values = popupNode.querySelectorAll(".map-popup-meta-val");
			const cleanDesaName = ceremony.desaAdatName.replace(/\s*\([Ss]imulasi\)/g, "").trim();
			const cleanCeremonyTitle = ceremony.ceremonyTitle.replace(/^\[SIMULATED\]\s*/i, "").trim();
			const cleanFirstRoadName = firstRoadName.replace(/^\[SIMULATED\]\s*/i, "").trim();
			if (location) location.textContent = cleanDesaName;
			if (title) title.textContent = cleanCeremonyTitle;
			if (values[0]) values[0].textContent = cleanFirstRoadName;
			if (values[1]) values[1].textContent = altRouteLabel;
			if (values[2])
				values[2].textContent =
					ceremony.scheduleWindowWita || "Waktu belum ditentukan";

			const btn = popupNode.querySelector(".map-popup-btn");
			if (btn) {
				btn.addEventListener("click", () => {
					setActiveDetailCeremony({
						id: ceremony.id,
						title: ceremony.ceremonyTitle,
						desaAdatName: ceremony.desaAdatName,
						kabupaten: ceremony.kabupaten,
						slug: ceremony.slug,
						status: ceremony.primaryStatus,
						dateLabel: ceremony.scheduleDateLabel,
						windowWita: ceremony.scheduleWindowWita,
						sacredCenterName: ceremony.sacredCenterName,
						roadName: firstRoadName,
						detourRoute: ceremony.alternativeRouteSummary,
						isSimulation: ceremony.isSimulation !== false,
					});
				});
			}

			const popup = new maplibregl.Popup({
				className: "custom-teduh-popup",
				offset: {
					center: [0, 0],
					top: [0, 6],
					"top-left": [0, 6],
					"top-right": [0, 6],
					bottom: [0, -42],
					"bottom-left": [0, -42],
					"bottom-right": [0, -42],
					left: [18, -20],
					right: [-18, -20],
				},
				anchor: "bottom",
				closeButton: true,
				closeOnClick: false,
				maxWidth: "320px",
			})
				.setLngLat(pinCoords)
				.setDOMContent(popupNode)
				.addTo(map);

			popup.getElement()?.querySelector(".maplibregl-popup-close-button")?.setAttribute("aria-label", "Tutup informasi peta");
			popup.on("close", () => {
				if (activePopupRef.current === popup) {
					activePopupRef.current = null;
				}
			});

			activePopupRef.current = popup;
		},
		[],
	);

	// Reset active ceremony selection and return to whole island view
	const handleResetSelection = useCallback(() => {
		setActiveCeremonyId(null);

		if (activePopupRef.current) {
			activePopupRef.current.remove();
			activePopupRef.current = null;
		}

		const map = mapRef.current;
		if (!map) return;

		map.flyTo({
			center: BALI_ISLAND_CENTER,
			zoom: BALI_ISLAND_ZOOM,
			duration: 750,
			essential: true,
		});
	}, []);

	// Attach road segment, alternative route, and user green route layers (no district polygon shapes)
	const attachRoadLayers = useCallback((mapInstance: maplibregl.Map) => {
		if (!mapInstance.getSource("landing-alt-routes")) {
			mapInstance.addSource("landing-alt-routes", {
				type: "geojson",
				data: altRoutesGeoJsonRef.current,
			});
		}

		if (!mapInstance.getLayer("landing-alt-routes-halo")) {
			mapInstance.addLayer({
				id: "landing-alt-routes-halo",
				type: "line",
				source: "landing-alt-routes",
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": "rgba(255, 255, 255, 0.85)",
					"line-width": 8,
					"line-opacity": 0.9,
				},
			});
		}

		if (!mapInstance.getLayer("landing-alt-routes-line")) {
			mapInstance.addLayer({
				id: "landing-alt-routes-line",
				type: "line",
				source: "landing-alt-routes",
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": "#2563EB",
					"line-width": 4,
					"line-dasharray": [2, 1.5],
					"line-opacity": 0.95,
				},
			});
		}

		if (!mapInstance.getSource("landing-ceremony-roads")) {
			mapInstance.addSource("landing-ceremony-roads", {
				type: "geojson",
				data: roadGeoJsonRef.current,
			});
		}

		if (!mapInstance.getLayer("landing-ceremony-roads-halo")) {
			mapInstance.addLayer({
				id: "landing-ceremony-roads-halo",
				type: "line",
				source: "landing-ceremony-roads",
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": ["get", "halo"],
					"line-width": 12,
					"line-opacity": 0.9,
				},
			});
		}

		if (!mapInstance.getLayer("landing-ceremony-roads-line")) {
			mapInstance.addLayer({
				id: "landing-ceremony-roads-line",
				type: "line",
				source: "landing-ceremony-roads",
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": ["get", "stroke"],
					"line-width": 5,
					"line-opacity": 0.95,
				},
			});
		}
	}, []);

	const handleSwitchBasemap = useCallback(
		(nextStyle: BasemapStyle) => {
			if (nextStyle === activeBasemap) return;
			setActiveBasemap(nextStyle);
			const map = mapRef.current;
			if (!map) return;
			map.setStyle(BASEMAP_STYLES[nextStyle]);
			map.once("style.load", () => {
				attachRoadLayers(map);
			});
		},
		[activeBasemap, attachRoadLayers],
	);

	useEffect(() => {
		if (gps.following && gps.position && mapRef.current) mapRef.current.easeTo({ center: gps.position.coordinates, zoom: Math.max(mapRef.current.getZoom(), 14), duration: 500 });
	}, [gps.position, gps.following]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;
		const updateAccuracy = () => showGpsAccuracy(map, gps.position);
		updateAccuracy();
		map.on("style.load", updateAccuracy);
		return () => { map.off("style.load", updateAccuracy); };
	}, [gps.position, isMapLoaded]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;
		map.on("dragstart", gps.pauseFollowing);
		return () => { map.off("dragstart", gps.pauseFollowing); };
	}, [gps.pauseFollowing, isMapLoaded]);

	// Initialize MapLibre instance
	useEffect(() => {
		if (!mapContainerRef.current) return;

		let mapInstance: maplibregl.Map | null = null;

		try {
			mapInstance = new maplibregl.Map({
				container: mapContainerRef.current,
				style: BASEMAP_STYLES.satellite,
				center: BALI_ISLAND_CENTER,
				zoom: BALI_ISLAND_ZOOM,
				maxBounds: BALI_MAP_BOUNDS,
				minZoom: BALI_MAP_MIN_ZOOM,
				maxZoom: BALI_MAP_MAX_ZOOM,
				attributionControl: false,
			});

			// Prevent scroll-trap on mobile and desktop: disable wheel, dragPan & touchZoomRotate by default until map is explicitly activated
			mapInstance.scrollZoom.disable();
			mapInstance.dragPan.disable();
			mapInstance.touchZoomRotate.disable();

			mapInstance.addControl(
				new maplibregl.NavigationControl({ showCompass: true }),
				"top-right",
			);

			mapInstance.addControl(
				new maplibregl.AttributionControl({
					compact: true,
					customAttribution: "OpenStreetMap & Esri • Rangkai Bali",
				}),
				"bottom-left",
			);

			mapInstance.on("load", () => {
				if (!mapInstance) return;
				attachRoadLayers(mapInstance);
				setIsMapLoaded(true);
				setMapError(null);
				mapInstance.resize();
			});

			mapInstance.on("error", (e: { error?: { message?: string } }) => {
				const msg = e.error?.message || "";
				if (msg.includes("Failed to initialize WebGL")) {
					setMapError(
						"Peramban Anda memerlukan akselerasi WebGL untuk menampilkan peta kawasan.",
					);
				}
			});

			mapRef.current = mapInstance;
		} catch (err) {
			const errMsg =
				err instanceof Error
					? err.message
					: "Peta wilayah belum dapat ditampilkan pada peramban ini.";
			queueMicrotask(() => {
				setMapError(errMsg);
			});
		}

		let resizeObserver: ResizeObserver | null = null;
		if (mapContainerRef.current && typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				mapInstance?.resize();
			});
			resizeObserver.observe(mapContainerRef.current);
		}

		let intersectionObserver: IntersectionObserver | null = null;
		if (wrapperRef.current && typeof IntersectionObserver !== "undefined") {
			intersectionObserver = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting && mapInstance) {
							mapInstance.resize();
						}
					}
				},
				{ threshold: 0.05 },
			);
			intersectionObserver.observe(wrapperRef.current);
		}

		const handleWindowResize = () => {
			mapInstance?.resize();
		};
		window.addEventListener("resize", handleWindowResize);

		const t1 = setTimeout(() => mapInstance?.resize(), 150);
		const t2 = setTimeout(() => mapInstance?.resize(), 500);
		const t3 = setTimeout(() => mapInstance?.resize(), 1200);

		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
			clearTimeout(t3);
			resizeObserver?.disconnect();
			intersectionObserver?.disconnect();
			window.removeEventListener("resize", handleWindowResize);
			if (activePopupRef.current) {
				activePopupRef.current.remove();
				activePopupRef.current = null;
			}
			userMarkerRef.current?.remove();
			userMarkerRef.current = null;
			ceremonyMarkersRef.current.forEach((m) => m.remove());
			ceremonyMarkersRef.current = [];
			mapInstance?.remove();
			mapRef.current = null;
		};
	}, [attachRoadLayers]);

	// Sync user device location marker when GPS is activated
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		userMarkerRef.current?.remove();
		userMarkerRef.current = null;

		if (userLocation) {
			const el = document.createElement("div");
			el.setAttribute("aria-label", "Lokasi Anda");
			el.style.cssText =
				"width:22px;height:22px;border-radius:9999px;background:#4D702F;border:3px solid #FFFFFF;box-shadow:0 0 0 6px rgba(92,132,55,0.28),0 4px 10px rgba(15,23,42,0.35);cursor:pointer;";
			el.title = "Lokasi Anda";
			userMarkerRef.current = new maplibregl.Marker({
				element: el,
				anchor: "center",
			})
				.setLngLat(userLocation)
				.addTo(map);
		}
	}, [isMapLoaded, userLocation]);

	// Sync road segment data, alternative routes & ceremony location pins across Bali at all zoom levels
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const roadSource = map.getSource("landing-ceremony-roads") as
			| maplibregl.GeoJSONSource
			| undefined;
		if (roadSource) {
			roadSource.setData(roadGeoJson);
		}

		const altRouteSource = map.getSource("landing-alt-routes") as
			| maplibregl.GeoJSONSource
			| undefined;
		if (altRouteSource) {
			altRouteSource.setData(altRoutesGeoJson);
		}

		ceremonyMarkersRef.current.forEach((m) => m.remove());
		ceremonyMarkersRef.current = [];

		for (const ceremony of ceremonies) {
			const pinCoords = ceremony.venueLocation;
			if (
				!Array.isArray(pinCoords) ||
				pinCoords.length !== 2 ||
				!Number.isFinite(pinCoords[0]) ||
				!Number.isFinite(pinCoords[1])
			) {
				continue;
			}

			const badge = getStatusBadgeConfig(ceremony.primaryStatus);
			const pinColor = badge.pinColor;
			const isActive = activeCeremonyId === ceremony.id;

			const el = document.createElement("div");
			el.className = `standard-location-pin ${isActive ? "is-active" : ""}`;
			el.setAttribute(
				"aria-label",
				`Lokasi acara: ${ceremony.sacredCenterName || ceremony.ceremonyTitle}${
					ceremony.isSimulation !== false ? " (simulasi)" : ""
				}`,
			);
			el.innerHTML = `
				<div class="pin-inner">
					<div class="pin-pulse-halo" style="background: ${pinColor}40;"></div>
					<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M16 2C9.37258 2 4 7.37258 4 14C4 24.5 16 39 16 39C16 39 28 24.5 28 14C28 7.37258 22.6274 2 16 2Z" fill="${pinColor}" stroke="#FFFFFF" stroke-width="1.8"/>
						<circle cx="16" cy="14" r="5.5" fill="#FFFFFF"/>
					</svg>
				</div>
				<div class="marker-hover-label"></div>
			`;
			const markerLabel = el.querySelector(".marker-hover-label");
			if (markerLabel) {
				markerLabel.textContent = ceremony.desaAdatName;
			}

			el.addEventListener("click", (evt) => {
				evt.stopPropagation();
				setActiveCeremonyId(ceremony.id);
				openCeremonyPopup(ceremony);
				map.flyTo({
					center: pinCoords,
					zoom: Math.max(map.getZoom(), 14.2),
					padding: { top: 130, bottom: 40, left: 20, right: 20 },
					duration: 650,
					essential: true,
				});
			});

			const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
				.setLngLat(pinCoords)
				.addTo(map);

			ceremonyMarkersRef.current.push(marker);
		}

		return () => {
			ceremonyMarkersRef.current.forEach((m) => m.remove());
			ceremonyMarkersRef.current = [];
		};
	}, [
		isMapLoaded,
		ceremonies,
		roadGeoJson,
		altRoutesGeoJson,
		activeCeremonyId,
		openCeremonyPopup,
	]);

	return (
		<div
			ref={wrapperRef}
			onClick={handleActivateMap}
			onMouseLeave={handleDeactivateMap}
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				minHeight: 0,
				background: "#151E28",
				overflow: "hidden",
			}}
		>
			<div
				ref={mapContainerRef}
				onClick={!isMapInteracting ? handleActivateMap : undefined}
				className={!isMapInteracting ? "landing-map-scroll-locked" : undefined}
				style={{
					position: "absolute",
					inset: 0,
					width: "100%",
					height: "100%",
					cursor: !isMapInteracting ? "pointer" : "grab",
					touchAction: !isMapInteracting ? "pan-y" : "none",
				}}
			/>

			<GpsControls gps={gps} />

			{/* Top-left non-obstructive Map Controls Bar: Basemap Switcher, User Location Tracking, & Zoom Focus */}
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					position: "absolute",
					top: 14,
					left: 14,
					right: 56,
					zIndex: 6,
					display: "flex",
					flexWrap: "wrap",
					alignItems: "center",
					gap: 8,
					pointerEvents: "none",
				}}
			>
				{/* Basemap Mode Switcher: Satelit / Peta Jalan */}
				<div
					role="group"
					aria-label="Pilih tampilan peta dasar"
					style={{
						pointerEvents: "auto",
						display: "inline-flex",
						alignItems: "center",
						background: "rgba(24, 27, 32, 0.88)",
						backdropFilter: "blur(8px)",
						padding: 3,
						borderRadius: 4,
						boxShadow: "0 4px 14px rgba(15, 23, 42, 0.22)",
						border: "1px solid rgba(255, 255, 255, 0.16)",
					}}
				>
					<button
						type="button"
						onClick={() => handleSwitchBasemap("satellite")}
						aria-pressed={activeBasemap === "satellite"}
						style={{
							border: "none",
							borderRadius: 4,
							padding: "5px 12px",
							fontSize: 12,
							fontWeight: 600,
							cursor: "pointer",
							background:
								activeBasemap === "satellite" ? "#FFFFFF" : "transparent",
							color: activeBasemap === "satellite" ? "#181B20" : "#E2E8F0",
							transition: "all 0.15s ease",
						}}
					>
						Satelit
					</button>
					<button
						type="button"
						onClick={() => handleSwitchBasemap("osm")}
						aria-pressed={activeBasemap === "osm"}
						style={{
							border: "none",
							borderRadius: 4,
							padding: "5px 12px",
							fontSize: 12,
							fontWeight: 600,
							cursor: "pointer",
							background: activeBasemap === "osm" ? "#FFFFFF" : "transparent",
							color: activeBasemap === "osm" ? "#181B20" : "#E2E8F0",
							transition: "all 0.15s ease",
						}}
					>
						Peta Jalan
					</button>
				</div>

				{/* Cooperative Scroll Interaction Pill (discreet hint, faint background, no emojis) */}
				{!isMapInteracting ? (
					<button
						type="button"
						onClick={handleActivateMap}
						style={{
							pointerEvents: "auto",
							border: "1px solid rgba(0, 0, 0, 0.08)",
							borderRadius: 4,
							padding: "4px 10px",
							fontSize: 11,
							fontWeight: 500,
							background: "rgba(255, 255, 255, 0.88)",
							backdropFilter: "blur(4px)",
							color: "#475569",
							cursor: "pointer",
							boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
							display: "inline-flex",
							alignItems: "center",
						}}
					>
						<span>Klik peta untuk berinteraksi</span>
					</button>
				) : (
					<button
						type="button"
						onClick={handleDeactivateMap}
						style={{
							pointerEvents: "auto",
							border: "1px solid rgba(0, 0, 0, 0.15)",
							borderRadius: 4,
							padding: "4px 10px",
							fontSize: 11,
							fontWeight: 500,
							background: "rgba(24, 27, 32, 0.85)",
							backdropFilter: "blur(4px)",
							color: "#F8FAFC",
							cursor: "pointer",
							boxShadow: "0 1px 4px rgba(0, 0, 0, 0.15)",
							display: "inline-flex",
							alignItems: "center",
						}}
						title="Klik untuk mengunci kembali peta dan melanjutkan scroll halaman"
					>
						<span>Selesai berinteraksi</span>
					</button>
				)}
			</div>

			{/* Compact Bottom-Left Legend */}
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					position: "absolute",
					bottom: 14,
					left: 14,
					zIndex: 6,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					maxWidth: "min(380px, calc(100% - 28px))",
					pointerEvents: "none",
				}}
			>
				<div
					style={{
						pointerEvents: "auto",
						display: "inline-flex",
						flexWrap: "wrap",
						alignItems: "center",
						gap: 10,
						background: "rgba(24, 27, 32, 0.84)",
						backdropFilter: "blur(8px)",
						padding: "5px 12px",
						borderRadius: 4,
						color: "#F8FAFC",
						fontSize: 11,
						fontWeight: 500,
						width: "fit-content",
					}}
				>
					<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
						<span
							style={{
								width: 10,
								height: 3.5,
								borderRadius: 2,
								background: "#C8322B",
								display: "inline-block",
							}}
						/>
						Ditutup
					</span>
					<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
						<span
							style={{
								width: 10,
								height: 3.5,
								borderRadius: 2,
								background: "#D97706",
								display: "inline-block",
							}}
						/>
						Buka-Tutup
					</span>
					<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
						<span
							style={{
								width: 10,
								height: 3.5,
								borderRadius: 2,
								background: "#2563EB",
								display: "inline-block",
							}}
						/>
						Jalur Alternatif
					</span>

				</div>
			</div>

			{/* Reset island view button if a ceremony is currently selected */}
			{activeCeremonyId && (
				<button
					type="button"
					onClick={handleResetSelection}
					style={{
						position: "absolute",
						bottom: 36,
						right: 20,
						zIndex: 5,
						background: "rgba(255, 255, 255, 0.95)",
						backdropFilter: "blur(8px)",
						border: "none",
						borderRadius: 9999,
						padding: "8px 16px",
						fontSize: 12.5,
						fontWeight: 600,
						color: "#181B20",
						cursor: "pointer",
						boxShadow: "0 4px 16px rgba(15, 23, 42, 0.14)",
						display: "flex",
						alignItems: "center",
						gap: 6,
					}}
				>
					<span>↺ Tampilkan Seluruh Bali</span>
				</button>
			)}

			{/* Loading indicator */}
			{!isMapLoaded && !mapError && (
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						background: "rgba(21, 30, 40, 0.88)",
						backdropFilter: "blur(8px)",
						WebkitBackdropFilter: "blur(8px)",
						border: "none",
						borderRadius: 9999,
						padding: "10px 20px",
						boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
						fontFamily: "var(--font-family-body, Figtree, sans-serif)",
						fontSize: 13,
						fontWeight: 500,
						color: "#F8FAFC",
						zIndex: 8,
						display: "flex",
						alignItems: "center",
						gap: 10,
					}}
				>
					<span>Memuat Titik Lokasi Upacara & Jalur Bali...</span>
				</div>
			)}

			{mapError ? (
				<div
					style={{
						position: "absolute",
						inset: 0,
						background: "#FFFFFF",
						display: "flex",
						flexDirection: "column",
						padding: 20,
						zIndex: 10,
						overflowY: "auto",
					}}
				>
					<MapFallbackRoadList
						showMapUnavailableNotice
						segments={allFallbackSegments}
					/>
				</div>
			) : null}

			{/* Detail Ceremony Modal (Opens when user clicks "Lihat Detail" from compact point popup) */}
			<CeremonyDetailModal
				ceremony={activeDetailCeremony}
				onClose={() => setActiveDetailCeremony(null)}
			/>
		</div>
	);
}
