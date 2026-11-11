import { useQuery } from "@tanstack/react-query";
import { Token } from "@astryxdesign/core/Token";
import { Stack } from "@astryxdesign/core/Stack";
import {
	ArrowRight,
	Clock,
	Locate,
	LogOut,
	Menu,
	RotateCcw,
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
	fetchPublicAlternativeRoutes,
	fetchPublicEventRoads,
	fetchPublicEvents,
	fetchPublicRoadImpacts,
	mapPublicEventToCeremonyProfile,
	roadImpactFeatureToRecord,
	type RoadImpactRecord,
} from "../../lib/events-api";
import { useGsapPageReveal } from "../../lib/gsap-motion";
import { BaliMapTilerView } from "./BaliMapTilerView";

export function TeduhSpatialMapConsole() {
	const [searchParams, setSearchParams] = useSearchParams();
	const mapViewportRef = useRef<HTMLDivElement>(null);

	const { data: sessionData } = useAuthSession();
	const signOutMutation = useSignOutMutation();

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
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const searchDropdownRef = useRef<HTMLDivElement>(null);
	const mobileSearchRef = useRef<HTMLDivElement>(null);

	// Guide panel dismissed state — defaults to false so it shows on initial visit; dismisses completely on X click
	const [isGuideDismissed, setIsGuideDismissed] = useState<boolean>(false);

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
				evt,
				roads,
				idx,
			);
		});
	}, [liveEvents, activeBackendEvent, activeEventRoads, allImpactsByEvent]);

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
			const insideMobile =
				mobileSearchRef.current &&
				mobileSearchRef.current.contains(target);

			if (!insideDesktop && !insideMobile) {
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
									<Stack direction="horizontal" gap={1} align="center" wrap="wrap">
										<span className="text-sm font-medium text-stone-900">{c.ceremonyTitle}</span>
										{c.isSimulation !== false ? (
											<Token color="orange" size="sm" label="SIMULASI" />
										) : null}
									</Stack>
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
			{/* 1. DESKTOP FLOATING SPLIT TOPBAR */}
			<header
				className="map-desktop-topbar"
				aria-label="Bilah Navigasi Peta"
				data-gsap="reveal"
			>
				{/* Left Capsule: Logo + Search Bar + Instant Dropdown */}
				<div className="map-desktop-topbar-left" ref={searchDropdownRef}>
					<Link to="/" className="navbar-brand" aria-label="Rangkai Beranda">
						<img
							src="/logo.png"
							alt="Rangkai Logo"
							className="navbar-brand-logo"
						/>
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

					{/* Live Dropdown Results (Desktop) */}
					{searchDropdownNode}
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

			{/* 2. MOBILE TOP SEARCH CAPSULE (< 860px) WITH HAMBURGER MENU */}
			<div
				ref={mobileSearchRef}
				className="map-mobile-search-capsule"
				data-gsap="reveal"
			>
				<Link
					to="/"
					aria-label="Kembali ke Beranda"
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						textDecoration: "none",
						flexShrink: 0,
					}}
				>
					<img
						src="/logo.png"
						alt="Rangkai"
						style={{ width: 24, height: 24, objectFit: "contain" }}
					/>
				</Link>
				<div className="map-topbar-divider" style={{ height: 18, margin: "0 2px" }} />
				<Search size={16} color="#64748B" style={{ flexShrink: 0 }} />
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
						minWidth: 0,
					}}
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={() => {
							setSearchQuery("");
							setIsSearchDropdownOpen(false);
						}}
						style={{ background: "none", border: "none", color: "#64748B", padding: 4 }}
						aria-label="Bersihkan pencarian"
					>
						<X size={16} />
					</button>
				)}
				<button
					type="button"
					onClick={() => setIsMobileMenuOpen(true)}
					style={{
						background: "none",
						border: "none",
						color: "#264D3B",
						padding: "4px 2px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						cursor: "pointer",
						flexShrink: 0,
					}}
					aria-label="Buka Menu"
				>
					<Menu size={20} />
				</button>

				{/* Live Dropdown Results (Mobile) */}
				{searchDropdownNode}
			</div>

			{/* Mobile Slide-Over Menu for Map Console */}
			<div
				className={`mobile-nav-overlay ${isMobileMenuOpen ? "is-visible" : ""}`}
				onClick={() => setIsMobileMenuOpen(false)}
			/>
			<aside
				className={`mobile-nav-menu ${isMobileMenuOpen ? "is-open" : ""}`}
				aria-label="Menu Ponsel Peta"
			>
				<div className="mobile-nav-top">
					<div className="mobile-nav-header">
						<Link to="/" className="navbar-brand">
							<img src="/logo.png" alt="Rangkai Logo" style={{ height: 32 }} />
						</Link>
						<button
							type="button"
							onClick={() => setIsMobileMenuOpen(false)}
							style={{ background: "none", border: "none", cursor: "pointer", color: "#545B67" }}
							aria-label="Tutup menu"
						>
							<X size={24} />
						</button>
					</div>

					<div className="mobile-nav-links">
						<Link
							to="/"
							className="mobile-nav-link"
							onClick={() => setIsMobileMenuOpen(false)}
						>
							Beranda
						</Link>
						<Link
							to="/peta"
							className="mobile-nav-link is-active"
							onClick={() => setIsMobileMenuOpen(false)}
						>
							Peta Kawasan
						</Link>
						<Link
							to="/events"
							className="mobile-nav-link"
							onClick={() => setIsMobileMenuOpen(false)}
						>
							Jadwal Upacara
						</Link>
					</div>
				</div>

				<div style={{ paddingTop: 20, borderTop: "1px solid #E2E4E8" }}>
					{sessionData?.user ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
							<Link
								to="/dashboard"
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "10px 14px",
									background: "#F4F4F3",
									borderRadius: 12,
									textDecoration: "none",
									color: "#181B20",
									fontSize: 14,
								}}
							>
								<ShieldCheck size={18} color="#264D3B" />
								<span>Panel Petugas Desa</span>
							</Link>
							<button
								type="button"
								onClick={() => signOutMutation.mutate()}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "10px 14px",
									background: "none",
									border: "1px solid #E2E4E8",
									borderRadius: 12,
									color: "#B91C1C",
									fontSize: 14,
									cursor: "pointer",
								}}
							>
								<LogOut size={18} />
								<span>Keluar Akun</span>
							</button>
						</div>
					) : (
						<Link
							to="/login"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								gap: 8,
								width: "100%",
								padding: "12px 20px",
								borderRadius: 9999,
								background: "#9E2A2B",
								color: "#FFFFFF",
								textDecoration: "none",
								fontWeight: 500,
								fontSize: 14.5,
								boxSizing: "border-box",
							}}
						>
							<ShieldCheck size={18} />
							<span>Akses Petugas Desa</span>
						</Link>
					)}
				</div>
			</aside>

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
									fontWeight: 500,
									color: "#181B20",
								}}
							>
								Panduan Peta Kawasan Bali
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
								<strong>Pilih Wilayah</strong> dengan klik area berwarna di peta atau gunakan kotak pencarian.
							</li>
							<li>
								<strong>Klik Titik Upacara</strong> untuk melihat kartu ringkas lokasi dan jam kegiatan.
							</li>
							<li>
								<strong>Klik Lihat Detail</strong> untuk membuka panel rincian ruas jalan terdampak.
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

			{/* 5. BOTTOM STATUSBAR PILL */}
			<div className="map-statusbar">
				<div className="map-status-pill tabular-nums">
					<span>{cursorCoords}</span>
					<span>•</span>
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
			</div>

			{/* 6. FULLSCREEN MAPLIBRE CANVAS */}
			<div className="map-canvas-full">
				<BaliMapTilerView
					village={activeVillage}
					allVillages={allCeremonyProfiles}
					alternativeRoutes={altRoutesData?.alternativeRoutes ?? []}
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
									<Stack direction="horizontal" gap={1} align="center" wrap="wrap">
										<span className="drawer-location-tag">
											{activeVillage.desaAdatName} • {activeVillage.kabupaten}
										</span>
										{activeVillage.isSimulation !== false ? (
											<Token color="orange" size="sm" label="SIMULASI" />
										) : null}
										<RoadStatusBadge status={activeVillage.primaryStatus} />
									</Stack>
								</div>
								<h3 className="drawer-title">
									{activeVillage.ceremonyTitle}
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
								<div className="drawer-info-row">
									<div className="drawer-info-item">
										<span className="drawer-info-label">Pusat Upacara</span>
										<span className="drawer-info-value">{activeVillage.sacredCenterName}</span>
									</div>
									<div className="drawer-info-item">
										<span className="drawer-info-label">Jadwal Pelaksanaan</span>
										<div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
											<Clock size={15} color="#264D3B" />
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
									<span style={{ fontSize: 12, color: "#64748B" }}>
										Verifikasi Pecalang
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
															{idx + 1}. {seg.roadName}
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
								onClick={() => setIsDrawerOpen(false)}
								className="drawer-btn-secondary"
							>
								Tutup
							</button>

							<Link
								to={`/events/${activeVillage.slug || activeVillage.id}`}
								className="drawer-btn-primary"
							>
								<span>Buka Halaman Detail Lengkap</span>
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
