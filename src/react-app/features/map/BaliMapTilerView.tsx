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
import type { BaliDistrictProperties } from "../../lib/bali-districts";
import {
	MapFallbackRoadList,
	type CeremonyDetailItem,
	type RoadSegmentFallbackItem,
} from "../../components/rangkai";
import {
	calculateUserBypassRoute,
	deriveDefaultSimulatedUserOrigin,
	isWithinBaliBounds,
	type UserGuidanceRoute,
} from "../../lib/routing-engine";

export type MapBasemapStyle = "satellite" | "osm";

interface BaliMapTilerViewProps {
	village?: BaliVillageCeremonyProfile | null;
	allVillages?: BaliVillageCeremonyProfile[];
	alternativeRoutes?: Array<{
		id: string;
		name: string;
		description?: string | null;
		coordinates?: [number, number][];
		geometry?: {
			type?: string;
			coordinates?: [number, number][];
		};
	}>;
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
	fitDataReady?: boolean;
	showDistrictBoundaries?: boolean;
	basemapStyle?: MapBasemapStyle;
	onBasemapStyleChange?: (style: MapBasemapStyle) => void;
	userLocation?: [number, number] | null;
	userGuidanceRoute?: UserGuidanceRoute | null;
	isPickingUserOrigin?: boolean;
	onPickUserOrigin?: (coord: [number, number]) => void;
}

