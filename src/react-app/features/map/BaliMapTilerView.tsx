import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	BALI_ISLAND_CENTER,
	BALI_ISLAND_ZOOM,
	BALI_MAP_BOUNDS,
	BALI_MAP_MIN_ZOOM,
	BALI_MAP_MAX_ZOOM,
	type BaliVillageCeremonyProfile,
	type VillageRoadRouteSegment,
} from "../../lib/bali-villages";
import { buildDistrictFeaturesFromEvents } from "../../lib/events-api";
import type { OperationalRoadStatus } from "../../lib/road-status";
import {
	BALI_DISTRICTS_DATA,
	type BaliDistrictProperties,
} from "../../lib/bali-districts";
import {
	MapFallbackRoadList,
	type CeremonyDetailItem,
} from "../../components/rangkai";

interface BaliMapTilerViewProps {
	village?: BaliVillageCeremonyProfile | null;
	allVillages?: BaliVillageCeremonyProfile[];
	selectedSegmentId?: string;
	onSelectSegment?: (segmentId: string) => void;
	onSelectVillage?: (village: BaliVillageCeremonyProfile) => void;
	height?: string | number;
	showParkingMarkers?: boolean;
	showPecalangMarkers?: boolean;
	showAllVillagesMarkers?: boolean;
	selectedRegionName?: string | null;
	onSelectRegion?: (regionName: string, district?: BaliDistrictProperties) => void;
	onOpenCeremonyDetail?: (ceremony: CeremonyDetailItem) => void;
	minimalControls?: boolean;
}

type MapLayerType = "maptiler" | "satellite" | "osm";

function calculateDistance(
	coord1: [number, number],
	coord2: [number, number],
): number {
	const [lon1, lat1] = coord1;
	const [lon2, lat2] = coord2;
	const dLat = (lat2 - lat1) * (Math.PI / 180);
	const dLon = (lon2 - lon1) * (Math.PI / 180);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1 * (Math.PI / 180)) *
			Math.cos(lat2 * (Math.PI / 180)) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return 6371 * c; // in kilometers
}

function getStatusColor(status: OperationalRoadStatus): string {
	switch (status) {
		case "closed":
			return "#C8322B";
		case "intermittent":
			return "#D97706";
		case "open":
			return "#15803D";
		default:
			return "#78716C";
	}
}

function getStatusBadgeConfig(status: OperationalRoadStatus) {
	switch (status) {
		case "closed":
			return {
				label: "Ditutup Total",
				className: "status-closed",
			};
		case "intermittent":
			return {
				label: "Buka-Tutup",
				className: "status-intermittent",
			};
		case "open":
			return {
				label: "Jalur Normal",
				className: "status-open",
			};
		default:
			return {
				label: "Konfirmasi",
				className: "status-unknown",
			};
	}
}

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

