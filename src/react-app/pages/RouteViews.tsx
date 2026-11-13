import { shouldLoadCleanupTasks } from "../lib/cleanup-input";
import "./workflow.css";
import { useUnsavedChanges } from "../lib/use-unsaved-changes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Calendar,
	CheckCircle2,
	ClipboardCheck,
	Clock,
	Copy,
	FileText,
	Info,
	LocateFixed,
	MapPin,
	MapPinned,
	Milestone,
	PackageCheck,
	PenTool,
	Plus,
	Save,
	Scale,
	Search,
	Send,
	ShieldCheck,

	Trash2,
	Upload,

	UserPlus,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
	ImpactPlannerPanel,
	PublicNoticeDraftPanel,
} from "../components/rangkai/AdvisoryPanels";
import { WasteScenarioPanel } from "../components/rangkai/WasteScenarioPanel";
import { PublicMobileBottomNav } from "../components/ui/PublicHeader";
import {
	OrganizerAlternativeRoutesManager,
	PublicAlternativeRoutesList,
} from "../components/rangkai/AlternativeRoutesPanel";
import {
	CleanupStatusBadge,
	type CleanupTaskStatus,
	EmptyStateCard,
	EventLifecycleBadge,
	LoadingStateBlock,
	RoadStatusBadge,
} from "../components/rangkai";
import { BaliMapTilerView } from "../features/map/BaliMapTilerView";
import { useGpsTracking } from "../features/map/useGpsTracking";
import {
	calculateUserBypassRoute,
	haversineDistanceMeters,
	type UserGuidanceRoute,
} from "../lib/routing-engine";
import { DashboardRoadMapInput } from "../features/map/DashboardRoadMapInput";
import { VenueLocationInput } from "../features/map/VenueLocationInput";
import { RoadStatusConfirmDialog } from "../components/rangkai/RoadStatusConfirmDialog";
import { TeduhSpatialMapConsole } from "../features/map/TeduhSpatialMapConsole";
import { type BaliVillageCeremonyProfile } from "../lib/bali-villages";
import { ApiClientError } from "../lib/api-client";
import { OPERATIONAL_DISCLAIMERS } from "../lib/constants";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";
import {
	assignEventOfficer,
	createCleanupTask,
	createRoadImpact,
	createSimulationRoadImpact,
	createWasteRecord,
	deleteRoadImpact,
	fetchCleanupTasks,
	fetchEventAssignments,
	fetchEventDetail,
	fetchEventRoadImpacts,
	fetchPublicCleanupSummary,
	fetchPublicAlternativeRoutes,
	fetchPublicEventDetail,
	fetchPublicEventRoads,
	fetchPublicEvents,

	fetchFieldEventDetail,

	fetchRoadCandidates,
	fetchRoadSegments,

	formatWitaEventSchedule,
	fromIsoToWitaInput,
	getSavedOrganizationId,
	mapPublicEventToCeremonyProfile,
	normalizeEventCategory,
	publishVerifiedEvent,
	reopenCleanupTask,
	revokeEventAssignment,
	saveExtractedFields,
	submitCleanupTask,
	submitRoadImpactForReview,
	startCleanupTask,
	toWitaIsoTimestamp,
	transitionEventToReview,
	triggerDocumentExtraction,
	updateRoadStatus,
	uploadCleanupEvidence,
	uploadEventDocument,
	verifyCleanupTask,
	IMPACT_TYPE_OPTIONS,
	getImpactTypeLabel,
} from "../lib/events-api";
import {
	createInvitation,
	fetchInvitations,
	revokeInvitation,
	useMyOrganizationsQuery,
} from "../lib/auth";
import { useGsapPageReveal } from "../lib/gsap-motion";
import type { OperationalRoadStatus } from "../lib/road-status";
import { formatWitaDateTime, formatWitaRange, isTimestampExpired } from "../lib/wita";
import { LandingPage } from "./LandingPage";

/**
 * 1. PUBLIC HOME PAGE (`/`)
 * Full-screen sections with smooth transitions, interactive Pan-Bali satellite map, and ceremony schedule.
 */
export function PublicHomePage() {
	return <LandingPage />;
}

/**
 * 2. PUBLIC FULL MAP CONSOLE (`/peta`)
 */
export function PublicFullMapView() {
	return <TeduhSpatialMapConsole />;
}

/**
 * 3. PUBLIC EVENTS LIST PAGE (`/events`)
 * Unified Teduh aesthetic, 100% backend-driven.
 */
