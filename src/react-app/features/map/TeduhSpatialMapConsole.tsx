import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	ArrowRight,
	Calendar,
	Clock,
	Compass,
	Locate,
	LogOut,
	MapPin,
	Search,
	ShieldCheck,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
	CeremonyDetailModal,
	RoadStatusBadge,
	type CeremonyDetailItem,
} from "../../components/rangkai";
import { useAuthSession, useSignOutMutation } from "../../lib/auth";
import type { BaliDistrictProperties } from "../../lib/bali-districts";
import type {
	BaliVillageCeremonyProfile,
	VillageRoadRouteSegment,
} from "../../lib/bali-villages";
import {
	buildDistrictFeaturesFromEvents,
	fetchPublicEventRoads,
	fetchPublicEvents,
	mapPublicEventToCeremonyProfile,
} from "../../lib/events-api";
import { BaliMapTilerView } from "./BaliMapTilerView";

export function TeduhSpatialMapConsole() {
	const [searchParams, setSearchParams] = useSearchParams();

	const { data: sessionData } = useAuthSession();
	const signOutMutation = useSignOutMutation();

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
	const [drawerStage, setDrawerStage] = useState<"stage1" | "stage2">(
		requestedParam ? "stage2" : "stage1",
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

	// Guide panel collapse state
	const [isGuideMinimized, setIsGuideMinimized] = useState(false);

	// Live coordinates status pill
	const [cursorCoords, setCursorCoords] = useState<string>(
		"8.4095° S, 115.1889° E",
	);

	// Sync URL param changes
	const [prevRequestedParam, setPrevRequestedParam] = useState(requestedParam);
	if (prevRequestedParam !== requestedParam) {
		setPrevRequestedParam(requestedParam);
		if (requestedParam) {
			setSelectedEventKey(requestedParam);
			setIsDrawerOpen(true);
			setDrawerStage("stage2");
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
	});

	const activeEventRoads = useMemo(
		() => activeRoadsData?.roads ?? activeRoadsData?.roadImpacts ?? [],
		[activeRoadsData],
	);

	// Map all live backend events into spatial profiles for the map
	const allCeremonyProfiles = useMemo(() => {
		return liveEvents.map((evt, idx) => {
			const isCurrent =
				activeBackendEvent &&
				(evt.id === activeBackendEvent.id || evt.slug === activeBackendEvent.slug);
			return mapPublicEventToCeremonyProfile(
				evt,
				isCurrent ? activeEventRoads : [],
				idx,
			);
		});
	}, [liveEvents, activeBackendEvent, activeEventRoads]);

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

	// Compute dynamic district features strictly from backend events
	const districtFeaturesData = useMemo(
		() => buildDistrictFeaturesFromEvents(allCeremonyProfiles),
		[allCeremonyProfiles],
	);

	// Filtered ceremonies for current selected region
	const regionCeremonies = useMemo(() => {
		if (!selectedRegionName) return allCeremonyProfiles;
		const q = selectedRegionName.toLowerCase().replace("kecamatan ", "");
		return allCeremonyProfiles.filter(
			(v) =>
				v.kabupaten.toLowerCase().includes(q) ||
				v.kecamatan.toLowerCase().includes(q) ||
				q.includes(v.kabupaten.toLowerCase()) ||
				q.includes(v.kecamatan.toLowerCase()) ||
				v.desaAdatName.toLowerCase().includes(q),
		);
	}, [selectedRegionName, allCeremonyProfiles]);

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
			if (
				searchDropdownRef.current &&
				!searchDropdownRef.current.contains(event.target as Node)
			) {
				setIsSearchDropdownOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Handle selection of a district or territory (does NOT overwrite an already-selected ceremony inside that district)
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
			setDrawerStage("stage2");
			setIsDrawerOpen(true);
		}
	}

	// Road status statistics for Stage 1 distribution bar
	const roadStatusCounts = useMemo(() => {
		const list =
			regionCeremonies.length > 0 ? regionCeremonies : allCeremonyProfiles;
		let closed = 0;
		let intermittent = 0;
		let open = 0;
		let unknown = 0;

		for (const v of list) {
			if (v.roadSegments.length > 0) {
				for (const r of v.roadSegments) {
					if (r.status === "closed") closed++;
					else if (r.status === "intermittent") intermittent++;
					else if (r.status === "open") open++;
					else unknown++;
				}
			} else {
				if (v.primaryStatus === "closed") closed++;
				else if (v.primaryStatus === "intermittent") intermittent++;
				else if (v.primaryStatus === "open") open++;
				else unknown++;
			}
		}

		const total = closed + intermittent + open + unknown;
		const denom = total || 1;
		return {
			closed,
			intermittent,
			open,
			unknown,
			total,
			closedPct: Math.round((closed / denom) * 100),
			intermittentPct: Math.round((intermittent / denom) * 100),
			openPct: Math.round((open / denom) * 100),
			unknownPct: Math.round((unknown / denom) * 100),
		};
	}, [regionCeremonies, allCeremonyProfiles]);

	return (
		<div className="map-viewport">
			{/* 1. DESKTOP FLOATING SPLIT TOPBAR */}
			<header className="map-desktop-topbar" aria-label="Bilah Navigasi Peta">
				{/* Left Capsule: Logo + Search Bar + Instant Dropdown */}
				<div className="map-desktop-topbar-left" ref={searchDropdownRef}>
					<Link to="/" className="navbar-brand">
						<img
							src="/logo.png"
							alt="Rangkai Logo"
							className="navbar-brand-logo"
						/>
						<span className="navbar-brand-text">Rangkai</span>
					</Link>

					<div className="map-topbar-divider" />

					<div className="map-search-input-wrap">
						<Search size={15} color="#64748B" />
						<input
							type="text"
							className="map-search-input"
							placeholder="Cari kecamatan, desa, atau acara..."
							value={searchQuery}
							onChange={(e) => {
								setSearchQuery(e.target.value);
								setIsSearchDropdownOpen(true);
							}}
							onFocus={() => setIsSearchDropdownOpen(true)}
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => {
									setSearchQuery("");
									setIsSearchDropdownOpen(false);
								}}
								style={{
									background: "none",
									border: "none",
									cursor: "pointer",
									color: "#64748B",
									padding: 2,
								}}
								aria-label="Bersihkan pencarian"
							>
								<X size={15} />
							</button>
						)}
					</div>

					{/* Live Dropdown Results */}
					{isSearchDropdownOpen && searchResults && (
						<div className="map-search-dropdown">
							{/* Category 1: Kecamatan / Kawasan */}
							{searchResults.districts.length > 0 && (
								<div>
									<div
										style={{
											padding: "8px 18px 4px",
											fontSize: 11,
											fontWeight: 500,
											color: "#64748B",
											textTransform: "uppercase",
											letterSpacing: "0.05em",
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
												setDrawerStage("stage1");
												setIsDrawerOpen(true);
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
													color: "#264D3B",
													background: "#ECF3EF",
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
											fontWeight: 500,
											color: "#64748B",
											textTransform: "uppercase",
											letterSpacing: "0.05em",
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
												<div
													style={{
														fontSize: 14,
														fontWeight: 500,
														color: "#181B20",
													}}
												>
													{c.ceremonyTitle}
												</div>
												<div style={{ fontSize: 12, color: "#545B67" }}>
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
											fontWeight: 500,
											color: "#64748B",
											textTransform: "uppercase",
											letterSpacing: "0.05em",
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
					)}
				</div>

				{/* Right Capsule: 3 Clean Nav Links + Officer Auth */}
				<div className="map-desktop-topbar-right">
					<nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
						<Link to="/" className="map-nav-link">
							Beranda
						</Link>
						<Link to="/peta" className="map-nav-link is-active">
							Peta Kawasan
						</Link>
						<Link to="/events" className="map-nav-link">
							Jadwal Upacara
						</Link>
					</nav>

					<div className="map-topbar-divider" />

					{sessionData?.user ? (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								paddingLeft: 4,
							}}
						>
							<Link
								to="/dashboard"
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									fontSize: 13,
									fontWeight: 500,
									color: "#264D3B",
									textDecoration: "none",
								}}
							>
								<span>Panel Petugas</span>
							</Link>
							<button
								type="button"
								onClick={() => signOutMutation.mutate()}
								title="Keluar Akun"
								style={{
									background: "none",
									border: "none",
									cursor: "pointer",
									color: "#64748B",
									display: "flex",
								}}
							>
								<LogOut size={16} />
							</button>
						</div>
					) : (
						<Link
							to="/login"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								padding: "7px 14px",
								borderRadius: 9999,
								background: "#9E2A2B",
								color: "#FFFFFF",
								fontSize: 12.5,
								fontWeight: 500,
								textDecoration: "none",
							}}
						>
							<ShieldCheck size={14} />
							<span>Akses Petugas</span>
						</Link>
					)}
				</div>
			</header>

			{/* 2. MOBILE TOP SEARCH CAPSULE (< 860px) */}
			<div className="map-mobile-search-capsule">
				<Search size={16} color="#64748B" />
				<input
					type="text"
					placeholder="Cari kecamatan, desa, atau acara..."
					value={searchQuery}
					onChange={(e) => {
						setSearchQuery(e.target.value);
						setIsSearchDropdownOpen(true);
					}}
					onFocus={() => setIsSearchDropdownOpen(true)}
					style={{
						flex: 1,
						border: "none",
						outline: "none",
						background: "transparent",
						fontSize: 13.5,
						color: "#181B20",
					}}
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={() => {
							setSearchQuery("");
							setIsSearchDropdownOpen(false);
						}}
						style={{ background: "none", border: "none", color: "#64748B" }}
					>
						<X size={16} />
					</button>
				)}
			</div>

			{/* 3. MOBILE BOTTOM DOCK (< 860px) */}
			<div className="map-mobile-bottom-dock">
				<Link
					to="/"
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: 44,
						minWidth: 56,
						gap: 2,
						textDecoration: "none",
						color: "#545B67",
						fontSize: 11,
					}}
				>
					<Compass size={18} />
					<span>Beranda</span>
				</Link>
				<Link
					to="/peta"
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: 44,
						minWidth: 56,
						gap: 2,
						textDecoration: "none",
						color: "#264D3B",
						fontSize: 11,
						fontWeight: 500,
					}}
				>
					<MapPin size={18} />
					<span>Peta</span>
				</Link>
				<Link
					to="/events"
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: 44,
						minWidth: 56,
						gap: 2,
						textDecoration: "none",
						color: "#545B67",
						fontSize: 11,
					}}
				>
					<Calendar size={18} />
					<span>Jadwal</span>
				</Link>
				<Link
					to="/login"
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: 44,
						minWidth: 56,
						gap: 2,
						textDecoration: "none",
						color: "#545B67",
						fontSize: 11,
					}}
				>
					<ShieldCheck size={18} />
					<span>Petugas</span>
				</Link>
			</div>

			{/* 4. GUIDED 3-STEP EXPLORATION PANEL (TOP-LEFT BELOW SEARCH) */}
			{!isGuideMinimized ? (
				<div className="map-onboarding" role="region" aria-label="Panduan Eksplorasi Peta">
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
									fontWeight: 500,
									color: "#181B20",
								}}
							>
								Panduan Peta Kawasan Bali
							</span>
							<button
								type="button"
								onClick={() => setIsGuideMinimized(true)}
								style={{
									background: "none",
									border: "none",
									cursor: "pointer",
									color: "#64748B",
									padding: 4,
									display: "flex",
								}}
								aria-label="Sembunyikan panduan"
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
								<strong>Pilih Wilayah</strong> dengan klik area berwarna di peta atau gunakan kotak pencarian.
							</li>
							<li>
								<strong>Klik Titik Upacara</strong> untuk melihat kartu ringkas lokasi dan jam kegiatan.
							</li>
							<li>
								<strong>Klik Lihat Detail</strong> untuk membuka daftar ruas jalan terdampak di panel kanan.
							</li>
						</ol>
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setIsGuideMinimized(false)}
					className="map-guide-reopen-btn"
				>
					<span>Panduan & Daftar Cepat ({allCeremonyProfiles.length})</span>
				</button>
			)}

			{/* 5. FLOATING CONTROLS: GPS LOCATE BUTTON & RESET OVERVIEW */}
			<div className="map-floating-controls">
				{(selectedRegionName || isDrawerOpen) && (
					<button
						type="button"
						onClick={() => {
							setSelectedRegionName(null);
							setIsDrawerOpen(false);
							setSearchParams({});
						}}
						style={{
							background: "rgba(255, 255, 255, 0.96)",
							border: "none",
							borderRadius: 9999,
							padding: "9px 16px",
							fontSize: 12.5,
							fontWeight: 500,
							color: "#181B20",
							cursor: "pointer",
							boxShadow: "0 4px 14px rgba(0, 0, 0, 0.1)",
							display: "flex",
							alignItems: "center",
							gap: 6,
							whiteSpace: "nowrap",
						}}
						title="Tampilkan Seluruh Wilayah Bali"
					>
						<span>↺ Seluruh Bali</span>
					</button>
				)}
				<button
					type="button"
					className="map-gps-btn"
					onClick={() => {
						if (navigator.geolocation) {
							navigator.geolocation.getCurrentPosition(
								(pos) => {
									setCursorCoords(
										`${pos.coords.latitude.toFixed(4)}° S, ${pos.coords.longitude.toFixed(4)}° E`,
									);
								},
								() => {
									setCursorCoords("8.4095° S, 115.1889° E");
								},
							);
						}
					}}
					title="Pusatkan ke Lokasi Saya"
					aria-label="Pusatkan Peta ke Lokasi Saya"
				>
					<Locate size={20} />
				</button>
			</div>

			{/* 6. BOTTOM STATUSBAR PILL */}
			<div className="map-statusbar">
				<div className="map-status-pill tabular-nums">
					<span>{cursorCoords}</span>
					<span>•</span>
					<span>WITA (UTC+8)</span>
				</div>
			</div>

			{/* 7. FULLSCREEN MAPLIBRE CANVAS */}
			<div className="map-canvas-full">
				<BaliMapTilerView
					village={activeVillage}
					allVillages={allCeremonyProfiles}
					selectedRegionName={selectedRegionName}
					onSelectRegion={(regName, district) => {
						handleSelectDistrict(regName, district);
					}}
					onSelectVillage={(v) => {
						// Step 2: Pin click focuses the ceremony and shows compact popup above pin
						handleSelectCeremony(v, false);
					}}
					selectedSegmentId={selectedSegmentId}
					onSelectSegment={(segId) => setSelectedSegmentId(segId)}
					showAllVillagesMarkers={true}
					onOpenCeremonyDetail={(c) => {
						// Step 3: Clicking "Lihat Detail" on the popup opens the synchronized side panel
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
					height="100%"
				/>
			</div>

			{/* 8. SYNCHRONIZED SLIDING SPATIAL DRAWER (BELOW TOPBAR, PURE BACKEND DATA) */}
			<aside
				className={`spatial-drawer ${isDrawerOpen ? "is-open" : ""}`}
				aria-label="Panel Rincian Wilayah & Upacara"
			>
				<div className="drawer-header">
					<div style={{ flex: 1 }}>
						{drawerStage === "stage2" ? (
							<button
								type="button"
								onClick={() => setDrawerStage("stage1")}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									background: "none",
									border: "none",
									padding: 0,
									color: "#264D3B",
									fontSize: 13,
									fontWeight: 500,
									cursor: "pointer",
									marginBottom: 4,
								}}
							>
								<ArrowLeft size={14} />
								<span>Kembali ke Daftar Wilayah</span>
							</button>
						) : null}

						<h3
							style={{
								fontSize: 20,
								fontWeight: 400,
								color: "#181B20",
								margin: 0,
								lineHeight: 1.3,
							}}
						>
							{drawerStage === "stage2" && activeVillage
								? activeVillage.ceremonyTitle
								: selectedRegionName
									? `Kawasan ${selectedRegionName}`
									: "Ringkasan Wilayah Bali"}
						</h3>
					</div>

					<button
						type="button"
						className="drawer-close-btn"
						onClick={() => setIsDrawerOpen(false)}
						title="Tutup Panel"
						aria-label="Tutup Panel"
					>
						<X size={18} />
					</button>
				</div>

				<div className="drawer-body">
					{drawerStage === "stage1" || !activeVillage ? (
						/* ================= STAGE 1: REGIONAL SUMMARY ================= */
						<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
							<div
								style={{
									background: "#FFFFFF",
									borderRadius: 16,
									padding: "18px 20px",
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: 12,
									}}
								>
									<span
										style={{
											fontSize: 14,
											fontWeight: 500,
											color: "#181B20",
										}}
									>
										Komposisi Status Jalur
									</span>
									<span
										style={{
											fontSize: 12,
											color: "#64748B",
											fontVariantNumeric: "tabular-nums",
										}}
									>
										{roadStatusCounts.total} Titik Terpantau
									</span>
								</div>

								<div
									style={{
										height: 8,
										borderRadius: 9999,
										overflow: "hidden",
										display: "flex",
										background: "#E2E4E8",
										marginBottom: 14,
									}}
								>
									<div
										style={{
											width: `${roadStatusCounts.closedPct}%`,
											background: "#B91C1C",
										}}
										title={`Ditutup: ${roadStatusCounts.closed}`}
									/>
									<div
										style={{
											width: `${roadStatusCounts.intermittentPct}%`,
											background: "#D97706",
										}}
										title={`Buka-Tutup: ${roadStatusCounts.intermittent}`}
									/>
									<div
										style={{
											width: `${roadStatusCounts.openPct}%`,
											background: "#15803D",
										}}
										title={`Lancar: ${roadStatusCounts.open}`}
									/>
									<div
										style={{
											width: `${roadStatusCounts.unknownPct}%`,
											background: "#64748B",
										}}
										title={`Belum Dikonfirmasi: ${roadStatusCounts.unknown}`}
									/>
								</div>

								<div
									style={{
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										gap: 8,
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											fontSize: 12.5,
											color: "#181B20",
										}}
									>
										<span
											style={{
												width: 8,
												height: 8,
												borderRadius: 2,
												background: "#B91C1C",
											}}
										/>
										<span>
											Ditutup: <strong>{roadStatusCounts.closed}</strong>
										</span>
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											fontSize: 12.5,
											color: "#181B20",
										}}
									>
										<span
											style={{
												width: 8,
												height: 8,
												borderRadius: 2,
												background: "#D97706",
											}}
										/>
										<span>
											Buka-Tutup:{" "}
											<strong>{roadStatusCounts.intermittent}</strong>
										</span>
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											fontSize: 12.5,
											color: "#181B20",
										}}
									>
										<span
											style={{
												width: 8,
												height: 8,
												borderRadius: 2,
												background: "#15803D",
											}}
										/>
										<span>
											Lancar: <strong>{roadStatusCounts.open}</strong>
										</span>
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											fontSize: 12.5,
											color: "#181B20",
										}}
									>
										<span
											style={{
												width: 8,
												height: 8,
												borderRadius: 2,
												background: "#64748B",
											}}
										/>
										<span>
											Belum Konf.: <strong>{roadStatusCounts.unknown}</strong>
										</span>
									</div>
								</div>
							</div>

							<div>
								<div
									style={{
										fontSize: 13,
										fontWeight: 500,
										color: "#545B67",
										marginBottom: 10,
									}}
								>
									Daftar Upacara di Wilayah Ini ({regionCeremonies.length})
								</div>

								{regionCeremonies.length > 0 ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: 10,
										}}
									>
										{regionCeremonies.map((c) => (
											<button
												type="button"
												key={c.id}
												onClick={() => handleSelectCeremony(c, true)}
												style={{
													background: "#FFFFFF",
													border: "none",
													borderRadius: 14,
													padding: "16px 18px",
													cursor: "pointer",
													textAlign: "left",
													width: "100%",
												}}
											>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														alignItems: "center",
														marginBottom: 6,
													}}
												>
													<span
														style={{
															fontSize: 12,
															fontWeight: 500,
															color: "#264D3B",
														}}
													>
														{c.desaAdatName}
													</span>
													<RoadStatusBadge status={c.primaryStatus} />
												</div>

												<div
													style={{
														fontSize: 15,
														fontWeight: 500,
														color: "#181B20",
														marginBottom: 6,
													}}
												>
													{c.ceremonyTitle}
												</div>

												<div
													style={{
														fontSize: 12.5,
														color: "#545B67",
													}}
												>
													{c.scheduleDateLabel} • {c.sacredCenterName}
												</div>
											</button>
										))}
									</div>
								) : (
									<div
										style={{
											background: "#FFFFFF",
											borderRadius: 14,
											padding: "24px 20px",
											textAlign: "center",
											color: "#545B67",
										}}
									>
										<p style={{ margin: 0, fontSize: 14 }}>
											Belum ada upacara adat terpublikasi di kawasan ini.
										</p>
									</div>
								)}
							</div>
						</div>
					) : (
						/* ================= STAGE 2: CEREMONY & VERIFIED ROADS DETAIL ================= */
						<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
							{/* Ceremony Header Card */}
							<div
								style={{
									background: "#FFFFFF",
									borderRadius: 16,
									padding: "18px 20px",
								}}
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
											fontSize: 12.5,
											fontWeight: 500,
											color: "#264D3B",
										}}
									>
										{activeVillage.desaAdatName} • {activeVillage.kabupaten}
									</span>
									<RoadStatusBadge status={activeVillage.primaryStatus} />
								</div>

								<div
									style={{
										fontSize: 13.5,
										color: "#545B67",
										marginBottom: 12,
									}}
								>
									Lokasi Utama:{" "}
									<strong style={{ color: "#181B20" }}>
										{activeVillage.sacredCenterName}
									</strong>
								</div>

								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 8,
										background: "#F4F4F3",
										padding: "9px 14px",
										borderRadius: 10,
										fontSize: 13,
										color: "#181B20",
										fontVariantNumeric: "tabular-nums",
									}}
								>
									<Clock size={15} color="#264D3B" />
									<span>
										{activeVillage.scheduleDateLabel} •{" "}
										{activeVillage.scheduleWindowWita}
									</span>
								</div>

								{activeVillage.overview && (
									<p
										style={{
											margin: "12px 0 0 0",
											fontSize: 13.5,
											color: "#545B67",
											lineHeight: 1.55,
										}}
									>
										{activeVillage.overview}
									</p>
								)}
							</div>

							{/* Verified Road Segments from Backend */}
							<div>
								<div
									style={{
										fontSize: 13,
										fontWeight: 500,
										color: "#545B67",
										marginBottom: 10,
									}}
								>
									Ruas Jalan Terdampak Terverifikasi (
									{activeVillage.roadSegments.length})
								</div>

								{isRoadsLoading ? (
									<div
										style={{
											background: "#FFFFFF",
											borderRadius: 14,
											padding: "20px",
											fontSize: 13.5,
											color: "#545B67",
										}}
									>
										Memuat daftar ruas jalan terverifikasi...
									</div>
								) : activeVillage.roadSegments.length > 0 ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: 10,
										}}
									>
										{activeVillage.roadSegments.map((seg, idx) => {
											const isSelected = seg.id === selectedSegmentId;
											return (
												<button
													type="button"
													key={seg.id}
													onClick={() => setSelectedSegmentId(seg.id)}
													style={{
														background: isSelected ? "#ECF3EF" : "#FFFFFF",
														border: "none",
														borderRadius: 14,
														padding: "14px 16px",
														cursor: "pointer",
														textAlign: "left",
														width: "100%",
													}}
												>
													<div
														style={{
															display: "flex",
															justifyContent: "space-between",
															alignItems: "center",
															marginBottom: 6,
															gap: 8,
														}}
													>
														<span
															style={{
																fontSize: 14,
																fontWeight: 500,
																color: "#181B20",
															}}
														>
															{idx + 1}. {seg.roadName}
														</span>
														<RoadStatusBadge status={seg.status} />
													</div>

													<div
														style={{
															fontSize: 13,
															color: "#545B67",
															marginBottom: 4,
														}}
													>
														Arahan Jalur:{" "}
														<strong style={{ color: "#181B20" }}>
															{seg.guidanceNote}
														</strong>
													</div>

													<div style={{ fontSize: 12, color: "#64748B" }}>
														{seg.corridorSection} • {seg.windowWita}
													</div>
												</button>
											);
										})}
									</div>
								) : (
									<div
										style={{
											background: "#FFFFFF",
											borderRadius: 14,
											padding: "20px 18px",
											fontSize: 13.5,
											color: "#545B67",
											lineHeight: 1.5,
										}}
									>
										Belum ada segmen jalan spesifik yang ditandai tertutup pada
										acara ini.{" "}
										{activeVillage.alternativeRouteSummary
											? activeVillage.alternativeRouteSummary
											: ""}
									</div>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Drawer Footer */}
				<div className="drawer-footer">
					<button
						type="button"
						onClick={() => {
							if (drawerStage === "stage2") {
								setDrawerStage("stage1");
							} else {
								setIsDrawerOpen(false);
							}
						}}
						style={{
							background: "#F4F4F3",
							border: "none",
							borderRadius: 9999,
							padding: "9px 16px",
							fontSize: 13,
							fontWeight: 500,
							color: "#181B20",
							cursor: "pointer",
						}}
					>
						{drawerStage === "stage2" ? "Ringkasan Wilayah" : "Tutup Panel"}
					</button>

					{activeVillage && (
						<Link
							to={`/events/${activeVillage.slug || activeVillage.id}`}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								background: "#9E2A2B",
								color: "#FFFFFF",
								borderRadius: 9999,
								padding: "9px 18px",
								fontSize: 13,
								fontWeight: 500,
								textDecoration: "none",
							}}
						>
							<span>Buka Halaman Detail Lengkap</span>
							<ArrowRight size={14} />
						</Link>
					)}
				</div>
			</aside>

			<CeremonyDetailModal
				ceremony={activeDetailCeremony}
				onClose={() => setActiveDetailCeremony(null)}
			/>
		</div>
	);
}
