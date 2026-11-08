import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Token } from "@astryxdesign/core/Token";
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
	Link2,
	MapPin,
	MapPinned,
	Milestone,
	Navigation,
	PackageCheck,
	PenTool,
	Plus,
	Radio,
	Save,
	Scale,
	Search,
	Send,
	ShieldCheck,

	Sparkles,
	Trash2,
	Upload,

	UserPlus,
	Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
	CleanupStatusBadge,
	type CleanupTaskStatus,
	EmptyStateCard,
	EventLifecycleBadge,
	LoadingStateBlock,
	RoadStatusBadge,
} from "../components/rangkai";
import { BaliMapTilerView } from "../features/map/BaliMapTilerView";
import { DashboardRoadMapInput } from "../features/map/DashboardRoadMapInput";
import { TeduhSpatialMapConsole } from "../features/map/TeduhSpatialMapConsole";
import { type BaliVillageCeremonyProfile } from "../lib/bali-villages";
import { OPERATIONAL_DISCLAIMERS } from "../lib/constants";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";
import {
	assignEventOfficer,
	createCleanupTask,
	createRoadImpact,
	createRoadSegment,
	createWasteRecord,
	deleteRoadImpact,
	fetchCleanupTasks,
	fetchEventAssignments,
	fetchEventDetail,
	fetchEventRoadImpacts,
	fetchPublicCleanupSummary,
	fetchPublicEventDetail,
	fetchPublicEventRoads,
	fetchPublicEvents,

	fetchFieldEventDetail,

	fetchRoadSegments,

	formatWitaEventSchedule,
	fromIsoToWitaInput,
	mapPublicEventToCeremonyProfile,
	normalizeEventCategory,
	publishVerifiedEvent,
	reopenCleanupTask,
	revokeEventAssignment,
	saveExtractedFields,
	submitCleanupTask,
	toWitaIsoTimestamp,
	transitionEventToReview,
	triggerDocumentExtraction,
	updateRoadStatus,
	uploadCleanupEvidence,
	uploadEventDocument,
	verifyCleanupTask,
} from "../lib/events-api";
import { createInvitation } from "../lib/auth";
import { useGsapPageReveal } from "../lib/gsap-motion";
import type { OperationalRoadStatus } from "../lib/road-status";
import { formatWitaDateTime, formatWitaRange } from "../lib/wita";
import { IMPACT_TYPE_OPTIONS, getImpactTypeLabel } from "./EventWizardPage";
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

					<div className="schedule-filter-bar" style={{ marginBottom: 0 }}>
						{[
							{ id: "all", label: "Semua Jadwal" },
							{ id: "active", label: "Sedang Berlangsung" },
							{ id: "published", label: "Terjadwal" },
						].map((f) => (
							<button
								type="button"
								key={f.id}
								className={`schedule-filter-btn ${statusFilter === f.id ? "is-active" : ""}`}
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
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 8,
									background: "#264D3B",
									color: "#FFFFFF",
									padding: "10px 20px",
									borderRadius: 9999,
									fontSize: 14,
									textDecoration: "none",
								}}
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
									className="schedule-card"
									data-gsap="scroll-card"
								>
									<div>
										<div className="schedule-card-header">
											<span className="schedule-village-label">
												{evt.organizationName || evt.village} •{" "}
												{evt.district || "Bali"}
											</span>
											<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
												{evt.isSimulation ? (
													<Token color="orange" size="sm" label="SIMULASI" />
												) : null}
												<span
													className={`road-status-badge ${statusBadgeClass}`}
												>
													{statusBadgeText}
												</span>
											</div>
										</div>

										<h2 className="schedule-card-title">{evt.title}</h2>

										{evt.description ? (
											<p
												style={{
													margin: "0 0 14px 0",
													fontSize: 14.5,
													color: "#545B67",
													lineHeight: 1.55,
												}}
											>
												{evt.description}
											</p>
										) : null}

										<div className="schedule-card-meta">
											<div className="schedule-meta-row">
												<Calendar size={15} color="#64748B" />
												<span style={{ fontVariantNumeric: "tabular-nums" }}>
													{schedule.dateLabel} • {schedule.windowWita}
												</span>
											</div>
											<div className="schedule-meta-row">
												<MapPin size={15} color="#64748B" />
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
											style={{
												fontSize: 13.5,
												color: "#264D3B",
												textDecoration: "none",
												fontWeight: 500,
											}}
										>
											Lihat di Peta →
										</Link>
										<Link
											to={`/events/${eventSlug}`}
											className="btn-schedule-detail"
										>
											<span>Rincian Lengkap</span>
											<ArrowRight size={14} />
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

	const apiEvent = publicEventQuery.data?.event;
	const rawRoads = useMemo(
		() => liveRoadsQuery.data?.roads ?? liveRoadsQuery.data?.roadImpacts ?? [],
		[liveRoadsQuery.data],
	);

	const spatialProfile: BaliVillageCeremonyProfile | null = useMemo(() => {
		if (!apiEvent) return null;
		return mapPublicEventToCeremonyProfile(apiEvent, rawRoads, 0);
	}, [apiEvent, rawRoads]);

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
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 8,
									background: "#264D3B",
									color: "#FFFFFF",
									padding: "10px 20px",
									borderRadius: 9999,
									fontSize: 14,
									textDecoration: "none",
								}}
							>
								<ArrowLeft size={15} />
								<span>Kembali ke Jadwal Upacara</span>
							</Link>
							<Link
								to="/peta"
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 8,
									background: "#F4F4F3",
									color: "#181B20",
									padding: "10px 20px",
									borderRadius: 9999,
									fontSize: 14,
									textDecoration: "none",
								}}
							>
								<span>Buka Peta Kawasan</span>
							</Link>
						</div>
					</div>
				</div>
			</main>
		);
	}

	const activeSegmentId =
		selectedSegmentId || spatialProfile.roadSegments[0]?.id || "";
	const schedule = formatWitaEventSchedule(apiEvent.startsAt, apiEvent.endsAt);
	const cleanupData = cleanupSummaryQuery.data;

	if (mapOnly) {
		return (
			<div style={{ width: "100%", height: "100dvh", position: "relative" }}>
				<div
					style={{
						position: "absolute",
						top: 16,
						left: 16,
						zIndex: 20,
						display: "flex",
						gap: 8,
					}}
				>
					<Link
						to={`/events/${spatialProfile.slug}`}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 8,
							background: "rgba(255, 255, 255, 0.96)",
							color: "#181B20",
							padding: "10px 18px",
							borderRadius: 9999,
							fontSize: 13.5,
							fontWeight: 500,
							textDecoration: "none",
							boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
						}}
					>
						<ArrowLeft size={15} />
						<span>Kembali ke Rincian Acara</span>
					</Link>
				</div>
				<BaliMapTilerView
					village={spatialProfile}
					allVillages={[spatialProfile]}
					selectedSegmentId={activeSegmentId}
					onSelectSegment={setSelectedSegmentId}
					height="100%"
				/>
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

					<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexWrap: "wrap",
							gap: 10,
							marginBottom: 12,
						}}
					>
						<span className="schedule-village-label">
							{apiEvent.organizationName} • {apiEvent.village},{" "}
							{apiEvent.district}
						</span>
						<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
							{apiEvent.category ? (
								<span
									style={{
										background: "#F4F4F3",
										color: "#545B67",
										padding: "4px 12px",
										borderRadius: 9999,
										fontSize: 12.5,
										fontWeight: 500,
									}}
								>
									{apiEvent.category}
								</span>
							) : null}
							<RoadStatusBadge status={spatialProfile.primaryStatus} />
						</div>
					</div>

					{apiEvent.isSimulation ? (
						<div style={{ marginBottom: 16 }}>
							<Banner
								status="warning"
								collapsible={false}
								title="SIMULASI — Bukan Penutupan Jalan Sebenarnya"
								description="Kegiatan ini dipublikasikan dalam mode simulasi atau latihan koordinasi desa adat. Ruas jalan dan status buka-tutup tidak mencerminkan penutupan operasional resmi di lapangan."
							/>
						</div>
					) : null}

					<h1 className="teduh-detail-title">{apiEvent.title}</h1>

					{/* Core Metadata Grid (Waktu WITA, Lokasi Utama, Penanggung Jawab) */}
					<div className="teduh-detail-meta-grid">
						<div className="teduh-meta-block">
							<span className="teduh-meta-label">Waktu Pelaksanaan (WITA)</span>
							<div className="teduh-meta-value">
								<Clock size={16} color="#264D3B" />
								<span style={{ fontVariantNumeric: "tabular-nums" }}>
									{schedule.dateLabel} • {schedule.windowWita}
								</span>
							</div>
						</div>

						<div className="teduh-meta-block">
							<span className="teduh-meta-label">Lokasi & Wilayah Adat</span>
							<div className="teduh-meta-value">
								<MapPin size={16} color="#264D3B" />
								<span>
									{apiEvent.venueName || apiEvent.village || apiEvent.organizationName}
								</span>
							</div>
						</div>

						<div className="teduh-meta-block">
							<span className="teduh-meta-label">Penyelenggara Terverifikasi</span>
							<div className="teduh-meta-value">
								<ShieldCheck size={16} color="#264D3B" />
								<span>
									{apiEvent.organizerName || apiEvent.organizationName}
								</span>
							</div>
						</div>

						<div className="teduh-meta-block">
							<span className="teduh-meta-label">Ruas Jalan Terdampak</span>
							<div className="teduh-meta-value">
								<Navigation size={16} color="#264D3B" />
								<span>
									{rawRoads.length} Ruas ({spatialProfile.primaryStatus === "closed" ? "Tutup Total" : spatialProfile.primaryStatus === "intermittent" ? "Buka-Tutup" : "Normal"})
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
										<FileText size={15} color="#264D3B" />
										<span>Deskripsi Kegiatan</span>
									</h3>
									<p className="teduh-card-body">{apiEvent.description}</p>
								</div>
							) : null}

							{apiEvent.processionDescription ? (
								<div className="teduh-surface-card" data-gsap="scroll-card">
									<h3 className="teduh-card-label">
										<Milestone size={15} color="#264D3B" />
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
										<AlertTriangle size={15} color="#264D3B" />
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
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "baseline",
							flexWrap: "wrap",
							gap: 12,
							marginBottom: 20,
						}}
					>
						<div>
							<h2 className="teduh-section-heading">
								Peta Lokasi & Ruas Jalan Terdampak ({rawRoads.length})
							</h2>
							<p style={{ margin: 0, fontSize: 15, color: "#545B67" }}>
								Klik salah satu ruas jalan di daftar untuk menyorot koridor pada
								peta.
							</p>
						</div>
					</div>

					<div className="teduh-roads-split">
						{/* Left: Verified Road Impacts List */}
						<div className="teduh-roads-list">
							{liveRoadsQuery.isLoading ? (
								<div className="teduh-surface-card">
									<p style={{ margin: 0, fontSize: 15, color: "#545B67" }}>
										Memuat data ruas jalan terverifikasi...
									</p>
								</div>
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
									const effStatus =
										road.operationalStatus?.effectiveStatus === "unconfirmed"
											? "unknown"
											: ((road.operationalStatus?.effectiveStatus ??
													"intermittent") as OperationalRoadStatus);

									return (
										<button
											type="button"
											key={road.id}
											onClick={() => setSelectedSegmentId(road.id)}
											className={`teduh-road-item ${isSelected ? "is-selected" : ""}`}
											data-gsap="scroll-card"
										>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
													gap: 10,
													marginBottom: 8,
												}}
											>
												<span
													style={{
														fontSize: 16,
														fontWeight: 500,
														color: "#181B20",
													}}
												>
													{idx + 1}. {road.displayName || "Ruas Jalan Terdampak"}
												</span>
												<RoadStatusBadge
													status={effStatus}
													expiresAt={road.operationalStatus?.expiresAt}
												/>
											</div>

											<div
												style={{
													fontSize: 14,
													color: "#545B67",
													marginBottom: 6,
													lineHeight: 1.5,
												}}
											>
												Arahan Pengalihan:{" "}
												<strong style={{ color: "#181B20", fontWeight: 500 }}>
													{road.diversionNote ||
														apiEvent.trafficImpactDescription ||
														"Ikuti arahan petugas Pecalang di lapangan."}
												</strong>
											</div>

											<div
												style={{
													fontSize: 13,
													color: "#64748B",
													fontVariantNumeric: "tabular-nums",
												}}
											>
												{road.coverageArea || apiEvent.village} • Berlaku:{" "}
												{roadSchedule.dateLabel} ({roadSchedule.windowWita})
											</div>
										</button>
									);
								})
							)}
						</div>

						{/* Right: Interactive Map Canvas */}
						<div className="teduh-roads-map-box">
							<BaliMapTilerView
								village={spatialProfile}
								allVillages={[spatialProfile]}
								selectedSegmentId={activeSegmentId}
								onSelectSegment={setSelectedSegmentId}
								height="100%"
							/>
						</div>
					</div>
				</section>

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
									<ClipboardCheck size={15} color="#264D3B" />
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
									<Scale size={15} color="#264D3B" />
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
									<PackageCheck size={15} color="#264D3B" />
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
						<Info size={18} color="#264D3B" />
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
	const { id: eventId = "" } = useParams<{ id: string }>();
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

	const fieldDetailQuery = useQuery({
		queryKey: ["field", "events", eventId],
		queryFn: () => fetchFieldEventDetail(eventId),
		enabled: Boolean(eventId && isRealUuidEvent),
		retry: false,
	});
	const permissions = fieldDetailQuery.data?.permissions;
	const isOrganizer = permissions?.isOrganizer ?? false;
	const canTraffic = permissions?.canUpdateTraffic ?? false;
	const canCleanup = permissions?.canUpdateCleanup ?? false;

	const roadSegmentsCatalogQuery = useQuery({
		queryKey: ["road-segments", "catalog"],
		queryFn: () => fetchRoadSegments(),
		enabled: Boolean(pathname.endsWith("/roads")),
		staleTime: 60_000,
	});

	const cleanupTasksQuery = useQuery({
		queryKey: ["cleanup-tasks", eventId],
		queryFn: () => fetchCleanupTasks(eventId),
		enabled: Boolean(isRealUuidEvent && pathname.endsWith("/cleanup")),
		retry: false,
	});

	const assignmentsQuery = useQuery({
		queryKey: ["events", eventId, "assignments"],
		queryFn: () => fetchEventAssignments(eventId),
		enabled: Boolean(isRealUuidEvent && pathname.endsWith("/team")),
		retry: false,
	});

	const rawEvent = eventDetailQuery.data?.event;
	const attachedRoadImpacts = useMemo(
		() => eventRoadImpactsQuery.data?.roadImpacts ?? [],
		[eventRoadImpactsQuery.data?.roadImpacts],
	);
	const catalogSegments = roadSegmentsCatalogQuery.data?.segments ?? [];

	// Document & Review Tab State
	const [docTitle, setDocTitle] = useState("");
	const [docVenue, setDocVenue] = useState("");
	const [docStartsWita, setDocStartsWita] = useState("");
	const [docEndsWita, setDocEndsWita] = useState("");
	const [docTrafficNote, setDocTrafficNote] = useState("");
	const [docPermitRef, setDocPermitRef] = useState("");
	const [hydratedDocEventId, setHydratedDocEventId] = useState<string | null>(
		null,
	);

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

	// Roads Tab State ("draw" vs "catalog")
	const [roadInputMode, setRoadInputMode] = useState<"draw" | "catalog">(
		"draw",
	);
	const [draftCoordinates, setDraftCoordinates] = useState<[number, number][]>(
		[],
	);
	const [newSegmentName, setNewSegmentName] = useState("");
	const [newSegmentArea, setNewSegmentArea] = useState("Bali");
	const [humanVerifiedRoad, setHumanVerifiedRoad] = useState(true);
	const [selectedCatalogSegmentId, setSelectedCatalogSegmentId] =
		useState<string>("");
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
		nextStatus: OperationalRoadStatus;
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
		useState<string>("");

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
				message: `Surat edaran berhasil diekstrak oleh ${ext.modelName}. Silakan periksa dan simpan perubahan.`,
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
		mutationFn: async (markReviewed: boolean) => {
			if (!isRealUuidEvent) {
				throw new Error("Kegiatan belum memiliki UUID valid.");
			}
			await saveExtractedFields(eventId, {
				title: docTitle.trim() || rawEvent?.title || "Upacara Adat",
				category: normalizeEventCategory(rawEvent?.category) || "upacara_adat",
				venueName: docVenue.trim() || null,
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
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", eventId],
			});
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			setStatusFeedback({
				type: "success",
				message: markReviewed
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
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", eventId],
			});
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			setStatusFeedback({
				type: "success",
				message:
					"Pengumuman upacara resmi diterbitkan ke portal publik dan peta warga!",
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

			const segRes = await createRoadSegment({
				displayName: newSegmentName.trim(),
				coverageArea:
					newSegmentArea.trim() || rawEvent?.venueName || "Kawasan Desa Adat",
				coordinates: draftCoordinates,
				humanVerified: true,
			});

			await createRoadImpact(eventId, {
				roadSegmentId: segRes.segment.id,
				impactType: selectedImpactType,
				plannedFrom: rawEvent?.startsAt || null,
				plannedTo: rawEvent?.endsAt || null,
				diversionNote: impactDiversionNote.trim() || null,
			});
			return segRes.segment.displayName;
		},
		onSuccess: async (segName) => {
			setDraftCoordinates([]);
			setNewSegmentName("");
			setImpactDiversionNote("");
			await queryClient.invalidateQueries({
				queryKey: ["road-segments", "catalog"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["events", eventId, "road-impacts"],
			});
			setStatusFeedback({
				type: "success",
				message: `Ruas jalan "${segName}" berhasil digambar, diverifikasi, dan ditautkan ke kegiatan ini.`,
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
		mutationFn: async (roadSegmentId: string) => {
			if (!isRealUuidEvent) {
				throw new Error("Simpan kegiatan terlebih dahulu.");
			}
			return createRoadImpact(eventId, {
				roadSegmentId,
				impactType: selectedImpactType,
				plannedFrom: rawEvent?.startsAt || null,
				plannedTo: rawEvent?.endsAt || null,
				diversionNote: impactDiversionNote.trim() || null,
			});
		},
		onSuccess: async () => {
			setSelectedCatalogSegmentId("");
			setImpactDiversionNote("");
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
			void cleanupTasksQuery.refetch();
			setNewTaskTitle("");
			setNewTaskLocation("");
			setIsAddingTask(false);
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
		mutationFn: async (file: File) => {
			const tasks = cleanupTasksQuery.data?.cleanupTasks ?? [];
			const targetTask =

				tasks.find((t) => t.id === selectedTaskForEvidence) || tasks[0];

			if (!targetTask) {
				throw new Error(
					"Buat minimal 1 tugas kebersihan terlebih dahulu sebelum mengunggah foto bukti.",
				);
			}
			return uploadCleanupEvidence(targetTask.id, file, evidenceStage);
		},
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setStatusFeedback({
				type: "success",
				message: `Foto bukti tahap "${evidenceStage.toUpperCase()}" berhasil diunggah ke Cloudflare R2.`,
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
			setOrganicKg("");
			setRecyclableKg("");
			setResidualSacks("");
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

				tasks.find((t) => t.id === params?.taskId) || tasks[0];
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
		mutationFn: async () => {
			if (!isRealUuidEvent) {
				throw new Error("Simpan kegiatan terlebih dahulu.");
			}
			return createInvitation({
				organizationId: rawEvent?.organizationId,
				eventId: inviteRole === "officer" ? eventId : undefined,
				role: inviteRole,
				recipientEmail: inviteEmail,
				canUpdateTraffic: inviteRole === "officer" && inviteCanTraffic,
				canUpdateCleanup: inviteRole === "officer" && inviteCanCleanup,
			});
		},
		onSuccess: (res) => {
			setGeneratedInviteUrl(res.invitation.inviteUrl ?? null);
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
			setDirectOfficerUserId("");
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

	const currentTabValue = useMemo(() => {
		if (pathname.endsWith("/document") || pathname.endsWith("/review")) {
			return "document";
		}
		if (pathname.endsWith("/roads")) return "roads";
		if (pathname.endsWith("/cleanup")) return "cleanup";
		if (pathname.endsWith("/team")) return "team";
		if (pathname.startsWith("/field")) {
			if (!isOrganizer && !canTraffic && canCleanup) {
				return "cleanup";
			}
			return "field";
		}
		return "field";
	}, [pathname, isOrganizer, canTraffic, canCleanup]);

	function handleTabChange(nextTab: string) {
		setStatusFeedback(null);
		switch (nextTab) {
			case "document":
				navigate(`/dashboard/events/${eventId}/review`);
				break;
			case "roads":
				navigate(`/dashboard/events/${eventId}/roads`);
				break;
			case "field":
				navigate(`/field/events/${eventId}`);
				break;
			case "cleanup":
				navigate(`/dashboard/events/${eventId}/cleanup`);
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

	const WORKFLOW_TABS = [
		{ id: "document", label: "Surat Edaran & Review", icon: FileText },
		{ id: "roads", label: "Peta & Ruas Jalan", icon: MapPinned },
		{ id: "field", label: "Pos Pecalang (Live)", icon: Radio },
		{ id: "cleanup", label: "Kebersihan & Sampah", icon: ClipboardCheck },
		{ id: "team", label: "Tim & Undangan Petugas", icon: Users },
	];

	return (
		<div>
			{/* Header Workspace */}
			<div className="teduh-workspace-header">
				<div>
					<div className="teduh-workspace-eyebrow">
						<ShieldCheck className="w-3.5 h-3.5" />
						<span>
							Ruang Kerja Operasional Upacara •{" "}
							{rawEvent?.venueName || "Desa Adat Bali"}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="teduh-workspace-title">
							{rawEvent?.title || title}
						</h1>
						{rawEvent ? (
							<EventLifecycleBadge status={rawEvent.status} />
						) : null}
					</div>
					<p className="teduh-workspace-subtitle">{subtitle}</p>
				</div>


				<div className="flex flex-wrap items-center gap-2">
					<Link
						to="/dashboard"
						className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"

					>
						<ArrowLeft className="w-3.5 h-3.5" />
						<span>Daftar Upacara</span>
					</Link>
					{isRealUuidEvent ? (
						<Link
							to={`/dashboard/events/${eventId}`}
							className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] no-underline"
						>
							<Sparkles className="w-3.5 h-3.5" />
							<span>Buka Wizard Lengkap</span>
						</Link>
					) : null}
				</div>
			</div>

			{/* Workflow Module Navigation Tabs */}
			<div className="flex flex-wrap items-center gap-2 mb-6 border-b border-[#E5E3DC] pb-3">
				{WORKFLOW_TABS.map((tab) => {
					const IconComp = tab.icon;
					const active = currentTabValue === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							onClick={() => handleTabChange(tab.id)}
							className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
								active
									? "bg-[#264D3B] text-white shadow-xs"
									: "bg-white border border-[#E5E3DC] text-[#585854] hover:text-[#181817] hover:bg-[#F3F1EC]"
							}`}
						>
							<IconComp className="w-3.5 h-3.5" />
							<span>{tab.label}</span>
						</button>
					);
				})}
			</div>

			{/* Status Feedback Banner */}
			{statusFeedback ? (
				<div className="mb-6">
					<Banner
						status={statusFeedback.type}
						collapsible={false}
						title="Informasi Operasional"
						description={statusFeedback.message}
					/>
				</div>
			) : null}

			{!isRealUuidEvent ? (
				<div className="mb-6">
					<Banner
						status="warning"
						collapsible={false}
						title="Pilih Kegiatan Upacara yang Valid"
						description="URL ini belum merujuk pada UUID kegiatan yang tersimpan di pangkalan data. Silakan pilih kegiatan dari Dashboard atau buat pengumuman baru."
					/>
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 1: SURAT EDARAN & PEMERIKSAAN PRAJURU (`document`)              */}
			{/* =================================================================== */}
			{currentTabValue === "document" ? (
				<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					<div className="xl:col-span-5 teduh-workspace-card space-y-4">
						<div className="border-b border-[#F0EFEA] pb-3">
							<h2 className="teduh-workspace-card-title">
								Unggah Surat Edaran &amp; Ekstraksi AI
							</h2>
							<p className="text-xs text-[#585854] mt-0.5">
								Unggah berkas surat pengumuman Desa Adat (PDF/JPG/PNG) untuk
								diekstrak otomatis oleh Google Gemini.
							</p>
						</div>

						<div className="rounded-2xl border-2 border-dashed border-[#C7DBD0] bg-[#F6FAF7] p-6 text-center space-y-3">
							<Upload className="w-7 h-7 text-[#264D3B] mx-auto" />
							<p className="text-xs font-bold text-[#181817]">
								Berkas Surat Edaran Desa Adat (Maks. 10 MB)
							</p>
							<label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] cursor-pointer">
								<Upload className="w-3.5 h-3.5" />
								<span>
									{uploadAndExtractDocMutation.isPending
										? "Menganalisis Dokumen..."
										: "Pilih & Ekstrak Surat Edaran"}
								</span>
								<input
									type="file"
									accept=".pdf,image/jpeg,image/png,image/webp"
									disabled={uploadAndExtractDocMutation.isPending}
									onChange={(e) => {
										const file = e.target.files?.[0];
										if (file) {
											void uploadAndExtractDocMutation.mutateAsync(file);
										}
									}}
									className="hidden"
								/>
							</label>
						</div>

						<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3.5 text-xs text-[#585854] space-y-1">
							<p className="font-bold text-[#181817]">
								Prinsip Human-in-the-Loop Rangkai
							</p>
							<p>
								Hasil ekstraksi AI tidak pernah langsung dipublikasikan ke
								warga. Prajuru wajib memeriksa dan mengonfirmasi rincian di
								sebelah kanan.
							</p>
						</div>
					</div>

					<div className="xl:col-span-7 teduh-workspace-card space-y-4">
						<div className="flex items-center justify-between border-b border-[#F0EFEA] pb-3">
							<h2 className="teduh-workspace-card-title">
								Periksa &amp; Konfirmasi Rincian Upacara
							</h2>
							{rawEvent?.verifiedAt ? (
								<span className="px-2.5 py-1 rounded-full bg-[#EBF3EE] text-[#264D3B] text-[11px] font-bold">
									Terverifikasi Prajuru
								</span>
							) : (
								<span className="px-2.5 py-1 rounded-full bg-[#FDF7EB] text-[#9A5B13] text-[11px] font-bold">
									Menunggu Konfirmasi
								</span>
							)}
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
							<div className="sm:col-span-2">
								<label className="block text-xs font-semibold text-[#181817] mb-1">
									Nama Upacara / Kegiatan Adat *
								</label>
								<input
									type="text"
									value={docTitle}
									onChange={(e) => setDocTitle(e.target.value)}
									className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2 text-xs text-[#181817]"
								/>
							</div>

							<div>
								<label className="block text-xs font-semibold text-[#181817] mb-1">
									Lokasi Pura &amp; Kawasan Utama
								</label>
								<input
									type="text"
									value={docVenue}
									onChange={(e) => setDocVenue(e.target.value)}
									className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2 text-xs text-[#181817]"
								/>
							</div>

							<div>
								<label className="block text-xs font-semibold text-[#181817] mb-1">
									Nomor Surat Edaran
								</label>
								<input
									type="text"
									value={docPermitRef}
									onChange={(e) => setDocPermitRef(e.target.value)}
									className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2 text-xs text-[#181817]"
								/>
							</div>

							<div>
								<label className="block text-xs font-semibold text-[#181817] mb-1">
									Waktu Mulai (WITA)
								</label>
								<input
									type="datetime-local"
									value={docStartsWita}
									onChange={(e) => setDocStartsWita(e.target.value)}
									className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2 text-xs text-[#181817]"
								/>
							</div>

							<div>
								<label className="block text-xs font-semibold text-[#181817] mb-1">
									Waktu Selesai (WITA)
								</label>
								<input
									type="datetime-local"
									value={docEndsWita}
									onChange={(e) => setDocEndsWita(e.target.value)}
									className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2 text-xs text-[#181817]"
								/>
							</div>

							<div className="sm:col-span-2">
								<label className="block text-xs font-semibold text-[#181817] mb-1">
									Ringkasan Rekayasa Lalu Lintas &amp; Pengalihan Arus
								</label>
								<textarea
									rows={3}
									value={docTrafficNote}
									onChange={(e) => setDocTrafficNote(e.target.value)}
									className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 text-xs text-[#181817]"
								/>
							</div>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#F0EFEA]">
							<button
								type="button"
								disabled={saveDocReviewMutation.isPending}
								onClick={() => void saveDocReviewMutation.mutateAsync(false)}
								className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC]"
							>
								<Save className="w-3.5 h-3.5" />
								<span>Simpan Draf</span>
							</button>

							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									disabled={saveDocReviewMutation.isPending}
									onClick={() => void saveDocReviewMutation.mutateAsync(true)}
									className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#264D3B] bg-[#EBF3EE] text-xs font-semibold text-[#264D3B] hover:bg-[#dfece4]"
								>
									<CheckCircle2 className="w-3.5 h-3.5" />
									<span>Konfirmasi Prajuru (Review)</span>
								</button>

								<button
									type="button"
									disabled={publishEventMutation.isPending}
									onClick={() => void publishEventMutation.mutateAsync()}
									className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e]"
								>
									<Send className="w-3.5 h-3.5" />
									<span>Terbitkan ke Warga</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 2: PETA & RUAS JALAN TERDAMPAK (`roads`)                        */}
			{/* =================================================================== */}
			{currentTabValue === "roads" ? (
				<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					{/* Left: Dedicated Dashboard Road Map Input */}
					<div className="xl:col-span-7 teduh-workspace-card space-y-4">
						<div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EFEA] pb-3">
							<div>
								<h2 className="teduh-workspace-card-title">
									Peta Input Ruas Jalan Terdampak
								</h2>
								<p className="text-xs text-[#585854]">
									Klik titik koordinat di peta untuk menggambar ruas jalan baru,
									atau pilih dari katalog jalan terverifikasi.
								</p>
							</div>

							<div className="inline-flex rounded-xl border border-[#E5E3DC] bg-[#F3F1EC] p-1">
								<button
									type="button"
									onClick={() => setRoadInputMode("draw")}
									className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
										roadInputMode === "draw"
											? "bg-[#264D3B] text-white"
											: "text-[#585854] hover:text-[#181817]"
									}`}
								>
									<PenTool className="w-3.5 h-3.5" />
									<span>Gambar di Peta</span>
								</button>
								<button
									type="button"
									onClick={() => setRoadInputMode("catalog")}
									className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
										roadInputMode === "catalog"
											? "bg-[#264D3B] text-white"
											: "text-[#585854] hover:text-[#181817]"
									}`}
								>
									<MapPinned className="w-3.5 h-3.5" />
									<span>Katalog ({catalogSegments.length})</span>
								</button>
							</div>
						</div>

						<DashboardRoadMapInput
							mode={roadInputMode}
							height={430}
							draftCoordinates={draftCoordinates}
							onDraftCoordinatesChange={setDraftCoordinates}
							catalogSegments={catalogSegments}
							selectedCatalogSegmentId={selectedCatalogSegmentId}
							onSelectCatalogSegment={setSelectedCatalogSegmentId}
							attachedRoadImpacts={attachedRoadImpacts}
						/>
					</div>

					{/* Right: Form & Attached Road Segments List */}
					<div className="xl:col-span-5 space-y-5">
						<div className="teduh-workspace-card space-y-4">
							<h3 className="teduh-workspace-card-title">
								{roadInputMode === "draw"
									? `Simpan Garis Ruas Jalan Baru (${draftCoordinates.length} titik)`
									: "Tautkan Ruas Jalan dari Katalog"}
							</h3>

							{roadInputMode === "draw" ? (
								<div className="space-y-3">
									<div>
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Nama Ruas Jalan / Simpang *
										</label>
										<input
											type="text"
											value={newSegmentName}
											onChange={(e) => setNewSegmentName(e.target.value)}
											placeholder="Mis. Jl. Raya Ubud — Depan Puri Saren"
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										/>
									</div>
									<div>
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Kawasan / Desa Adat *
										</label>
										<input
											type="text"
											value={newSegmentArea}
											onChange={(e) => setNewSegmentArea(e.target.value)}
											placeholder="Mis. Ubud, Gianyar"
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										/>
									</div>
									<div>
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Jenis Dampak Operasional *
										</label>
										<select
											value={selectedImpactType}
											onChange={(e) =>
												setSelectedImpactType(
													e.target.value as typeof selectedImpactType,
												)
											}
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										>
											{IMPACT_TYPE_OPTIONS.map((opt) => (
												<option key={opt.value} value={opt.value}>
													{opt.label}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Arahan Pengalihan Arus
										</label>
										<input
											type="text"
											value={impactDiversionNote}
											onChange={(e) => setImpactDiversionNote(e.target.value)}
											placeholder="Mis. Dialihkan ke Jl. Sugriwa / Peliatan"
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										/>
									</div>
									<label className="flex items-start gap-2 text-xs text-[#181817] cursor-pointer">
										<input
											type="checkbox"
											checked={humanVerifiedRoad}
											onChange={(e) => setHumanVerifiedRoad(e.target.checked)}
											className="mt-0.5 rounded border-[#C5C3BC] text-[#264D3B]"
										/>
										<span>
											Garis ruas jalan ini telah diverifikasi sesuai lokasi
											lapangan (Human-Verified).
										</span>
									</label>
									<button
										type="button"
										disabled={
											drawRoadOnTabMutation.isPending ||
											draftCoordinates.length < 2
										}
										onClick={() => void drawRoadOnTabMutation.mutateAsync()}
										className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50"
									>
										<Plus className="w-3.5 h-3.5" />
										<span>
											{drawRoadOnTabMutation.isPending
												? "Menyimpan..."
												: "Simpan & Tautkan Ruas Jalan"}
										</span>
									</button>
								</div>
							) : (
								<div className="space-y-3">
									<div>
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Pilih Ruas Jalan Terverifikasi *
										</label>
										<select
											value={selectedCatalogSegmentId}
											onChange={(e) =>
												setSelectedCatalogSegmentId(e.target.value)
											}
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
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
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Jenis Dampak Operasional *
										</label>
										<select
											value={selectedImpactType}
											onChange={(e) =>
												setSelectedImpactType(
													e.target.value as typeof selectedImpactType,
												)
											}
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										>
											{IMPACT_TYPE_OPTIONS.map((opt) => (
												<option key={opt.value} value={opt.value}>
													{opt.label}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Arahan Pengalihan Arus
										</label>
										<input
											type="text"
											value={impactDiversionNote}
											onChange={(e) => setImpactDiversionNote(e.target.value)}
											placeholder="Mis. Dialihkan melalui jalur alternatif desa"
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										/>
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
										className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50"
									>
										<Plus className="w-3.5 h-3.5" />
										<span>Tautkan Ruas Katalog</span>
									</button>
								</div>
							)}
						</div>

						{/* Attached Road Impacts List */}
						<div className="teduh-workspace-card space-y-3">
							<h3 className="teduh-workspace-card-title">
								Ruas Jalan Terdampak ({attachedRoadImpacts.length})
							</h3>
							{attachedRoadImpacts.length === 0 ? (
								<EmptyStateCard
									title={SYSTEM_STATE_MESSAGES.noMatchingRoad.title}
									description={SYSTEM_STATE_MESSAGES.noMatchingRoad.description}
								/>
							) : (
								<div className="space-y-2.5">
									{attachedRoadImpacts.map((imp) => (
										<div
											key={imp.id}
											className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 flex items-center justify-between gap-2"
										>
											<div className="min-w-0">
												<p className="text-xs font-bold text-[#181817] truncate">
													{imp.segment?.displayName ||
														imp.displayName ||
														"Ruas Jalan"}
												</p>
												<p className="text-[11px] text-[#585854] truncate">
													{getImpactTypeLabel(imp.impactType)}
													{imp.diversionNote ? ` • ${imp.diversionNote}` : ""}
												</p>
											</div>
											<div className="flex items-center gap-2 shrink-0">
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
												<button
													type="button"
													onClick={() =>
														void deleteRoadImpactOnTabMutation.mutateAsync(
															imp.id,
														)
													}
													className="p-1.5 rounded-lg border border-[#E8B4B4] bg-[#FDF2F2] text-[#9E2A2B] hover:bg-[#fae5e5]"
													title="Hapus ruas jalan"
												>
													<Trash2 className="w-3.5 h-3.5" />
												</button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 3: POS PECALANG — STATUS JALAN LIVE (`field`)                   */}
			{/* =================================================================== */}
			{currentTabValue === "field" ? (
				<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					<div className="xl:col-span-7 teduh-workspace-card space-y-4">
						<div className="border-b border-[#F0EFEA] pb-3">
							<h2 className="teduh-workspace-card-title">
								Peta Operasional Pos Pecalang
							</h2>
							<p className="text-xs text-[#585854]">
								Klik ruas jalan pada peta atau pada panel kendali di sebelah
								kanan untuk memperbarui status penutupan jalan secara real-time.
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

					<div className="xl:col-span-5 teduh-workspace-card space-y-4">
						<div className="border-b border-[#F0EFEA] pb-3">
							<h2 className="teduh-workspace-card-title">
								Kendali Status Ruas Jalan (Pecalang)
							</h2>
							<p className="text-xs text-[#585854]">
								Setiap pembaruan berlaku selama 30 menit sebelum ditandai perlu
								konfirmasi ulang (`UNCONFIRMED`).
							</p>
						</div>

						<div>
							<label className="block text-xs font-semibold text-[#181817] mb-1">
								Catatan Lapangan Pos Pecalang (Opsional)
							</label>
							<input
								type="text"
								value={fieldNote}
								onChange={(e) => setFieldNote(e.target.value)}
								placeholder="Contoh: Iring-iringan Melasti tiba di Catus Pata"
								className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
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
										className="px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold"
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
										className={`rounded-xl border p-3.5 space-y-2.5 ${
											selectedImpactId === seg.id
												? "border-[#264D3B] bg-[#EBF3EE]/40"
												: "border-[#E5E3DC] bg-[#FBFBFA]"
										}`}
									>
										<div className="flex items-start justify-between gap-2">
											<div>
												<p className="text-xs font-bold text-[#181817]">
													{seg.roadName}
												</p>
												<p className="text-[11px] text-[#585854]">
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
												className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
													seg.status === "closed"
														? "bg-[#9E2A2B] text-white border-[#9E2A2B]"
														: "bg-white text-[#9E2A2B] border-[#E8B4B4] hover:bg-[#FDF2F2]"
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
												className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
													seg.status === "intermittent"
														? "bg-[#B86B14] text-white border-[#B86B14]"
														: "bg-white text-[#9A5B13] border-[#F3D9A4] hover:bg-[#FDF7EB]"
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
												className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
													seg.status === "open"
														? "bg-[#264D3B] text-white border-[#264D3B]"
														: "bg-white text-[#264D3B] border-[#C7DBD0] hover:bg-[#EBF3EE]"
												}`}
											>
												Buka Lajur
											</button>
										</div>
									</div>
								))}
							</div>
						)}

						<AlertDialog
							isOpen={Boolean(pendingStatusChange)}
							onOpenChange={(open) => {
								if (!open) setPendingStatusChange(null);
							}}
							onAction={() => {
								if (!pendingStatusChange) return;
								void updateStatusMutation.mutateAsync({
									impactId: pendingStatusChange.segmentId,
									nextStatus: pendingStatusChange.nextStatus as
										| "open"
										| "intermittent"
										| "closed",
									note: fieldNote || undefined,
								});
							}}
							title="Konfirmasi Perubahan Status Jalan"
							description={
								pendingStatusChange
									? `Ubah status "${pendingStatusChange.roadName}" menjadi ${pendingStatusChange.nextStatus.toUpperCase()}? Pembaruan akan dicatat pada log audit dan langsung tampil di peta publik.`
									: ""
							}
							actionLabel="Simpan Status"
							cancelLabel="Batal"
							actionVariant={
								pendingStatusChange?.nextStatus === "closed"
									? "destructive"
									: "primary"
							}
						/>
					</div>
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 4: KEBERSIHAN & PENCATATAN SAMPAH (`cleanup`)                   */}
			{/* =================================================================== */}
			{currentTabValue === "cleanup" ? (
				<div className="space-y-6">
					<Banner
						status="info"
						collapsible={false}
						title="Independensi Kebersihan & Pembukaan Jalan"
						description={OPERATIONAL_DISCLAIMERS.CLEANUP_INDEPENDENCE_NOTE}
					/>

					<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
						{/* Left Column: Cleanup Tasks & Photo Evidence */}
						<div className="xl:col-span-7 space-y-6">
							<div className="teduh-workspace-card space-y-4">
								<div className="flex items-center justify-between border-b border-[#F0EFEA] pb-3">
									<h2 className="teduh-workspace-card-title">
										Daftar Tugas Kebersihan Area Upacara
									</h2>
									<button
										type="button"
										onClick={() => setIsAddingTask((prev) => !prev)}
										className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e]"
									>
										<Plus className="w-3.5 h-3.5" />
										<span>Tambah Tugas</span>
									</button>
								</div>

								{isAddingTask ? (
									<div className="rounded-xl border border-[#D7E3DC] bg-[#F6FAF7] p-4 space-y-3">
										<div>
											<label className="block text-xs font-semibold text-[#181817] mb-1">
												Judul Tugas Kebersihan *
											</label>
											<input
												type="text"
												value={newTaskTitle}
												onChange={(e) => setNewTaskTitle(e.target.value)}
												placeholder="Contoh: Pembersihan Sisa Canang & Sampah Plastik Catus Pata"
												className="w-full rounded-xl border border-[#E5E3DC] bg-white px-3 py-2 text-xs text-[#181817]"
											/>
										</div>
										<div>
											<label className="block text-xs font-semibold text-[#181817] mb-1">
												Catatan Titik Lokasi
											</label>
											<input
												type="text"
												value={newTaskLocation}
												onChange={(e) => setNewTaskLocation(e.target.value)}
												placeholder="Contoh: Seputar Jaba Luar Pura Desa dan Simpang Utama"
												className="w-full rounded-xl border border-[#E5E3DC] bg-white px-3 py-2 text-xs text-[#181817]"
											/>
										</div>
										<div className="flex justify-end gap-2">
											<button
												type="button"
												onClick={() => setIsAddingTask(false)}
												className="px-3 py-1.5 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817]"
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
												className="px-3.5 py-1.5 rounded-xl bg-[#264D3B] text-white text-xs font-semibold disabled:opacity-50"
											>
												Simpan Tugas
											</button>
										</div>
									</div>
								) : null}

								{cleanupTasksQuery.data?.cleanupTasks &&
								cleanupTasksQuery.data.cleanupTasks.length > 0 ? (
									<div className="space-y-2.5">
										{cleanupTasksQuery.data.cleanupTasks.map((task) => (
											<div
												key={task.id}
												className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
											>
												<div>
													<p className="text-xs font-bold text-[#181817]">
														{task.title}
													</p>
													<p className="text-[11px] text-[#585854]">
														{task.description || "Area Utama Upacara"}
													</p>
												</div>
												<div className="flex flex-wrap items-center gap-2">
													<CleanupStatusBadge
														status={task.status as CleanupTaskStatus}
													/>
													{task.status === "todo" ||
													task.status === "in_progress" ||
													task.status === "reopened" ? (
														<button
															type="button"
															onClick={() =>
																void submitCleanupMutation.mutateAsync(task.id)
															}
															className="px-2.5 py-1 rounded-lg bg-[#264D3B] text-white text-[11px] font-semibold"
														>
															Serahkan Tugas
														</button>
													) : null}
													{task.status === "submitted" ? (
														<>
															<button
																type="button"
																onClick={() =>
																	void verifyCleanupMutation.mutateAsync({
																		taskId: task.id,
																	})
																}
																className="px-2.5 py-1 rounded-lg bg-[#264D3B] text-white text-[11px] font-semibold"
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
																className="px-2.5 py-1 rounded-lg border border-[#E5E3DC] bg-white text-[11px] font-semibold text-[#181817]"
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
									<div className="rounded-xl border border-dashed border-[#D5D3CB] p-4 text-xs text-[#585854] text-center">
										Belum ada tugas kebersihan terdaftar. Klik{" "}
										<strong>+ Tambah Tugas</strong> untuk membuat daftar tugas
										petugas kebersihan.
									</div>
								)}
							</div>

							{/* Photo Evidence Upload */}
							<div className="teduh-workspace-card space-y-4">
								<h3 className="teduh-workspace-card-title">
									Unggah Bukti Foto Kebersihan Lapangan
								</h3>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									<div>
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Pilih Tugas Kebersihan
										</label>
										<select
											value={selectedTaskForEvidence}
											onChange={(e) =>
												setSelectedTaskForEvidence(e.target.value)
											}
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										>
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
										<label className="block text-xs font-semibold text-[#181817] mb-1">
											Tahap Dokumentasi Foto
										</label>
										<select
											value={evidenceStage}
											onChange={(e) =>
												setEvidenceStage(e.target.value as "before" | "after")
											}
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										>
											<option value="before">
												Sebelum Pembersihan (Before)
											</option>
											<option value="after">Setelah Pembersihan (After)</option>
										</select>
									</div>
								</div>

								<label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#C7DBD0] bg-[#F6FAF7] p-5 text-center cursor-pointer hover:bg-[#EBF3EE]/60 transition-colors">
									<Upload className="w-6 h-6 text-[#264D3B] mb-1.5" />
									<span className="text-xs font-bold text-[#181817]">
										{uploadCleanupEvidenceMutation.isPending
											? "Mengunggah Bukti Foto ke R2..."
											: "Klik untuk Mengunggah Foto Bukti (JPG, PNG, WEBP)"}
									</span>
									<input
										type="file"
										accept="image/jpeg,image/png,image/webp"
										disabled={uploadCleanupEvidenceMutation.isPending}
										onChange={(e) => {
											const f = e.target.files?.[0];
											if (f) {
												void uploadCleanupEvidenceMutation.mutateAsync(f);
											}
										}}
										className="hidden"
									/>
								</label>
							</div>
						</div>

						{/* Right Column: Waste Quantity Recording */}
						<div className="xl:col-span-5 teduh-workspace-card space-y-4">
							<div className="border-b border-[#F0EFEA] pb-3">
								<h2 className="teduh-workspace-card-title">
									Pencatatan Timbunan Sampah Pasca-Upacara
								</h2>
								<p className="text-xs text-[#585854]">
									Pisahkan secara jujur antara berat terukur (ditimbang) dan
									estimasi / jumlah karung sesuai standar Rangkai.
								</p>
							</div>

							<div className="space-y-3">
								<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 space-y-2">
									<label className="block text-xs font-bold text-[#181817]">
										1. Sampah Organik / Canang &amp; Janur (Kg)
									</label>
									<div className="grid grid-cols-2 gap-2">
										<input
											type="number"
											min="0"
											step="0.5"
											value={organicKg}
											onChange={(e) => setOrganicKg(e.target.value)}
											placeholder="Berat (Kg)"
											className="rounded-xl border border-[#E5E3DC] bg-white px-3 py-2 text-xs text-[#181817]"
										/>
										<select
											value={organicMethod}
											onChange={(e) =>
												setOrganicMethod(
													e.target.value as "weighed" | "estimated",
												)
											}
											className="rounded-xl border border-[#E5E3DC] bg-white px-2.5 py-2 text-xs text-[#181817]"
										>
											<option value="weighed">Ditimbang Aktual</option>
											<option value="estimated">Estimasi Petugas</option>
										</select>
									</div>
								</div>

								<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 space-y-2">
									<label className="block text-xs font-bold text-[#181817]">
										2. Sampah Daur Ulang / Botol &amp; Plastik (Kg)
									</label>
									<div className="grid grid-cols-2 gap-2">
										<input
											type="number"
											min="0"
											step="0.5"
											value={recyclableKg}
											onChange={(e) => setRecyclableKg(e.target.value)}
											placeholder="Berat (Kg)"
											className="rounded-xl border border-[#E5E3DC] bg-white px-3 py-2 text-xs text-[#181817]"
										/>
										<select
											value={recyclableMethod}
											onChange={(e) =>
												setRecyclableMethod(
													e.target.value as "weighed" | "estimated",
												)
											}
											className="rounded-xl border border-[#E5E3DC] bg-white px-2.5 py-2 text-xs text-[#181817]"
										>
											<option value="weighed">Ditimbang Aktual</option>
											<option value="estimated">Estimasi Petugas</option>
										</select>
									</div>
								</div>

								<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 space-y-2">
									<label className="block text-xs font-bold text-[#181817]">
										3. Sampah Residu (Jumlah Karung)
									</label>
									<input
										type="number"
										min="0"
										step="1"
										value={residualSacks}
										onChange={(e) => setResidualSacks(e.target.value)}
										placeholder="Contoh: 8 karung"
										className="w-full rounded-xl border border-[#E5E3DC] bg-white px-3 py-2 text-xs text-[#181817]"
									/>
								</div>

								<button
									type="button"
									disabled={recordWasteMutation.isPending}
									onClick={() => void recordWasteMutation.mutateAsync()}
									className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50"
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
				</div>
			) : null}

			{/* =================================================================== */}
			{/* TAB 5: TIM LAPANGAN & UNDANGAN PETUGAS (`team`)                     */}
			{/* =================================================================== */}
			{currentTabValue === "team" ? (
				<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
					{/* Left Column: Generate One-Time Invitation Link & Direct Assign */}
					<div className="xl:col-span-5 space-y-6">
						<div className="teduh-workspace-card space-y-4">
							<div className="border-b border-[#F0EFEA] pb-3">
								<div className="flex items-center gap-2">
									<Link2 className="w-4 h-4 text-[#264D3B]" />
									<h2 className="teduh-workspace-card-title">
										Buat Tautan Undangan Petugas Lapangan
									</h2>
								</div>
								<p className="text-xs text-[#585854] mt-1">
									Hasilkan tautan undangan resmi sekali pakai (berlaku 7 hari)
									untuk dibagikan kepada Pecalang atau petugas kebersihan via
									WhatsApp.
								</p>
							</div>

							<div className="space-y-2.5 text-xs">
								<label>Email penerima
									<input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="w-full rounded-xl border border-[#E5E3DC] px-3 py-2" />
								</label>
								<label>Peran
									<select value={inviteRole} onChange={(e) => setInviteRole(e.target.value === "organizer" ? "organizer" : "officer")}>
										<option value="officer">Petugas lapangan</option>
										<option value="organizer">Penyelenggara</option>
									</select>
								</label>
								<label className="flex items-center gap-2.5 rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 cursor-pointer">
									<input
										type="checkbox"
										checked={inviteCanTraffic}
										onChange={(e) => setInviteCanTraffic(e.target.checked)}
										className="rounded border-[#C5C3BC] text-[#264D3B]"
									/>
									<div>
										<span className="font-bold text-[#181817] block">
											Wewenang Lalu Lintas (`traffic:update`)
										</span>
										<span className="text-[#585854]">
											Dapat memperbarui status ruas jalan (Pos Pecalang)
										</span>
									</div>
								</label>

								<label className="flex items-center gap-2.5 rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 cursor-pointer">
									<input
										type="checkbox"
										checked={inviteCanCleanup}
										onChange={(e) => setInviteCanCleanup(e.target.checked)}
										className="rounded border-[#C5C3BC] text-[#264D3B]"
									/>
									<div>
										<span className="font-bold text-[#181817] block">
											Wewenang Kebersihan (`cleanup:update`)
										</span>
										<span className="text-[#585854]">
											Dapat mengunggah foto bukti &amp; menyerahkan tugas
											kebersihan
										</span>
									</div>
								</label>
							</div>

							<button
								type="button"
								disabled={
									generateInviteMutation.isPending ||
									!inviteEmail.trim() ||
									(inviteRole === "officer" && !inviteCanTraffic && !inviteCanCleanup)
								}
								onClick={() => void generateInviteMutation.mutateAsync()}
								className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50"
							>
								<UserPlus className="w-3.5 h-3.5" />
								<span>
									{generateInviteMutation.isPending
										? "Membuat Tautan..."
										: "Buat Tautan Undangan Petugas"}
								</span>
							</button>

							{generatedInviteUrl ? (
								<div className="rounded-xl border border-[#A6D9B8] bg-[#EBF7F0] p-3.5 space-y-2">
									<span className="text-[11px] font-bold uppercase tracking-wider text-[#1D5E3A] block">
										Tautan Undangan Siap Dibagikan:
									</span>
									<div className="flex items-center gap-2">
										<input
											type="text"
											readOnly
											value={generatedInviteUrl}
											className="flex-1 rounded-lg border border-[#A6D9B8] bg-white px-2.5 py-1.5 text-xs font-mono text-[#181817]"
										/>
										<button
											type="button"
											onClick={() => {
												void navigator.clipboard.writeText(generatedInviteUrl).then(
													() => setStatusFeedback({ type: "info", message: "Tautan berhasil disalin." }),
													() => setStatusFeedback({ type: "error", message: "Gagal menyalin. Pilih dan salin tautan secara manual." }),
												);
											}}
											className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#264D3B] text-white text-xs font-semibold"
										>
											<Copy className="w-3.5 h-3.5" />
											<span>Salin</span>
										</button>
									</div>
								</div>
							) : null}
						</div>


						{/* Direct Assign by User ID */}
						<div className="teduh-workspace-card space-y-3">
							<h3 className="teduh-workspace-card-title">
								Penugasan Langsung via ID Akun
							</h3>
							<p className="text-xs text-[#585854]">
								Jika petugas sudah memiliki akun di Desa Adat ini, masukkan ID
								Akun mereka untuk menugaskan secara langsung.
							</p>
							<div className="flex gap-2">
								<input
									type="text"
									value={directOfficerUserId}
									onChange={(e) => setDirectOfficerUserId(e.target.value)}
									placeholder="Masukkan ID Akun Petugas..."
									className="flex-1 rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
								/>
								<button
									type="button"
									disabled={
										!directOfficerUserId.trim() ||
										directAssignMutation.isPending

									}
									onClick={() => void directAssignMutation.mutateAsync()}
									className="px-3.5 py-2 rounded-xl border border-[#264D3B] bg-[#EBF3EE] text-xs font-semibold text-[#264D3B] hover:bg-[#dfece4] disabled:opacity-50"
								>
									Tugaskan
								</button>
							</div>
						</div>
					</div>

					{/* Right Column: Assigned Officers List */}
					<div className="xl:col-span-7 teduh-workspace-card space-y-4">
						<div className="flex items-center justify-between border-b border-[#F0EFEA] pb-3">
							<h2 className="teduh-workspace-card-title">
								Daftar Petugas Lapangan Terdaftar (
								{assignmentsQuery.data?.assignments?.length ?? 0})
							</h2>
						</div>

						{assignmentsQuery.isLoading ? (
							<LoadingStateBlock label="Memuat daftar petugas..." rows={3} />
						) : !assignmentsQuery.data?.assignments?.length ? (
							<div className="rounded-xl border border-dashed border-[#D5D3CB] p-6 text-center space-y-2 text-xs text-[#585854]">
								<Users className="w-7 h-7 text-[#8A8984] mx-auto" />
								<p className="font-bold text-[#181817]">
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
										className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
									>
										<div className="space-y-1">
											<p className="text-xs font-bold text-[#181817]">
												{asg.userName || "Petugas Lapangan"} (
												{asg.userEmail || asg.userId})
											</p>
											<div className="flex flex-wrap items-center gap-1.5">
												{asg.canUpdateTraffic ? (
													<span className="px-2 py-0.5 rounded-md bg-[#EBF3EE] text-[#264D3B] text-[11px] font-semibold">
														Pos Pecalang (traffic:update)
													</span>
												) : null}
												{asg.canUpdateCleanup ? (
													<span className="px-2 py-0.5 rounded-md bg-[#FDF7EB] text-[#9A5B13] text-[11px] font-semibold">
														Kebersihan (cleanup:update)
													</span>
												) : null}
												<span className="text-[11px] text-[#585854]">
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
											className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E8B4B4] bg-[#FDF2F2] text-[11px] font-semibold text-[#9E2A2B] hover:bg-[#fae5e5] shrink-0"
										>
											<Trash2 className="w-3 h-3" />
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
