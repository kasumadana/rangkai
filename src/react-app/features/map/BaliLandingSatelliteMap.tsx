import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CeremonyDetailModal,
	type CeremonyDetailItem,
} from "../../components/rangkai";
import type {
	BaliDistrictProperties,
	DistrictCeremonySummary,
} from "../../lib/bali-districts";
import {
	BALI_ISLAND_CENTER,
	BALI_ISLAND_ZOOM,
	BALI_MAP_BOUNDS,
	BALI_MAP_MAX_ZOOM,
	BALI_MAP_MIN_ZOOM,
	type BaliVillageCeremonyProfile,
} from "../../lib/bali-villages";
import { buildDistrictFeaturesFromEvents } from "../../lib/events-api";
import type { OperationalRoadStatus } from "../../lib/road-status";

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

interface BaliLandingSatelliteMapProps {
	ceremonies?: BaliVillageCeremonyProfile[];
}

export function BaliLandingSatelliteMap({
	ceremonies = [],
}: BaliLandingSatelliteMapProps) {
	const mapContainerRef = useRef<HTMLDivElement | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const revealedMarkersRef = useRef<maplibregl.Marker[]>([]);
	const districtPillsRef = useRef<maplibregl.Marker[]>([]);
	const activePopupRef = useRef<maplibregl.Popup | null>(null);
	const selectedDistrictRef = useRef<BaliDistrictProperties | null>(null);
	const activeCeremonyIdRef = useRef<string | null>(null);

	const districtFeaturesData = useMemo(
		() => buildDistrictFeaturesFromEvents(ceremonies),
		[ceremonies],
	);
	const districtFeaturesRef = useRef(districtFeaturesData);
	useEffect(() => {
		districtFeaturesRef.current = districtFeaturesData;
	}, [districtFeaturesData]);

	const [activeBasemap] = useState<BasemapStyle>("satellite");
	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [mapError, setMapError] = useState<string | null>(null);
	const [selectedDistrict, setSelectedDistrict] =
		useState<BaliDistrictProperties | null>(null);
	const [activeCeremonyId, setActiveCeremonyId] = useState<string | null>(null);
	const [activeDetailCeremony, setActiveDetailCeremony] =
		useState<CeremonyDetailItem | null>(null);

	// Synchronize ref states to prevent stale closures in map zoom callbacks
	useEffect(() => {
		selectedDistrictRef.current = selectedDistrict;
	}, [selectedDistrict]);

	useEffect(() => {
		activeCeremonyIdRef.current = activeCeremonyId;
	}, [activeCeremonyId]);

	// Cooperative map activation state (prevents wheel scroll-trapping while scrolling page)
	const [isMapInteracting, setIsMapInteracting] = useState(false);

	const handleActivateMap = useCallback(() => {
		setIsMapInteracting(true);
		mapRef.current?.scrollZoom.enable();
	}, []);

	const handleDeactivateMap = useCallback(() => {
		setIsMapInteracting(false);
		mapRef.current?.scrollZoom.disable();
	}, []);

	// Click outside the map container to release focus and restore smooth page scroll
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
				handleDeactivateMap();
			}
		}

		if (isMapInteracting) {
			window.addEventListener("pointerdown", handleClickOutside);
			return () => window.removeEventListener("pointerdown", handleClickOutside);
		}
	}, [isMapInteracting, handleDeactivateMap]);

	// Open Compact Map Popup directly above the point
	const openCeremonyPopup = useCallback(
		(
			ceremony: DistrictCeremonySummary,
			district?: BaliDistrictProperties | null,
		) => {
			const map = mapRef.current;
			if (!map) return;

			if (activePopupRef.current) {
				activePopupRef.current.remove();
				activePopupRef.current = null;
			}

			const badge = getStatusBadgeConfig(ceremony.status);
			const isSim = ceremony.isSimulation !== false;
			const popupNode = document.createElement("div");
			popupNode.className = "map-popup-card";
			popupNode.innerHTML = `
				<div class="map-popup-header">
					<span class="map-popup-badge ${badge.className}">${badge.label}</span>
					${isSim ? '<span class="map-popup-badge simulation-token">SIMULASI</span>' : ''}
					<span class="map-popup-location">${ceremony.desaAdatName}</span>
				</div>
				<h4 class="map-popup-title">${ceremony.title}</h4>
				<div class="map-popup-meta-box">
					<div class="map-popup-meta-row">
						<span class="map-popup-meta-label">Jalur:</span>
						<span class="map-popup-meta-val">${ceremony.roadName || "Koridor Wilayah"}</span>
					</div>
					<div class="map-popup-meta-row">
						<span class="map-popup-meta-label">Waktu:</span>
						<span class="map-popup-meta-val">${ceremony.windowWita || "08:00 - Selesai"}</span>
					</div>
				</div>
				<button type="button" class="map-popup-btn" id="btn-compact-detail-${ceremony.id}">
					<span>Lihat Detail</span>
					<span aria-hidden="true">→</span>
				</button>
			`;

			const btn = popupNode.querySelector(`#btn-compact-detail-${ceremony.id}`);
			if (btn) {
				btn.addEventListener("click", () => {
					setActiveDetailCeremony({
						id: ceremony.id,
						title: ceremony.title,
						desaAdatName: ceremony.desaAdatName,
						kabupaten: district ? district.kabupaten : undefined,
						slug: ceremony.slug,
						status: ceremony.status,
						dateLabel: ceremony.dateLabel,
						windowWita: ceremony.windowWita,
						sacredCenterName: ceremony.sacredCenterName,
						roadName: ceremony.roadName,
						detourRoute: ceremony.detourRoute,
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
				closeButton: false, // Clean popup without colliding close button
				closeOnClick: false,
				maxWidth: "248px",
			})
				.setLngLat(ceremony.coordinates)
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

	// Select and focus on a district, revealing its ceremony points
	const handleSelectDistrict = useCallback(
		(district: BaliDistrictProperties, focusCoords?: [number, number]) => {
			setSelectedDistrict(district);
			selectedDistrictRef.current = district;
			const firstCeremony =
				district.ceremonies.length > 0 ? district.ceremonies[0] : null;
			const cId = firstCeremony ? firstCeremony.id : null;
			setActiveCeremonyId(cId);
			activeCeremonyIdRef.current = cId;

			// Hide overview district pills when district is selected
			districtPillsRef.current.forEach((m) => {
				m.getElement().style.display = "none";
			});

			const map = mapRef.current;
			if (!map) return;

			// If district has a ceremony, center directly on the first ceremony with optimal zoom and padding for popup
			if (firstCeremony) {
				map.flyTo({
					center: firstCeremony.coordinates,
					zoom: 13.5,
					padding: { top: 130, bottom: 40, left: 20, right: 20 },
					duration: 800,
					essential: true,
				});
				openCeremonyPopup(firstCeremony, district);
			} else {
				const targetCenter = focusCoords || district.center;
				map.flyTo({
					center: targetCenter,
					zoom: Math.max(map.getZoom(), 12.0),
					duration: 800,
					essential: true,
				});
				if (activePopupRef.current) {
					activePopupRef.current.remove();
					activePopupRef.current = null;
				}
			}
		},
		[openCeremonyPopup],
	);

	// Reset district selection and return to whole island view
	const handleResetSelection = useCallback(() => {
		setSelectedDistrict(null);
		selectedDistrictRef.current = null;
		setActiveCeremonyId(null);
		activeCeremonyIdRef.current = null;

		if (activePopupRef.current) {
			activePopupRef.current.remove();
			activePopupRef.current = null;
		}

		// Clear revealed ceremony pins and restore district pills
		revealedMarkersRef.current.forEach((m) => m.remove());
		revealedMarkersRef.current = [];
		districtPillsRef.current.forEach((m) => {
			m.getElement().style.display = "inline-flex";
		});

		const map = mapRef.current;
		if (!map) return;

		map.flyTo({
			center: BALI_ISLAND_CENTER,
			zoom: BALI_ISLAND_ZOOM,
			duration: 750,
			essential: true,
		});
	}, []);

	// Setup MapLibre layers for District Boundaries
	const attachDistrictLayers = useCallback(
		(mapInstance: maplibregl.Map) => {
			if (!mapInstance.getSource("bali-districts")) {
				mapInstance.addSource("bali-districts", {
					type: "geojson",
					data: districtFeaturesRef.current,
				});
			}

			// Clean translucent fill layer for regional areas
			if (!mapInstance.getLayer("bali-districts-fill")) {
				mapInstance.addLayer({
					id: "bali-districts-fill",
					type: "fill",
					source: "bali-districts",
					paint: {
						"fill-color": ["get", "fillColor"],
						"fill-opacity": 0.35,
					},
				});
			}

			// Selected district outer white halo line
			if (!mapInstance.getLayer("bali-districts-selected-halo")) {
				mapInstance.addLayer({
					id: "bali-districts-selected-halo",
					type: "line",
					source: "bali-districts",
					paint: {
						"line-color": "#FFFFFF",
						"line-width": 5.5,
						"line-opacity": 0,
					},
				});
			}

			// Distinct boundary lines between districts with their individual colors
			if (!mapInstance.getLayer("bali-districts-line")) {
				mapInstance.addLayer({
					id: "bali-districts-line",
					type: "line",
					source: "bali-districts",
					paint: {
						"line-color": ["get", "borderColor"],
						"line-width": 2.0,
						"line-opacity": 0.75,
					},
				});
			}

			// Click handler on district area polygon
			mapInstance.on("click", "bali-districts-fill", (e) => {
				if (!e.features || e.features.length === 0) return;
				const featId = e.features[0].properties?.id;
				const found = districtFeaturesRef.current.features.find(
					(f: { properties: BaliDistrictProperties }) =>
						f.properties.id === featId,
				);
				if (found) {
					handleSelectDistrict(found.properties, [e.lngLat.lng, e.lngLat.lat]);
				}
			});

			mapInstance.on("mouseenter", "bali-districts-fill", () => {
				mapInstance.getCanvas().style.cursor = "pointer";
			});

			mapInstance.on("mouseleave", "bali-districts-fill", () => {
				mapInstance.getCanvas().style.cursor = "";
			});

			// General click handler: if user clicks anywhere on map background, find closest district
			mapInstance.on("click", (e) => {
				const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
					[e.point.x - 4, e.point.y - 4],
					[e.point.x + 4, e.point.y + 4],
				];
				const hitFeatures = mapInstance.queryRenderedFeatures(bbox, {
					layers: ["bali-districts-fill"],
				});

				if (hitFeatures.length === 0) {
					// User clicked outside polygon: find nearest district center
					const clickCoord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
					let nearestDist = Infinity;
					let nearestDistrict: BaliDistrictProperties | null = null;

					for (const feat of districtFeaturesRef.current.features) {
						const dist = calculateDistance(clickCoord, feat.properties.center);
						if (dist < nearestDist) {
							nearestDist = dist;
							nearestDistrict = feat.properties;
						}
					}

					// If within reasonable distance in Bali (~35km), select it
					if (nearestDistrict && nearestDist <= 35) {
						handleSelectDistrict(nearestDistrict, clickCoord);
					}
				}
			});
		},
		[handleSelectDistrict],
	);

	// Update district polygon layer high-contrast highlighting whenever selectedDistrict changes
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		if (selectedDistrict) {
			// High contrast: selected district is bold & vibrant; unselected districts dim to subtle background
			map.setPaintProperty("bali-districts-fill", "fill-opacity", [
				"case",
				["==", ["get", "id"], selectedDistrict.id],
				0.52,
				0.08,
			]);
			map.setPaintProperty("bali-districts-line", "line-width", [
				"case",
				["==", ["get", "id"], selectedDistrict.id],
				3.5,
				1.2,
			]);
			map.setPaintProperty("bali-districts-line", "line-opacity", [
				"case",
				["==", ["get", "id"], selectedDistrict.id],
				1.0,
				0.25,
			]);
			if (map.getLayer("bali-districts-selected-halo")) {
				map.setPaintProperty("bali-districts-selected-halo", "line-opacity", [
					"case",
					["==", ["get", "id"], selectedDistrict.id],
					0.9,
					0.0,
				]);
			}
		} else {
			// Normal balanced overview across Bali
			map.setPaintProperty("bali-districts-fill", "fill-opacity", 0.35);
			map.setPaintProperty("bali-districts-line", "line-width", 2.0);
			map.setPaintProperty("bali-districts-line", "line-opacity", 0.75);
			if (map.getLayer("bali-districts-selected-halo")) {
				map.setPaintProperty("bali-districts-selected-halo", "line-opacity", 0);
			}
		}
	}, [isMapLoaded, selectedDistrict]);

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

			// Prevent scroll-trap: disable wheel scrollZoom by default until map is explicitly activated
			mapInstance.scrollZoom.disable();

			mapInstance.addControl(
				new maplibregl.NavigationControl({ showCompass: true }),
				"top-right",
			);

			mapInstance.addControl(
				new maplibregl.AttributionControl({
					compact: true,
					customAttribution: "OpenStreetMap & Esri • Rangkai Bali",
				}),
				"bottom-right",
			);

			mapInstance.on("load", () => {
				if (!mapInstance) return;
				attachDistrictLayers(mapInstance);
				setIsMapLoaded(true);
				setMapError(null);
				mapInstance.resize();
			});

			// Auto-toggle visibility between overview district pills and detailed ceremony pins based on zoom
			mapInstance.on("zoom", () => {
				if (!mapInstance) return;
				const zoom = mapInstance.getZoom();
				const isZoomedOut = zoom < 11.2;

				if (isZoomedOut) {
					if (activePopupRef.current) {
						activePopupRef.current.remove();
						activePopupRef.current = null;
					}
					revealedMarkersRef.current.forEach((m) => {
						m.getElement().style.display = "none";
					});
					districtPillsRef.current.forEach((m) => {
						m.getElement().style.display = "inline-flex";
					});
				} else {
					if (selectedDistrictRef.current) {
						districtPillsRef.current.forEach((m) => {
							m.getElement().style.display = "none";
						});
						revealedMarkersRef.current.forEach((m) => {
							m.getElement().style.display = "block";
						});
					}
				}
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
			districtPillsRef.current.forEach((m) => m.remove());
			districtPillsRef.current = [];
			revealedMarkersRef.current.forEach((m) => m.remove());
			revealedMarkersRef.current = [];
			mapInstance?.remove();
			mapRef.current = null;
		};
	}, [activeBasemap, attachDistrictLayers]);

	// Mount overview District Ceremony Count Pills
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const src = map.getSource("bali-districts") as maplibregl.GeoJSONSource | undefined;
		if (src) {
			src.setData(districtFeaturesData);
		}

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
					handleSelectDistrict(dist);
				});

				if (selectedDistrict && map.getZoom() >= 11.2) {
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
	}, [isMapLoaded, districtFeaturesData, selectedDistrict, handleSelectDistrict]);

	// Dynamically reveal ceremony points on map ONLY when a district is selected (Teduh Teardrop Pins)
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		// Clear existing revealed markers
		revealedMarkersRef.current.forEach((m) => m.remove());
		revealedMarkersRef.current = [];

		// If no district is selected, map remains completely clean with NO dots/markers
		if (!selectedDistrict) return;

		// Reveal specific ceremony points for the selected district using Teduh teardrop location pins
		if (selectedDistrict.ceremonies && selectedDistrict.ceremonies.length > 0) {
			const pinColor = selectedDistrict.borderColor;
			const isZoomedOut = map.getZoom() < 11.2;

			selectedDistrict.ceremonies.forEach((c: DistrictCeremonySummary) => {
				const el = document.createElement("div");
				el.className = `standard-location-pin ${activeCeremonyId === c.id ? "is-active" : ""}`;
				if (isZoomedOut) {
					el.style.display = "none";
				}
				el.innerHTML = `
					<div class="pin-inner">
						<div class="pin-pulse-halo" style="background: ${pinColor}40;"></div>
						<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M16 2C9.37258 2 4 7.37258 4 14C4 24.5 16 39 16 39C16 39 28 24.5 28 14C28 7.37258 22.6274 2 16 2Z" fill="${pinColor}" stroke="#FFFFFF" stroke-width="1.8"/>
							<circle cx="16" cy="14" r="5.5" fill="#FFFFFF"/>
						</svg>
					</div>
					<div class="marker-hover-label">${c.desaAdatName}</div>
				`;

				el.addEventListener("click", (evt) => {
					evt.stopPropagation();
					setActiveCeremonyId(c.id);
					openCeremonyPopup(c, selectedDistrict);
					map.flyTo({
						center: c.coordinates,
						zoom: 13.5,
						padding: { top: 130, bottom: 40, left: 20, right: 20 },
						duration: 600,
						essential: true,
					});
				});

				const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
					.setLngLat(c.coordinates)
					.addTo(map);

				revealedMarkersRef.current.push(marker);
			});
		}
	}, [isMapLoaded, selectedDistrict, activeCeremonyId, openCeremonyPopup]);

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
				style={{
					position: "absolute",
					inset: 0,
					width: "100%",
					height: "100%",
				}}
			/>

			{/* Non-intrusive Interaction State Pill */}
			{!isMapInteracting ? (
				<div className="map-scroll-hint-pill">
					<span>Klik peta untuk mengaktifkan zoom & jelajah</span>
				</div>
			) : (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						handleDeactivateMap();
					}}
					className="map-scroll-active-pill"
					title="Klik untuk menonaktifkan zoom peta dan melanjutkan scroll halaman"
				>
					<span>✓ Mode Interaksi Aktif • Lepas Fokus</span>
				</button>
			)}

			{/* Reset island view button if a district is currently selected */}
			{selectedDistrict && (
				<button
					type="button"
					onClick={handleResetSelection}
					style={{
						position: "absolute",
						bottom: 24,
						right: 24,
						zIndex: 5,
						background: "rgba(255, 255, 255, 0.95)",
						backdropFilter: "blur(8px)",
						border: "1px solid rgba(228, 231, 229, 0.9)",
						borderRadius: 9999,
						padding: "8px 16px",
						fontSize: 12,
						fontWeight: 500,
						color: "#181B20",
						cursor: "pointer",
						boxShadow: "0 4px 14px rgba(0, 0, 0, 0.08)",
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
						border: "1px solid rgba(255, 255, 255, 0.14)",
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
					<span>Memuat Garis Wilayah & Perbatasan Kawasan Bali...</span>
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
						alignItems: "center",
						justifyContent: "center",
						padding: 24,
						textAlign: "center",
						zIndex: 10,
						color: "#181B20",
					}}
				>
					<div
						style={{
							fontWeight: 600,
							fontSize: 14,
							color: "#181B20",
							marginBottom: 6,
						}}
					>
						Peta Wilayah Belum Dapat Ditampilkan
					</div>
					<div
						style={{
							fontSize: 12.5,
							color: "#71717A",
							maxWidth: 360,
							lineHeight: 1.6,
						}}
					>
						{mapError}
					</div>
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