export function PublicEventsListPage() {
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const pageRef = useRef<HTMLElement>(null);
	const navigate = useNavigate();

	const publicEventsQuery = useQuery({
		queryKey: ["public", "events", statusFilter],
		queryFn: () =>
			fetchPublicEvents(
				statusFilter === "all"
					? { limit: 50 }
					: {
							status:
								statusFilter === "active" ? "active" : "published",
							limit: 50,
						},
			),
		staleTime: 30_000,
		retry: false,
	});

	const liveEvents = useMemo(() => {
		const raw = publicEventsQuery.data?.events ?? [];
		const trimmed = searchQuery.trim().toLowerCase();
		if (!trimmed) return raw;
		return raw.filter((evt) => {
			return (
				evt.title.toLowerCase().includes(trimmed) ||
				(evt.venueName && evt.venueName.toLowerCase().includes(trimmed)) ||
				(evt.category && evt.category.toLowerCase().includes(trimmed)) ||
				(evt.organizationName &&
					evt.organizationName.toLowerCase().includes(trimmed)) ||
				(evt.village && evt.village.toLowerCase().includes(trimmed)) ||
				(evt.district && evt.district.toLowerCase().includes(trimmed))
			);
		});
	}, [publicEventsQuery.data?.events, searchQuery]);

	useGsapPageReveal(pageRef, [
		liveEvents.length,
		statusFilter,
		publicEventsQuery.isLoading,
	]);

	return (
		<main ref={pageRef} className="teduh-page-shell">
			<div className="teduh-page-container">
				<header className="teduh-page-header" data-gsap="reveal">
					<h1 className="teduh-page-title">
						Jadwal Upacara & Rekayasa Jalur Bali
					</h1>
					<p className="teduh-page-subtitle">
						Direktori pengumuman kegiatan adat yang telah diverifikasi oleh
						panitia desa adat beserta perkiraan waktu pelaksanaan (WITA) dan
						lokasi terdampak.
					</p>
				</header>

				{/* Search & Status Filter Bar */}
				<div className="teduh-toolbar" data-gsap="reveal">
					<div className="teduh-search-box">
						<Search size={17} color="#64748B" className="teduh-search-icon" />
						<input
							type="text"
							className="teduh-search-input"
							placeholder="Cari nama upacara, desa adat, atau kabupaten..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							aria-label="Cari jadwal upacara"
						/>
						{searchQuery && (
							<button
								type="button"
								className="teduh-search-clear"
								onClick={() => setSearchQuery("")}
								aria-label="Bersihkan pencarian"
								title="Bersihkan pencarian"
							>
								✕
							</button>
						)}
					</div>

					<select className="schedule-filter-mobile" aria-label="Filter status jadwal" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
						<option value="all">Semua Jadwal</option>
						<option value="active">Sedang Berlangsung</option>
						<option value="published">Terjadwal</option>
					</select>
					<div className="schedule-filter-bar schedule-filter-desktop" style={{ marginBottom: 0 }}>
						{[
							{ id: "all", label: "Semua Jadwal" },
							{ id: "active", label: "Sedang Berlangsung" },
							{ id: "published", label: "Terjadwal" },
						].map((f) => (
							<button
								type="button"
								key={f.id}
								className={`schedule-filter-btn ${statusFilter === f.id ? "is-active" : ""}`}
								aria-pressed={statusFilter === f.id}
								onClick={() => setStatusFilter(f.id)}
							>
								{f.label}
							</button>
						))}
					</div>
				</div>

				{/* Events List / Cards */}
				{publicEventsQuery.isLoading ? (
					<div className="teduh-empty-surface" data-gsap="reveal">
						<p style={{ margin: 0, fontSize: 16, color: "#545B67" }}>
							Memuat daftar jadwal upacara terpublikasi...
						</p>
					</div>
				) : liveEvents.length === 0 ? (
					<div className="teduh-empty-surface" data-gsap="reveal">
						<h2
							style={{
								margin: "0 0 8px 0",
								fontSize: 22,
								fontWeight: 400,
								color: "#181B20",
							}}
						>
							{searchQuery
								? "Tidak ditemukan jadwal yang sesuai"
								: SYSTEM_STATE_MESSAGES.noEvents.title}
						</h2>
						<p
							style={{
								margin: "0 auto 20px auto",
								maxWidth: "54ch",
								fontSize: 15,
								color: "#545B67",
								lineHeight: 1.6,
							}}
						>
							{searchQuery
								? `Tidak ada pengumuman acara yang cocok dengan kata kunci "${searchQuery}".`
								: SYSTEM_STATE_MESSAGES.noEvents.description}
						</p>
						{searchQuery ? (
							<button
								type="button"
								className="schedule-filter-btn is-active"
								onClick={() => {
									setSearchQuery("");
									setStatusFilter("all");
								}}
							>
								Tampilkan Semua Jadwal
							</button>
						) : (
							<Link
								to="/peta"
								className="ui-button ui-button-primary"
								style={{ gap: 8 }}
							>
								<span>Buka Peta Kawasan Bali</span>
								<ArrowRight size={15} />
							</Link>
						)}
					</div>
				) : (
					<div className="schedule-grid">
						{liveEvents.map((evt) => {
							const schedule = formatWitaEventSchedule(
								evt.startsAt,
								evt.endsAt,
							);
							const eventSlug = evt.slug || evt.publicSlug || evt.id;
							const isOngoing = evt.status === "active";
							const isCompleted = evt.status === "completed";

							const statusBadgeClass = isOngoing
								? "status-closed"
								: isCompleted
									? "status-open"
									: "status-intermittent";
							const statusBadgeText = isOngoing
								? "Sedang Berlangsung"
								: isCompleted
									? "Selesai"
									: "Terpublikasi";

							return (
								<article
									key={evt.id}
									className="schedule-card schedule-card-clickable"
									data-gsap="scroll-card"
									onClick={(e) => {
										if (!(e.target as HTMLElement).closest("a, button")) {
											navigate(`/events/${eventSlug}`);
										}
									}}
								>
									<div>
										<div className="schedule-card-header">
											<span className="schedule-village-label">
												{evt.organizationName || evt.village} •{" "}
												{evt.district || "Bali"}
											</span>
											<div className="schedule-card-badges">
												{evt.isSimulation ? (
													<span className="map-popup-badge simulation-token">SIMULASI</span>
												) : null}
												<span
													className={`road-status-badge ${statusBadgeClass}`}
												>
													{statusBadgeText}
												</span>
											</div>
										</div>

										<h2 className="schedule-card-title">
											<Link
												to={`/events/${eventSlug}`}
												className="schedule-card-title-link"
											>
												{evt.title}
											</Link>
										</h2>

										{evt.description ? (
											<p
												style={{
													margin: "0 0 14px 0",
													fontSize: "1rem",
													color: "#545B67",
													lineHeight: 1.55,
												}}
											>
												{evt.description}
											</p>
										) : null}

										<div className="schedule-card-meta">
											<div className="schedule-meta-row">
												<Calendar size={16} color="#4D702F" style={{ flexShrink: 0 }} />
												<span style={{ fontVariantNumeric: "tabular-nums" }}>
													{schedule.dateLabel} • {schedule.windowWita}
												</span>
											</div>
											<div className="schedule-meta-row">
												<MapPin size={16} color="#4D702F" style={{ flexShrink: 0 }} />
												<span>
													{evt.venueName ||
														evt.village ||
														"Lokasi Utama Desa Adat"}
												</span>
											</div>
										</div>
									</div>

									<div className="schedule-card-footer">
										<Link
											to={`/peta?village=${eventSlug}`}
											className="btn-schedule-map"
											onClick={(e) => e.stopPropagation()}
										>
											<span>Lihat di Peta</span>
										</Link>
										<Link
											to={`/events/${eventSlug}`}
											className="btn-schedule-detail"
											onClick={(e) => e.stopPropagation()}
										>
											<span>Rincian Lengkap</span>
											<ArrowRight size={15} />
										</Link>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</div>
		</main>
	);
}

/**
 * 4. PUBLIC EVENT DETAIL PAGE (`/events/:slug` & `/events/:slug/map`)
 * Unified Teduh aesthetic, 100% synchronized with backend endpoints:
 * - GET /api/public/events/:slug
 * - GET /api/public/events/:slug/roads
 * - GET /api/public/events/:slug/cleanup-summary
 */
export function PublicEventDetailPage({
	mapOnly = false,
}: {
	mapOnly?: boolean;
}) {
	const { slug } = useParams<{ slug: string }>();
	const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
	const [statusClock, setStatusClock] = useState(() => Date.now());
	const detailRef = useRef<HTMLElement>(null);

	const publicEventQuery = useQuery({
		queryKey: ["public", "event-detail", slug],
		queryFn: () => fetchPublicEventDetail(slug!),
		enabled: Boolean(slug),
		staleTime: 15_000,
		retry: false,
	});

	const liveRoadsQuery = useQuery({
		queryKey: ["public", "event-roads", slug],
		queryFn: () => fetchPublicEventRoads(slug!),
		enabled: Boolean(slug),
		staleTime: 15_000,
		refetchInterval: 30_000,
		retry: false,
	});

	const cleanupSummaryQuery = useQuery({
		queryKey: ["public", "event-cleanup-summary", slug],
		queryFn: () => fetchPublicCleanupSummary(slug!),
		enabled: Boolean(slug),
		staleTime: 30_000,
		retry: false,
	});

	const alternativeRoutesQuery = useQuery({
		queryKey: ["public", "events", slug, "alternative-routes"],
		queryFn: () => fetchPublicAlternativeRoutes(slug!),
		enabled: Boolean(slug),
		staleTime: 30_000,
	});

	const apiEvent = publicEventQuery.data?.event;
	useEffect(() => {
		const now = Date.now();
		const deadlines = (liveRoadsQuery.data?.roads ?? []).map((road) => road.operationalStatus?.expiresAt ? Date.parse(road.operationalStatus.expiresAt) : NaN).filter((time) => Number.isFinite(time) && time > now);
		if (!deadlines.length) return;
		const delay = Math.min(Math.max(Math.min(...deadlines) - now + 25, 25), 2_147_000_000);
		const timer = setTimeout(() => setStatusClock(Date.now()), delay);
		return () => clearTimeout(timer);
	}, [liveRoadsQuery.data, statusClock]);
	const rawRoads = useMemo(
		() => (liveRoadsQuery.data?.roads ?? liveRoadsQuery.data?.roadImpacts ?? []).map((road) => road.operationalStatus ? {
			...road,
			operationalStatus: { ...road.operationalStatus, isStale: road.operationalStatus.isStale || liveRoadsQuery.isError || isTimestampExpired(road.operationalStatus.expiresAt, new Date(Math.max(statusClock, liveRoadsQuery.dataUpdatedAt))) },
		} : road),
		[liveRoadsQuery.data, liveRoadsQuery.dataUpdatedAt, liveRoadsQuery.isError, statusClock],
	);

	const spatialProfile: BaliVillageCeremonyProfile | null = useMemo(() => {
		if (!apiEvent) return null;
		return mapPublicEventToCeremonyProfile(apiEvent, rawRoads, 0);
	}, [apiEvent, rawRoads]);

	const gps = useGpsTracking();
	const [eventBasemapStyle, setEventBasemapStyle] =
		useState<"osm" | "satellite">("satellite");
	const [detailGuidanceRouteSnapshot, setDetailGuidanceRouteSnapshot] =
		useState<{
			route: UserGuidanceRoute;
			profile: BaliVillageCeremonyProfile;
			alternatives: unknown;
		} | null>(null);
	const [detailGuidanceStatus, setDetailGuidanceStatus] =
		useState<string | null>(null);
	const setDetailGuidanceRoute = useCallback((route: UserGuidanceRoute | null) => {
		setDetailGuidanceRouteSnapshot(
			route && spatialProfile
				? {
					route,
					profile: spatialProfile,
					alternatives: alternativeRoutesQuery.data,
				}
				: null,
		);
	}, [spatialProfile, alternativeRoutesQuery.data]);
	const detailGuidanceRoute =
		gps.active &&
		gps.position?.coordinates &&
		gps.position.accuracy <= 50 &&
		spatialProfile &&
		detailGuidanceRouteSnapshot?.profile === spatialProfile &&
		detailGuidanceRouteSnapshot.alternatives === alternativeRoutesQuery.data
			? detailGuidanceRouteSnapshot.route
			: null;
	const visibleDetailGuidanceStatus = !gps.active
		? null
		: !spatialProfile || !gps.position?.coordinates
			? "Menunggu lokasi GPS dan data kegiatan..."
			: gps.position.accuracy > 50
				? "Menunggu lokasi yang lebih akurat untuk menyusun rute."
				: detailGuidanceStatus;
	const lastCalcPosRef = useRef<[number, number] | null>(null);
	const lastCalcTimeRef = useRef<number>(0);
	const detailGuidanceRequestIdRef = useRef(0);
	const detailGuidanceAbortControllerRef = useRef<AbortController | null>(null);
	const lastDetailGuidanceProfileRef = useRef(spatialProfile);
	const lastDetailGuidanceAlternativesRef = useRef(alternativeRoutesQuery.data);
	useEffect(
		() => () => detailGuidanceAbortControllerRef.current?.abort(),
		[],
	);

	const handleCalculateDetailAlternativeRoute = useCallback(async () => {
		if (!spatialProfile || !gps.position?.coordinates) {
			setDetailGuidanceStatus("Menunggu lokasi GPS...");
			return;
		}
		if (gps.position.accuracy > 50) {
			detailGuidanceRequestIdRef.current += 1;
			detailGuidanceAbortControllerRef.current?.abort();
			setDetailGuidanceRoute(null);
			setDetailGuidanceStatus("Menunggu lokasi yang lebih akurat untuk menyusun rute.");
			return;
		}
		detailGuidanceAbortControllerRef.current?.abort();
		const abortController = new AbortController();
		detailGuidanceAbortControllerRef.current = abortController;
		const requestId = ++detailGuidanceRequestIdRef.current;
		setDetailGuidanceRoute(null);
		setDetailGuidanceStatus("Menyusun rute melalui jalur alternatif yang disetujui...");
		try {
			const route = await calculateUserBypassRoute({
				userLocation: gps.position.coordinates,
				ceremony: spatialProfile,
				alternativeRoutes:
					alternativeRoutesQuery.data?.alternativeRoutes ?? [],
				signal: abortController.signal,
			});
			if (requestId !== detailGuidanceRequestIdRef.current) return;
			setDetailGuidanceRoute(route);
			setDetailGuidanceStatus(
				route
					? `Panduan melalui ${route.viaRouteName || route.routeName} siap${route.isSimulation ? " (SIMULASI)" : ""}.`
					: "Rute aman belum dapat dipastikan dari data jalur yang tersedia; garis rute tidak ditampilkan.",
			);
		} catch {
			if (requestId !== detailGuidanceRequestIdRef.current) return;
			setDetailGuidanceRoute(null);
			setDetailGuidanceStatus("Rute belum dapat dihitung. Jalur rute tidak ditampilkan.");
		} finally {
			if (detailGuidanceAbortControllerRef.current === abortController) {
				detailGuidanceAbortControllerRef.current = null;
			}
		}
	}, [spatialProfile, gps.position, alternativeRoutesQuery.data, setDetailGuidanceRoute]);

	useEffect(() => {
		const routingInputsChanged =
			lastDetailGuidanceProfileRef.current !== spatialProfile ||
			lastDetailGuidanceAlternativesRef.current !== alternativeRoutesQuery.data;
		if (routingInputsChanged) {
			lastDetailGuidanceProfileRef.current = spatialProfile;
			lastDetailGuidanceAlternativesRef.current = alternativeRoutesQuery.data;
			detailGuidanceRequestIdRef.current += 1;
			detailGuidanceAbortControllerRef.current?.abort();
			lastCalcPosRef.current = null;
			lastCalcTimeRef.current = 0;
		}
		if (!gps.active) {
			detailGuidanceRequestIdRef.current += 1;
			detailGuidanceAbortControllerRef.current?.abort();
			lastCalcPosRef.current = null;
			return;
		}
		if (!spatialProfile || !gps.position?.coordinates) {
			detailGuidanceRequestIdRef.current += 1;
			detailGuidanceAbortControllerRef.current?.abort();
			return;
		}

		if (gps.position.accuracy > 50) {
			detailGuidanceRequestIdRef.current += 1;
			detailGuidanceAbortControllerRef.current?.abort();
			return;
		}

		const now = Date.now();
		const coords = gps.position.coordinates;
		const lastPos = lastCalcPosRef.current;
		const lastTime = lastCalcTimeRef.current;

		if (lastPos) {
			const movedMeters = haversineDistanceMeters(lastPos, coords);
			const elapsedSec = (now - lastTime) / 1000;
			if (movedMeters < 30 && elapsedSec < 15) {
				return;
			}
		}

		lastCalcPosRef.current = coords;
		lastCalcTimeRef.current = now;
		// GPS changes start an asynchronous routing request and publish its result.
		void handleCalculateDetailAlternativeRoute();
	}, [gps.active, gps.position, spatialProfile, alternativeRoutesQuery.data, handleCalculateDetailAlternativeRoute]);

	useGsapPageReveal(detailRef, [
		slug,
		Boolean(apiEvent),
		rawRoads.length,
		publicEventQuery.isLoading,
	]);

	if (publicEventQuery.isLoading) {
		return (
			<main ref={detailRef} className="teduh-page-shell">
				<div className="teduh-page-container">
					<div className="teduh-empty-surface" data-gsap="reveal">
						<p style={{ margin: 0, fontSize: 16, color: "#545B67" }}>
							Memuat rincian acara dan status ruas jalan dari server...
						</p>
					</div>
				</div>
			</main>
		);
	}

	if (publicEventQuery.isError && (!(publicEventQuery.error instanceof ApiClientError) || publicEventQuery.error.status !== 404)) {
		return <main className="teduh-page-shell"><div className="teduh-page-container"><section className="teduh-empty-surface" role="alert"><h1>Rincian acara belum dapat dimuat</h1><p>Periksa koneksi dan coba lagi.</p><button type="button" className="teduh-btn-secondary" onClick={() => void publicEventQuery.refetch()}>Coba lagi</button></section></div></main>;
	}

	if (!apiEvent || !spatialProfile) {
		return (
			<main ref={detailRef} className="teduh-page-shell">
				<div className="teduh-page-container">
					<div className="teduh-empty-surface" data-gsap="reveal">
						<h1
							style={{
								margin: "0 0 10px 0",
								fontSize: 28,
								fontWeight: 400,
								color: "#181B20",
							}}
						>
							Acara Tidak Ditemukan
						</h1>
						<p
							style={{
								margin: "0 auto 24px auto",
								maxWidth: "52ch",
								fontSize: 16,
								color: "#545B67",
								lineHeight: 1.6,
							}}
						>
							{SYSTEM_STATE_MESSAGES.noEvents.description}
						</p>
						<div
							style={{
								display: "flex",
								justifyContent: "center",
								gap: 12,
								flexWrap: "wrap",
							}}
						>
							<Link
								to="/events"
								className="ui-button ui-button-primary"
								style={{ gap: 8 }}
							>
								<ArrowLeft size={15} />
								<span>Kembali ke Jadwal Upacara</span>
							</Link>
							<Link
								to="/peta"
								className="ui-button"
								style={{ gap: 8 }}
							>
								<span>Buka Peta Kawasan</span>
							</Link>
						</div>
					</div>
				</div>
			</main>
		);
	}

	const activeSegmentId = selectedSegmentId;
	const schedule = formatWitaEventSchedule(apiEvent.startsAt, apiEvent.endsAt);
	const cleanupData = cleanupSummaryQuery.data;

	if (mapOnly) {
		return (
			<div className="public-event-map-shell">
				<div
					style={{
						position: "absolute",
						top: 16,
						left: 16,
						zIndex: 20,
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						gap: 8,
					}}
				>
					<Link
						to={`/events/${spatialProfile.slug}`}
						className="ui-button"
						style={{ gap: 8 }}
					>
						<ArrowLeft size={15} />
						<span>Kembali ke Rincian Acara</span>
					</Link>

					{apiEvent.isSimulation !== false ? (
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								background: "#92400E",
								color: "#FFFFFF",
								padding: "8px 14px",
								borderRadius: 4,
								fontSize: "0.875rem",
								fontWeight: 700,
								textTransform: "uppercase",
								letterSpacing: "0.04em",
							}}
						>
							SIMULASI
						</span>
					) : null}

					{spatialProfile.roadSegments?.[0]?.roadName ? (
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								background: "#FFFFFF",
								border: "1px solid var(--color-border)",
								color: "#181B20",
								padding: "8px 14px",
								borderRadius: 4,
								fontSize: "0.9375rem",
								fontWeight: 600,
							}}
						>
							{spatialProfile.roadSegments[0].roadName}
						</span>
					) : null}
				</div>
				<BaliMapTilerView
					village={spatialProfile}
					allVillages={[spatialProfile]}
					showAllVillagesMarkers={false}
					showDistrictBoundaries={false}
					fitDataReady={!liveRoadsQuery.isLoading && !alternativeRoutesQuery.isLoading}
					alternativeRoutes={alternativeRoutesQuery.isError ? [] : alternativeRoutesQuery.data?.alternativeRoutes}
					selectedSegmentId={activeSegmentId}
					onSelectSegment={setSelectedSegmentId}
					minimalControls={true}
					height="100%"
				/>
				<PublicMobileBottomNav />
			</div>
		);
	}

	return (
		<main ref={detailRef} className="teduh-page-shell">
			<div className="teduh-page-container">
				{/* 1. TOP NAVIGATION ROW */}
				<div className="teduh-detail-nav" data-gsap="reveal">
					<Link to="/events" className="teduh-back-link">
						<ArrowLeft size={16} />
						<span>Kembali ke Jadwal Upacara</span>
					</Link>

					<div className="teduh-detail-nav-actions">
						<Link
							to={`/peta?village=${spatialProfile.slug}`}
							className="teduh-pill-action"
						>
							<MapPinned size={15} />
							<span>Buka di Peta Kawasan</span>
						</Link>
					</div>
				</div>

				{/* 2. HERO HEADER SURFACE */}
				<section className="teduh-detail-hero" data-gsap="reveal">
					<div className="teduh-detail-hero-top">
						<span className="schedule-village-label">
							{apiEvent.organizationName} • {apiEvent.village},{" "}
							{apiEvent.district}
						</span>
						<div className="teduh-detail-hero-badges">
							{apiEvent.category ? (
								<span className="teduh-category-badge">
									{apiEvent.category}
								</span>
							) : null}
							<RoadStatusBadge status={spatialProfile.primaryStatus} />
						</div>
					</div>

					{apiEvent.isSimulation ? (
						<section className="teduh-simulation-banner" aria-label="Informasi simulasi">
							<strong>SIMULASI — Bukan Penutupan Jalan Sebenarnya</strong>
							<p>
								Kegiatan ini dipublikasikan dalam mode simulasi atau latihan koordinasi desa adat. Ruas jalan dan status buka-tutup tidak mencerminkan penutupan operasional resmi di lapangan.
							</p>
						</section>
					) : null}

					<h1 className="teduh-detail-title">{apiEvent.title}</h1>

					{/* Core Metadata Grid (Waktu WITA, Lokasi Utama, Penanggung Jawab) */}
					<div className="teduh-detail-meta-grid">
						<div className="teduh-meta-block">
							<span className="teduh-meta-label">Waktu Pelaksanaan (WITA)</span>
							<div className="teduh-meta-value">
								<Clock size={16} color="#4D702F" />
								<span style={{ fontVariantNumeric: "tabular-nums" }}>
									{schedule.dateLabel} • {schedule.windowWita}
								</span>
							</div>
						</div>

						<div className="teduh-meta-block">
							<span className="teduh-meta-label">Pusat Upacara & Lokasi</span>
							<div className="teduh-meta-value">
								<MapPin size={16} color="#4D702F" />
								<span>{apiEvent.venueName || "Lokasi belum ditentukan"}</span>
							</div>
						</div>

						<div className="teduh-meta-block">
							<span className="teduh-meta-label">Penyelenggara</span>
							<div className="teduh-meta-value">
								<ShieldCheck size={16} color="#4D702F" />
								<span>
									{apiEvent.organizerName || apiEvent.organizationName}
								</span>
							</div>
						</div>
					</div>
				</section>

				{/* 3. DESCRIPTION, PROCESSION & TRAFFIC IMPACT SUMMARY */}
				{(apiEvent.description ||
					apiEvent.processionDescription ||
					apiEvent.trafficImpactDescription) && (
					<section className="teduh-detail-section" data-gsap="scroll-section">
						<h2 className="teduh-section-heading">
							Rincian Prosesi & Pengaturan Lalu Lintas
						</h2>

						<div className="teduh-info-cards-grid">
							{apiEvent.description ? (
								<div className="teduh-surface-card" data-gsap="scroll-card">
									<h3 className="teduh-card-label">
										<FileText size={15} color="#4D702F" />
										<span>Deskripsi Kegiatan</span>
									</h3>
									<p className="teduh-card-body">{apiEvent.description}</p>
								</div>
							) : null}

							{apiEvent.processionDescription ? (
								<div className="teduh-surface-card" data-gsap="scroll-card">
									<h3 className="teduh-card-label">
										<Milestone size={15} color="#4D702F" />
										<span>Rute & Jalur Prosesi</span>
									</h3>
									<p className="teduh-card-body">
										{apiEvent.processionDescription}
									</p>
								</div>
							) : null}

							{apiEvent.trafficImpactDescription ? (
								<div className="teduh-surface-card" data-gsap="scroll-card">
									<h3 className="teduh-card-label">
										<AlertTriangle size={15} color="#4D702F" />
										<span>Ringkasan Dampak & Pengalihan Arus</span>
									</h3>
									<p className="teduh-card-body">
										{apiEvent.trafficImpactDescription}
									</p>
								</div>
							) : null}
						</div>
					</section>
				)}

				{/* 4. MAP & VERIFIED AFFECTED ROAD SEGMENTS */}
				<section className="teduh-detail-section" data-gsap="scroll-section">
					<div className="teduh-roads-header">
						<div>
							<h2 className="teduh-section-heading">
								Peta Lokasi & Ruas Jalan Terdampak
								{!liveRoadsQuery.isLoading && !liveRoadsQuery.isError
									? ` (${rawRoads.length})`
									: ""}
							</h2>
							<p style={{ margin: "6px 0 0 0", fontSize: "1rem", color: "#545B67" }}>
								Klik salah satu ruas jalan di daftar untuk menyorot koridor pada
								peta.
							</p>
							{!spatialProfile.venueLocation ? (
								<p className="teduh-venue-unconfirmed-note">
									Titik lokasi belum ditentukan.
								</p>
							) : null}
						</div>
					</div>

					<div className="teduh-roads-split">
						{/* Left: Verified Road Impacts List */}
						<div className="teduh-roads-list">
							{liveRoadsQuery.isLoading ? (
								<div className="teduh-surface-card">
									<p style={{ margin: 0, fontSize: "1rem", color: "#545B67" }}>
										Memuat data ruas jalan terverifikasi...
									</p>
								</div>
							) : liveRoadsQuery.isError ? (
								<p role="alert">
									Data ruas jalan belum dapat dimuat.{" "}
									<button
										type="button"
										className="teduh-btn-secondary"
										onClick={() => void liveRoadsQuery.refetch()}
									>
										Coba lagi
									</button>
								</p>
							) : rawRoads.length === 0 ? (
								<div className="teduh-surface-card">
									<h3 className="teduh-card-label">
										{SYSTEM_STATE_MESSAGES.noMatchingRoad.title}
									</h3>
									<p className="teduh-card-body">
										{SYSTEM_STATE_MESSAGES.noMatchingRoad.description}
									</p>
								</div>
							) : (
								rawRoads.map((road, idx) => {
									const isSelected = road.id === activeSegmentId;
									const roadSchedule = formatWitaEventSchedule(
										road.plannedFrom,
										road.plannedTo,
									);
									const expiresAt = Date.parse(
										road.operationalStatus?.expiresAt ?? "",
									);
									const effStatus =
										road.operationalStatus?.isStale ||
										!Number.isFinite(expiresAt) ||
										expiresAt <=
											Math.max(statusClock, liveRoadsQuery.dataUpdatedAt) ||
										road.operationalStatus?.effectiveStatus === "unconfirmed"
											? "unknown"
											: ((road.operationalStatus?.effectiveStatus ??
													"unknown") as OperationalRoadStatus);

									return (
										<button
											type="button"
											key={road.id}
											onClick={() => setSelectedSegmentId(road.id)}
											className={`teduh-road-item ${isSelected ? "is-selected" : ""}`}
											aria-pressed={isSelected}
											data-gsap="scroll-card"
										>
											<div className="teduh-road-item-header">
												<span className="teduh-road-item-title">
													{idx + 1}. {road.displayName || "Ruas Jalan Terdampak"}
												</span>
												<RoadStatusBadge
													status={effStatus}
													expiresAt={road.operationalStatus?.expiresAt}
												/>
											</div>

											<div className="teduh-road-item-diversion">
												Arahan Pengalihan:{" "}
												<strong style={{ color: "#181B20", fontWeight: 600 }}>
													{road.diversionNote || "Belum tersedia."}
												</strong>
											</div>

											<div className="teduh-road-item-schedule">
												{road.coverageArea || apiEvent.village} • Berlaku:{" "}
												{roadSchedule.dateLabel} ({roadSchedule.windowWita})
											</div>

											<div className="teduh-road-meta-grid">
												<span className="teduh-road-meta-pill">
													Rencana: {getImpactTypeLabel(road.impactType)}
												</span>
												<span className="teduh-road-meta-pill">
													Pengamatan:{" "}
													{road.operationalStatus?.observedAt
														? formatWitaDateTime(
																road.operationalStatus.observedAt,
															)
														: "Belum ada laporan"}
												</span>
												<span className="teduh-road-meta-pill">
													Berlaku sampai:{" "}
													{road.operationalStatus?.expiresAt
														? formatWitaDateTime(
																road.operationalStatus.expiresAt,
															)
														: "Belum ditentukan"}
												</span>
											</div>
										</button>
									);
								})
							)}
						</div>

						{/* Right: Map Column with toolbar above, canvas in center, and legend below */}
						<div className="teduh-roads-map-column">
							{/* Toolbar outside map canvas */}
							<div className="teduh-map-toolbar">
								<div
									role="group"
									aria-label="Pilih tampilan peta dasar"
									className="teduh-map-basemap-group"
								>
									<button
										type="button"
										onClick={() => setEventBasemapStyle("satellite")}
										aria-pressed={eventBasemapStyle === "satellite"}
										className={`teduh-map-toolbar-btn ${eventBasemapStyle === "satellite" ? "is-active" : ""}`}
									>
										Satelit
									</button>
									<button
										type="button"
										onClick={() => setEventBasemapStyle("osm")}
										aria-pressed={eventBasemapStyle === "osm"}
										className={`teduh-map-toolbar-btn ${eventBasemapStyle === "osm" ? "is-active" : ""}`}
									>
										Peta Jalan
									</button>
								</div>

								<button
									type="button"
									onClick={() => {
										if (gps.active) {
											detailGuidanceRequestIdRef.current += 1;
											gps.stop();
											setDetailGuidanceRoute(null);
										} else {
											gps.start();
										}
									}}
									className={`teduh-btn-alt-route ${gps.active ? "is-tracking" : ""}`}
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 6,
										...(gps.active
											? { background: "#FFFFFF", borderColor: "#B91C1C", color: "#B91C1C" }
											: {}),
									}}
								>
									<LocateFixed size={16} />
									<span>
										{gps.active
											? "Hentikan tracking"
											: "Track lokasi"}
									</span>
								</button>
							</div>

							{gps.active && !gps.position && !gps.error && (
								<div role="status" style={{ fontSize: 13, color: "#545B67", fontStyle: "italic" }}>
									Mencari lokasi GPS...
								</div>
							)}
							{gps.active && gps.position && gps.position.accuracy > 50 && (
								<div
									role="status"
									style={{
										background: "#FEF3C7",
										border: "1px solid #F59E0B",
										borderRadius: 4,
										padding: "8px 12px",
										fontSize: 13,
										color: "#92400E",
										fontWeight: 500,
									}}
								>
									Menunggu lokasi lebih akurat (±{Math.round(gps.position.accuracy)}m)
								</div>
							)}
							{gps.error && (
								<div
									role="alert"
									style={{
										background: "#FEF2F2",
										border: "1px solid #F87171",
										borderRadius: 4,
										padding: "8px 12px",
										fontSize: 13,
										color: "#B91C1C",
									}}
								>
									{gps.error}
								</div>
							)}

							{/* Unobstructed Map Canvas Box */}
							<div className="teduh-roads-map-box">
								<BaliMapTilerView
									village={spatialProfile}
									allVillages={[spatialProfile]}
									showAllVillagesMarkers={false}
									showDistrictBoundaries={false}
									fitDataReady={!liveRoadsQuery.isLoading && !alternativeRoutesQuery.isLoading}
									alternativeRoutes={alternativeRoutesQuery.isError ? [] : alternativeRoutesQuery.data?.alternativeRoutes}
									showAlternativeRoutes={!gps.active}
									selectedSegmentId={activeSegmentId}
									onSelectSegment={setSelectedSegmentId}
									basemapStyle={eventBasemapStyle}
									onBasemapStyleChange={setEventBasemapStyle}
									userLocation={gps.position?.coordinates ?? null}
									userGuidanceRoute={detailGuidanceRoute}
									minimalControls={true}
									height="100%"
								/>
							</div>

							{/* Legend & Guidance Bar outside map canvas */}
							<div className="teduh-map-legend-bar">
				{visibleDetailGuidanceStatus ? (
					<div className="teduh-guidance-status" role="status" aria-live="polite">
						{visibleDetailGuidanceStatus}
						<small>Koordinat GPS dikirim melalui server Rangkai ke ORS untuk menghitung rute dan tidak disimpan oleh aplikasi.</small>
					</div>
				) : null}
								<div className="teduh-legend-items">
									<span className="teduh-legend-pill">
										<span className="teduh-legend-color" style={{ background: "#C8322B" }} />
										<span>Ditutup</span>
									</span>
									<span className="teduh-legend-pill">
										<span className="teduh-legend-color" style={{ background: "#D97706" }} />
										<span>Buka-Tutup</span>
									</span>
									<span className="teduh-legend-pill">
										<span className="teduh-legend-color" style={{ background: "#4D702F" }} />
										<span>Dibuka</span>
									</span>
									<span className="teduh-legend-pill">
										<span className="teduh-legend-color" style={{ background: "#78716C" }} />
										<span>Belum dikonfirmasi</span>
									</span>
									<span className="teduh-legend-pill">
										<span className="teduh-legend-color" style={{ background: "#2563EB" }} />
										<span>Jalur alternatif</span>
									</span>
									{spatialProfile.isSimulation !== false ? (
										<span className="teduh-legend-pill" style={{ color: "#78716C", fontStyle: "italic" }}>
											Garis putus: simulasi
										</span>
									) : null}
								</div>

								{detailGuidanceRoute && (
									<div className="teduh-guidance-summary-card">
										<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
							<strong style={{ color: "#2563EB", fontSize: 13 }}>
								Panduan Jalur Alternatif{detailGuidanceRoute.isSimulation ? " (SIMULASI)" : ""}
							</strong>
											<button
												type="button"
												onClick={() => setDetailGuidanceRoute(null)}
												style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 13 }}
											>
												✕
											</button>
										</div>
										<div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.45 }}>
											Menghindari: <strong>{detailGuidanceRoute.avoidedRoadNames.join(", ") || "Penutupan Ruas Jalan"}</strong>
											<br />
											Lewat: <strong>{detailGuidanceRoute.viaRouteName || detailGuidanceRoute.routeName}</strong>
											{detailGuidanceRoute.distanceMeters > 0 && (
												<span> • Jarak: {(detailGuidanceRoute.distanceMeters / 1000).toFixed(1)} km</span>
											)}
											{detailGuidanceRoute.durationSeconds > 0 && (
												<span> • Estimasi: ~{Math.max(1, Math.round(detailGuidanceRoute.durationSeconds / 60))} mnt</span>
											)}
										</div>
									</div>
								)}
							</div>
						</div>
					</div>
				</section>

				{/* 4.5 JALUR ALTERNATIF TERVERIFIKASI PANITIA */}
				{slug ? (
					<section className="teduh-detail-section" data-gsap="scroll-section">
						<PublicAlternativeRoutesList slug={slug} />
					</section>
				) : null}

				{/* 5. POST-EVENT CLEANUP & WASTE SUMMARY (FROM BACKEND) */}
				{cleanupData &&
				(cleanupData.summary.totalTasks > 0 ||
					cleanupData.wasteTotals.weighedKg > 0 ||
					cleanupData.wasteTotals.estimatedKg > 0 ||
					cleanupData.wasteTotals.totalSacks > 0) ? (
					<section className="teduh-detail-section" data-gsap="scroll-section">
						<h2 className="teduh-section-heading">
							Penanganan Kebersihan & Catatan Sampah Pasca-Acara
						</h2>
						<p
							style={{
								margin: "0 0 18px 0",
								fontSize: 15,
								color: "#545B67",
							}}
						>
							{OPERATIONAL_DISCLAIMERS.CLEANUP_INDEPENDENCE_NOTE}
						</p>

						<div className="teduh-info-cards-grid">
							<div className="teduh-surface-card" data-gsap="scroll-card">
								<h3 className="teduh-card-label">
									<ClipboardCheck size={15} color="#4D702F" />
									<span>Status Tugas Kebersihan</span>
								</h3>
								<div className="teduh-stat-number">
									{cleanupData.summary.verifiedTasks} / {cleanupData.summary.totalTasks} Tugas Terverifikasi
								</div>
								<p className="teduh-card-body">
									Menunggu verifikasi: {cleanupData.summary.submittedTasks} • Sedang dikerjakan: {cleanupData.summary.inProgressTasks}
								</p>
							</div>

							<div className="teduh-surface-card" data-gsap="scroll-card">
								<h3 className="teduh-card-label">
									<Scale size={15} color="#4D702F" />
									<span>Berat Sampah Terukur (Ditimbang)</span>
								</h3>
								<div className="teduh-stat-number">
									{cleanupData.wasteTotals.weighedKg} kg
								</div>
								<p className="teduh-card-body">
									Organik: {cleanupData.byCategory.organic.weighedKg} kg • Daur Ulang: {cleanupData.byCategory.recyclable.weighedKg} kg • Residu: {cleanupData.byCategory.residual.weighedKg} kg
								</p>
							</div>

							<div className="teduh-surface-card" data-gsap="scroll-card">
								<h3 className="teduh-card-label">
									<PackageCheck size={15} color="#4D702F" />
									<span>Estimasi & Jumlah Karung Sampah</span>
								</h3>
								<div className="teduh-stat-number">
									{cleanupData.wasteTotals.totalSacks} Karung
									{cleanupData.wasteTotals.estimatedKg > 0
										? ` (${cleanupData.wasteTotals.estimatedKg} kg estimasi)`
										: ""}
								</div>
								<p className="teduh-card-body">
									Data estimasi dipisahkan dari hasil timbangan aktual sesuai standar pelaporan Rangkai.
								</p>
							</div>
						</div>
					</section>
				) : null}

				{/* 6. HONEST OPERATIONAL DISCLAIMER */}
				<footer className="teduh-detail-disclaimer" data-gsap="scroll-section">
					<div className="teduh-disclaimer-icon">
						<Info size={18} color="#4D702F" />
					</div>
					<div className="teduh-disclaimer-text">
						<p style={{ margin: "0 0 6px 0", fontSize: 13.5, color: "#181B20", fontWeight: 500 }}>
							{OPERATIONAL_DISCLAIMERS.PUBLIC_LIMITATION}
						</p>
						<p style={{ margin: 0, fontSize: 13, color: "#545B67", lineHeight: 1.6 }}>
							{OPERATIONAL_DISCLAIMERS.OPEN_ROAD_NOTE}
						</p>
					</div>
				</footer>
			</div>
		</main>
	);
}

