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

	const [activeBasemap] = useState<BasemapStyle>("satellite");
	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [mapError, setMapError] = useState<string | null>(null);
	const [activeCeremonyId, setActiveCeremonyId] = useState<string | null>(null);
	const [activeDetailCeremony, setActiveDetailCeremony] =
		useState<CeremonyDetailItem | null>(null);

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
			if (!map || !ceremony.venueLocation) return;

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

			const popupNode = document.createElement("div");
			popupNode.className = "map-popup-card";
			popupNode.innerHTML = `
				<div class="map-popup-header">
					<span class="map-popup-badge ${badge.className}">${badge.label}</span>
					${isSim ? '<span class="map-popup-badge simulation-token">SIMULASI</span>' : ""}
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
			if (location) location.textContent = ceremony.desaAdatName;
			if (title) title.textContent = ceremony.ceremonyTitle;
			if (values[0]) values[0].textContent = firstRoadName;
			if (values[1])
				values[1].textContent =
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
				closeButton: false,
				closeOnClick: false,
				maxWidth: "248px",
			})
				.setLngLat(ceremony.venueLocation)
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

	// Attach only road segment corridor layers (no district polygon shapes)
	const attachRoadLayers = useCallback((mapInstance: maplibregl.Map) => {
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
			ceremonyMarkersRef.current.forEach((m) => m.remove());
			ceremonyMarkersRef.current = [];
			mapInstance?.remove();
			mapRef.current = null;
		};
	}, [activeBasemap, attachRoadLayers]);

	// Sync road segment data & ceremony location pins across Bali at all zoom levels
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !isMapLoaded) return;

		const roadSource = map.getSource("landing-ceremony-roads") as
			| maplibregl.GeoJSONSource
			| undefined;
		if (roadSource) {
			roadSource.setData(roadGeoJson);
		}

		ceremonyMarkersRef.current.forEach((m) => m.remove());
		ceremonyMarkersRef.current = [];

		for (const ceremony of ceremonies) {
			if (
				!Array.isArray(ceremony.venueLocation) ||
				ceremony.venueLocation.length !== 2 ||
				!Number.isFinite(ceremony.venueLocation[0]) ||
				!Number.isFinite(ceremony.venueLocation[1])
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
				if (ceremony.venueLocation) {
					map.flyTo({
						center: ceremony.venueLocation,
						zoom: Math.max(map.getZoom(), 13.8),
						padding: { top: 130, bottom: 40, left: 20, right: 20 },
						duration: 650,
						essential: true,
					});
				}
			});

			const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
				.setLngLat(ceremony.venueLocation)
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
					<span>Klik peta untuk mengaktifkan zoom & pilih titik upacara</span>
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