function getStatusColor(status: OperationalRoadStatus): string {
	switch (status) {
		case "closed":
			return "#C8322B";
		case "intermittent":
			return "#D97706";
		case "open":
			return "#5C8437";
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

const OSM_STYLE: maplibregl.StyleSpecification = {
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
};

export function BaliMapTilerView({
	village = null,
	allVillages = [],
	alternativeRoutes = [],
	selectedSegmentId,
	onSelectSegment,
	onSelectVillage,
	height = "100%",
	showAllVillagesMarkers = true,
	selectedRegionName = null,
	onOpenCeremonyDetail,
	minimalControls = false,
	fitDataReady = true,
	basemapStyle: controlledBasemapStyle,
	onBasemapStyleChange,
	userLocation: controlledUserLocation,
	userGuidanceRoute: controlledUserGuidanceRoute,
	isPickingUserOrigin = false,
	onPickUserOrigin,
}: BaliMapTilerViewProps) {
	const mapContainerRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const allVillagesMarkersRef = useRef<maplibregl.Marker[]>([]);
	const userMarkerRef = useRef<maplibregl.Marker | null>(null);
	const activePopupRef = useRef<maplibregl.Popup | null>(null);
	const fittedEventRef = useRef<string | null>(null);
	const focusedSegmentRef = useRef<string | null>(null);
	const onOpenCeremonyDetailRef = useRef(onOpenCeremonyDetail);
	const appliedBasemapRef = useRef<MapBasemapStyle>("satellite");

	const [internalBasemapStyle, setInternalBasemapStyle] =
		useState<MapBasemapStyle>("satellite");
	const effectiveBasemapStyle = controlledBasemapStyle ?? internalBasemapStyle;

	const handleBasemapChange = useCallback(
		(nextStyle: MapBasemapStyle) => {
			if (onBasemapStyleChange) {
				onBasemapStyleChange(nextStyle);
			} else {
				setInternalBasemapStyle(nextStyle);
			}
		},
		[onBasemapStyleChange],
	);

	// Internal standalone user location & green route state (used when parent does not pass controlledUserLocation)
	const [internalUserLocation, setInternalUserLocation] = useState<
		[number, number] | null
	>(null);
	const [internalGuidanceRoute, setInternalGuidanceRoute] =
		useState<UserGuidanceRoute | null>(null);
	const [isInternalLocating, setIsInternalLocating] = useState(false);

	const effectiveUserLocation =
		controlledUserLocation !== undefined
			? controlledUserLocation
			: internalUserLocation;
	const effectiveGuidanceRoute =
		controlledUserGuidanceRoute !== undefined
			? controlledUserGuidanceRoute
			: internalGuidanceRoute;

	const districtFeaturesData = useMemo(
		() => buildDistrictFeaturesFromEvents(allVillages),
		[allVillages],
	);

	useEffect(() => {
		onOpenCeremonyDetailRef.current = onOpenCeremonyDetail;
	}, [onOpenCeremonyDetail]);

	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [styleEpoch, setStyleEpoch] = useState(0);
	const [mapError, setMapError] = useState<string | null>(null);
	const [mapAttempt, setMapAttempt] = useState(0);
	const [isBaliOverview, setIsBaliOverview] = useState(false);

	const venueLng = village?.venueLocation?.[0];
	const venueLat = village?.venueLocation?.[1];
	const sacredCenterName = village?.sacredCenterName;
	const isVillageSimulation = Boolean(village?.isSimulation);

	useEffect(() => {
		const map = mapRef.current;
		if (
			!map ||
			Boolean(mapError) ||
			venueLng === undefined ||
			venueLat === undefined ||
			!sacredCenterName
		) {
			return;
		}
		const marker = new maplibregl.Marker({ color: "#5C8437", anchor: "bottom" })
			.setLngLat([venueLng, venueLat])
			.addTo(map);
		marker
			.getElement()
			.setAttribute(
				"aria-label",
				`Lokasi acara: ${sacredCenterName}${isVillageSimulation ? " (simulasi)" : ""}`,
			);
		return () => {
			marker.remove();
		};
	}, [
		mapAttempt,
		mapError,
		isMapLoaded,
		venueLng,
		venueLat,
		sacredCenterName,
		isVillageSimulation,
	]);

	const minHeightValue = typeof height === "number" ? height : 500;

	// Initialize MapLibre
	useEffect(() => {
		if (!mapContainerRef.current) return;

		let mapInstance: maplibregl.Map | null = null;
		let loadTimer: ReturnType<typeof setTimeout> | undefined;
		let active = true;

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
				if (loadTimer) clearTimeout(loadTimer);
				setIsMapLoaded(true);
				mapInstance?.resize();
			});
			mapInstance.on("style.load", () => setStyleEpoch((epoch) => epoch + 1));

			mapInstance.on(
				"error",
				(e: { error?: { message?: string }; sourceId?: string }) => {
					const msg = e.error?.message || "";
					if (msg.includes("Failed to initialize WebGL")) {
						setMapError(
							"Peramban Anda memerlukan akselerasi WebGL untuk memuat peta.",
						);
					} else if (
						msg.includes("Worker failed to load") ||
						e.sourceId === "satellite-tiles"
					) {
						setMapError(
							"Peta tidak dapat dimuat. Periksa koneksi lalu coba lagi.",
						);
					}
				},
			);

			mapRef.current = mapInstance;
			loadTimer = setTimeout(() => {
				if (!mapInstance?.loaded()) {
					setMapError(
						"Peta belum selesai dimuat. Periksa koneksi lalu coba lagi.",
					);
				}
			}, 12000);
		} catch (err) {
			const errMsg =
				err instanceof Error
					? err.message
					: "Peta belum dapat ditampilkan pada peramban ini.";
			queueMicrotask(() => {
				if (active) setMapError(errMsg);
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
		if (
			mapContainerRef.current &&
			typeof IntersectionObserver !== "undefined"
		) {
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
			active = false;
			if (loadTimer) clearTimeout(loadTimer);
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
			allVillagesMarkersRef.current.forEach((m) => m.remove());
			allVillagesMarkersRef.current = [];
			mapInstance?.remove();
			mapRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mapAttempt]);

	// Switch basemap style dynamically when effectiveBasemapStyle changes
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;
		if (appliedBasemapRef.current === effectiveBasemapStyle) return;
		appliedBasemapRef.current = effectiveBasemapStyle;
		map.setStyle(
			effectiveBasemapStyle === "osm" ? OSM_STYLE : SATELLITE_STYLE,
		);
	}, [effectiveBasemapStyle, isMapLoaded]);

	// Standalone user location route calculation when used on /events/:slug or /events/:slug/map
	useEffect(() => {
		if (controlledUserGuidanceRoute !== undefined) return;
		let cancelled = false;
		const targetVillage = village ?? allVillages[0] ?? null;
		if (!internalUserLocation || !targetVillage) {
			setInternalGuidanceRoute(null);
			return;
		}
		calculateUserBypassRoute({
			userOrigin: internalUserLocation,
			ceremony: targetVillage,
		}).then((route) => {
			if (!cancelled) {
				setInternalGuidanceRoute(route);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [
		controlledUserGuidanceRoute,
		internalUserLocation,
		village,
		allVillages,
	]);

	const handleStandaloneTrackLocation = useCallback(() => {
		if (internalUserLocation) {
			setInternalUserLocation(null);
			setInternalGuidanceRoute(null);
			return;
		}
		const targetVillage = village ?? allVillages[0] ?? null;
		const applyCoord = (coord: [number, number]) => {
			setInternalUserLocation(coord);
			setIsInternalLocating(false);
			const map = mapRef.current;
			if (map) {
				const bounds = new maplibregl.LngLatBounds(coord, coord);
				if (targetVillage) {
					bounds.extend(
						targetVillage.venueLocation ?? targetVillage.mapCenter,
					);
					for (const seg of targetVillage.roadSegments || []) {
						for (const pt of seg.coordinates || []) {
							bounds.extend(pt);
						}
					}
				}
				map.fitBounds(bounds, {
					padding: 65,
					maxZoom: 15.2,
					duration: 750,
				});
			}
		};

		if (
			typeof navigator !== "undefined" &&
			"geolocation" in navigator &&
			typeof navigator.geolocation.getCurrentPosition === "function"
		) {
			setIsInternalLocating(true);
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					const candidate: [number, number] = [
						Number(pos.coords.longitude.toFixed(6)),
						Number(pos.coords.latitude.toFixed(6)),
					];
					if (isWithinBaliBounds(candidate)) {
						applyCoord(candidate);
					} else {
						applyCoord(
							targetVillage
								? deriveDefaultSimulatedUserOrigin(targetVillage)
								: BALI_ISLAND_CENTER,
						);
					}
				},
				() => {
					applyCoord(
						targetVillage
							? deriveDefaultSimulatedUserOrigin(targetVillage)
							: BALI_ISLAND_CENTER,
					);
				},
				{ enableHighAccuracy: true, timeout: 3500, maximumAge: 30000 },
			);
		} else {
			applyCoord(
				targetVillage
					? deriveDefaultSimulatedUserOrigin(targetVillage)
					: BALI_ISLAND_CENTER,
			);
		}
	}, [internalUserLocation, village, allVillages]);

	// Click on map to pick custom user origin when isPickingUserOrigin is active
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !isPickingUserOrigin || !onPickUserOrigin) {
			return;
		}
		const canvas = map.getCanvas();
		const prevCursor = canvas.style.cursor;
		canvas.style.cursor = "crosshair";

		const handleMapClick = (e: maplibregl.MapMouseEvent) => {
			const picked: [number, number] = [
				Number(e.lngLat.lng.toFixed(6)),
				Number(e.lngLat.lat.toFixed(6)),
			];
			if (isWithinBaliBounds(picked)) {
				onPickUserOrigin(picked);
			}
		};

		map.on("click", handleMapClick);
		return () => {
			canvas.style.cursor = prevCursor;
			map.off("click", handleMapClick);
		};
	}, [isMapLoaded, isPickingUserOrigin, onPickUserOrigin]);

	// Fit once after the event's spatial data has loaded; status polling must not move the camera.
	useEffect(() => {
		const map = mapRef.current;
		if (
			!map ||
			!isMapLoaded ||
			!village ||
			!fitDataReady ||
			isBaliOverview ||
			fittedEventRef.current === village.id
		) {
			return;
		}
		const coordinates: [number, number][] = [];
		if (village.venueLocation) coordinates.push(village.venueLocation);
		for (const road of village.roadSegments) {
			coordinates.push(
				...(road.coordinateParts ?? [road.coordinates]).flat(),
			);
		}
		for (const route of [
			...alternativeRoutes,
			...(village.alternativeRoutes ?? []),
		]) {
			const line =
				route.coordinates ??
				("geometry" in route ? route.geometry?.coordinates : undefined);
			if (Array.isArray(line)) {
				coordinates.push(
					...line.filter(
						(point): point is [number, number] =>
							Array.isArray(point) &&
							point.length >= 2 &&
							Number.isFinite(point[0]) &&
							Number.isFinite(point[1]),
					),
				);
			}
		}
		if (coordinates.length > 1) {
			const bounds = new maplibregl.LngLatBounds();
			coordinates.forEach((point) => bounds.extend(point));
			map.fitBounds(bounds, { padding: 55, maxZoom: 15, duration: 800 });
		} else {
			map.flyTo({
				center: coordinates[0] ?? village.mapCenter,
				zoom: village.mapZoom,
				duration: 800,
			});
		}
		fittedEventRef.current = village.id;
		focusedSegmentRef.current = null;
	}, [village, alternativeRoutes, isMapLoaded, fitDataReady, isBaliOverview]);

	useEffect(() => {
		const map = mapRef.current;
		if (
			!map ||
			!isMapLoaded ||
			!village ||
			!selectedSegmentId ||
			selectedSegmentId === focusedSegmentRef.current
		) {
			return;
		}
		const road = village.roadSegments.find(
			(segment) => segment.id === selectedSegmentId,
		);
		if (!road) return;
		const coordinates = (road.coordinateParts ?? [road.coordinates]).flat();
		if (coordinates.length < 2) return;
		const bounds = new maplibregl.LngLatBounds();
		coordinates.forEach((point) => bounds.extend(point));
		map.fitBounds(bounds, { padding: 65, maxZoom: 16, duration: 500 });
		focusedSegmentRef.current = selectedSegmentId;
	}, [village, selectedSegmentId, isMapLoaded]);

	// Fly camera when selectedRegionName changes (focusing on the ceremony point in that area if available)
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

		const matchingCeremony = allVillages.find(
			(v) =>
				v.kabupaten.toLowerCase().includes(q) ||
				v.kecamatan.toLowerCase().includes(q) ||
				q.includes(v.kecamatan.toLowerCase()),
		);
		if (matchingCeremony?.venueLocation) {
			map.flyTo({
				center: matchingCeremony.venueLocation,
				zoom: 13.5,
				duration: 900,
				essential: true,
			});
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
				zoom: 12.2,
				duration: 900,
				essential: true,
			});
		}
	}, [selectedRegionName, isMapLoaded, village, allVillages, districtFeaturesData]);

	// Open compact point popup directly above the ceremony point on the map
	const openCompactPopupForVillage = useCallback(
		(v: BaliVillageCeremonyProfile) => {
			const map = mapRef.current;
			const pinCoords = v.venueLocation ?? v.mapCenter;
			if (!map || !pinCoords) return;

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
					${v.isSimulation !== false ? '<span class="map-popup-badge simulation-token">SIMULASI</span>' : ""}
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
			if (values[0]) {
				values[0].textContent =
					v.roadSegments[0]?.roadName ||
					v.sacredCenterName ||
					"Koridor Wilayah";
			}
			if (values[1]) {
				values[1].textContent = v.scheduleWindowWita || "Jadwal menyusul";
			}
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
							detourRoute:
								v.roadSegments[0]?.guidanceNote ||
								v.alternativeRouteSummary,
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
				.setLngLat(pinCoords)
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

	// Render Pan-Bali ceremony location pins at all zoom levels (without polygon area boxes)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded || !showAllVillagesMarkers) return;

		allVillagesMarkersRef.current.forEach((m) => m.remove());
		allVillagesMarkersRef.current = [];

		allVillages.forEach((v) => {
			const pinCoords = v.venueLocation ?? v.mapCenter;
			if (!pinCoords) return;
			const pinColor = getStatusColor(v.primaryStatus);
			const isCurrent = village ? v.id === village.id : false;

			const pinEl = document.createElement("div");
			pinEl.className = `standard-location-pin ${isCurrent ? "is-active" : ""}`;
			pinEl.setAttribute(
				"aria-label",
				`Lokasi acara: ${v.sacredCenterName || v.ceremonyTitle}${
					v.isSimulation !== false ? " (simulasi)" : ""
				}`,
			);
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
			if (label) {
				label.textContent = `${v.desaAdatName}${v.isSimulation !== false ? " • SIMULASI" : ""}`;
			}

			pinEl.addEventListener("click", (evt) => {
				evt.stopPropagation();
				setIsBaliOverview(false);
				const isMobile =
					typeof window !== "undefined" && window.innerWidth <= 768;
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
					center: pinCoords,
					zoom: Math.max(map.getZoom(), 14),
					padding: isMobile
						? { top: 130, bottom: 40, left: 20, right: 20 }
						: { top: 60, bottom: 40, left: 20, right: 460 },
					essential: true,
				});
			});

			const pinMarker = new maplibregl.Marker({
				element: pinEl,
				anchor: "bottom",
			})
				.setLngLat(pinCoords)
				.addTo(map);
			allVillagesMarkersRef.current.push(pinMarker);
		});
	}, [
		allVillages,
		village,
		isMapLoaded,
		isBaliOverview,
		showAllVillagesMarkers,
		onSelectVillage,
		openCompactPopupForVillage,
	]);

	// Render Road LineStrings for the selected village (or all villages when in island overview)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const sourceId = "rangkai-road-routes";
		const lineHaloLayerId = "rangkai-road-routes-halo";
		const lineLayerId = "rangkai-road-routes-line";

		const sourceVillages = village ? [village] : allVillages;
		const features: Array<{
			type: "Feature";
			id: string;
			properties: {
				id: string;
				roadName: string;
				corridorSection: string;
				status: OperationalRoadStatus;
				isSimulation: boolean;
				color: string;
				isSelected: boolean;
				windowWita: string;
				roleLabel: string;
			};
			geometry:
				| { type: "MultiLineString"; coordinates: Array<Array<[number, number]>> }
				| { type: "LineString"; coordinates: Array<[number, number]> };
		}> = [];

		for (const activeVillage of sourceVillages) {
			for (const seg of activeVillage.roadSegments ?? []) {
				if (!seg.coordinates || seg.coordinates.length < 2) continue;
				features.push({
					type: "Feature" as const,
					id: seg.id,
					properties: {
						id: seg.id,
						roadName: seg.roadName,
						corridorSection: seg.corridorSection,
						status: seg.status,
						isSimulation: activeVillage.isSimulation !== false,
						color: getStatusColor(seg.status),
						isSelected: seg.id === selectedSegmentId,
						windowWita: seg.windowWita,
						roleLabel: seg.roleLabel,
					},
					geometry: seg.coordinateParts
						? {
								type: "MultiLineString" as const,
								coordinates: seg.coordinateParts,
							}
						: { type: "LineString" as const, coordinates: seg.coordinates },
				});
			}
		}

		const geojsonData = {
			type: "FeatureCollection" as const,
			features,
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
						["get", "isSimulation"],
						["literal", [2, 2]],
						["==", ["get", "status"], "intermittent"],
						["literal", [2, 1.5]],
						["==", ["get", "status"], "open"],
						["literal", [3, 2]],
						["literal", [1, 0]],
					],
				},
			});
		}
		const handleClick = (e: maplibregl.MapLayerMouseEvent) => {
			const feat = e.features?.[0];
			if (feat && feat.properties?.id && onSelectSegment) {
				onSelectSegment(feat.properties.id as string);
			}
		};
		const handleEnter = () => {
			map.getCanvas().style.cursor = "pointer";
		};
		const handleLeave = () => {
			map.getCanvas().style.cursor = "";
		};
		map.on("click", lineLayerId, handleClick);
		map.on("mouseenter", lineLayerId, handleEnter);
		map.on("mouseleave", lineLayerId, handleLeave);
		return () => {
			map.off("click", lineLayerId, handleClick);
			map.off("mouseenter", lineLayerId, handleEnter);
			map.off("mouseleave", lineLayerId, handleLeave);
		};
	}, [village, allVillages, selectedSegmentId, isMapLoaded, onSelectSegment, styleEpoch]);

	// Render Alternative Routes Overlay (SPEC-08: Dashed blue LineString distinct from closures)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const sourceId = "rangkai-alt-routes-source";
		const haloLayerId = "rangkai-alt-routes-halo";
		const lineLayerId = "rangkai-alt-routes-line";

		const sourceVillagesForAlt = village ? [village] : allVillages;
		const activeAltRoutes = [
			...(alternativeRoutes || []),
			...sourceVillagesForAlt.flatMap((v) => v.alternativeRoutes || []),
		];

		const seenIds = new Set<string>();
		const geojsonData = {
			type: "FeatureCollection" as const,
			features: activeAltRoutes
				.map((r) => {
					const coords =
						"coordinates" in r &&
						Array.isArray(r.coordinates) &&
						r.coordinates.length > 0
							? r.coordinates
							: "geometry" in r &&
								  r.geometry &&
								  Array.isArray(r.geometry.coordinates)
								? (r.geometry.coordinates as [number, number][])
								: [];
					return {
						id: r.id,
						name: r.name,
						description:
							r.description || "Jalur pengalihan sementara panitia",
						coords,
					};
				})
				.filter((r) => {
					if (r.coords.length < 2) return false;
					if (seenIds.has(r.id)) return false;
					seenIds.add(r.id);
					return true;
				})
				.map((r) => ({
					type: "Feature" as const,
					id: r.id,
					properties: {
						id: r.id,
						name: r.name,
						description: r.description,
					},
					geometry: {
						type: "LineString" as const,
						coordinates: r.coords,
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
				id: haloLayerId,
				type: "line",
				source: sourceId,
				layout: {
					"line-join": "round",
					"line-cap": "round",
				},
				paint: {
					"line-color": "rgba(255, 255, 255, 0.85)",
					"line-width": 8,
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
					"line-color": "#2563EB",
					"line-width": 4.5,
					"line-dasharray": [2, 2],
				},
			});

			map.on("click", lineLayerId, (e: maplibregl.MapLayerMouseEvent) => {
				const feat = e.features?.[0];
				if (feat && feat.properties) {
					const content = document.createElement("section");
					const heading = document.createElement("strong");
					heading.textContent = "Jalur Alternatif Sementara (Simulasi)";
					const name = document.createElement("p");
					name.textContent = String(
						feat.properties.name || "Rute Pengalihan",
					);
					const description = document.createElement("p");
					description.textContent = String(
						feat.properties.description || "",
					);
					const disclaimer = document.createElement("p");
					disclaimer.textContent =
						"Panduan adat • Bukan rute resmi kepolisian";
					content.append(heading, name, description, disclaimer);
					new maplibregl.Popup({ closeButton: true, closeOnClick: true })
						.setLngLat(e.lngLat)
						.setDOMContent(content)
						.addTo(map);
				}
			});

			map.on("mouseenter", lineLayerId, () => {
				map.getCanvas().style.cursor = "pointer";
			});
			map.on("mouseleave", lineLayerId, () => {
				map.getCanvas().style.cursor = "";
			});
		}
	}, [alternativeRoutes, village, allVillages, isMapLoaded, styleEpoch]);

	// Render User Location Marker & Green Guidance Route Line (#16A34A)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const sourceId = "rangkai-user-guidance-source";
		const haloLayerId = "rangkai-user-guidance-halo";
		const lineLayerId = "rangkai-user-guidance-line";

		const routeCoords = effectiveGuidanceRoute?.coordinates ?? [];
		const geojsonData = {
			type: "FeatureCollection" as const,
			features:
				routeCoords.length >= 2
					? [
							{
								type: "Feature" as const,
								properties: {
									name:
										effectiveGuidanceRoute?.routeName ||
										"Rute Alternatif Anda",
								},
								geometry: {
									type: "LineString" as const,
									coordinates: routeCoords,
								},
							},
						]
					: [],
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
				id: haloLayerId,
				type: "line",
				source: sourceId,
				layout: {
					"line-join": "round",
					"line-cap": "round",
				},
				paint: {
					"line-color": "rgba(255, 255, 255, 0.92)",
					"line-width": 10,
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
					"line-color": "#16A34A",
					"line-width": 5.5,
				},
			});
		}

		userMarkerRef.current?.remove();
		userMarkerRef.current = null;

		if (effectiveUserLocation) {
			const el = document.createElement("div");
			el.setAttribute("aria-label", "Lokasi Anda");
			el.style.cssText =
				"width:22px;height:22px;border-radius:9999px;background:#16A34A;border:3px solid #FFFFFF;box-shadow:0 0 0 6px rgba(22,163,74,0.28),0 4px 10px rgba(15,23,42,0.35);cursor:pointer;";
			el.title = "Lokasi Anda (Titik Awal Rute Alternatif)";
			userMarkerRef.current = new maplibregl.Marker({
				element: el,
				anchor: "center",
			})
				.setLngLat(effectiveUserLocation)
				.addTo(map);

			if (routeCoords.length >= 2) {
				const bounds = new maplibregl.LngLatBounds(
					effectiveUserLocation,
					effectiveUserLocation,
				);
				routeCoords.forEach((pt) => bounds.extend(pt));
				map.fitBounds(bounds, {
					padding: { top: 80, bottom: 90, left: 70, right: 70 },
					maxZoom: 15.2,
					duration: 750,
				});
			}
		}
	}, [
		effectiveUserLocation,
		effectiveGuidanceRoute,
		isMapLoaded,
		styleEpoch,
	]);

	function handleToggleOverview() {
		const map = mapRef.current;
		if (!map) return;
		if (isBaliOverview && village) {
			setIsBaliOverview(false);
			map.flyTo({
				center: village.mapCenter,
				zoom: village.mapZoom,
				duration: 1200,
			});
		} else {
			setIsBaliOverview(true);
			map.flyTo({
				center: BALI_ISLAND_CENTER,
				zoom: BALI_ISLAND_ZOOM,
				duration: 1400,
			});
		}
	}

	return (
		<div
			style={{
				width: "100%",
				height,
				minHeight: height === "100%" ? "100%" : minHeightValue,
				position: "relative",
				borderRadius:
					height === "100%" ? 0 : "var(--radius-element, 12px)",
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
						boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)",
					}}
				>
					<div
						style={{
							fontWeight: 600,
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

			{/* Controls top right (Basemap Mode Switcher + User Route + Bali Overview Toggle) - hidden in minimalControls mode */}
			{!minimalControls && (
				<div
					style={{
						position: "absolute",
						top: height === "100%" ? 84 : 14,
						right: 54,
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						justifyContent: "flex-end",
						gap: 6,
						zIndex: 6,
					}}
				>
					<div
						role="group"
						aria-label="Pilih tampilan peta dasar"
						style={{
							display: "inline-flex",
							alignItems: "center",
							background: "rgba(24, 27, 32, 0.88)",
							backdropFilter: "blur(8px)",
							padding: 2.5,
							borderRadius: 8,
							boxShadow: "0 2px 10px rgba(0,0,0,0.14)",
						}}
					>
						<button
							type="button"
							onClick={() => handleBasemapChange("satellite")}
							aria-pressed={effectiveBasemapStyle === "satellite"}
							style={{
								border: "none",
								borderRadius: 6,
								padding: "5px 10px",
								fontSize: 11.5,
								fontWeight: 600,
								cursor: "pointer",
								background:
									effectiveBasemapStyle === "satellite"
										? "#FFFFFF"
										: "transparent",
								color:
									effectiveBasemapStyle === "satellite"
										? "#18181B"
										: "#E2E8F0",
							}}
						>
							Satelit
						</button>
						<button
							type="button"
							onClick={() => handleBasemapChange("osm")}
							aria-pressed={effectiveBasemapStyle === "osm"}
							style={{
								border: "none",
								borderRadius: 6,
								padding: "5px 10px",
								fontSize: 11.5,
								fontWeight: 600,
								cursor: "pointer",
								background:
									effectiveBasemapStyle === "osm"
										? "#FFFFFF"
										: "transparent",
								color:
									effectiveBasemapStyle === "osm"
										? "#18181B"
										: "#E2E8F0",
							}}
						>
							Peta Jalan
						</button>
					</div>

					{controlledUserLocation === undefined && (
						<button
							type="button"
							onClick={handleStandaloneTrackLocation}
							aria-pressed={Boolean(effectiveUserLocation)}
							style={{
								background: effectiveUserLocation
									? "#16A34A"
									: "rgba(255, 255, 255, 0.95)",
								color: effectiveUserLocation ? "#FFFFFF" : "#18181B",
								border: "none",
								borderRadius: 8,
								padding: "6px 12px",
								fontFamily: "var(--font-family)",
								fontSize: 11.5,
								fontWeight: 600,
								cursor: "pointer",
								boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
								backdropFilter: "blur(8px)",
							}}
						>
							{isInternalLocating
								? "Mencari Lokasi..."
								: effectiveUserLocation
									? "Rute Anda Aktif"
									: "Lokasi Saya & Rute"}
						</button>
					)}

					<button
						type="button"
						onClick={handleToggleOverview}
						style={{
							background: isBaliOverview
								? "#18181B"
								: "rgba(255, 255, 255, 0.95)",
							color: isBaliOverview ? "#FFFFFF" : "#18181B",
							border: "none",
							borderRadius: 8,
							padding: "6px 12px",
							fontFamily: "var(--font-family)",
							fontSize: 11.5,
							fontWeight: 600,
							cursor: "pointer",
							boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
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
						border: "none",
						borderRadius: 10,
						padding: "7px 12px",
						boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
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
								background: "#5C8437",
								display: "inline-block",
							}}
						/>
						<span>Dibuka</span>
					</div>
					<div className="map-legend-item">
						<span
							aria-hidden="true"
							style={{
								display: "inline-block",
								width: 12,
								height: 4,
								background: "#78716C",
							}}
						/>{" "}
						Belum dikonfirmasi
					</div>
					<div className="map-legend-item">
						<span
							aria-hidden="true"
							style={{
								display: "inline-block",
								width: 12,
								height: 4,
								background: "#2563EB",
							}}
						/>{" "}
						Jalur alternatif
					</div>
					{effectiveUserLocation ? (
						<div className="map-legend-item">
							<span
								aria-hidden="true"
								style={{
									display: "inline-block",
									width: 12,
									height: 4,
									background: "#16A34A",
								}}
							/>{" "}
							Rute alternatif Anda
						</div>
					) : null}
					{village && village.isSimulation !== false ? (
						<div className="map-legend-item">Garis putus: simulasi</div>
					) : null}
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
						border: "none",
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
					<span>Memuat Peta Citra & Titik Lokasi Upacara...</span>
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
					<p role="alert">{mapError}</p>
					<button
						type="button"
						className="teduh-btn-secondary"
						onClick={() => {
							setMapError(null);
							setIsMapLoaded(false);
							fittedEventRef.current = null;
							setMapAttempt((attempt) => attempt + 1);
						}}
					>
						Coba lagi peta
					</button>
					<MapFallbackRoadList
						showMapUnavailableNotice
						segments={
							village?.roadSegments?.map((seg: VillageRoadRouteSegment) => {
								const rawImpact = (seg.impactType || "").toLowerCase();
								const mappedImpact: RoadSegmentFallbackItem["impactType"] =
									rawImpact.includes("intermittent") ||
									rawImpact.includes("buka_tutup")
										? "intermittent_flow"
										: rawImpact.includes("parking")
											? "parking_restriction"
											: rawImpact.includes("procession")
												? "procession_route"
												: "closure";

								return {
									id: seg.id,
									segmentName: seg.roadName,
									corridorArea:
										seg.corridorSection || village.desaAdatName,
									impactType: mappedImpact,
									plannedFrom: seg.plannedFrom ?? null,
									plannedTo: seg.plannedTo ?? null,
									observedAt: seg.observedAt || null,
									expiresAt: seg.expiresAt || null,
									diversionNote: seg.guidanceNote || null,
									isSimulation: village.isSimulation !== false,
									status: (seg.status === "closed"
										? "closed"
										: seg.status === "intermittent"
											? "intermittent"
											: seg.status === "open"
												? "open"
												: "unknown") as OperationalRoadStatus,
								};
							}) ?? []
						}
					/>
				</div>
			) : null}
		</div>
	);
}