/**
 * 6. WORKFLOW & FIELD OFFICER WORKSPACE (`/dashboard/events/:id/*` & `/field/events/:id`)
 * Cohesive Teduh Workspace Shell with dedicated dashboard map input & full backend connectivity.
 */
interface WorkflowRouteShellProps {
	stepCode: string;
	title: string;
	subtitle: string;
	requirementRef: string;
}

export function WorkflowRouteShellPage({
	title,
	subtitle,
}: WorkflowRouteShellProps) {
	const { id: eventId = "", taskId } = useParams<{ id: string; taskId?: string }>();
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const isRealUuidEvent = useMemo(
		() =>
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				eventId,
			),
		[eventId],
	);

	const eventDetailQuery = useQuery({
		queryKey: ["events", "detail", eventId],
		queryFn: () => fetchEventDetail(eventId),
		enabled: Boolean(eventId && isRealUuidEvent),
		retry: false,
	});

	const eventRoadImpactsQuery = useQuery({
		queryKey: ["events", eventId, "road-impacts"],
		queryFn: () => fetchEventRoadImpacts(eventId),
		enabled: Boolean(eventId && isRealUuidEvent),
		retry: false,
		refetchInterval: 15_000,
	});

	const myOrgsQuery = useMyOrganizationsQuery();
	const myOrganizations = useMemo(
		() => myOrgsQuery.data?.organizations ?? [],
		[myOrgsQuery.data?.organizations],
	);
	const rawEvent = eventDetailQuery.data?.event;

	const fieldDetailQuery = useQuery({
		queryKey: ["field", "events", eventId],
		queryFn: () => fetchFieldEventDetail(eventId),
		enabled: Boolean(eventId && isRealUuidEvent),
		retry: false,
	});
	const permissions = fieldDetailQuery.data?.permissions;
	const isOrganizer = useMemo(() => {
		if (permissions?.isOrganizer) return true;
		if (rawEvent?.organizationId) {
			return myOrganizations.some(
				(o) => o.id === rawEvent.organizationId && o.role === "organizer",
			);
		}
		return false;
	}, [permissions?.isOrganizer, rawEvent, myOrganizations]);
	const canTraffic = permissions?.canUpdateTraffic ?? false;
	const canCleanup = permissions?.canUpdateCleanup ?? false;

	const roadSegmentsCatalogQuery = useQuery({
		queryKey: ["road-segments", "catalog"],
		queryFn: () => fetchRoadSegments(),
		enabled: Boolean(pathname.endsWith("/roads")),
		staleTime: 60_000,
	});

	const roadCandidatesQuery = useQuery({
		queryKey: ["road-candidates", eventId],
		queryFn: () => fetchRoadCandidates(eventId),
		enabled: Boolean(isRealUuidEvent && pathname.endsWith("/roads") && isOrganizer),
		staleTime: 30_000,
	});
	const roadCandidates = roadCandidatesQuery.data?.candidates ?? [];

	const cleanupTasksQuery = useQuery({
		queryKey: ["cleanup-tasks", eventId],
		queryFn: () => fetchCleanupTasks(eventId),
		enabled: Boolean(
			isRealUuidEvent &&
				shouldLoadCleanupTasks(pathname, isOrganizer, canCleanup),
		),
		retry: false,
	});

	const assignmentsQuery = useQuery({
		queryKey: ["events", eventId, "assignments"],
		queryFn: () => fetchEventAssignments(eventId),
		enabled: Boolean(isRealUuidEvent && pathname.endsWith("/team")),
		retry: false,
	});

	const attachedRoadImpacts = useMemo(
		() => eventRoadImpactsQuery.data?.roadImpacts ?? [],
		[eventRoadImpactsQuery.data?.roadImpacts],
	);
	const catalogSegments = roadSegmentsCatalogQuery.data?.segments ?? [];

	// Document & Review Tab State
	const [docTitle, setDocTitle] = useState("");
	const [docAiConsent, setDocAiConsent] = useState(false);
	const [docDirty, setDocDirty] = useState(false);
	const docRevision = useRef(0);
	const docSavingRevision = useRef(0);
	function markDocDirty() { docRevision.current += 1; setDocDirty(true); }
	const [dirtyGroups, setDirtyGroups] = useState<Record<string, number>>({});
	const groupRevisions = useRef<Record<string, number>>({});
	const savingRevisions = useRef<Record<string, number>>({});
	function markGroup(group: string) {
		const revision = (groupRevisions.current[group] ?? 0) + 1;
		groupRevisions.current[group] = revision;
		setDirtyGroups((previous) => ({ ...previous, [group]: revision }));
	}
	function beginSave(group: string) { savingRevisions.current[group] = groupRevisions.current[group] ?? 0; }
	function clearSavedGroup(group: string) {
		if (savingRevisions.current[group] !== (groupRevisions.current[group] ?? 0)) return false;
		setDirtyGroups((previous) => { const next = { ...previous }; delete next[group]; return next; });
		return true;
	}
	useUnsavedChanges(docDirty || Object.keys(dirtyGroups).length > 0);
	const [docVenue, setDocVenue] = useState("");
	const [docVenueLongitude, setDocVenueLongitude] = useState("");
	const [docVenueLatitude, setDocVenueLatitude] = useState("");
	const [docVenueDirty, setDocVenueDirty] = useState(false);
	const [docStartsWita, setDocStartsWita] = useState("");
	const [docEndsWita, setDocEndsWita] = useState("");
	const [docTrafficNote, setDocTrafficNote] = useState("");
	const [docPermitRef, setDocPermitRef] = useState("");
	const [hydratedDocEventId, setHydratedDocEventId] = useState<string | null>(
		null,
	);
	const [hydratedVenueKey, setHydratedVenueKey] = useState<string | null>(null);

	if (rawEvent && hydratedDocEventId !== rawEvent.id) {
		setHydratedDocEventId(rawEvent.id);
		const rec = rawEvent as unknown as Record<string, unknown>;
		setDocTitle(rawEvent.title || "");
		setDocVenue(rawEvent.venueName || "");
		setDocStartsWita(fromIsoToWitaInput(rawEvent.startsAt));
		setDocEndsWita(fromIsoToWitaInput(rawEvent.endsAt));
		setDocTrafficNote((rec.trafficImpactDescription as string) || "");
		setDocPermitRef(rawEvent.permitReference || "");
	}

	const currentVenueKey = rawEvent
		? `${rawEvent.id}:${rawEvent.venueLocation?.coordinates?.join(",") ?? ""}`
		: null;
	if (rawEvent && currentVenueKey !== hydratedVenueKey) {
		setHydratedVenueKey(currentVenueKey);
		if (!docVenueDirty) {
			setDocVenueLongitude(
				rawEvent.venueLocation?.coordinates
					? String(rawEvent.venueLocation.coordinates[0])
					: "",
			);
			setDocVenueLatitude(
				rawEvent.venueLocation?.coordinates
					? String(rawEvent.venueLocation.coordinates[1])
					: "",
			);
		}
	}

	// Roads Tab State ("draw" vs "catalog")
	const [roadInputMode, setRoadInputMode] = useState<"draw" | "catalog">(
		"draw",
	);
	const [draftCoordinates, setDraftCoordinates] = useState<[number, number][]>(
		[],
	);
	const [newSegmentName, setNewSegmentName] = useState("");
	const [newSegmentArea, setNewSegmentArea] = useState("Bali");
	const [humanVerifiedRoad, setHumanVerifiedRoad] = useState(false);
	const roadAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
	const [selectedCatalogSegmentId, setSelectedCatalogSegmentId] =
		useState<string>("");
	const [roadFromWita, setRoadFromWita] = useState<string>("");
	const [roadToWita, setRoadToWita] = useState<string>("");
	const [selectedImpactType, setSelectedImpactType] = useState<
		"closure" | "intermittent" | "narrowing" | "procession"
	>("closure");
	const [impactDiversionNote, setImpactDiversionNote] = useState("");

	// Field Officer (Pos Pecalang) Tab State
	const [segmentStatuses, setSegmentStatuses] = useState<
		Record<string, OperationalRoadStatus>
	>({});
	const [selectedImpactId, setSelectedImpactId] = useState<string>("");
	const [pendingStatusChange, setPendingStatusChange] = useState<{
		segmentId: string;
		roadName: string;
		nextStatus: Exclude<OperationalRoadStatus, "unknown">;
	} | null>(null);
	const [fieldNote, setFieldNote] = useState("");
	const [statusFeedback, setStatusFeedback] = useState<{
		type: "success" | "warning" | "error" | "info";
		message: string;
	} | null>(null);


	// Cleanup & Waste Tab State
	const [evidenceStage, setEvidenceStage] = useState<"before" | "after">(
		"after",
	);
	const [selectedTaskForEvidence, setSelectedTaskForEvidence] =
		useState<string>(taskId ?? "");

	const [newTaskTitle, setNewTaskTitle] = useState("");
	const [newTaskLocation, setNewTaskLocation] = useState("");
	const [isAddingTask, setIsAddingTask] = useState(false);

	const [organicKg, setOrganicKg] = useState("");
	const [organicMethod, setOrganicMethod] = useState<"weighed" | "estimated">(
		"weighed",
	);
	const [recyclableKg, setRecyclableKg] = useState("");
	const [recyclableMethod, setRecyclableMethod] = useState<
		"weighed" | "estimated"
	>("weighed");
	const [residualSacks, setResidualSacks] = useState("");

	// Team & Invitation Tab State
	const [inviteCanTraffic, setInviteCanTraffic] = useState(true);
	const [inviteCanCleanup, setInviteCanCleanup] = useState(true);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"officer" | "organizer">("officer");
	const invitationsOrgId = rawEvent?.organizationId || getSavedOrganizationId();
	const invitationsQuery = useQuery({
		queryKey: ["invitations", invitationsOrgId],
		queryFn: () => fetchInvitations(invitationsOrgId),
		enabled: Boolean(invitationsOrgId && pathname.endsWith("/team") && isOrganizer),
	});
	const revokeInvitationMutation = useMutation({
		mutationFn: revokeInvitation,
		onSuccess: () => {
			void invitationsQuery.refetch();
			void queryClient.invalidateQueries({ queryKey: ["invitations"] });
			setStatusFeedback({
				type: "success",
				message: "Tautan undangan berhasil dibatalkan.",
			});
		},
		onError: () =>
			setStatusFeedback({
				type: "error",
				message: "Undangan gagal dibatalkan. Coba lagi.",
			}),
	});
	const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(
		null,
	);
	const [directOfficerUserId, setDirectOfficerUserId] = useState("");

	// ---------------------------------------------------------------------------
	// Mutations: Document Upload, Extraction, Save, Review, Publish
	// ---------------------------------------------------------------------------
	const uploadAndExtractDocMutation = useMutation({
		mutationFn: async (file: File) => {
			if (!isRealUuidEvent) {
				throw new Error("Buka kegiatan yang telah tersimpan terlebih dahulu.");
			}
			if (!docAiConsent) throw new Error("Setujui penggunaan AI untuk membaca dokumen terlebih dahulu.");
			const uploadRes = await uploadEventDocument(eventId, file, true);
			const extractRes = await triggerDocumentExtraction(
				eventId,
				uploadRes.document.id,
				true,
			);
			return extractRes.extraction;
		},
		onSuccess: (ext) => {
			const out = ext.outputJson;
			if (out) {
				markDocDirty();
				if (out.event_name?.value) setDocTitle(out.event_name.value);
				if (out.venue_name?.value) setDocVenue(out.venue_name.value);
				if (out.start_datetime?.value)
					setDocStartsWita(fromIsoToWitaInput(out.start_datetime.value));
				if (out.end_datetime?.value)
					setDocEndsWita(fromIsoToWitaInput(out.end_datetime.value));
				if (out.traffic_impact_description?.value)
					setDocTrafficNote(out.traffic_impact_description.value);
				if (out.permit_reference_text?.value)
					setDocPermitRef(out.permit_reference_text.value);
			}
			setStatusFeedback({
				type: "success",
				message: "Surat berhasil dibaca. Buka pemeriksaan untuk memeriksa dan menyimpan perubahan.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "warning",
				message:
					err instanceof Error
						? `${err.message}. Silakan perbarui rincian secara manual.`
						: "Gagal mengekstrak dokumen otomatis.",
			});
		},
	});

	const saveDocReviewMutation = useMutation({
		onMutate: () => { docSavingRevision.current = docRevision.current; },
		mutationFn: async (markReviewed: boolean) => {
			if (!isRealUuidEvent) {
				throw new Error("Kegiatan belum memiliki UUID valid.");
			}
			const hasVenueCoords =
				docVenueLongitude.trim() !== "" || docVenueLatitude.trim() !== "";
			const lng = Number(docVenueLongitude);
			const lat = Number(docVenueLatitude);
			if (
				hasVenueCoords &&
				(!docVenueLongitude.trim() ||
					!docVenueLatitude.trim() ||
					!Number.isFinite(lng) ||
					!Number.isFinite(lat) ||
					lng < 114.3 ||
					lng > 115.9 ||
					lat < -8.95 ||
					lat > -7.95)
			) {
				throw new Error(
					"Koordinat lokasi harus berada di wilayah Bali (bujur 114.3–115.9, lintang -8.95–-7.95).",
				);
			}
			await saveExtractedFields(eventId, {
				title: docTitle.trim() || rawEvent?.title || "Upacara Adat",
				category: normalizeEventCategory(rawEvent?.category) || "upacara_adat",
				venueName: docVenue.trim() || null,
				...(hasVenueCoords
					? { venueLocation: { type: "Point" as const, coordinates: [lng, lat] as [number, number] } }
					: docVenueDirty
						? { venueLocation: null }
						: {}),
				startsAt: toWitaIsoTimestamp(docStartsWita),
				endsAt: toWitaIsoTimestamp(docEndsWita),
				permitReference: docPermitRef.trim() || null,
				trafficImpactDescription: docTrafficNote.trim() || null,
			});
			if (markReviewed) {
				await transitionEventToReview(eventId);
			}
		},
		onSuccess: async (_, markReviewed) => {
			if (docSavingRevision.current === docRevision.current) { setDocDirty(false); setDocVenueDirty(false); }
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", eventId],
			});
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			setStatusFeedback({
				type: "success",
				message: docSavingRevision.current !== docRevision.current
					? "Data tersimpan, tetapi perubahan terbaru belum disimpan."
					: markReviewed
						? "Data disimpan dan ditandai telah diperiksa Prajuru (Status: REVIEW)."
						: "Perubahan rincian surat edaran berhasil disimpan.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal menyimpan rincian.",
			});
		},
	});

	const publishEventMutation = useMutation({
		mutationFn: async () => {
			if (!isRealUuidEvent) throw new Error("Kegiatan belum tersimpan.");
			return publishVerifiedEvent(eventId);
		},
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", eventId],
			});
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			setStatusFeedback({
				type: "success",
				message: result.event.isSimulation === false ? "Kegiatan diterbitkan ke portal publik." : "Kegiatan diterbitkan sebagai SIMULASI.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error
						? err.message
						: "Pastikan kegiatan telah ditandai diperiksa Prajuru (Review) sebelum diterbitkan.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Mutations: Road Map Input (Draw & Catalog & Delete)
	// ---------------------------------------------------------------------------
	const drawRoadOnTabMutation = useMutation({
		onMutate: () => beginSave("roads"),
		mutationFn: async () => {
			if (!isRealUuidEvent) {
				throw new Error("Simpan kegiatan terlebih dahulu.");
			}
			if (draftCoordinates.length < 2) {
				throw new Error(
					"Klik minimal 2 titik pada peta untuk membentuk garis ruas jalan.",
				);
			}
			if (newSegmentName.trim().length < 3) {
				throw new Error("Masukkan nama ruas jalan (minimal 3 karakter).");
			}
			if (!humanVerifiedRoad) {
				throw new Error("Centang verifikasi lokasi ruas jalan oleh Prajuru.");
			}

			const plannedFrom = toWitaIsoTimestamp(roadFromWita) || rawEvent?.startsAt || null;
			const plannedTo = toWitaIsoTimestamp(roadToWita) || rawEvent?.endsAt || null;
			if (!plannedFrom || !plannedTo || Date.parse(plannedTo) <= Date.parse(plannedFrom)) {
				throw new Error("Isi waktu mulai dan selesai penutupan (WITA) dengan waktu selesai setelah waktu mulai.");
			}

			const payload = {
				displayName: newSegmentName.trim(),
				coverageArea:
					newSegmentArea.trim() || rawEvent?.venueName || "Kawasan Desa Adat",
				coordinates: draftCoordinates,
				humanVerified: true,
				impactType: selectedImpactType,
				plannedFrom,
				plannedTo,
				diversionNote: impactDiversionNote.trim() || null,
			};
			const fingerprint = JSON.stringify([eventId, payload]);
			if (roadAttempt.current?.fingerprint !== fingerprint) roadAttempt.current = { fingerprint, id: crypto.randomUUID() };
			await createSimulationRoadImpact(eventId, { ...payload, mutationId: roadAttempt.current.id });
			return payload.displayName;
		},
		onSuccess: async (segName) => {
			const saved = clearSavedGroup("roads");
			roadAttempt.current = null;
			if (saved) { setDraftCoordinates([]); setNewSegmentName(""); setImpactDiversionNote(""); }
			await queryClient.invalidateQueries({
				queryKey: ["road-segments", "catalog"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["events", eventId, "road-impacts"],
			});
			setStatusFeedback({
				type: "success",
				message: `Ruas "${segName}" tersimpan sebagai garis latihan untuk kegiatan ini.`,
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal menyimpan ruas jalan.",
			});
		},
	});

	const attachCatalogRoadMutation = useMutation({
		onMutate: () => beginSave("roads"),
		mutationFn: async (roadSegmentId: string) => {
			if (!isRealUuidEvent) {
				throw new Error("Simpan kegiatan terlebih dahulu.");
			}
			const plannedFrom = toWitaIsoTimestamp(roadFromWita) || rawEvent?.startsAt || null;
			const plannedTo = toWitaIsoTimestamp(roadToWita) || rawEvent?.endsAt || null;
			if (!plannedFrom || !plannedTo || Date.parse(plannedTo) <= Date.parse(plannedFrom)) {
				throw new Error("Isi waktu mulai dan selesai penutupan (WITA) dengan waktu selesai setelah waktu mulai.");
			}
			return createRoadImpact(eventId, {
				roadSegmentId,
				impactType: selectedImpactType,
				plannedFrom,
				plannedTo,
				diversionNote: impactDiversionNote.trim() || null,
			});
		},
		onSuccess: async () => {
			if (clearSavedGroup("roads")) { setSelectedCatalogSegmentId(""); setImpactDiversionNote(""); }
			await queryClient.invalidateQueries({
				queryKey: ["events", eventId, "road-impacts"],
			});
			setStatusFeedback({
				type: "success",
				message: "Ruas jalan dari katalog berhasil ditautkan ke kegiatan ini.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal menautkan ruas jalan.",
			});
		},
	});

	const submitRoadReviewOnTabMutation = useMutation({
		mutationFn: async (impactId: string) => submitRoadImpactForReview(eventId, impactId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["events", eventId, "road-impacts"] });
			setStatusFeedback({ type: "success", message: "Ruas jalan diajukan ke antrean tinjauan Polisi / Reviewer Pemerintah." });
		},
		onError: (err) => {
			setStatusFeedback({ type: "error", message: err instanceof Error ? err.message : "Gagal mengajukan tinjauan ruas." });
		},
	});

	const deleteRoadImpactOnTabMutation = useMutation({
		mutationFn: async (impactId: string) => {
			return deleteRoadImpact(eventId, impactId);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["events", eventId, "road-impacts"],
			});
			setStatusFeedback({
				type: "info",
				message: "Ruas jalan terdampak telah dihapus dari kegiatan ini.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal menghapus ruas jalan.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Mutations: Field Officer Live Status Update
	// ---------------------------------------------------------------------------
	const updateStatusMutation = useMutation({
		onMutate: () => beginSave("traffic"),
		mutationFn: async ({
			impactId,
			nextStatus,
			note,
		}: {
			impactId: string;
			nextStatus: "open" | "intermittent" | "closed";
			note?: string;
		}) => {
			return updateRoadStatus(impactId, {
				status: nextStatus,
				observedAt: new Date().toISOString(),
				mutationId: crypto.randomUUID(),
				note: note || undefined,
			});
		},
		onSuccess: (_, vars) => {
			if (clearSavedGroup("traffic")) setFieldNote("");
			setSegmentStatuses((prev) => ({
				...prev,
				[vars.impactId]: vars.nextStatus,
			}));
			void eventRoadImpactsQuery.refetch();
			setStatusFeedback({
				type: "success",
				message: `Status "${vars.nextStatus.toUpperCase()}" berhasil disimpan ke server. Berlaku 30 menit sesuai SPO Operasional Pecalang.`,
			});
			setPendingStatusChange(null);
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error
						? `Gagal memperbarui status jalan: ${err.message}`
						: "Gagal memperbarui status jalan.",
			});
			setPendingStatusChange(null);
		},
	});

	// ---------------------------------------------------------------------------
	// Mutations: Cleanup & Waste
	// ---------------------------------------------------------------------------
	const createCleanupTaskMutation = useMutation({
		onMutate: () => beginSave("task"),
		mutationFn: async ({
			title: taskTitle,
			locationNotes,
		}: {
			title: string;
			locationNotes?: string;
		}) => {
			return createCleanupTask(eventId, {
				title: taskTitle,
				description: locationNotes || undefined,
			});
		},
		onSuccess: () => {
			const saved = clearSavedGroup("task");
			void cleanupTasksQuery.refetch();
			if (saved) { setNewTaskTitle(""); setNewTaskLocation(""); setIsAddingTask(false); }
			setStatusFeedback({
				type: "success",
				message: "Tugas kebersihan baru berhasil ditambahkan.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error
						? err.message
						: "Gagal menambahkan tugas kebersihan.",
			});
		},
	});

	const submitCleanupMutation = useMutation({
		mutationFn: async (taskId: string) => submitCleanupTask(taskId),
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setStatusFeedback({
				type: "success",
				message: "Tugas kebersihan diserahkan untuk diverifikasi Prajuru.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error
						? err.message
						: "Gagal menyerahkan tugas kebersihan.",
			});
		},
	});

	const reopenCleanupMutation = useMutation({
		mutationFn: async ({
			taskId,
			reason,
		}: {
			taskId: string;
			reason?: string;
		}) => reopenCleanupTask(taskId, reason),
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setStatusFeedback({
				type: "info",
				message: "Tugas kebersihan dibuka kembali untuk perbaikan bukti.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal membuka kembali tugas.",
			});
		},
	});

	const uploadCleanupEvidenceMutation = useMutation({
		onMutate: () => beginSave("evidence"),
		mutationFn: async (file: File) => {
			const tasks = cleanupTasksQuery.data?.cleanupTasks ?? [];
			const targetTask =

				tasks.find((t) => t.id === (taskId ?? selectedTaskForEvidence));

			if (!targetTask) {
				throw new Error(
					"Buat minimal 1 tugas kebersihan terlebih dahulu sebelum mengunggah foto bukti.",
				);
			}
			return uploadCleanupEvidence(targetTask.id, file, evidenceStage);
		},
		onSuccess: () => {
			clearSavedGroup("evidence");
			void cleanupTasksQuery.refetch();
			setStatusFeedback({
				type: "success",
				message: `Foto bukti tahap "${evidenceStage.toUpperCase()}" berhasil diunggah.`,
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error
						? err.message
						: "Gagal mengunggah foto bukti kebersihan.",
			});
		},
	});

	const recordWasteMutation = useMutation({
		onMutate: () => beginSave("waste"),
		mutationFn: async () => {
			const records = [];
			if (organicKg && Number(organicKg) > 0) {
				records.push(
					createWasteRecord(eventId, {
						category: "organic",
						quantityKg: Number(organicKg),
						measurementMethod: organicMethod,
					}),
				);
			}
			if (recyclableKg && Number(recyclableKg) > 0) {
				records.push(
					createWasteRecord(eventId, {
						category: "recyclable",
						quantityKg: Number(recyclableKg),
						measurementMethod: recyclableMethod,
					}),
				);
			}
			if (residualSacks && Number(residualSacks) > 0) {
				records.push(
					createWasteRecord(eventId, {
						category: "residual",
						sackCount: Number(residualSacks),
						measurementMethod: "estimated",
					}),
				);
			}
			if (records.length === 0) {
				throw new Error(
					"Isi minimal salah satu kuantitas sampah (Organik, Daur Ulang, atau Residu).",
				);
			}
			await Promise.all(records);
		},
		onSuccess: () => {
			if (clearSavedGroup("waste")) { setOrganicKg(""); setRecyclableKg(""); setResidualSacks(""); }
			setStatusFeedback({
				type: "success",
				message:
					"Catatan timbunan sampah pasca-upacara berhasil disimpan ke pangkalan data.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal mencatat data sampah.",
			});
		},
	});

	const verifyCleanupMutation = useMutation({
		mutationFn: async (params?: { taskId?: string }) => {
			const tasks = cleanupTasksQuery.data?.cleanupTasks ?? [];
			const targetTask =

				tasks.find((t) => t.id === params?.taskId);
			if (!targetTask) {
				throw new Error("Belum ada tugas kebersihan yang dapat diverifikasi.");

			}
			await verifyCleanupTask(targetTask.id, "Diverifikasi oleh Prajuru Adat.");
		},
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setStatusFeedback({
				type: "success",
				message:
					"Kebersihan area berhasil diverifikasi Prajuru. Sesuai aturan domain: pembukaan jalan tetap wewenang pos Pecalang dan tidak dibuka otomatis.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error
						? err.message
						: "Gagal memverifikasi tugas kebersihan.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Mutations: Team Assignments & One-Time Invitations
	// ---------------------------------------------------------------------------
	const generateInviteMutation = useMutation({
		onMutate: () => beginSave("invite"),
		mutationFn: async () => {
			if (!isRealUuidEvent) {
				throw new Error("Simpan kegiatan terlebih dahulu.");
			}
			const orgId = rawEvent?.organizationId || getSavedOrganizationId();
			if (!orgId) {
				throw new Error("Organisasi belum dipilih.");
			}
			return createInvitation({
				organizationId: orgId,
				eventId: inviteRole === "officer" ? eventId : undefined,
				role: inviteRole,
				recipientEmail: inviteEmail.trim(),
				canUpdateTraffic: inviteRole === "officer" && inviteCanTraffic,
				canUpdateCleanup: inviteRole === "officer" && inviteCanCleanup,
			});
		},
		onSuccess: (res) => {
			clearSavedGroup("invite");
			setGeneratedInviteUrl(res.invitation.inviteUrl ?? null);
			void invitationsQuery.refetch();
			void queryClient.invalidateQueries({ queryKey: ["invitations"] });
			setStatusFeedback({
				type: "success",
				message:
					"Tautan undangan sekali pakai berhasil dibuat! Salin dan bagikan kepada Pecalang atau petugas kebersihan.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error
						? err.message
						: "Gagal membuat tautan undangan.",
			});
		},
	});

	const directAssignMutation = useMutation({
		onMutate: () => beginSave("assignment"),
		mutationFn: async () => {
			if (!directOfficerUserId.trim()) {
				throw new Error("Masukkan UUID akun petugas.");
			}
			return assignEventOfficer(eventId, {
				userId: directOfficerUserId.trim(),
				canUpdateTraffic: inviteCanTraffic,
				canUpdateCleanup: inviteCanCleanup,
			});
		},
		onSuccess: async () => {
			if (clearSavedGroup("assignment")) setDirectOfficerUserId("");
			await assignmentsQuery.refetch();
			setStatusFeedback({
				type: "success",
				message: "Petugas lapangan berhasil ditugaskan pada kegiatan ini.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal menugaskan petugas.",
			});
		},
	});

	const revokeAssignmentMutation = useMutation({
		mutationFn: async (assignmentId: string) => {
			return revokeEventAssignment(eventId, assignmentId);
		},
		onSuccess: async () => {
			await assignmentsQuery.refetch();
			setStatusFeedback({
				type: "info",
				message: "Penugasan petugas pada kegiatan ini telah dicabut.",
			});
		},
		onError: (err) => {
			setStatusFeedback({
				type: "error",
				message:
					err instanceof Error ? err.message : "Gagal mencabut penugasan.",
			});
		},
	});

	const startCleanupMutation = useMutation({
		mutationFn: startCleanupTask,
		onSuccess: () => { void cleanupTasksQuery.refetch(); setStatusFeedback({ type: "success", message: "Tugas dimulai." }); },
		onError: (error) => setStatusFeedback({ type: "error", message: error instanceof Error ? error.message : "Tugas gagal dimulai." }),
	});

	const currentTabValue = useMemo(() => {
		if (pathname.endsWith("/document") || pathname.endsWith("/review")) {
			return "document";
		}
		if (pathname.endsWith("/roads")) return "roads";
		if (/\/cleanup(?:\/[^/]+)?$/.test(pathname)) return "cleanup";
		if (pathname.endsWith("/team")) return "team";
		if (pathname.startsWith("/field")) {
			if (!isOrganizer && !canTraffic && canCleanup) {
				return "cleanup";
			}
			return "field";
		}
		return "wizard";
	}, [pathname, isOrganizer, canTraffic, canCleanup]);

	function handleTabChange(nextTab: string) {
		setStatusFeedback(null);
		switch (nextTab) {
			case "wizard":
				navigate(`/dashboard/events/${eventId}`);
				break;
			case "document":
				navigate(`/dashboard/events/${eventId}/document`);
				break;
			case "roads":
				navigate(`/dashboard/events/${eventId}/roads`);
				break;
			case "field":
				navigate(`/field/events/${eventId}`);
				break;
			case "cleanup":
				navigate(
					pathname.startsWith("/field")
						? `/field/events/${eventId}/cleanup`
						: `/dashboard/events/${eventId}/cleanup`,
				);
				break;
			case "team":
				navigate(`/dashboard/events/${eventId}/team`);
				break;
		}
	}

	const officerRoadList = useMemo(() => {
		return attachedRoadImpacts.map((imp) => {
			const effective =
				segmentStatuses[imp.id] ??
				imp.operationalStatus?.effectiveStatus ??
				"unknown";
			return {
				id: imp.id,
				roadName:
					imp.segment?.displayName ||
					imp.displayName ||
					"Ruas Jalan Terdampak",
				corridorSection:
					imp.segment?.coverageArea || imp.coverageArea || "Kawasan Desa Adat",
				impactType: imp.impactType,
				diversionNote: imp.diversionNote,
				windowWita:
					imp.plannedFrom && imp.plannedTo
						? formatWitaRange(imp.plannedFrom, imp.plannedTo)
						: "Sesuai jadwal acara",
				status: effective as OperationalRoadStatus,
				expiresAt: imp.operationalStatus?.expiresAt,
			};
		});
	}, [attachedRoadImpacts, segmentStatuses]);


	return (
		<div className="workflow-page" onChangeCapture={(event) => { const group = (event.target as HTMLElement).closest<HTMLElement>("[data-dirty-group]")?.dataset.dirtyGroup; if (group) markGroup(group); }}>
			{/* Header Workspace */}
			<div className="teduh-workspace-header">
				<div>
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="teduh-workspace-title">
							{rawEvent?.title || fieldDetailQuery.data?.event.title || title}
							{taskId && cleanupTasksQuery.data?.cleanupTasks.find((task) => task.id === taskId) ? ` - ${cleanupTasksQuery.data.cleanupTasks.find((task) => task.id === taskId)?.title}` : null}
						</h1>
						{rawEvent ? <EventLifecycleBadge status={rawEvent.status} /> : null}
						{(rawEvent ?? fieldDetailQuery.data?.event)?.isSimulation !== false && (rawEvent || fieldDetailQuery.data?.event) ? <span className="text-base font-semibold">Simulasi</span> : null}
					</div>
					<p className="teduh-workspace-subtitle">{subtitle}</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Link
						to={pathname.startsWith("/field") ? "/field" : "/dashboard"}
						className="ui-button"
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						<span>{pathname.startsWith("/field") ? "Kembali ke daftar tugas" : "Daftar Upacara"}</span>
					</Link>

				</div>
			</div>

			{/* Status Feedback Banner */}
			{statusFeedback ? (
				<div role={statusFeedback.type === "error" ? "alert" : "status"} className={`mb-6 rounded p-4 ${statusFeedback.type === "error" ? "bg-red-50 text-red-900" : statusFeedback.type === "warning" ? "bg-amber-50 text-amber-950" : statusFeedback.type === "success" ? "bg-green-50 text-green-900" : "bg-blue-50 text-blue-900"}`}>
					<strong>Informasi Operasional</strong><p>{statusFeedback.message}</p>
				</div>
			) : null}

			{!isRealUuidEvent ? (
				<div role="alert" className="mb-6 rounded bg-amber-50 p-4 text-amber-950">
					<strong>Pilih Kegiatan Upacara yang Valid</strong><p>URL ini belum merujuk pada UUID kegiatan yang tersimpan di pangkalan data. Silakan pilih kegiatan dari Dashboard atau buat pengumuman baru.</p>
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 1: SURAT EDARAN & PEMERIKSAAN PRAJURU (`document`)              */}
			{/* =================================================================== */}
			{currentTabValue === "document" ? (
				<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					<div hidden={pathname.endsWith("/review")} className="xl:col-span-5 workflow-panel space-y-4">
						<div className="space-y-1">
							<h2 className="teduh-workspace-card-title">
								Unggah Surat Edaran &amp; Ekstraksi AI
							</h2>
							<p className="text-base text-stone-600 mt-0.5">
								Unggah berkas surat pengumuman Desa Adat (PDF/JPG/PNG) untuk
								diekstrak otomatis oleh Google Gemini.
							</p>
						</div>

						<label className="flex items-start gap-2"><input type="checkbox" checked={docAiConsent} onChange={(event) => setDocAiConsent(event.target.checked)} /> Saya menyetujui dokumen dikirim untuk pembacaan AI.</label>
						<div className="rounded border-2 border-dashed border-emerald-200 bg-white p-6 text-center space-y-3">
							<Upload className="w-7 h-7 text-emerald-800 mx-auto" />
							<p className="text-base font-bold text-stone-900">
								Berkas Surat Edaran Desa Adat (Maks. 8 MB)
							</p>
							<label className="ui-button ui-button-primary">
								<Upload className="w-4 h-4" />
								<span>
									{uploadAndExtractDocMutation.isPending
										? "Menganalisis Dokumen..."
										: "Pilih & Ekstrak Surat Edaran"}
								</span>
								<input
									type="file"
									accept=".pdf,image/jpeg,image/png"
									disabled={uploadAndExtractDocMutation.isPending || !docAiConsent}
									onChange={(e) => {
										const file = e.target.files?.[0];
										if (file) {
											void uploadAndExtractDocMutation.mutateAsync(file);
										}
									}}
									className="sr-only"
								/>
							</label>
						</div>
						<Link className="ui-button ui-button-primary" to={`/dashboard/events/${eventId}/review`}>Periksa rincian</Link>

						<div className="rounded border border-stone-200 bg-white p-3.5 text-base text-stone-600 space-y-1">
							<p className="font-bold text-stone-900">
								Pemeriksaan panitia
							</p>
							<p>
								Hasil ekstraksi AI tidak pernah langsung dipublikasikan ke
								warga. Prajuru wajib memeriksa dan mengonfirmasi rincian di
								di halaman pemeriksaan.
							</p>
						</div>
					</div>

					<div hidden={!pathname.endsWith("/review")} onChangeCapture={() => setDocDirty(true)} className="xl:col-span-7 workflow-panel space-y-4">
						<div className="flex items-center justify-between">
							<h2 className="teduh-workspace-card-title">
								Periksa &amp; Konfirmasi Rincian Upacara
							</h2>
							{rawEvent?.verifiedAt ? (
								<span className="px-2.5 py-1 rounded border border-emerald-300 bg-white text-emerald-800 text-base font-bold">
									Terverifikasi Prajuru
								</span>
							) : (
								<span className="px-2.5 py-1 rounded border border-amber-300 bg-white text-amber-800 text-base font-bold">
									Menunggu Konfirmasi
								</span>
							)}
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
							<div className="sm:col-span-2">
								<label className="block text-base font-semibold text-stone-900 mb-1">
									Nama Upacara / Kegiatan Adat *
								</label>
								<input
									type="text"
									value={docTitle}
									onChange={(e) => setDocTitle(e.target.value)}
									className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
								/>
							</div>

							<div>
								<label className="block text-base font-semibold text-stone-900 mb-1">
									Lokasi Pura &amp; Kawasan Utama
								</label>
								<input
									type="text"
									value={docVenue}
									onChange={(e) => setDocVenue(e.target.value)}
									className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
								/>
							</div>

							<div>
								<label className="block text-base font-semibold text-stone-900 mb-1">
									Nomor Surat Edaran
								</label>
								<input
									type="text"
									value={docPermitRef}
									onChange={(e) => setDocPermitRef(e.target.value)}
									className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
								/>
							</div>

							<div>
								<label className="block text-base font-semibold text-stone-900 mb-1">
									Waktu Mulai (WITA)
								</label>
								<input
									type="datetime-local"
									value={docStartsWita}
									onChange={(e) => setDocStartsWita(e.target.value)}
									className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
								/>
							</div>

							<div>
								<label className="block text-base font-semibold text-stone-900 mb-1">
									Waktu Selesai (WITA)
								</label>
								<input
									type="datetime-local"
									value={docEndsWita}
									onChange={(e) => setDocEndsWita(e.target.value)}
									className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
								/>
							</div>

							<div className="sm:col-span-2">
								<label className="block text-base font-semibold text-stone-900 mb-1">
									Ringkasan Rekayasa Lalu Lintas &amp; Pengalihan Arus
								</label>
								<textarea
									rows={3}
									value={docTrafficNote}
									onChange={(e) => setDocTrafficNote(e.target.value)}
									className="teduh-form-textarea text-base text-stone-900 bg-white border-stone-200"
								/>
							</div>

							<div className="sm:col-span-2">
								<VenueLocationInput
									longitude={docVenueLongitude}
									latitude={docVenueLatitude}
									onChange={(lng, lat) => {
										markDocDirty();
										setDocVenueDirty(true);
										setDocVenueLongitude(lng);
										setDocVenueLatitude(lat);
									}}
								/>
							</div>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-3 pt-2">
							<button
								type="button"
								disabled={saveDocReviewMutation.isPending}
								onClick={() => void saveDocReviewMutation.mutateAsync(false)}
								className="ui-button"
							>
								<Save className="w-4 h-4" />
								<span>Simpan Draf</span>
							</button>

							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									disabled={saveDocReviewMutation.isPending}
									onClick={() => void saveDocReviewMutation.mutateAsync(true)}
									className="ui-button"
								>
									<CheckCircle2 className="w-4 h-4" />
									<span>Konfirmasi Prajuru (Review)</span>
								</button>

								<button
									type="button"
									disabled={publishEventMutation.isPending}
									onClick={() => void publishEventMutation.mutateAsync()}
									className="ui-button ui-button-primary"
								>
									<Send className="w-4 h-4" />
									<span>Terbitkan ke Warga</span>
								</button>
							</div>
						</div>
					</div>

					{/* AI Advisory: Impact Analysis & Notice Draft Panels */}
					{isRealUuidEvent && isOrganizer ? (
						<div className="xl:col-span-12 space-y-6 mt-2">
							<ImpactPlannerPanel eventId={eventId!} isOrganizer={isOrganizer} />
							<PublicNoticeDraftPanel eventId={eventId!} isOrganizer={isOrganizer} />
						</div>
					) : null}
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 2: PETA & RUAS JALAN TERDAMPAK (`roads`)                        */}
			{/* =================================================================== */}
			{currentTabValue === "roads" ? (
				<div data-dirty-group="roads" className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					{/* Left: Dedicated Dashboard Road Map Input */}
					<div className="xl:col-span-7 workflow-panel space-y-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div>
								<h2 className="teduh-workspace-card-title">
									Peta Input Ruas Jalan Terdampak
								</h2>
								<p className="text-base text-stone-600">
									Klik titik koordinat di peta untuk menggambar ruas jalan baru,
									atau pilih dari katalog jalan terverifikasi.
								</p>
							</div>

							<div className="inline-flex rounded border border-stone-200 bg-white p-1">
								<button
									type="button"
									onClick={() => setRoadInputMode("draw")}
									className={`inline-flex items-center gap-1.5 px-3.5 py-3 rounded text-base font-semibold min-h-[49px] transition-colors ${
										roadInputMode === "draw"
											? "bg-emerald-800 text-white "
											: "text-stone-600 hover:text-stone-900"
									}`}
								>
									<PenTool className="w-3.5 h-3.5" />
									<span>Gambar di Peta</span>
								</button>
								<button
									type="button"
									onClick={() => setRoadInputMode("catalog")}
									className={`inline-flex items-center gap-1.5 px-3.5 py-3 rounded text-base font-semibold min-h-[49px] transition-colors ${
										roadInputMode === "catalog"
											? "bg-emerald-800 text-white "
											: "text-stone-600 hover:text-stone-900"
									}`}
								>
									<MapPinned className="w-3.5 h-3.5" />
									<span>Katalog{roadSegmentsCatalogQuery.isSuccess ? ` (${catalogSegments.length})` : ""}</span>
								</button>
							</div>
						</div>

						{/* Road Candidate Suggestions from Document Extraction */}
						{roadCandidates.length > 0 ? (
							<div className="rounded border border-stone-200 bg-white p-3 text-base space-y-2">
								<div className="flex items-center justify-between">
									<span className="font-semibold text-stone-900">
										Kandidat Ruas Jalan dari Dokumen ({roadCandidates.length} saran)
									</span>
									<span className="text-base text-stone-500">
										Pilihan memerlukan konfirmasi panitia
									</span>
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
									{roadCandidates.map((cand) => (
										<div
											key={cand.candidateId}
											className="p-2.5 rounded border border-stone-200 bg-white flex flex-col justify-between gap-2"
										>
											<div>
												<p className="font-bold text-stone-900">{cand.displayName}</p>
												<p className="text-base text-stone-500">
													Kawasan: {cand.coverageArea} • Skor: {Math.round(cand.matchScore * 100)}%
												</p>
												<p className="text-base text-stone-600 italic mt-0.5">{cand.explanation}</p>
											</div>
											<button
												type="button"
												onClick={() => {
													setRoadInputMode("catalog");
													markGroup("roads");
													setSelectedCatalogSegmentId(cand.roadSegmentId);
												}}
												className={`w-full py-2.5 px-3 rounded font-semibold text-base min-h-[48px] transition-colors ${
													selectedCatalogSegmentId === cand.roadSegmentId
														? "bg-emerald-800 text-white "
														: "bg-white hover:bg-stone-200 text-stone-800"
												}`}
											>
												{selectedCatalogSegmentId === cand.roadSegmentId
													? "Terpilih di Peta"
													: "Pilih Ruas Ini"}
											</button>
										</div>
									))}
								</div>
							</div>
						) : null}

						{roadSegmentsCatalogQuery.isLoading ? <p role="status">Memuat katalog ruas jalan...</p> : roadSegmentsCatalogQuery.isError ? <div role="alert">Katalog ruas jalan tidak tersedia. <button type="button" onClick={() => void roadSegmentsCatalogQuery.refetch()}>Coba lagi</button></div> : catalogSegments.length === 0 ? <p>Katalog ruas jalan kosong.</p> : null}
						<DashboardRoadMapInput
							mode={roadInputMode}
							height={430}
							draftCoordinates={draftCoordinates}
							onDraftCoordinatesChange={(coordinates) => { markGroup("roads"); setDraftCoordinates(coordinates); }}
							catalogSegments={catalogSegments}
							selectedCatalogSegmentId={selectedCatalogSegmentId}
							onSelectCatalogSegment={(segmentId) => { markGroup("roads"); setSelectedCatalogSegmentId(segmentId); }}
							attachedRoadImpacts={attachedRoadImpacts}
						/>
					</div>

					{/* Right: Form & Attached Road Segments List */}
					<div className="xl:col-span-5 space-y-5">
						<div className="workflow-panel space-y-4">
							<h3 className="teduh-workspace-card-title">
								{roadInputMode === "draw"
									? `Simpan Garis Ruas Jalan Baru (${draftCoordinates.length} titik)`
									: "Tautkan Ruas Jalan dari Katalog"}
							</h3>

							{roadInputMode === "draw" ? (
								<div className="space-y-3">
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Nama Ruas Jalan / Simpang *
										</label>
										<input
											type="text"
											value={newSegmentName}
											onChange={(e) => setNewSegmentName(e.target.value)}
											placeholder="Mis. Jl. Raya Ubud — Depan Puri Saren"
											className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
										/>
									</div>
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Kawasan / Desa Adat *
										</label>
										<input
											type="text"
											value={newSegmentArea}
											onChange={(e) => setNewSegmentArea(e.target.value)}
											placeholder="Mis. Ubud, Gianyar"
											className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
										/>
									</div>
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Jenis Dampak Operasional *
										</label>
										<select
											value={selectedImpactType}
											onChange={(e) =>
												setSelectedImpactType(
													e.target.value as typeof selectedImpactType,
												)
											}
											className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
										>
											{IMPACT_TYPE_OPTIONS.map((opt) => (
												<option key={opt.value} value={opt.value}>
													{opt.label}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Arahan Pengalihan Arus
										</label>
										<input
											type="text"
											value={impactDiversionNote}
											onChange={(e) => setImpactDiversionNote(e.target.value)}
											placeholder="Mis. Dialihkan ke Jl. Sugriwa / Peliatan"
											className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
										/>
									</div>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
										<label className="block text-base font-semibold text-stone-900">
											Mulai Penutupan (WITA) *
											<input type="datetime-local" value={roadFromWita || (rawEvent?.startsAt ? fromIsoToWitaInput(rawEvent.startsAt) : "")} onChange={(e) => setRoadFromWita(e.target.value)} className="teduh-form-input text-base text-stone-900 bg-white border-stone-200 mt-1" />
										</label>
										<label className="block text-base font-semibold text-stone-900">
											Selesai Penutupan (WITA) *
											<input type="datetime-local" value={roadToWita || (rawEvent?.endsAt ? fromIsoToWitaInput(rawEvent.endsAt) : "")} onChange={(e) => setRoadToWita(e.target.value)} className="teduh-form-input text-base text-stone-900 bg-white border-stone-200 mt-1" />
										</label>
									</div>
									<label className="flex items-start gap-2 text-base text-stone-900 cursor-pointer">
										<input
											type="checkbox"
											checked={humanVerifiedRoad}
											onChange={(e) => setHumanVerifiedRoad(e.target.checked)}
											className="mt-0.5 rounded border-stone-300 text-emerald-800"
										/>
										<span>
											Saya memeriksa garis ini untuk latihan. Garis ini bukan ruas operasional terverifikasi.
										</span>
									</label>
									{isOrganizer ? (
										<button
											type="button"
											disabled={
												drawRoadOnTabMutation.isPending ||
												draftCoordinates.length < 2
											}
											onClick={() => void drawRoadOnTabMutation.mutateAsync()}
											className="w-full teduh-btn-primary min-h-[48px]"
										>
											<Plus className="w-4 h-4" />
											<span>
												{drawRoadOnTabMutation.isPending
													? "Menyimpan..."
													: "Simpan & Tautkan Ruas Jalan"}
											</span>
										</button>
									) : null}
								</div>
							) : (
								<div className="space-y-3">
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Pilih Ruas Jalan Terverifikasi *
										</label>
										<select
											value={selectedCatalogSegmentId}
											onChange={(e) =>
												setSelectedCatalogSegmentId(e.target.value)
											}
											className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
										>
											<option value="">
												-- Pilih dari katalog atau klik garis biru di peta --
											</option>
											{catalogSegments.map((seg) => (
												<option key={seg.id} value={seg.id}>
													{seg.displayName} ({seg.coverageArea})
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Jenis Dampak Operasional *
										</label>
										<select
											value={selectedImpactType}
											onChange={(e) =>
												setSelectedImpactType(
													e.target.value as typeof selectedImpactType,
												)
											}
											className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
										>
											{IMPACT_TYPE_OPTIONS.map((opt) => (
												<option key={opt.value} value={opt.value}>
													{opt.label}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Arahan Pengalihan Arus
										</label>
										<input
											type="text"
											value={impactDiversionNote}
											onChange={(e) => setImpactDiversionNote(e.target.value)}
											placeholder="Mis. Dialihkan melalui jalur alternatif desa"
											className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
										/>
									</div>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
										<label className="block text-base font-semibold text-stone-900">
											Mulai Penutupan (WITA) *
											<input type="datetime-local" value={roadFromWita || (rawEvent?.startsAt ? fromIsoToWitaInput(rawEvent.startsAt) : "")} onChange={(e) => setRoadFromWita(e.target.value)} className="teduh-form-input text-base text-stone-900 bg-white border-stone-200 mt-1" />
										</label>
										<label className="block text-base font-semibold text-stone-900">
											Selesai Penutupan (WITA) *
											<input type="datetime-local" value={roadToWita || (rawEvent?.endsAt ? fromIsoToWitaInput(rawEvent.endsAt) : "")} onChange={(e) => setRoadToWita(e.target.value)} className="teduh-form-input text-base text-stone-900 bg-white border-stone-200 mt-1" />
										</label>
									</div>
									<button
										type="button"
										disabled={
											!selectedCatalogSegmentId ||
											attachCatalogRoadMutation.isPending
										}
										onClick={() =>
											void attachCatalogRoadMutation.mutateAsync(
												selectedCatalogSegmentId,
											)
										}
										className="ui-button w-full"
									>
										<Plus className="w-4 h-4" />
										<span>Tautkan Ruas Katalog</span>
									</button>
								</div>
							)}
						</div>

						{/* Attached Road Impacts List */}
						<div className="workflow-panel teduh-road-impacts-panel">
							<div className="teduh-road-impacts-header">
								<h3 className="teduh-workspace-card-title">Ruas Jalan Terdampak</h3>
								<span className="teduh-road-impacts-count">{attachedRoadImpacts.length}</span>
							</div>
							{attachedRoadImpacts.length === 0 ? (
								<EmptyStateCard
									title={SYSTEM_STATE_MESSAGES.noMatchingRoad.title}
									description={SYSTEM_STATE_MESSAGES.noMatchingRoad.description}
								/>
							) : (
								<div className="teduh-road-impacts-list">
									{attachedRoadImpacts.map((imp) => (
										<div
											key={imp.id}
											className="teduh-road-impact-row"
										>
											<div className="teduh-road-impact-copy">
												<p className="text-base font-bold text-stone-900 break-words">
													{imp.segment?.displayName ||
														imp.displayName ||
														"Ruas Jalan"}
												</p>
												<p className="text-base text-stone-600 break-words">
													{getImpactTypeLabel(imp.impactType)}
													{imp.diversionNote ? ` • ${imp.diversionNote}` : ""}
												</p>
											</div>
											<div className="teduh-road-impact-actions">
												<div className="teduh-road-impact-status">
													<RoadStatusBadge
														status={
															imp.operationalStatus?.effectiveStatus ===
															"unconfirmed"
																? "unknown"
																: (imp.operationalStatus?.effectiveStatus ??
																	"unknown")
														}
														expiresAt={imp.operationalStatus?.expiresAt}
													/>
												</div>
												<div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
													{isOrganizer && imp.sourceType === "catalog" && (rawEvent?.status === "draft" || rawEvent?.status === "review") && (!imp.reviewStatus || imp.reviewStatus === "rejected" || imp.reviewStatus === "superseded") ? (
														<button
															type="button"
															disabled={submitRoadReviewOnTabMutation.isPending}
															onClick={() => void submitRoadReviewOnTabMutation.mutateAsync(imp.id)}
															className="ui-button"
														>
															<span>Ajukan Reviewer</span>
														</button>
													) : imp.reviewStatus ? (
														<span className="px-2 py-1 rounded bg-stone-100 text-xs font-semibold text-stone-700 self-center">
															{imp.reviewStatus === "pending" ? "Menunggu Reviewer" : imp.reviewStatus === "approved" ? "Disetujui Reviewer" : imp.reviewStatus === "rejected" ? "Ditolak Reviewer" : "Perlu Pengajuan Ulang"}
														</span>
													) : null}
													<button
														type="button"
														aria-label={`Hapus ${imp.segment?.displayName || imp.displayName || "ruas jalan"}`}
														onClick={() =>
															void deleteRoadImpactOnTabMutation.mutateAsync(
																imp.id,
															)
														}
														className="ui-button text-red-700"
														title="Hapus ruas jalan"
													>
														<Trash2 className="w-4 h-4" />
													</button>
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Organizer Reviewed Alternative Routes Manager */}
					{isRealUuidEvent ? (
						<div className="xl:col-span-12 mt-4">
							<OrganizerAlternativeRoutesManager eventId={eventId!} isOrganizer={isOrganizer} />
						</div>
					) : null}
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 3: POS PECALANG — STATUS JALAN LIVE (`field`)                   */}
			{/* =================================================================== */}
			{pathname.startsWith("/field") && fieldDetailQuery.isLoading ? <p role="status">Memeriksa penugasan...</p> : null}
			{pathname.startsWith("/field") && fieldDetailQuery.isError ? <p role="alert">Penugasan tidak dapat dimuat. <button type="button" onClick={() => void fieldDetailQuery.refetch()}>Coba lagi</button></p> : null}
			{pathname.startsWith("/field") && fieldDetailQuery.isSuccess && ((currentTabValue === "field" && !canTraffic && !isOrganizer) || (currentTabValue === "cleanup" && !canCleanup && !isOrganizer)) ? <p role="alert">Anda tidak memiliki izin untuk tugas ini.</p> : null}
			{currentTabValue === "field" && (isOrganizer || canTraffic) ? (
				<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					<div className="xl:col-span-7 workflow-panel space-y-4">
						<div className="space-y-1">
							<h2 className="teduh-workspace-card-title">
								Peta Operasional Pos Pecalang
							</h2>
							<p className="text-base text-stone-600">
								Klik ruas jalan pada peta atau pada panel kendali di sebelah
								untuk mencatat kondisi jalan yang diamati.
							</p>
						</div>

						<DashboardRoadMapInput
							mode="operational"
							height={430}
							attachedRoadImpacts={attachedRoadImpacts}
							selectedImpactId={selectedImpactId}
							onSelectImpact={setSelectedImpactId}
						/>
					</div>

					<div className="xl:col-span-5 workflow-panel space-y-4">
						<div className="space-y-1">
							<h2 className="teduh-workspace-card-title">
								Kendali Status Ruas Jalan (Pecalang)
							</h2>
							<p className="text-base text-stone-600">
								Setiap pembaruan berlaku selama 30 menit sebelum ditandai perlu
								konfirmasi ulang (`UNCONFIRMED`).
							</p>
						</div>

						<div>
							<label className="block text-base font-semibold text-stone-900 mb-1">
								Catatan Lapangan Pos Pecalang (Opsional)
							</label>
							<input
								type="text"
								data-dirty-group="traffic"
								value={fieldNote}
								onChange={(e) => setFieldNote(e.target.value)}
								placeholder="Contoh: Iring-iringan Melasti tiba di Catus Pata"
								className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
							/>
						</div>

						{eventRoadImpactsQuery.isLoading ? (
							<LoadingStateBlock
								label="Memuat ruas jalan Pos Pecalang..."
								rows={3}
							/>
						) : officerRoadList.length === 0 ? (
							<EmptyStateCard
								title={SYSTEM_STATE_MESSAGES.noMatchingRoad.title}
								description={SYSTEM_STATE_MESSAGES.noMatchingRoad.description}
								actions={
									<button
										type="button"
										onClick={() => handleTabChange("roads")}
										className="ui-button"
									>
										+ Tambah Ruas Jalan di Peta
									</button>
								}
							/>
						) : (
							<div className="space-y-3">
								{officerRoadList.map((seg) => (
									<div
										key={seg.id}
										className={`rounded border p-3.5 space-y-2.5 ${
											selectedImpactId === seg.id
												? "border-emerald-800 bg-white/40"
												: "border-stone-200 bg-white"
										}`}
									>
										<div className="flex items-start justify-between gap-2">
											<div>
												<p className="text-base font-bold text-stone-900">
													{seg.roadName}
												</p>
												<p className="text-base text-stone-600">
													{seg.corridorSection} • {seg.windowWita}
												</p>
											</div>
											<RoadStatusBadge
												status={seg.status}
												expiresAt={seg.expiresAt}
											/>
										</div>

										<div className="grid grid-cols-3 gap-2 pt-1">
											<button
												type="button"
												onClick={() =>
													setPendingStatusChange({
														segmentId: seg.id,
														roadName: seg.roadName,
														nextStatus: "closed",
													})
												}
												className={`px-2.5 py-2.5 rounded text-base font-bold border min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer ${
													seg.status === "closed"
														? "bg-red-700 text-white border-red-700 "
														: "bg-white text-red-700 border-red-300 hover:bg-red-50"
												}`}
											>
												Tutup Total
											</button>
											<button
												type="button"
												onClick={() =>
													setPendingStatusChange({
														segmentId: seg.id,
														roadName: seg.roadName,
														nextStatus: "intermittent",
													})
												}
												className={`px-2.5 py-2.5 rounded text-base font-bold border min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer ${
													seg.status === "intermittent"
														? "bg-amber-700 text-white border-amber-700 "
														: "bg-white text-amber-800 border-amber-200 hover:bg-amber-50"
												}`}
											>
												Buka-Tutup
											</button>
											<button
												type="button"
												onClick={() =>
													setPendingStatusChange({
														segmentId: seg.id,
														roadName: seg.roadName,
														nextStatus: "open",
													})
												}
												className={`px-2.5 py-2.5 rounded text-base font-bold border min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer ${
													seg.status === "open"
														? "bg-emerald-800 text-white border-emerald-800 "
														: "bg-white text-emerald-800 border-emerald-200 hover:bg-white"
												}`}
											>
												Buka Lajur
											</button>
										</div>
									</div>
								))}
							</div>
						)}

						<RoadStatusConfirmDialog
							roadName={pendingStatusChange?.roadName ?? null}
							nextStatus={pendingStatusChange?.nextStatus ?? null}
							pending={updateStatusMutation.isPending}
							onCancel={() => setPendingStatusChange(null)}
							onConfirm={() => {
								if (!pendingStatusChange) return;
								updateStatusMutation.mutate({
									impactId: pendingStatusChange.segmentId,
									nextStatus: pendingStatusChange.nextStatus,
									note: fieldNote || undefined,
								});
							}}
						/>
					</div>
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 4: KEBERSIHAN & PENCATATAN SAMPAH (`cleanup`)                   */}
			{/* =================================================================== */}
			{currentTabValue === "cleanup" && (isOrganizer || canCleanup) ? (
				<div className="space-y-6">
					<section className="rounded border border-stone-200 bg-white p-4 text-stone-900" aria-label="Independensi Kebersihan dan Pembukaan Jalan">
						<strong>Independensi Kebersihan &amp; Pembukaan Jalan</strong><p>{OPERATIONAL_DISCLAIMERS.CLEANUP_INDEPENDENCE_NOTE}</p>
					</section>

					<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
						{/* Left Column: Cleanup Tasks & Photo Evidence */}
						<div className="xl:col-span-7 space-y-6">
							<div className="workflow-panel space-y-4">
								<div className="flex items-center justify-between">
									<h2 className="teduh-workspace-card-title">
										Daftar Tugas Kebersihan Area Upacara
									</h2>
									{isOrganizer ? (
										<button
											type="button"
											onClick={() => setIsAddingTask((prev) => !prev)}
											className="ui-button ui-button-primary"
										>
											<Plus className="w-4 h-4" />
											<span>Tambah Tugas</span>
										</button>
									) : null}
								</div>

								{isAddingTask ? (
									<div data-dirty-group="task" className="rounded border border-emerald-200 bg-white p-4 space-y-3">
										<div>
											<label className="block text-base font-semibold text-stone-900 mb-1">
												Judul Tugas Kebersihan *
											</label>
											<input
												type="text"
												value={newTaskTitle}
												onChange={(e) => setNewTaskTitle(e.target.value)}
												placeholder="Contoh: Pembersihan Sisa Canang & Sampah Plastik Catus Pata"
												className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
											/>
										</div>
										<div>
											<label className="block text-base font-semibold text-stone-900 mb-1">
												Catatan Titik Lokasi
											</label>
											<input
												type="text"
												value={newTaskLocation}
												onChange={(e) => setNewTaskLocation(e.target.value)}
												placeholder="Contoh: Seputar Jaba Luar Pura Desa dan Simpang Utama"
												className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
											/>
										</div>
										<div className="flex justify-end gap-2">
											<button
												type="button"
												onClick={() => setIsAddingTask(false)}
												className="ui-button"
											>
												Batal
											</button>
											<button
												type="button"
												disabled={
													!newTaskTitle.trim() ||
													createCleanupTaskMutation.isPending
												}
												onClick={() =>
													void createCleanupTaskMutation.mutateAsync({
														title: newTaskTitle,
														locationNotes: newTaskLocation,
													})
												}
												className="ui-button ui-button-primary"
											>
												Simpan Tugas
											</button>
										</div>
									</div>
								) : null}

								{cleanupTasksQuery.data?.cleanupTasks &&
								cleanupTasksQuery.data.cleanupTasks.length > 0 ? (
									<div className="space-y-2.5">
										{cleanupTasksQuery.data.cleanupTasks.filter((task) => !taskId || task.id === taskId).map((task) => (
											<div
												key={task.id}
												className="rounded border border-stone-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
											>
												<div>
													<p className="text-base font-bold text-stone-900">
														{task.title}
													</p>
													<p className="text-base text-stone-600">
														{task.description || "Area Utama Upacara"}
													</p>
													{task.evidence && task.evidence.length > 0 ? (
														<div className="mt-2 flex flex-wrap gap-2">
															{task.evidence.map((ev) => (
																<a key={ev.id} href={`/api/cleanup-tasks/${encodeURIComponent(task.id)}/evidence/${encodeURIComponent(ev.id)}`} target="_blank" rel="noreferrer" className="block rounded border border-stone-200 overflow-hidden">
																	<img src={`/api/cleanup-tasks/${encodeURIComponent(task.id)}/evidence/${encodeURIComponent(ev.id)}`} alt={`Bukti ${ev.stage}`} className="w-20 h-16 object-cover" />
																	<span className="block text-[11px] font-semibold text-center bg-stone-100 text-stone-700 py-0.5">{ev.stage === "before" ? "Before" : "After"}</span>
																</a>
															))}
														</div>
													) : null}
												</div>
												<div className="flex flex-wrap items-center gap-2">
													<CleanupStatusBadge
														status={task.status as CleanupTaskStatus}
													/>
													{(task.status === "todo" || task.status === "reopened") && canCleanup ? (
														<button
															type="button"
															disabled={startCleanupMutation.isPending}
															onClick={() => startCleanupMutation.mutate(task.id)}
															className="ui-button ui-button-primary"
														>
															Mulai Kerjakan
														</button>
													) : null}
													{task.status === "in_progress" && canCleanup ? (
														<button
															type="button"
															onClick={() =>
																void submitCleanupMutation.mutateAsync(task.id)
															}
															className="ui-button ui-button-primary"
														>
															Serahkan Tugas
														</button>
													) : null}
													{isOrganizer && task.status === "submitted" ? (
														<>
															<button
																type="button"
																onClick={() =>
																	void verifyCleanupMutation.mutateAsync({
																		taskId: task.id,
																	})
																}
																className="ui-button ui-button-primary"
															>
																Verifikasi Prajuru
															</button>
															<button
																type="button"
																onClick={() =>
																	void reopenCleanupMutation.mutateAsync({
																		taskId: task.id,
																		reason:
																			"Perlu pembersihan ulang sisa sampah di lokasi.",
																	})
																}
																className="ui-button"
															>
																Buka Kembali
															</button>
														</>
													) : null}
												</div>
											</div>
										))}
									</div>
								) : (
									<div className="rounded border border-dashed border-stone-300 p-4 text-base text-stone-600 text-center">
										Belum ada tugas kebersihan terdaftar. Klik{" "}
										<strong>+ Tambah Tugas</strong> untuk membuat daftar tugas
										petugas kebersihan.
									</div>
								)}
							</div>

							{/* Photo Evidence Upload */}
							<div data-dirty-group="evidence" className="workflow-panel space-y-4">
								<h3 className="teduh-workspace-card-title">
									Unggah Bukti Foto Kebersihan Lapangan
								</h3>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Pilih Tugas Kebersihan
										</label>
										<select
											value={taskId ?? selectedTaskForEvidence}
											disabled={Boolean(taskId)}
											onChange={(e) =>
												setSelectedTaskForEvidence(e.target.value)
											}
											className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
										>
											<option value="">-- Pilih tugas --</option>
											{cleanupTasksQuery.data?.cleanupTasks?.map((t) => (
												<option key={t.id} value={t.id}>
													{t.title} ({t.status})
												</option>
											))}
											{!cleanupTasksQuery.data?.cleanupTasks?.length ? (
												<option value="">
													-- Buat tugas terlebih dahulu --
												</option>
											) : null}
										</select>
									</div>

									<div>
										<label className="block text-base font-semibold text-stone-900 mb-1">
											Tahap Dokumentasi Foto
										</label>
										<select
											value={evidenceStage}
											onChange={(e) =>
												setEvidenceStage(e.target.value as "before" | "after")
											}
											className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
										>
											<option value="before">
												Sebelum Pembersihan (Before)
											</option>
											<option value="after">Setelah Pembersihan (After)</option>
										</select>
									</div>
								</div>

								<label className="flex flex-col items-center justify-center rounded border-2 border-dashed border-emerald-200 bg-white p-5 text-center cursor-pointer hover:bg-white transition-colors">
									<Upload className="w-6 h-6 text-emerald-800 mb-1.5" />
									<span className="text-base font-bold text-stone-900">
										{uploadCleanupEvidenceMutation.isPending
											? "Mengunggah foto..."
											: "Klik untuk Mengunggah Foto Bukti (JPG/PNG, maksimal 5 MB)"}
									</span>
									<input
										type="file"
										accept="image/jpeg,image/png"
										disabled={uploadCleanupEvidenceMutation.isPending}
										onChange={(e) => {
											const f = e.target.files?.[0];
											if (f) {
												uploadCleanupEvidenceMutation.mutate(f);
												e.target.value = "";
											}
										}}
										className="sr-only"
									/>
								</label>
							</div>
						</div>

						{/* Right Column: Waste Quantity Recording */}
						<div data-dirty-group="waste" className="xl:col-span-5 workflow-panel space-y-4">
							<div className="space-y-1">
								<h2 className="teduh-workspace-card-title">
									Pencatatan Timbunan Sampah Pasca-Upacara
								</h2>
								<p className="text-base text-stone-600">
									Pisahkan secara jujur antara berat terukur (ditimbang) dan
									estimasi / jumlah karung sesuai standar Rangkai.
								</p>
							</div>

							<div className="space-y-3">
								<div className="rounded border border-stone-200 bg-white p-3 space-y-2">
									<label className="block text-base font-bold text-stone-900">
										1. Sampah Organik / Canang &amp; Janur (Kg)
									</label>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
										<input
											type="number"
											min="0"
											step="0.5"
											value={organicKg}
											onChange={(e) => setOrganicKg(e.target.value)}
											placeholder="Berat (Kg)"
											className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
										/>
										<select
											value={organicMethod}
											onChange={(e) =>
												setOrganicMethod(
													e.target.value as "weighed" | "estimated",
												)
											}
											className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
										>
											<option value="weighed">Ditimbang Aktual</option>
											<option value="estimated">Estimasi Petugas</option>
										</select>
									</div>
								</div>

								<div className="rounded border border-stone-200 bg-white p-3 space-y-2">
									<label className="block text-base font-bold text-stone-900">
										2. Sampah Daur Ulang / Botol &amp; Plastik (Kg)
									</label>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
										<input
											type="number"
											min="0"
											step="0.5"
											value={recyclableKg}
											onChange={(e) => setRecyclableKg(e.target.value)}
											placeholder="Berat (Kg)"
											className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
										/>
										<select
											value={recyclableMethod}
											onChange={(e) =>
												setRecyclableMethod(
													e.target.value as "weighed" | "estimated",
												)
											}
											className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
										>
											<option value="weighed">Ditimbang Aktual</option>
											<option value="estimated">Estimasi Petugas</option>
										</select>
									</div>
								</div>

								<div className="rounded border border-stone-200 bg-white p-3 space-y-2">
									<label className="block text-base font-bold text-stone-900">
										3. Sampah Residu (Jumlah Karung)
									</label>
									<input
										type="number"
										min="0"
										step="1"
										value={residualSacks}
										onChange={(e) => setResidualSacks(e.target.value)}
										placeholder="Contoh: 8 karung"
										className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
									/>
								</div>

								<button
									type="button"
									disabled={recordWasteMutation.isPending}
									onClick={() => void recordWasteMutation.mutateAsync()}
									className="ui-button ui-button-primary w-full"
								>
									<Save className="w-3.5 h-3.5" />
									<span>
										{recordWasteMutation.isPending
											? "Menyimpan..."
											: "Simpan Catatan Sampah"}
									</span>
								</button>
							</div>
						</div>
					</div>

					{/* Post-Event Waste Logistics & Scenario Planning Tool */}
					{isRealUuidEvent && isOrganizer ? (
						<div className="xl:col-span-12 mt-4">
							<WasteScenarioPanel eventId={eventId!} />
						</div>
					) : null}
				</div>
			) : null}

			{pathname.startsWith("/field") && currentTabValue === "field" && (isOrganizer || canTraffic) && (isOrganizer || canCleanup) ? (
				<nav className="field-workflow-navigation" aria-label="Tahap tugas lapangan">
					<Link className="ui-button ui-button-primary" to={`/field/events/${eventId}/cleanup`}>
						Selanjutnya: Kebersihan
					</Link>
				</nav>
			) : null}
			{pathname.startsWith("/field") && currentTabValue === "cleanup" && (isOrganizer || canCleanup) && (isOrganizer || canTraffic) ? (
				<nav className="field-workflow-navigation" aria-label="Tahap tugas lapangan">
					<Link className="ui-button" to={`/field/events/${eventId}/traffic`}>
						Kembali ke lalu lintas
					</Link>
				</nav>
			) : null}

			{/* =================================================================== */}
			{/* TAB 5: TIM LAPANGAN & UNDANGAN PETUGAS (`team`)                     */}
			{/* =================================================================== */}
			{currentTabValue === "team" ? (
				<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					{/* Left Column: Generate One-Time Invitation Link & Direct Assign */}
					<div className="xl:col-span-5 space-y-6">
						<div data-dirty-group="invite" className="workflow-panel space-y-4">
							<div className="space-y-1">
								<h2 className="teduh-workspace-card-title">
									Buat Tautan Undangan Petugas
								</h2>
								<p className="text-base text-stone-600 mt-1 leading-relaxed">
									Hasilkan tautan undangan resmi sekali pakai (berlaku 7 hari)
									untuk dibagikan kepada Pecalang atau petugas kebersihan via WhatsApp.
								</p>
							</div>

							<div className="flex flex-col gap-3">
								<div>
									<label htmlFor="invitation-email" className="block text-base font-semibold text-stone-900 mb-1">
										Email Penerima Undangan *
									</label>
									<input
										id="invitation-email"
										type="email"
										required
										value={inviteEmail}
										onChange={(e) => setInviteEmail(e.target.value)}
										placeholder="contoh: pecalang.desa@rangkai.local"
										className="teduh-form-input text-base text-stone-900 bg-white border-stone-200"
									/>
								</div>

								<div>
									<label htmlFor="invitation-role" className="block text-base font-semibold text-stone-900 mb-1">
										Peran Undangan
									</label>
									<select
										id="invitation-role"
										value={inviteRole}
										onChange={(e) =>
											setInviteRole(
												e.target.value === "organizer" ? "organizer" : "officer",
											)
										}
										className="teduh-form-select text-base text-stone-900 bg-white border-stone-200"
									>
										<option value="officer">
											Petugas Lapangan (Pecalang / Kebersihan)
										</option>
										<option value="organizer">
											Panitia Penyelenggara (Organizer)
										</option>
									</select>
								</div>

								{inviteRole === "officer" ? (
									<fieldset className="flex flex-col gap-2 pt-1">
										<legend className="block text-base font-semibold text-stone-900">
											Hak Akses Penugasan Lapangan:
										</legend>
										<label className="flex items-start gap-2.5 rounded border border-stone-200 bg-white p-3 cursor-pointer hover:bg-white transition-colors">
											<input
												type="checkbox"
												checked={inviteCanTraffic}
												onChange={(e) => setInviteCanTraffic(e.target.checked)}
												className="mt-1 rounded border-stone-300 text-emerald-800"
											/>
											<div className="text-base">
												<span className="font-bold text-stone-900 block">
													Wewenang Status Jalan
												</span>
												<span className="text-stone-600 text-sm">
													Dapat memperbarui status buka/tutup ruas jalan di Pos Pecalang
												</span>
											</div>
										</label>

										<label className="flex items-start gap-2.5 rounded border border-stone-200 bg-white p-3 cursor-pointer hover:bg-white transition-colors">
											<input
												type="checkbox"
												checked={inviteCanCleanup}
												onChange={(e) => setInviteCanCleanup(e.target.checked)}
												className="mt-1 rounded border-stone-300 text-emerald-800"
											/>
											<div className="text-base">
												<span className="font-bold text-stone-900 block">
													Wewenang Kebersihan
												</span>
												<span className="text-stone-600 text-sm">
													Dapat mengunggah foto bukti &amp; menyerahkan tugas kebersihan
												</span>
											</div>
										</label>
									</fieldset>
								) : null}
							</div>

							<button
								type="button"
								disabled={
									generateInviteMutation.isPending ||
									!inviteEmail.trim() ||
									(inviteRole === "officer" &&
										!inviteCanTraffic &&
										!inviteCanCleanup)
								}
								onClick={() => {
									generateInviteMutation.mutate();
								}}
								className="ui-button ui-button-primary w-full"
							>
								<UserPlus className="w-4 h-4" />
								<span>
									{generateInviteMutation.isPending
										? "Membuat Tautan Undangan..."
										: "Buat Tautan Undangan Petugas"}
								</span>
							</button>

							{generatedInviteUrl ? (
								<div className="rounded border border-emerald-300 bg-white p-3.5 space-y-2">
									<span className="text-base font-semibold text-emerald-800 block">
										Tautan undangan siap dibagikan:
									</span>
									<div className="flex items-center gap-2">
										<input
											type="text"
											readOnly
											value={generatedInviteUrl}
											className="flex-1 rounded border border-emerald-300 bg-white px-3 py-2 text-base font-mono text-stone-900"
										/>
										<button
											type="button"
											onClick={async () => {
												try {
													await navigator.clipboard.writeText(generatedInviteUrl);
													setStatusFeedback({
														type: "info",
														message: "Tautan undangan berhasil disalin ke papan klip.",
													});
												} catch {
													setStatusFeedback({
														type: "error",
														message:
															"Gagal menyalin tautan otomatis. Pilih dan salin teks tautan secara manual.",
													});
												}
											}}
											className="ui-button ui-button-primary shrink-0"
										>
											<Copy className="w-4 h-4" />
											<span>Salin</span>
										</button>
									</div>
								</div>
							) : null}
						</div>

						{/* Daftar Undangan Organisasi */}
						<div className="workflow-panel space-y-3">
							<div className="flex items-center justify-between">
								<h3 className="teduh-workspace-card-title">
									Daftar Tautan Undangan Organisasi
								</h3>
								<span className="px-2 py-0.5 rounded-md bg-white text-base font-semibold text-stone-600">
									{invitationsQuery.data?.invitations?.length ?? 0}
								</span>
							</div>

							{invitationsQuery.isLoading ? (
								<LoadingStateBlock label="Memuat daftar undangan..." rows={2} />
							) : invitationsQuery.isError ? (
								<div className="p-3 rounded border border-red-300 bg-red-50 text-base text-red-700 space-y-2">
									<p>Undangan tidak dapat dimuat.</p>
									<button
										type="button"
										onClick={() => void invitationsQuery.refetch()}
										className="ui-button"
									>
										Coba lagi
									</button>
								</div>
							) : !invitationsQuery.data?.invitations?.length ? (
								<p className="text-base text-stone-600 py-2">
									Belum ada tautan undangan yang dibuat.
								</p>
							) : (
								<div className="space-y-2 max-h-64 overflow-y-auto pr-1">
									{invitationsQuery.data.invitations.map((invitation) => (
										<div
											key={invitation.id}
											className="rounded border border-stone-200 bg-white p-3 flex items-center justify-between gap-2"
										>
											<div className="min-w-0 space-y-1">
												<p className="text-base font-semibold text-stone-900 truncate">
													{invitation.recipientEmail}
												</p>
												<div className="flex flex-wrap items-center gap-1 text-base">
													<span className="px-1.5 py-0.5 rounded bg-white text-emerald-800 font-medium">
														{invitation.role === "organizer"
															? "Panitia"
															: "Petugas Lapangan"}
													</span>
													<span
														className={`px-1.5 py-0.5 rounded font-medium ${
															invitation.status === "pending"
																? "bg-amber-100 text-amber-800"
																: invitation.status === "accepted"
																	? "bg-emerald-100 text-emerald-900"
																	: "bg-white text-stone-500"
														}`}
													>
														{invitation.status === "pending"
															? "Menunggu"
															: invitation.status === "accepted"
																? "Diterima"
																: "Dibatalkan"}
													</span>
												</div>
											</div>

											{invitation.status === "pending" ? (
												<button
													type="button"
													disabled={revokeInvitationMutation.isPending}
													onClick={() =>
														revokeInvitationMutation.mutate(invitation.id)
													}
													className="ui-button text-red-700 shrink-0"
												>
													Batalkan
												</button>
											) : null}
										</div>
									))}
								</div>
							)}
						</div>


						{/* Direct Assign by User ID */}
						<div data-dirty-group="assignment" className="workflow-panel space-y-3">
							<h3 className="teduh-workspace-card-title">
								Penugasan Langsung via ID Akun
							</h3>
							<p className="text-base text-stone-600">
								Jika petugas sudah memiliki akun di Desa Adat ini, masukkan ID
								Akun mereka untuk menugaskan secara langsung.
							</p>
							<div className="flex gap-2">
								<input
									type="text"
									value={directOfficerUserId}
									onChange={(e) => setDirectOfficerUserId(e.target.value)}
									placeholder="Masukkan ID Akun Petugas..."
									className="flex-1 teduh-form-input text-base text-stone-900 bg-white border-stone-200"
								/>
								<button
									type="button"
									disabled={
										!directOfficerUserId.trim() ||
										directAssignMutation.isPending
									}
									onClick={() => void directAssignMutation.mutateAsync()}
									className="ui-button"
								>
									Tugaskan
								</button>
							</div>
						</div>
					</div>

					{/* Right Column: Assigned Officers List */}
					<div className="xl:col-span-7 workflow-panel space-y-4">
						<div className="flex items-center justify-between">
							<h2 className="teduh-workspace-card-title">
								Daftar Petugas Lapangan Terdaftar (
								{assignmentsQuery.data?.assignments?.length ?? 0})
							</h2>
						</div>

						{assignmentsQuery.isLoading ? (
							<LoadingStateBlock label="Memuat daftar petugas..." rows={3} />
						) : !assignmentsQuery.data?.assignments?.length ? (
							<div className="rounded border border-dashed border-stone-300 p-6 text-center space-y-2 text-base text-stone-600">
								<Users className="w-7 h-7 text-stone-400 mx-auto" />
								<p className="font-bold text-stone-900">
									Belum Ada Petugas Lapangan yang Ditugaskan
								</p>
								<p className="max-w-sm mx-auto">
									Gunakan tombol <strong>Buat Tautan Undangan Petugas</strong>{" "}
									di sebelah kiri dan kirimkan ke Pecalang atau petugas
									kebersihan agar mereka dapat bergabung ke acara ini.
								</p>
							</div>
						) : (
							<div className="space-y-2.5">
								{assignmentsQuery.data.assignments.map((asg) => (
									<div
										key={asg.id}
										className="rounded border border-stone-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
									>
										<div className="space-y-1">
											<p className="text-base font-bold text-stone-900">
												{asg.userName || "Petugas Lapangan"} (
												{asg.userEmail || asg.userId})
											</p>
											<div className="flex flex-wrap items-center gap-1.5">
												{asg.canUpdateTraffic ? (
													<span className="px-2 py-0.5 rounded-md bg-white text-emerald-800 text-base font-semibold">
														Pos Pecalang
													</span>
												) : null}
												{asg.canUpdateCleanup ? (
													<span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-base font-semibold">
														Kebersihan
													</span>
												) : null}
												<span className="text-base text-stone-600">
													• Ditugaskan{" "}
													{formatWitaDateTime(asg.assignedAt || asg.createdAt)}
												</span>
											</div>
										</div>

										<button
											type="button"
											disabled={revokeAssignmentMutation.isPending}
											onClick={() =>
												void revokeAssignmentMutation.mutateAsync(asg.id)
											}
											className="ui-button text-red-700 shrink-0"
										>
											<Trash2 className="w-4 h-4" />
											<span>Cabut Tugas</span>
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			) : null}
		</div>

	);
}
