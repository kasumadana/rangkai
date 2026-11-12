import { useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	Clock,
	LocateFixed,
	RotateCcw,
	Search,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
	CeremonyDetailModal,
	RoadStatusBadge,
	type CeremonyDetailItem,
} from "../../components/rangkai";
import { PublicHeader } from "../../components/ui/PublicHeader";
import type { BaliDistrictProperties } from "../../lib/bali-districts";
import type {
	BaliVillageCeremonyProfile,
	VillageRoadRouteSegment,
} from "../../lib/bali-villages";
import {
	buildDistrictFeaturesFromEvents,
	fetchPublicAlternativeRoutes,
	fetchPublicEventRoads,
	fetchPublicEvents,
	fetchPublicRoadImpacts,
	mapPublicEventToCeremonyProfile,
	roadImpactFeatureToRecord,
	type RoadImpactRecord,
} from "../../lib/events-api";
import {
	calculateUserBypassRoute,
	haversineDistanceMeters,
	type UserGuidanceRoute,
} from "../../lib/routing-engine";
import { useGsapPageReveal } from "../../lib/gsap-motion";
import { BaliMapTilerView } from "./BaliMapTilerView";
import { GpsControls } from "./GpsControls";
import { useGpsTracking } from "./useGpsTracking";

export function TeduhSpatialMapConsole() {
	const [searchParams, setSearchParams] = useSearchParams();
	const mapViewportRef = useRef<HTMLDivElement>(null);
	const gps = useGpsTracking();
	const [spatialGuidanceRouteSnapshot, setSpatialGuidanceRouteSnapshot] =
		useState<{
			route: UserGuidanceRoute;
			profile: BaliVillageCeremonyProfile;
			alternatives: unknown;
		} | null>(null);
	const [spatialGuidanceStatus, setSpatialGuidanceStatus] =
		useState<string | null>(null);

	useGsapPageReveal(mapViewportRef, []);

	// 1. Fetch live published/active events from backend
	const { data: publicEventsData } = useQuery({
		queryKey: ["public", "events", { limit: 50 }],
		queryFn: () => fetchPublicEvents({ limit: 50 }),
		staleTime: 60_000,
	});

	const liveEvents = useMemo(
		() => publicEventsData?.events ?? [],
		[publicEventsData],
	);

	// Check if a ceremony was requested via URL (?village=slug or ?event=slug)
	const requestedParam =
		searchParams.get("village") || searchParams.get("event") || "";

	const [selectedEventKey, setSelectedEventKey] = useState<string>(
		requestedParam,
	);
	const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
	const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(
		Boolean(requestedParam),
	);
	const [selectedRegionName, setSelectedRegionName] = useState<string | null>(
		null,
	);
	const [activeDetailCeremony, setActiveDetailCeremony] =
		useState<CeremonyDetailItem | null>(null);

	// Search dropdown state
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
	const searchDropdownRef = useRef<HTMLDivElement>(null);

	// Guide panel dismissed state — defaults to false so it shows on initial visit; dismisses completely on X click
	const [isGuideDismissed, setIsGuideDismissed] = useState<boolean>(false);

	// Sync URL param changes
	const [prevRequestedParam, setPrevRequestedParam] = useState(requestedParam);
	if (prevRequestedParam !== requestedParam) {
		setPrevRequestedParam(requestedParam);
		if (requestedParam) {
			setSelectedEventKey(requestedParam);
			setIsDrawerOpen(true);
		}
	}

	// Resolve currently active backend event
	const activeBackendEvent = useMemo(() => {
		if (liveEvents.length === 0) return null;
		if (selectedEventKey) {
			const match = liveEvents.find(
				(e) =>
					e.id === selectedEventKey ||
					e.slug === selectedEventKey ||
					e.publicSlug === selectedEventKey,
			);
			if (match) return match;
		}
		return liveEvents[0];
	}, [liveEvents, selectedEventKey]);

	const activeSlug = activeBackendEvent?.slug || activeBackendEvent?.id || "";

	// 2. Fetch verified PostGIS road segments for the active event
	const { data: activeRoadsData, isLoading: isRoadsLoading } = useQuery({
		queryKey: ["public", "event-roads", activeSlug],
		queryFn: () => fetchPublicEventRoads(activeSlug),
		enabled: Boolean(activeSlug),
		staleTime: 30_000,
		refetchInterval: 30_000,
	});

	// 2b. Aggregate verified public road impacts across all events for spatial background lines (SPEC-11: limit 300)
	const {
		data: allRoadImpactsData,
		isError: isAllRoadsError,
	} = useQuery({
		queryKey: ["public", "road-impacts", { limit: 300 }],
		queryFn: () => fetchPublicRoadImpacts({ limit: 300 }),
		staleTime: 30_000,
		refetchInterval: 30_000,
	});

	// 2c. Fetch public alternative routes for the active event (SPEC-08)
	const { data: altRoutesData } = useQuery({
		queryKey: ["public", "events", activeSlug, "alternative-routes"],
		queryFn: () => fetchPublicAlternativeRoutes(activeSlug),
		enabled: Boolean(activeSlug),
		staleTime: 30_000,
	});

	const activeEventRoads = useMemo(
		() => activeRoadsData?.roads ?? activeRoadsData?.roadImpacts ?? [],
		[activeRoadsData],
	);

	const allImpactsByEvent = useMemo(() => {
		const map = new Map<string, RoadImpactRecord[]>();
		if (!allRoadImpactsData?.features) return map;
		for (const feat of allRoadImpactsData.features) {
			const rec = roadImpactFeatureToRecord(feat);
			const eId = feat.properties.eventId;
			const eSlug = feat.properties.eventSlug;
			if (eId) {
				const list = map.get(eId) ?? [];
				list.push(rec);
				map.set(eId, list);
			}
			if (eSlug && eSlug !== eId) {
				const list = map.get(eSlug) ?? [];
				list.push(rec);
				map.set(eSlug, list);
			}
		}
		return map;
	}, [allRoadImpactsData]);

	// Map all live backend events into spatial profiles for the map
	const allCeremonyProfiles = useMemo(() => {
		return liveEvents.map((evt, idx) => {
			const isCurrent =
				activeBackendEvent &&
				(evt.id === activeBackendEvent.id || evt.slug === activeBackendEvent.slug);
			const roads = isCurrent
				? (activeEventRoads.length > 0
						? activeEventRoads
						: (allImpactsByEvent.get(evt.id) ?? (evt.slug ? allImpactsByEvent.get(evt.slug) : undefined) ?? []))
				: (allImpactsByEvent.get(evt.id) ?? (evt.slug ? allImpactsByEvent.get(evt.slug) : undefined) ?? []);
			return mapPublicEventToCeremonyProfile(
				isCurrent ? { ...evt, alternativeRoutes: altRoutesData?.alternativeRoutes ?? [] } : evt,
				roads,
				idx,
			);
		});
	}, [liveEvents, activeBackendEvent, activeEventRoads, allImpactsByEvent, altRoutesData]);

	const activeVillage = useMemo<BaliVillageCeremonyProfile | null>(() => {
		if (allCeremonyProfiles.length === 0) return null;
		if (selectedEventKey) {
			const found = allCeremonyProfiles.find(
				(p) => p.id === selectedEventKey || p.slug === selectedEventKey,
			);
			if (found) return found;
		}
		return allCeremonyProfiles[0];
	}, [allCeremonyProfiles, selectedEventKey]);

	const setSpatialGuidanceRoute = useCallback(
		(
			route: UserGuidanceRoute | null,
			profile: BaliVillageCeremonyProfile | null = activeVillage,
		) => {
			setSpatialGuidanceRouteSnapshot(
				route && profile
					? { route, profile, alternatives: altRoutesData }
					: null,
			);
		},
		[activeVillage, altRoutesData],
	);
	const spatialGuidanceRoute =
		gps.active &&
		gps.position?.coordinates &&
		gps.position.accuracy <= 50 &&
		activeVillage &&
		spatialGuidanceRouteSnapshot?.profile === activeVillage &&
		spatialGuidanceRouteSnapshot.alternatives === altRoutesData
			? spatialGuidanceRouteSnapshot.route
			: null;
	const visibleSpatialGuidanceStatus = !gps.active
		? null
		: !gps.position?.coordinates
			? "Menunggu lokasi GPS..."
			: !activeVillage
				? "Pilih kegiatan untuk menyusun rute pengalihan."
				: gps.position.accuracy > 50
					? "Menunggu lokasi yang lebih akurat untuk menyusun rute."
					: spatialGuidanceStatus;

	// Compute dynamic district features strictly from backend events
	const districtFeaturesData = useMemo(
		() => buildDistrictFeaturesFromEvents(allCeremonyProfiles),
		[allCeremonyProfiles],
	);

	// Autocomplete search results grouped by category
	const searchResults = useMemo(() => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return null;

		const matchingDistricts = districtFeaturesData.features
			.filter(
				(f) =>
					f.properties.name.toLowerCase().includes(q) ||
					f.properties.kabupaten.toLowerCase().includes(q),
			)
			.slice(0, 4);

		const matchingCeremonies = allCeremonyProfiles
			.filter(
				(v) =>
					v.ceremonyTitle.toLowerCase().includes(q) ||
					v.desaAdatName.toLowerCase().includes(q) ||
					v.kabupaten.toLowerCase().includes(q) ||
					v.kecamatan.toLowerCase().includes(q),
			)
			.slice(0, 4);

		const matchingRoads: Array<{
			village: BaliVillageCeremonyProfile;
			road: VillageRoadRouteSegment;
		}> = [];
		for (const v of allCeremonyProfiles) {
			for (const r of v.roadSegments) {
				if (
					r.roadName.toLowerCase().includes(q) ||
					r.guidanceNote.toLowerCase().includes(q)
				) {
					matchingRoads.push({ village: v, road: r });
					if (matchingRoads.length >= 4) break;
				}
			}
			if (matchingRoads.length >= 4) break;
		}

		return {
			districts: matchingDistricts,
			ceremonies: matchingCeremonies,
			roads: matchingRoads,
		};
	}, [searchQuery, districtFeaturesData, allCeremonyProfiles]);

	// Close search dropdown on click outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			const target = event.target as Node;
			const insideDesktop =
				searchDropdownRef.current &&
				searchDropdownRef.current.contains(target);
			if (!insideDesktop) {
				setIsSearchDropdownOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Handle selection of a district or territory
	function handleSelectDistrict(
		districtName: string,
		district?: BaliDistrictProperties,
	) {
		setSelectedRegionName(districtName);

		const q = districtName.toLowerCase().replace("kecamatan ", "");
		if (
			activeVillage &&
			(activeVillage.kecamatan.toLowerCase().includes(q) ||
				activeVillage.kabupaten.toLowerCase().includes(q))
		) {
			return;
		}

		const matched = allCeremonyProfiles.find(
			(v) =>
				(district &&
					v.kabupaten
						.toLowerCase()
						.includes(district.kabupaten.toLowerCase())) ||
				v.kecamatan.toLowerCase().includes(q) ||
				q.includes(v.kecamatan.toLowerCase()),
		);
		if (matched) {
			setSelectedEventKey(matched.slug || matched.id);
			if (matched.roadSegments[0]) {
				setSelectedSegmentId(matched.roadSegments[0].id);
			}
		}
	}

	const lastCalcPosRef = useRef<[number, number] | null>(null);
	const lastCalcTimeRef = useRef<number>(0);
	const guidanceRequestIdRef = useRef(0);
	const lastGuidanceProfileRef = useRef(activeVillage);
	const lastGuidanceAlternativesRef = useRef(altRoutesData);

	const handleCalculateDrawerRoute = useCallback(async (
		targetVillage?: BaliVillageCeremonyProfile | null,
	) => {
		const v = targetVillage ?? activeVillage;
		if (!v || !gps.position?.coordinates) {
			setSpatialGuidanceStatus("Menunggu lokasi GPS dan kegiatan yang dipilih.");
			return;
		}
		if (gps.position.accuracy > 50) {
			guidanceRequestIdRef.current += 1;
			setSpatialGuidanceRoute(null);
			setSpatialGuidanceStatus("Menunggu lokasi yang lebih akurat untuk menyusun rute.");
			return;
		}
		const requestId = ++guidanceRequestIdRef.current;
		setSpatialGuidanceRoute(null);
		setSpatialGuidanceStatus("Menyusun rute melalui jalur alternatif yang disetujui...");
		try {
			const route = await calculateUserBypassRoute({
				userLocation: gps.position.coordinates,
				ceremony: v,
				alternativeRoutes: altRoutesData?.alternativeRoutes ?? [],
			});
			if (requestId !== guidanceRequestIdRef.current) return;
			setSpatialGuidanceRoute(route, v);
			setSpatialGuidanceStatus(
				route
					? `Panduan melalui ${route.viaRouteName || route.routeName} siap${route.isSimulation ? " (SIMULASI)" : ""}.`
					: "Rute aman belum dapat dipastikan dari data jalur yang tersedia; garis rute tidak ditampilkan.",
			);
		} catch {
			if (requestId !== guidanceRequestIdRef.current) return;
			setSpatialGuidanceRoute(null);
			setSpatialGuidanceStatus("Rute belum dapat dihitung. Jalur rute tidak ditampilkan.");
		}
	}, [activeVillage, gps.position, altRoutesData, setSpatialGuidanceRoute]);

	useEffect(() => {
		const routingInputsChanged =
			lastGuidanceProfileRef.current !== activeVillage ||
			lastGuidanceAlternativesRef.current !== altRoutesData;
		if (routingInputsChanged) {
			lastGuidanceProfileRef.current = activeVillage;
			lastGuidanceAlternativesRef.current = altRoutesData;
			guidanceRequestIdRef.current += 1;
			lastCalcPosRef.current = null;
			lastCalcTimeRef.current = 0;
		}
		if (!gps.active) {
			guidanceRequestIdRef.current += 1;
			lastCalcPosRef.current = null;
			return;
		}
		if (!gps.position?.coordinates) {
			guidanceRequestIdRef.current += 1;
			return;
		}
		if (!activeVillage) {
			guidanceRequestIdRef.current += 1;
			return;
		}

		if (gps.position.accuracy > 50) {
			guidanceRequestIdRef.current += 1;
			return;
		}

		const now = Date.now();
		const coords = gps.position.coordinates;
		const lastPos = lastCalcPosRef.current;
		const lastTime = lastCalcTimeRef.current;

		if (lastPos) {
			const movedMeters = haversineDistanceMeters(lastPos, coords);
			const elapsedSec = (now - lastTime) / 1000;
			if (movedMeters < 30 || elapsedSec < 15) {
				return;
			}
		}

		lastCalcPosRef.current = coords;
		lastCalcTimeRef.current = now;
		// GPS changes start an asynchronous routing request and publish its result.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void handleCalculateDrawerRoute(activeVillage);
	}, [gps.active, gps.position, activeVillage, altRoutesData, handleCalculateDrawerRoute]);

	// Handle selection of a specific ceremony
	function handleSelectCeremony(
		v: BaliVillageCeremonyProfile,
		openDrawer = false,
	) {
		const key = v.slug || v.id;
		setSelectedEventKey(key);
		setSelectedRegionName(v.kecamatan || v.kabupaten);
		if (v.roadSegments[0]) {
			setSelectedSegmentId(v.roadSegments[0].id);
		}
		setSearchParams({ village: key });
		if (openDrawer) {
			setIsDrawerOpen(true);
		}
		// Reset previous route so old calculation never flashes on a new ceremony
		setSpatialGuidanceRoute(null);
		lastCalcPosRef.current = null;
		if (gps.active && gps.position?.coordinates && gps.position.accuracy <= 50) {
			void handleCalculateDrawerRoute(v);
		}
	}

	const searchDropdownNode =
		isSearchDropdownOpen && searchResults ? (
			<div className="map-search-dropdown">
				{/* Category 1: Kecamatan / Kawasan */}
				{searchResults.districts.length > 0 && (
					<div>
						<div
							style={{
								padding: "8px 18px 4px",
								fontSize: 11,
								fontWeight: 600,
								color: "#64748B",
							}}
						>
							Wilayah Kecamatan
						</div>
						{searchResults.districts.map((d) => (
							<button
								type="button"
								key={d.id}
								className="map-search-item"
								onClick={() => {
									handleSelectDistrict(d.properties.name, d.properties);
									setIsSearchDropdownOpen(false);
								}}
							>
								<div>
									<div
										style={{
											fontSize: 14,
											fontWeight: 500,
											color: "#181B20",
										}}
									>
										{d.properties.name}
									</div>
									<div style={{ fontSize: 12, color: "#545B67" }}>
										{d.properties.kabupaten}
									</div>
								</div>
								<span
									style={{
										fontSize: 11,
										fontWeight: 500,
										color: "#4D702F",
										background: "#EBF0E6",
										padding: "2px 8px",
										borderRadius: 9999,
									}}
								>
									{d.properties.ceremonyCount} Acara
								</span>
							</button>
						))}
					</div>
				)}

				{/* Category 2: Upacara Adat */}
				{searchResults.ceremonies.length > 0 && (
					<div
						style={{
							marginTop: 4,
							paddingTop: 4,
							borderTop: "1px solid #F1F2F4",
						}}
					>
						<div
							style={{
								padding: "8px 18px 4px",
								fontSize: 11,
								fontWeight: 600,
								color: "#64748B",
							}}
						>
							Upacara Terpublikasi
						</div>
						{searchResults.ceremonies.map((c) => (
							<button
								type="button"
								key={c.id}
								className="map-search-item"
								onClick={() => {
									handleSelectCeremony(c, true);
									setIsSearchDropdownOpen(false);
								}}
							>
								<div>
									<div className="flex flex-wrap items-center gap-1">
										<span className="text-sm font-medium text-stone-900">{c.ceremonyTitle}</span>
										{c.isSimulation !== false ? (
											<span className="map-popup-badge simulation-token">SIMULASI</span>
										) : null}
									</div>
									<div className="text-xs text-stone-600 mt-0.5">
										{c.desaAdatName} • {c.kabupaten}
									</div>
								</div>
								<RoadStatusBadge status={c.primaryStatus} />
							</button>
						))}
					</div>
				)}

				{/* Category 3: Ruas Jalan */}
				{searchResults.roads.length > 0 && (
					<div
						style={{
							marginTop: 4,
							paddingTop: 4,
							borderTop: "1px solid #F1F2F4",
						}}
					>
						<div
							style={{
								padding: "8px 18px 4px",
								fontSize: 11,
								fontWeight: 600,
								color: "#64748B",
							}}
						>
							Ruas Jalan Terdampak
						</div>
						{searchResults.roads.map((r) => (
							<button
								type="button"
								key={r.road.id}
								className="map-search-item"
								onClick={() => {
									handleSelectCeremony(r.village, true);
									setSelectedSegmentId(r.road.id);
									setIsSearchDropdownOpen(false);
								}}
							>
								<div>
									<div
										style={{
											fontSize: 14,
											fontWeight: 500,
											color: "#181B20",
										}}
									>
										{r.road.roadName}
									</div>
									<div style={{ fontSize: 12, color: "#545B67" }}>
										Pengalihan: {r.road.guidanceNote}
									</div>
								</div>
								<RoadStatusBadge status={r.road.status} />
							</button>
						))}
					</div>
				)}

				{searchResults.districts.length === 0 &&
					searchResults.ceremonies.length === 0 &&
					searchResults.roads.length === 0 && (
						<div
							style={{
								padding: "20px 18px",
								textAlign: "center",
								fontSize: 13,
								color: "#64748B",
							}}
						>
							Tidak ditemukan hasil untuk "{searchQuery}". Coba ketik nama
							kecamatan atau kabupaten di Bali.
						</div>
					)}
			</div>
		) : null;

	return (
		<div
			ref={mapViewportRef}
			className={`map-viewport ${isDrawerOpen ? "has-drawer-open" : ""}`}
		>
			<PublicHeader map />
            <div className="map-search-control" ref={searchDropdownRef}>
                <label htmlFor="map-search">Cari lokasi atau kegiatan</label>
                <div className="map-search-control-input"><Search size={16} aria-hidden="true" /><input id="map-search" type="search" value={searchQuery} placeholder="Cari kecamatan, desa, atau acara" onChange={e => { setSearchQuery(e.target.value); setIsSearchDropdownOpen(true); }} onFocus={() => setIsSearchDropdownOpen(true)} />{searchQuery && <button type="button" onClick={() => { setSearchQuery(""); setIsSearchDropdownOpen(false); }} aria-label="Bersihkan pencarian"><X size={16} /></button>}</div>
                {searchDropdownNode}
            </div>

			{/* 3. GUIDED 3-STEP EXPLORATION PANEL (Dismisses completely when X is clicked) */}
			{!isGuideDismissed && (
				<div
					className="map-onboarding"
					role="region"
					aria-label="Panduan Eksplorasi Peta"
					data-gsap="reveal"
				>
					<div style={{ flex: 1 }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: 8,
							}}
						>
							<span
								style={{
									fontSize: 14,
									fontWeight: 600,
									color: "#181B20",
								}}
							>
								Panduan Peta Titik Upacara Bali
							</span>
							<button
								type="button"
								onClick={() => setIsGuideDismissed(true)}
								style={{
									background: "none",
									border: "none",
									cursor: "pointer",
									color: "#64748B",
									padding: 4,
									display: "flex",
								}}
								aria-label="Tutup panduan"
							>
								<X size={15} />
							</button>
						</div>

						<ol
							style={{
								margin: 0,
								paddingLeft: 18,
								fontSize: 12.5,
								color: "#545B67",
								lineHeight: 1.6,
								display: "flex",
								flexDirection: "column",
								gap: 4,
							}}
						>
							<li>
								<strong>Pilih Titik Upacara</strong> dengan klik pin lokasi di peta atau gunakan kotak pencarian daerah.
							</li>
							<li>
								<strong>Tinjau Kartu Ringkas</strong> untuk melihat status penutupan jalan dan jadwal WITA.
							</li>
							<li>
								<strong>Klik Lihat Detail</strong> untuk membuka rincian ruas jalan terdampak & jalur alternatif.
							</li>
						</ol>
					</div>
				</div>
			)}

			{/* 4. FLOATING CONTROLS: GPS LOCATE BUTTON & RESET OVERVIEW */}
			<div className="map-floating-controls">
				{(selectedRegionName || isDrawerOpen) && (
					<button
						type="button"
						className="map-reset-btn"
						onClick={() => {
							setSelectedRegionName(null);
							setIsDrawerOpen(false);
							setSearchParams({});
						}}
						title="Tampilkan Seluruh Wilayah Bali"
						aria-label="Tampilkan Seluruh Wilayah Bali"
					>
						<RotateCcw size={18} />
					</button>
				)}
			</div>
			<GpsControls gps={gps} fullMap />

			{/* 5. BOTTOM STATUSBAR PILL */}
			<div className="map-statusbar">
				<div className="map-status-pill tabular-nums">
					<span>WITA (UTC+8)</span>
					{allRoadImpactsData?.pagination?.truncated ? (
						<>
							<span>•</span>
							<span style={{ color: "#D97706" }}>
								Menampilkan {allRoadImpactsData.features.length} dari {allRoadImpactsData.pagination.total} ruas jalan
							</span>
						</>
					) : null}
					{isAllRoadsError ? (
						<>
							<span>•</span>
							<span style={{ color: "#EF4444" }}>
								Sebagian ruas jalan belum dapat dimuat
							</span>
						</>
					) : null}
				</div>
				{visibleSpatialGuidanceStatus ? (
					<div className="map-routing-status" role="status" aria-live="polite">
						{visibleSpatialGuidanceStatus}
						<small>Koordinat GPS dikirim ke layanan OSRM saat rute dihitung.</small>
					</div>
				) : null}
			</div>

			{/* 6. FULLSCREEN MAPLIBRE CANVAS */}
			<div className="map-canvas-full">
				<BaliMapTilerView
					village={activeVillage}
					allVillages={allCeremonyProfiles}
					alternativeRoutes={altRoutesData?.alternativeRoutes ?? []}
					showAlternativeRoutes={!gps.active}
					selectedRegionName={selectedRegionName}
					onSelectRegion={(regName, district) => {
						handleSelectDistrict(regName, district);
					}}
					onSelectVillage={(v) => {
						const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
						// On desktop: directly open right-side detail popup panel!
						// On mobile: keep popup above pin; clicking "Lihat Detail" opens bottom sheet.
						handleSelectCeremony(v, !isMobile);
					}}
					selectedSegmentId={selectedSegmentId}
					onSelectSegment={(segId) => setSelectedSegmentId(segId)}
					showAllVillagesMarkers={true}
					userLocation={gps.position?.coordinates ?? null}
					userGuidanceRoute={spatialGuidanceRoute}
					onOpenCeremonyDetail={(c) => {
						// Step 2: Clicking "Lihat Detail" on the popup opens the full bottom-up content sheet
						const found = allCeremonyProfiles.find(
							(v) => v.id === c.id || v.slug === c.slug,
						);
						if (found) {
							handleSelectCeremony(found, true);
						} else {
							setActiveDetailCeremony(c);
						}
					}}
					minimalControls={true}
					cooperativeGestures={false}
					height="100%"
				/>
			</div>

			{/* 7. BOTTOM-UP FULL CONTENT SHEET (No "Kembali ke Wilayah" button, clean X to close) */}
			{isDrawerOpen && (
				<div
					className="spatial-drawer-backdrop"
					onClick={() => setIsDrawerOpen(false)}
					aria-hidden="true"
				/>
			)}
			<aside
				className={`spatial-drawer ${isDrawerOpen ? "is-open" : ""}`}
				aria-label="Rincian Upacara & Ruas Jalan Terdampak"
			>
				<div className="drawer-mobile-grabber" aria-hidden="true" />
				{activeVillage ? (
					<>
						<div className="drawer-header">
							<div style={{ flex: 1, minWidth: 0 }}>
								<div className="mb-1.5">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="drawer-location-tag">
											{activeVillage.desaAdatName.replace(/\s*\([Ss]imulasi\)/g, "").trim()} • {activeVillage.kabupaten}
										</span>
										{activeVillage.isSimulation !== false ? (
											<span className="map-popup-badge simulation-token">SIMULASI</span>
										) : null}
									</div>
								</div>
								<h3 className="drawer-title">
									{activeVillage.ceremonyTitle.replace(/^\[SIMULATED\]\s*/i, "").trim()}
								</h3>
							</div>

							<button
								type="button"
								className="drawer-close-btn"
								onClick={() => setIsDrawerOpen(false)}
								title="Tutup Panel"
								aria-label="Tutup Panel"
							>
								<X size={20} />
							</button>
						</div>

						<div className="drawer-body">
							{/* 1. Ceremony Info Card */}
							<div className="drawer-info-card">
								<div className="drawer-info-row" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
									<div className="drawer-info-item">
										<span className="drawer-info-label">Pusat Upacara</span>
										<span className="drawer-info-value">{activeVillage.sacredCenterName}</span>
									</div>
									<div className="drawer-info-item">
										<span className="drawer-info-label">Jadwal Pelaksanaan</span>
										<div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
											<Clock size={15} color="#4D702F" />
											<span className="drawer-info-value tabular-nums">
												{activeVillage.scheduleDateLabel} • {activeVillage.scheduleWindowWita}
											</span>
										</div>
									</div>
								</div>

								{activeVillage.overview && (
									<div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #ECEEEF" }}>
										<span className="drawer-info-label">Arahan Pelaksanaan</span>
										<p style={{ margin: "4px 0 0", fontSize: 13.5, color: "#545B67", lineHeight: 1.65 }}>
											{activeVillage.overview}
										</p>
									</div>
								)}
							</div>

							{gps.active && gps.position && gps.position.accuracy > 50 && (
								<div
									role="status"
									style={{
										background: "#FEF3C7",
										border: "1px solid #F59E0B",
										borderRadius: 4,
										padding: "10px 14px",
										fontSize: 13,
										color: "#92400E",
										fontWeight: 500,
									}}
								>
									Menunggu lokasi lebih akurat (±{Math.round(gps.position.accuracy)}m)
								</div>
							)}

							{spatialGuidanceRoute && (
								<div
									style={{
										background: "#EFF6FF",
										border: "1px solid #93C5FD",
										borderRadius: 4,
										padding: "12px 16px",
										display: "flex",
										flexDirection: "column",
										gap: 4,
									}}
								>
									<span style={{ fontSize: 13, fontWeight: 600, color: "#1D4ED8" }}>
										Panduan Jalur Alternatif
									</span>
									<span style={{ fontSize: 13.5, color: "#1E293B", lineHeight: 1.4 }}>
										Lewat: <strong>{spatialGuidanceRoute.viaRouteName || spatialGuidanceRoute.routeName}</strong>
										{spatialGuidanceRoute.distanceMeters > 0
											? ` (${(spatialGuidanceRoute.distanceMeters / 1000).toFixed(1)} km, ~${Math.max(1, Math.round(spatialGuidanceRoute.durationSeconds / 60))} mnt)`
											: ""}
									</span>
								</div>
							)}

							{/* 2. Verified Road Segments Section */}
							<div className="drawer-roads-section">
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: 12,
									}}
								>
									<span style={{ fontSize: 14, fontWeight: 600, color: "#181B20" }}>
										Ruas Jalan Terdampak Terverifikasi ({activeVillage.roadSegments.length})
									</span>
								</div>

								{isRoadsLoading ? (
									<div className="drawer-empty-box">
										Memuat daftar ruas jalan terverifikasi...
									</div>
								) : activeVillage.roadSegments.length > 0 ? (
									<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
										{activeVillage.roadSegments.map((seg, idx) => {
											const isSelected = seg.id === selectedSegmentId;
											return (
												<button
													type="button"
													key={seg.id}
													onClick={() => setSelectedSegmentId(seg.id)}
													className={`drawer-road-item ${isSelected ? "is-selected" : ""}`}
												>
													<div
														style={{
															display: "flex",
															justifyContent: "space-between",
															alignItems: "center",
															marginBottom: 8,
															gap: 8,
														}}
													>
														<span
															style={{
																fontSize: 14.5,
																fontWeight: 600,
																color: "#181B20",
															}}
														>
															{idx + 1}. {seg.roadName.replace(/^\[SIMULATED\]\s*/i, "").trim()}
														</span>
														<RoadStatusBadge status={seg.status} />
													</div>

													<div
														style={{
															fontSize: 13.5,
															color: "#545B67",
															lineHeight: 1.5,
															marginBottom: 6,
														}}
													>
														Arahan Pengalihan:{" "}
														<strong style={{ color: "#181B20" }}>
															{seg.guidanceNote}
														</strong>
													</div>

													<div style={{ fontSize: 12, color: "#64748B", display: "flex", gap: 10, flexWrap: "wrap" }}>
														<span>{seg.corridorSection}</span>
														<span>•</span>
														<span className="tabular-nums">{seg.windowWita}</span>
													</div>
												</button>
											);
										})}
									</div>
								) : (
									<div className="drawer-empty-box">
										Belum ada segmen jalan spesifik yang ditandai tertutup pada
										acara ini.{" "}
										{activeVillage.alternativeRouteSummary
											? activeVillage.alternativeRouteSummary
											: ""}
									</div>
								)}
							</div>
						</div>

						<div className="drawer-footer">
							<button
								type="button"
								onClick={() => {
									if (gps.active) {
						guidanceRequestIdRef.current += 1;
										gps.stop();
										setSpatialGuidanceRoute(null);
									} else {
										gps.start();
									}
								}}
								className={`drawer-btn-secondary ${gps.active ? "is-tracking" : ""}`}
								style={{
									borderColor: gps.active ? "#B91C1C" : "#4D702F",
									color: gps.active ? "#B91C1C" : "#4D702F",
									fontWeight: 600,
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
								}}
							>
								<LocateFixed size={16} />
								<span>{gps.active ? "Hentikan tracking" : "Track lokasi"}</span>
							</button>

							<Link
								to={`/events/${activeVillage.slug || activeVillage.id}`}
								className="drawer-btn-primary"
							>
								<span>Buka Halaman Detail</span>
								<ArrowRight size={15} />
							</Link>
						</div>
					</>
				) : null}
			</aside>

			<CeremonyDetailModal
				ceremony={activeDetailCeremony}
				onClose={() => setActiveDetailCeremony(null)}
			/>
		</div>
	);
}