export function BaliMapTilerView({
	village = null,
	allVillages = [],
	selectedSegmentId,
	onSelectSegment,
	onSelectVillage,
	height = "100%",
	showAllVillagesMarkers = true,
	selectedRegionName = null,
	onSelectRegion,
	onOpenCeremonyDetail,
	minimalControls = false,
}: BaliMapTilerViewProps) {
	const mapContainerRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const allVillagesMarkersRef = useRef<maplibregl.Marker[]>([]);
	const districtPillsRef = useRef<maplibregl.Marker[]>([]);
	const activePopupRef = useRef<maplibregl.Popup | null>(null);
	const onSelectRegionRef = useRef(onSelectRegion);
	const onOpenCeremonyDetailRef = useRef(onOpenCeremonyDetail);

	const districtFeaturesData = useMemo(
		() => buildDistrictFeaturesFromEvents(allVillages),
		[allVillages],
	);

	useEffect(() => {
		onSelectRegionRef.current = onSelectRegion;
	}, [onSelectRegion]);

	useEffect(() => {
		onOpenCeremonyDetailRef.current = onOpenCeremonyDetail;
	}, [onOpenCeremonyDetail]);

	const [activeLayer, setActiveLayer] = useState<MapLayerType>("satellite");
	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [mapError, setMapError] = useState<string | null>(null);
	const [isBaliOverview, setIsBaliOverview] = useState(false);

	const minHeightValue = typeof height === "number" ? height : 500;

	// Initialize MapLibre
	useEffect(() => {
		if (!mapContainerRef.current) return;

		let mapInstance: maplibregl.Map | null = null;
		let fallbackTimer: NodeJS.Timeout | null = null;

		try {
			mapInstance = new maplibregl.Map({
				container: mapContainerRef.current,
				style: SATELLITE_STYLE,
				center: village ? village.mapCenter : BALI_ISLAND_CENTER,
				zoom: village ? village.mapZoom : BALI_ISLAND_ZOOM,
				maxBounds: BALI_MAP_BOUNDS,
				minZoom: BALI_MAP_MIN_ZOOM,
				maxZoom: BALI_MAP_MAX_ZOOM,
				attributionControl: false,
			});

			if (!minimalControls) {
				mapInstance.addControl(
					new maplibregl.NavigationControl({ showCompass: true }),
					"top-right",
				);
			}

			mapInstance.addControl(
				new maplibregl.AttributionControl({
					compact: true,
					customAttribution: "MapTiler • OpenStreetMap • Rangkai Bali",
				}),
				"bottom-right",
			);

			mapInstance.on("load", () => {
				if (fallbackTimer) clearTimeout(fallbackTimer);
				setIsMapLoaded(true);
				setMapError(null);
				mapInstance?.resize();
			});

			// Auto-toggle visibility between district overview pills and ceremony pins based on zoom
			mapInstance.on("zoom", () => {
				if (!mapInstance) return;
				const zoom = mapInstance.getZoom();
				const isZoomedOut = zoom < 11.2;

				if (isZoomedOut) {
					if (activePopupRef.current) {
						activePopupRef.current.remove();
						activePopupRef.current = null;
					}
					allVillagesMarkersRef.current.forEach((m) => {
						m.getElement().style.display = "none";
					});
					districtPillsRef.current.forEach((m) => {
						m.getElement().style.display = "inline-flex";
					});
				} else {
					districtPillsRef.current.forEach((m) => {
						m.getElement().style.display = "none";
					});
					allVillagesMarkersRef.current.forEach((m) => {
						m.getElement().style.display = "block";
					});
				}
			});

			mapInstance.on("error", (e: { error?: { message?: string } }) => {
				const msg = e.error?.message || "";
				if (msg.includes("Failed to initialize WebGL")) {
					setMapError("Peramban Anda memerlukan akselerasi WebGL untuk memuat peta.");
				} else {
					// Fallback to ultra-reliable OpenStreetMap raster tiles
					try {
						mapInstance?.setStyle(SATELLITE_STYLE);
						setActiveLayer("satellite");
					} catch {
						// ignore style switch errors
					}
				}
			});

			// If MapTiler is slow to respond or blocked by browser extensions, fallback to OSM after 1800ms
			fallbackTimer = setTimeout(() => {
				if (!mapInstance?.isStyleLoaded()) {
					try {
						mapInstance?.setStyle(SATELLITE_STYLE);
						setActiveLayer("satellite");
					} catch {
						// ignore
					}
				}
			}, 1800);

			mapRef.current = mapInstance;
		} catch (err) {
			const errMsg =
				err instanceof Error
					? err.message
					: "Peta belum dapat ditampilkan pada peramban ini.";
			queueMicrotask(() => {
				setMapError(errMsg);
			});
		}

		// Ensure container size adapts dynamically
		let resizeObserver: ResizeObserver | null = null;
		if (mapContainerRef.current && typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				mapInstance?.resize();
			});
			resizeObserver.observe(mapContainerRef.current);
		}

		let intersectionObserver: IntersectionObserver | null = null;
		if (mapContainerRef.current && typeof IntersectionObserver !== "undefined") {
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
			intersectionObserver.observe(mapContainerRef.current);
		}

		const handleWindowResize = () => {
			mapInstance?.resize();
		};
		window.addEventListener("resize", handleWindowResize);

		// Force multiple resize ticks to handle flex/grid stabilization
		const t1 = setTimeout(() => mapInstance?.resize(), 100);
		const t2 = setTimeout(() => mapInstance?.resize(), 300);
		const t3 = setTimeout(() => mapInstance?.resize(), 800);

		return () => {
			if (fallbackTimer) clearTimeout(fallbackTimer);
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
			districtPillsRef.current.forEach((m) => m.remove());
			districtPillsRef.current = [];
			allVillagesMarkersRef.current.forEach((m) => m.remove());
			allVillagesMarkersRef.current = [];
			mapInstance?.remove();
			mapRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Mount overview District Ceremony Count Pills (visible when zoom < 11.2)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		districtPillsRef.current.forEach((m) => m.remove());
		districtPillsRef.current = [];

		districtFeaturesData.features.forEach(
			(feat: { properties: BaliDistrictProperties }) => {
				const dist = feat.properties;
				if (!dist.ceremonies || dist.ceremonies.length === 0) return;

				const el = document.createElement("div");
				el.className = "district-count-pill";
				el.style.setProperty("--district-border", dist.borderColor);
				el.innerHTML = `
					<span class="district-count-name">${dist.name}</span>
					<span class="district-count-badge">${dist.ceremonies.length} Acara</span>
				`;

				el.addEventListener("click", (e) => {
					e.stopPropagation();
					if (onSelectRegionRef.current) {
						onSelectRegionRef.current(dist.name, dist);
					}
					const foundVillage = allVillages.find((v) =>
						dist.ceremonies.some((c) => c.id === v.id || c.slug === v.slug),
					);
					if (foundVillage && onSelectVillage) {
						onSelectVillage(foundVillage);
					}
					const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
					map.flyTo({
						center: foundVillage ? foundVillage.mapCenter : dist.center,
						zoom: 13.0,
						padding: isMobile
							? { top: 130, bottom: 40, left: 20, right: 20 }
							: { top: 60, bottom: 40, left: 20, right: 460 },
						duration: 800,
						essential: true,
					});
				});

				// If zoomed in, hide initially
				if (map.getZoom() >= 11.2) {
					el.style.display = "none";
				}

				const marker = new maplibregl.Marker({ element: el, anchor: "center" })
					.setLngLat(dist.center)
					.addTo(map);

				districtPillsRef.current.push(marker);
			},
		);

		return () => {
			districtPillsRef.current.forEach((m) => m.remove());
			districtPillsRef.current = [];
		};
	}, [isMapLoaded, districtFeaturesData, allVillages, onSelectVillage]);

	// Fly camera when village changes
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !village) return;

		if (!isBaliOverview) {
			map.flyTo({
				center: village.mapCenter,
				zoom: village.mapZoom,
				duration: 1200,
				essential: true,
			});
		}
	}, [village, isMapLoaded, isBaliOverview]);

	// Fly camera to selected district center when selectedRegionName changes (only if no specific village is already in that district)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !selectedRegionName) return;

		const q = selectedRegionName.toLowerCase();
		if (
			village &&
			(village.kabupaten.toLowerCase().includes(q) ||
				village.kecamatan.toLowerCase().includes(q) ||
				q.includes(village.kecamatan.toLowerCase()))
		) {
			return;
		}

		const matchedDistrict = districtFeaturesData.features.find(
			(f) =>
				f.properties.name.toLowerCase().includes(q) ||
				q.includes(f.properties.name.toLowerCase()) ||
				f.properties.kabupaten.toLowerCase().includes(q),
		);

		if (matchedDistrict) {
			map.flyTo({
				center: matchedDistrict.properties.center,
				zoom: 12.5,
				duration: 1000,
				essential: true,
			});
		}
	}, [selectedRegionName, isMapLoaded, village, districtFeaturesData]);

	// Open compact point popup directly above the ceremony point on the map
	const openCompactPopupForVillage = useCallback(
		(v: BaliVillageCeremonyProfile) => {
			const map = mapRef.current;
			if (!map || !v.roadSegments.some((road) => road.coordinates.length > 0)) return;

			if (activePopupRef.current) {
				activePopupRef.current.remove();
				activePopupRef.current = null;
			}

			const statusBadge = getStatusBadgeConfig(
				v.primaryStatus.toLowerCase() as OperationalRoadStatus,
			);
			const popupNode = document.createElement("div");
			popupNode.className = "map-popup-card";
			popupNode.innerHTML = `
				<div class="map-popup-header">
					<span class="map-popup-badge ${statusBadge.className}">${statusBadge.label}</span>
					${v.isSimulation ? '<span class="map-popup-badge simulation-token">SIMULASI</span>' : ''}
					<span class="map-popup-location"></span>
				</div>
				<h4 class="map-popup-title"></h4>
				<div class="map-popup-meta-box">
					<div class="map-popup-meta-row">
						<span class="map-popup-meta-label">Jalur:</span>
						<span class="map-popup-meta-val"></span>
					</div>
					<div class="map-popup-meta-row">
						<span class="map-popup-meta-label">Waktu:</span>
						<span class="map-popup-meta-val"></span>
					</div>
				</div>
				<button type="button" class="map-popup-btn">
					<span>Lihat Detail</span>
					<span aria-hidden="true">→</span>
				</button>
			`;

			const location = popupNode.querySelector(".map-popup-location");
			const title = popupNode.querySelector(".map-popup-title");
			const values = popupNode.querySelectorAll(".map-popup-meta-val");
			if (location) location.textContent = v.desaAdatName;
			if (title) title.textContent = v.ceremonyTitle;
			if (values[0]) values[0].textContent = v.roadSegments[0]?.roadName || v.sacredCenterName || "Koridor Wilayah";
			if (values[1]) values[1].textContent = v.scheduleWindowWita || "Jadwal menyusul";
			const btn = popupNode.querySelector(".map-popup-btn");
			if (btn) {
				btn.addEventListener("click", () => {
					if (activePopupRef.current) {
						activePopupRef.current.remove();
						activePopupRef.current = null;
					}
					if (onOpenCeremonyDetailRef.current) {
						onOpenCeremonyDetailRef.current({
							id: v.id,
							title: v.ceremonyTitle,
							desaAdatName: v.desaAdatName,
							kabupaten: v.kabupaten,
							slug: v.slug,
							status: v.primaryStatus.toLowerCase() as OperationalRoadStatus,
							dateLabel: v.scheduleDateLabel,
							windowWita: v.scheduleWindowWita,
							sacredCenterName: v.puraPoint.name,
							roadName: v.roadSegments[0]?.roadName,
							detourRoute: v.roadSegments[0]?.guidanceNote || v.alternativeRouteSummary,
							isSimulation: v.isSimulation,
						});
					}
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
				closeButton: false,
				closeOnClick: false,
				maxWidth: "248px",
			})
				.setLngLat(v.mapCenter)
				.setDOMContent(popupNode)
				.addTo(map);

			popup.on("close", () => {
				if (activePopupRef.current === popup) {
					activePopupRef.current = null;
				}
			});

			activePopupRef.current = popup;
		},
		[],
	);

	// Render Pan-Bali village pins for all registered villages (Teduh Teardrop Pins)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !showAllVillagesMarkers) return;

		allVillagesMarkersRef.current.forEach((m) => m.remove());
		allVillagesMarkersRef.current = [];

		allVillages.forEach((v) => {
			if (v.isSimulation !== false) return;
			if (!v.roadSegments.some((road) => road.coordinates.length > 0)) return;
			const pinColor = getStatusColor(v.primaryStatus);
			const isCurrent = village ? v.id === village.id : false;

			const pinEl = document.createElement("div");
			pinEl.className = `standard-location-pin ${isCurrent ? "is-active" : ""}`;
			if (map.getZoom() < 11.2) {
				pinEl.style.display = "none";
			}
			pinEl.innerHTML = `
				<div class="pin-inner">
					<div class="pin-pulse-halo" style="background: ${pinColor}40;"></div>
					<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M16 2C9.37258 2 4 7.37258 4 14C4 24.5 16 39 16 39C16 39 28 24.5 28 14C28 7.37258 22.6274 2 16 2Z" fill="${pinColor}" stroke="#FFFFFF" stroke-width="1.8"/>
						<circle cx="16" cy="14" r="5.5" fill="#FFFFFF"/>
					</svg>
				</div>
				<div class="marker-hover-label"></div>
			`;
			const label = pinEl.querySelector(".marker-hover-label");
			if (label) label.textContent = v.desaAdatName;

			pinEl.addEventListener("click", (evt) => {
				evt.stopPropagation();
				setIsBaliOverview(false);
				const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
				if (onSelectVillage) {
					onSelectVillage(v);
				}
				if (isMobile) {
					openCompactPopupForVillage(v);
				} else {
					if (activePopupRef.current) {
						activePopupRef.current.remove();
						activePopupRef.current = null;
					}
				}
				map.flyTo({
					center: v.mapCenter,
					zoom: 13.5,
					padding: isMobile
						? { top: 130, bottom: 40, left: 20, right: 20 }
						: { top: 60, bottom: 40, left: 20, right: 460 },
					essential: true,
				});
			});

			const pinMarker = new maplibregl.Marker({ element: pinEl, anchor: "bottom" })
				.setLngLat(v.mapCenter)
				.addTo(map);
			allVillagesMarkersRef.current.push(pinMarker);
		});
	}, [allVillages, village, isMapLoaded, isBaliOverview, showAllVillagesMarkers, onSelectVillage, openCompactPopupForVillage]);

	// Render Road LineStrings for the selected village
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const sourceId = "rangkai-road-routes";
		const lineHaloLayerId = "rangkai-road-routes-halo";
		const lineLayerId = "rangkai-road-routes-line";

		const segments = village?.roadSegments ?? [];
		const geojsonData = {
			type: "FeatureCollection" as const,
			features: segments
				.filter((seg: VillageRoadRouteSegment) => seg.coordinates && seg.coordinates.length >= 2)
				.map((seg: VillageRoadRouteSegment) => ({
					type: "Feature" as const,
					id: seg.id,
					properties: {
						id: seg.id,
						roadName: seg.roadName,
						corridorSection: seg.corridorSection,
						status: seg.status,
						color: getStatusColor(seg.status),
						isSelected: seg.id === selectedSegmentId,
						windowWita: seg.windowWita,
						roleLabel: seg.roleLabel,
					},
					geometry: {
						type: "LineString" as const,
						coordinates: seg.coordinates,
					},
				})),
		};

		if (map.getSource(sourceId)) {
			(map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(
				geojsonData,
			);
		} else {
			map.addSource(sourceId, {
				type: "geojson",
				data: geojsonData,
			});

			map.addLayer({
				id: lineHaloLayerId,
				type: "line",
				source: sourceId,
				layout: {
					"line-join": "round",
					"line-cap": "round",
				},
				paint: {
					"line-color": [
						"case",
						["get", "isSelected"],
						"#FFFFFF",
						"rgba(255,255,255,0.75)",
					],
					"line-width": ["case", ["get", "isSelected"], 12, 9],
				},
			});

			map.addLayer({
				id: lineLayerId,
				type: "line",
				source: sourceId,
				layout: {
					"line-join": "round",
					"line-cap": "round",
				},
				paint: {
					"line-color": ["get", "color"],
					"line-width": ["case", ["get", "isSelected"], 7, 5],
					"line-dasharray": [
						"case",
						["==", ["get", "status"], "intermittent"],
						["literal", [2, 1.5]],
						["==", ["get", "status"], "open"],
						["literal", [3, 2]],
						["literal", [1, 0]],
					],
				},
			});

			map.on("click", lineLayerId, (e: maplibregl.MapLayerMouseEvent) => {
				const feat = e.features?.[0];
				if (feat && feat.properties?.id && onSelectSegment) {
					onSelectSegment(feat.properties.id as string);
				}
			});

			map.on("mouseenter", lineLayerId, () => {
				map.getCanvas().style.cursor = "pointer";
			});
			map.on("mouseleave", lineLayerId, () => {
				map.getCanvas().style.cursor = "";
			});
		}
	}, [village, selectedSegmentId, isMapLoaded, onSelectSegment, activeLayer]);

	// Render Territorial District Boundaries & Handle Regional Selection
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const sourceId = "rangkai-districts-source";
		const fillLayerId = "rangkai-districts-fill";
		const lineLayerId = "rangkai-districts-line";
		const labelLayerId = "rangkai-districts-label";

		if (map.getSource(sourceId)) {
			(map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(
				districtFeaturesData as unknown as Parameters<maplibregl.GeoJSONSource["setData"]>[0],
			);
			return;
		}

		map.addSource(sourceId, {
			type: "geojson",
			data: districtFeaturesData as unknown as Parameters<maplibregl.GeoJSONSource["setData"]>[0],
		});

		map.addLayer({
			id: fillLayerId,
			type: "fill",
			source: sourceId,
			paint: {
				"fill-color": ["get", "fillColor"],
				"fill-opacity": 0.22,
			},
		});

		map.addLayer({
			id: lineLayerId,
			type: "line",
			source: sourceId,
			paint: {
				"line-color": ["get", "borderColor"],
				"line-width": 2.2,
				"line-opacity": 0.85,
			},
		});

		map.addLayer({
			id: labelLayerId,
			type: "symbol",
			source: sourceId,
			layout: {
				"text-field": ["get", "name"],
				"text-size": 11,
				"text-anchor": "center",
				"text-allow-overlap": false,
			},
			paint: {
				"text-color": "#18181B",
				"text-halo-color": "#FFFFFF",
				"text-halo-width": 2,
			},
		});

		map.on("click", fillLayerId, (e: maplibregl.MapLayerMouseEvent) => {
			const feat = e.features?.[0];
			if (feat && feat.properties) {
				const districtProps = feat.properties as unknown as BaliDistrictProperties;
				if (onSelectRegionRef.current) {
					onSelectRegionRef.current(districtProps.name, districtProps);
				}

				const q = districtProps.name.toLowerCase();
				const matchingVillage = allVillages.find(
					(v) =>
						v.kabupaten.toLowerCase().includes(districtProps.kabupaten.toLowerCase()) ||
						v.kecamatan.toLowerCase().includes(q) ||
						q.includes(v.kecamatan.toLowerCase()),
				);
				if (matchingVillage) {
					const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
					if (onSelectVillage) {
						onSelectVillage(matchingVillage);
					}
					if (isMobile) {
						openCompactPopupForVillage(matchingVillage);
					} else {
						if (activePopupRef.current) {
							activePopupRef.current.remove();
							activePopupRef.current = null;
						}
					}
					map.flyTo({
						center: matchingVillage.mapCenter,
						zoom: 13.5,
						padding: isMobile
							? { top: 130, bottom: 40, left: 20, right: 20 }
							: { top: 60, bottom: 40, left: 20, right: 460 },
						essential: true,
					});
				}
			}
		});

		map.on("mouseenter", fillLayerId, () => {
			map.getCanvas().style.cursor = "pointer";
		});

		map.on("mouseleave", fillLayerId, () => {
			map.getCanvas().style.cursor = "";
		});

		map.on("click", (e: maplibregl.MapMouseEvent) => {
			if (!onSelectRegionRef.current) return;
			const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
				[e.point.x - 4, e.point.y - 4],
				[e.point.x + 4, e.point.y + 4],
			];
			const hit = map.queryRenderedFeatures(bbox, {
				layers: [fillLayerId],
			});
			if (hit.length === 0) {
				const clickCoord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
				let nearestDist = Infinity;
				let nearestDistrict: BaliDistrictProperties | null = null;
				for (const feat of BALI_DISTRICTS_DATA.features) {
					const dist = calculateDistance(clickCoord, feat.properties.center);
					if (dist < nearestDist) {
						nearestDist = dist;
						nearestDistrict = feat.properties;
					}
				}
				if (nearestDistrict && nearestDist <= 35) {
					onSelectRegionRef.current(nearestDistrict.name, nearestDistrict);
				}
			}
		});
	}, [isMapLoaded, activeLayer, districtFeaturesData, allVillages, openCompactPopupForVillage]);

	// Update district polygon layer high-contrast highlighting whenever selectedRegionName changes
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !map.getLayer("rangkai-districts-fill")) return;

		if (selectedRegionName) {
			const q = selectedRegionName.toLowerCase();
			const matchedDistrict = BALI_DISTRICTS_DATA.features.find(
				(f) =>
					f.properties.name.toLowerCase().includes(q) ||
					q.includes(f.properties.name.toLowerCase()) ||
					f.properties.kabupaten.toLowerCase().includes(q),
			);
			const targetId = matchedDistrict?.properties.id || "";

			map.setPaintProperty("rangkai-districts-fill", "fill-opacity", [
				"case",
				["==", ["get", "id"], targetId],
				0.52,
				0.08,
			]);
			map.setPaintProperty("rangkai-districts-line", "line-width", [
				"case",
				["==", ["get", "id"], targetId],
				3.5,
				1.2,
			]);
			map.setPaintProperty("rangkai-districts-line", "line-opacity", [
				"case",
				["==", ["get", "id"], targetId],
				1.0,
				0.25,
			]);
		} else {
			map.setPaintProperty("rangkai-districts-fill", "fill-opacity", 0.28);
			map.setPaintProperty("rangkai-districts-line", "line-width", 2.0);
			map.setPaintProperty("rangkai-districts-line", "line-opacity", 0.75);
		}
	}, [selectedRegionName, isMapLoaded]);

	function handleToggleOverview() {
		const map = mapRef.current;
		if (!map) return;
		if (isBaliOverview && village) {
			setIsBaliOverview(false);
			map.flyTo({ center: village.mapCenter, zoom: village.mapZoom, duration: 1200 });
		} else {
			setIsBaliOverview(true);
			map.flyTo({ center: BALI_ISLAND_CENTER, zoom: BALI_ISLAND_ZOOM, duration: 1400 });
		}
	}

	return (
		<div
			style={{
				width: "100%",
				height,
				minHeight: height === "100%" ? "100%" : minHeightValue,
				position: "relative",
				borderRadius: height === "100%" ? 0 : "var(--radius-element, 12px)",
				overflow: "hidden",
				border: "none",
				background: "#151E28",
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

			{/* Info badge top left */}
			{height !== "100%" && village && (
				<div
					style={{
						position: "absolute",
						top: 14,
						left: 14,
						background: "rgba(255, 255, 255, 0.96)",
						backdropFilter: "blur(12px)",
						WebkitBackdropFilter: "blur(12px)",
						borderRadius: 12,
						padding: "10px 16px",
						zIndex: 5,
					}}
				>
					<div
						style={{
							fontWeight: 500,
							fontSize: 13,
							color: "#181B20",
						}}
					>
						{village.desaAdatName}, {village.kabupaten}
					</div>
					<div
						style={{
							fontSize: 12,
							color: "#545B67",
							marginTop: 2,
						}}
					>
						{village.ceremonyTitle} ({village.scheduleWindowWita})
					</div>
				</div>
			)}

			{/* Controls top right (Bali Overview Toggle) - hidden in minimalControls mode */}
			{!minimalControls && (
				<div
					style={{
						position: "absolute",
						top: height === "100%" ? 84 : 14,
						right: 54, // next to maplibre nav buttons
						display: "flex",
						gap: 6,
						zIndex: 5,
					}}
				>
					{/* Pan-Bali toggle button */}
					<button
						type="button"
						onClick={handleToggleOverview}
						style={{
							background: isBaliOverview ? "#18181B" : "rgba(255, 255, 255, 0.95)",
							color: isBaliOverview ? "#FFFFFF" : "#18181B",
							border: "1px solid #E4E4E7",
							borderRadius: 8,
							padding: "6px 12px",
							fontFamily: "var(--font-family)",
							fontSize: 11.5,
							fontWeight: 600,
							cursor: "pointer",
							boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
							backdropFilter: "blur(8px)",
						}}
					>
						{isBaliOverview ? "Fokus Desa" : "Semua Bali"}
					</button>
				</div>
			)}

			{/* Status color legend bottom left - hidden in minimalControls mode */}
			{!minimalControls && (
				<div
					style={{
						position: "absolute",
						bottom: 14,
						left: 14,
						background: "rgba(255, 255, 255, 0.95)",
						backdropFilter: "blur(10px)",
						WebkitBackdropFilter: "blur(10px)",
						border: "1px solid #E4E4E7",
						borderRadius: 8,
						padding: "6px 12px",
						boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
						display: "flex",
						alignItems: "center",
						gap: 12,
						zIndex: 5,
						flexWrap: "wrap",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							fontSize: 11,
							fontFamily: "var(--font-family)",
							fontWeight: 600,
							color: "#18181B",
						}}
					>
						<span
							style={{
								width: 12,
								height: 4,
								borderRadius: 2,
								background: "#C8322B",
								display: "inline-block",
							}}
						/>
						<span>Ditutup</span>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							fontSize: 11,
							fontFamily: "var(--font-family)",
							fontWeight: 600,
							color: "#18181B",
						}}
					>
						<span
							style={{
								width: 12,
								height: 4,
								borderRadius: 2,
								background: "#D97706",
								display: "inline-block",
							}}
						/>
						<span>Buka-Tutup</span>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							fontSize: 11,
							fontFamily: "var(--font-family)",
							fontWeight: 600,
							color: "#18181B",
						}}
					>
						<span
							style={{
								width: 12,
								height: 4,
								borderRadius: 2,
								background: "#15803D",
								display: "inline-block",
							}}
						/>
						<span>Jalur Alternatif</span>
					</div>
				</div>
			)}

			{/* Loading overlay */}
			{!isMapLoaded && !mapError && (
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						background: "rgba(255, 255, 255, 0.95)",
						backdropFilter: "blur(8px)",
						border: "1px solid #E4E4E7",
						borderRadius: 9999,
						padding: "8px 16px",
						boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
						fontFamily: "Figtree, sans-serif",
						fontSize: 12,
						fontWeight: 600,
						color: "#18181B",
						zIndex: 8,
						display: "flex",
						alignItems: "center",
						gap: 8,
					}}
				>
					<span
						style={{
							width: 8,
							height: 8,
							borderRadius: "50%",
							background: "#F97316",
							display: "inline-block",
							animation: "pulse 1.5s infinite",
						}}
					/>
					<span>Memuat Peta Citra & Jalur Desa...</span>
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
						segments={
							village?.roadSegments?.map((seg) => ({
								id: seg.id,
								segmentName: seg.roadName,
								corridorArea: village.desaAdatName,
								impactType: "closure",
								plannedFrom: new Date().toISOString(),
								plannedTo: new Date(Date.now() + 3600000).toISOString(),
								status: (seg.status === "closed"
									? "closed"
									: seg.status === "intermittent"
										? "intermittent"
										: seg.status === "open"
											? "open"
											: "unknown") as OperationalRoadStatus,
							})) ?? []
						}
					/>
				</div>
			) : null}
		</div>
	);
}
