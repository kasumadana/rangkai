import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { FileInput } from "@astryxdesign/core/FileInput";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import {
	Layout,
	LayoutContent,
	LayoutHeader,
	LayoutPanel,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Token } from "@astryxdesign/core/Token";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Calendar,
	Check,
	CheckCircle2,
	ClipboardCheck,
	Clock,
	Copy,
	FileText,
	Info,
	MapPin,
	MapPinned,
	Milestone,
	Navigation,
	PackageCheck,
	Radio,
	Save,
	Scale,
	Search,
	ShieldCheck,
	UserPlus,
	Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { RouterLinkBridge } from "../components/layout/AppShellLayout";
import {
	CleanupStatusBadge,
	EmptyStateCard,
	LoadingStateBlock,
	RoadStatusBadge,
	type CleanupTaskStatus,
} from "../components/rangkai";
import { LandingPage } from "./LandingPage";
import { TeduhSpatialMapConsole } from "../features/map/TeduhSpatialMapConsole";
import { BaliMapTilerView } from "../features/map/BaliMapTilerView";
import {
	type BaliVillageCeremonyProfile,
} from "../lib/bali-villages";
import { OPERATIONAL_DISCLAIMERS } from "../lib/constants";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";
import {
	createCleanupTask,
	createWasteRecord,
	fetchCleanupTasks,
	fetchEventDetail,
	fetchEventRoadImpacts,
	fetchPublicCleanupSummary,
	fetchPublicEventDetail,
	fetchPublicEventRoads,
	fetchPublicEvents,
	fetchFieldEventDetail,
	formatWitaEventSchedule,
	mapPublicEventToCeremonyProfile,
	reopenCleanupTask,
	submitCleanupTask,
	updateRoadStatus,
	uploadCleanupEvidence,
	verifyCleanupTask,
} from "../lib/events-api";
import {
	fetchEventAssignments,
	revokeEventAssignment,
	fetchInvitations,
	createInvitation,
	revokeInvitation,
} from "../lib/auth";
import { useGsapPageReveal } from "../lib/gsap-motion";
import type { OperationalRoadStatus } from "../lib/road-status";
import { formatWitaRange } from "../lib/wita";

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
 * Uses Astryx `Layout` + `LayoutHeader` (with docked `TabList`) + focused workspace region.
 */
interface WorkflowRouteShellProps {
	stepCode: string;
	title: string;
	subtitle: string;
	requirementRef: string;
}

export function WorkflowRouteShellPage({ title }: WorkflowRouteShellProps) {
	const { id: eventId = "" } = useParams<{ id: string }>();
	const { pathname } = useLocation();
	const navigate = useNavigate();

	const isRealUuidEvent = useMemo(
		() =>
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				eventId,
			),
		[eventId],
	);

	const eventDetailQuery = useQuery({
		queryKey: ["event", eventId],
		queryFn: () => fetchEventDetail(eventId),
		enabled: Boolean(eventId && isRealUuidEvent),
		retry: false,
	});

	const eventRoadImpactsQuery = useQuery({
		queryKey: ["events", eventId, "road-impacts"],
		queryFn: () => fetchEventRoadImpacts(eventId),
		enabled: Boolean(eventId && isRealUuidEvent),
		retry: false,
		refetchInterval: 15 * 1000,
	});

	const activeVillage = useMemo(() => {
		const rawEvent = eventDetailQuery.data?.event;
		const roads = eventRoadImpactsQuery.data?.roadImpacts ?? [];
		if (rawEvent) {
			return mapPublicEventToCeremonyProfile(
				{
					id: rawEvent.id,
					title: rawEvent.title,
					slug: rawEvent.publicSlug || rawEvent.id,
					category: rawEvent.category ?? null,
					description: rawEvent.description ?? null,
					venueName: rawEvent.venueName,
					startsAt: rawEvent.startsAt,
					endsAt: rawEvent.endsAt,
					status: rawEvent.status,
					publishedAt: rawEvent.publishedAt ?? null,
					organizationName: "Desa Adat",
					village: "Bali",
					district: "Bali",
				},
				roads,
			);
		}
		return mapPublicEventToCeremonyProfile(
			{
				id: eventId || "event-detail",
				title: "Detail Kegiatan Desa",
				slug: eventId || "event",
				category: null,
				description: null,
				venueName: null,
				startsAt: null,
				endsAt: null,
				status: "draft",
				publishedAt: null,
				organizationName: "Desa Adat",
				village: "Bali",
				district: "Bali",
			},
			roads,
		);
	}, [eventDetailQuery.data?.event, eventRoadImpactsQuery.data?.roadImpacts, eventId]);

	const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
	const [extractionChecked, setExtractionChecked] = useState(true);
	const [extractedTitle, setExtractedTitle] = useState(
		activeVillage.ceremonyTitle,
	);
	const [extractedVenue, setExtractedVenue] = useState(
		`${activeVillage.sacredCenterName} → ${activeVillage.destinationName}`,
	);
	const [extractedWindow, setExtractedWindow] = useState(
		`${activeVillage.scheduleDateLabel} (${activeVillage.scheduleWindowWita})`,
	);

	const [segmentStatuses, setSegmentStatuses] = useState<
		Record<string, OperationalRoadStatus>
	>({});
	const [selectedSegmentId, setSelectedSegmentId] = useState<string>(
		activeVillage.roadSegments[0]?.id ?? "",
	);
	const [pendingStatusChange, setPendingStatusChange] = useState<{
		segmentId: string;
		roadName: string;
		nextStatus: OperationalRoadStatus;
	} | null>(null);
	const [fieldNote, setFieldNote] = useState("");
	const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

	const [organicKg, setOrganicKg] = useState("");
	const [recyclableKg, setRecyclableKg] = useState("");
	const [residualSacks, setResidualSacks] = useState("");
	const [cleanupVerified, setCleanupVerified] = useState(false);

	const cleanupTasksQuery = useQuery({
		queryKey: ["cleanup-tasks", eventId],
		queryFn: () => fetchCleanupTasks(eventId),
		enabled: isRealUuidEvent,
		retry: false,
	});

	const fieldDetailQuery = useQuery({
		queryKey: ["field", "events", eventId],
		queryFn: () => fetchFieldEventDetail(eventId),
		enabled: Boolean(eventId && isRealUuidEvent),
		retry: false,
	});

	const permissions = fieldDetailQuery.data?.permissions;
	const isOrganizer = permissions?.isOrganizer ?? true;
	const canTraffic = permissions?.canUpdateTraffic ?? true;
	const canCleanup = permissions?.canUpdateCleanup ?? true;

	const [selectedCleanupTaskId, setSelectedCleanupTaskId] = useState<string>("");

	// Team Management state & queries (Ticket 02)
	const [isInvitingMember, setIsInvitingMember] = useState(false);
	const [inviteRole, setInviteRole] = useState<"officer" | "organizer">("officer");
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteCanTraffic, setInviteCanTraffic] = useState(true);
	const [inviteCanCleanup, setInviteCanCleanup] = useState(true);
	const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
	const [manualCopyUrl, setManualCopyUrl] = useState<string | null>(null);
	const [teamFeedback, setTeamFeedback] = useState<string | null>(null);

	const eventOrgId =
		eventDetailQuery.data?.event?.organizationId ||
		fieldDetailQuery.data?.event?.organizationId;

	const assignmentsQuery = useQuery({
		queryKey: ["event", eventId, "assignments"],
		queryFn: () => fetchEventAssignments(eventId),
		enabled: Boolean(eventId && isRealUuidEvent && (pathname.endsWith("/team") || !permissions)),
		retry: false,
	});

	const invitationsQuery = useQuery({
		queryKey: ["event", eventId, "invitations"],
		queryFn: () => fetchInvitations(eventOrgId),
		enabled: Boolean(eventOrgId && pathname.endsWith("/team")),
		retry: false,
	});

	const createInviteMutation = useMutation({
		mutationFn: async () => {
			return createInvitation({
				eventId,
				organizationId: eventOrgId,
				role: inviteRole,
				recipientEmail: inviteEmail.trim() || undefined,
				canUpdateTraffic: inviteRole === "officer" ? inviteCanTraffic : undefined,
				canUpdateCleanup: inviteRole === "officer" ? inviteCanCleanup : undefined,
			});
		},
		onSuccess: (data) => {
			void invitationsQuery.refetch();
			setIsInvitingMember(false);
			setInviteEmail("");
			const token = data.invitation.token;
			const inviteUrl =
				data.invitation.inviteUrl ||
				(token ? `${window.location.origin}/invite/${token}` : "");
			if (inviteUrl) {
				setManualCopyUrl(inviteUrl);
			}
			setTeamFeedback(
				"Tautan undangan berhasil dibuat. Salin dan kirimkan langsung kepada calon petugas.",
			);
		},
		onError: (err) => {
			setTeamFeedback(
				err instanceof Error ? err.message : "Gagal membuat undangan.",
			);
		},
	});

	const revokeInviteMutation = useMutation({
		mutationFn: async (invId: string) => {
			return revokeInvitation(invId);
		},
		onSuccess: () => {
			void invitationsQuery.refetch();
			setTeamFeedback("Undangan berhasil dibatalkan.");
		},
		onError: (err) => {
			setTeamFeedback(
				err instanceof Error ? err.message : "Gagal membatalkan undangan.",
			);
		},
	});

	const revokeAssignmentMutation = useMutation({
		mutationFn: async (assignmentId: string) => {
			return revokeEventAssignment(eventId, assignmentId);
		},
		onSuccess: () => {
			void assignmentsQuery.refetch();
			setTeamFeedback("Penugasan petugas berhasil dicabut.");
		},
		onError: (err) => {
			setTeamFeedback(
				err instanceof Error ? err.message : "Gagal mencabut penugasan.",
			);
		},
	});

	async function copyInviteLink(url: string, id: string) {
		try {
			if (navigator?.clipboard?.writeText) {
				await navigator.clipboard.writeText(url);
				setCopiedTokenId(id);
				setTeamFeedback("Tautan undangan berhasil disalin ke papan klip!");
				setTimeout(() => setCopiedTokenId(null), 3000);
				return;
			}
			throw new Error("Clipboard API unavailable");
		} catch {
			setManualCopyUrl(url);
			setTeamFeedback("Salin tautan secara manual dari kolom di bawah.");
		}
	}

	const [evidenceStage, setEvidenceStage] = useState<"before" | "after">("after");
	const [newTaskTitle, setNewTaskTitle] = useState("");
	const [newTaskLocation, setNewTaskLocation] = useState("");
	const [isAddingTask, setIsAddingTask] = useState(false);

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
			setStatusFeedback(
				`Status "${vars.nextStatus}" berhasil disimpan ke server. Berlaku 30 menit per SPO Operasional.`,
			);
			setPendingStatusChange(null);
		},
		onError: (err) => {
			setStatusFeedback(
				err instanceof Error
					? `Gagal memperbarui status jalan: ${err.message}`
					: "Gagal memperbarui status jalan.",
			);
			setPendingStatusChange(null);
		},
	});

	const createCleanupTaskMutation = useMutation({
		mutationFn: async ({
			title,
			locationNotes,
		}: {
			title: string;
			locationNotes?: string;
		}) => {
			if (!isRealUuidEvent) {
				setStatusFeedback("Tugas kebersihan baru ditambahkan (mode demonstrasi).");
				return;
			}
			return createCleanupTask(eventId, {
				title,
				description: locationNotes || undefined,
			});
		},
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setNewTaskTitle("");
			setNewTaskLocation("");
			setIsAddingTask(false);
			setStatusFeedback("Tugas kebersihan baru berhasil ditambahkan.");
		},
		onError: (err) => {
			setStatusFeedback(
				err instanceof Error ? err.message : "Gagal menambahkan tugas kebersihan.",
			);
		},
	});

	const submitCleanupMutation = useMutation({
		mutationFn: async (taskId: string) => {
			if (!isRealUuidEvent) {
				setStatusFeedback("Tugas kebersihan diserahkan (mode demonstrasi).");
				return;
			}
			return submitCleanupTask(taskId);
		},
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setStatusFeedback("Tugas kebersihan diserahkan untuk diverifikasi Prajuru.");
		},
		onError: (err) => {
			setStatusFeedback(
				err instanceof Error ? err.message : "Gagal menyerahkan tugas kebersihan.",
			);
		},
	});

	const reopenCleanupMutation = useMutation({
		mutationFn: async ({ taskId, reason }: { taskId: string; reason?: string }) => {
			if (!isRealUuidEvent) {
				setStatusFeedback("Tugas kebersihan dibuka kembali (mode demonstrasi).");
				return;
			}
			return reopenCleanupTask(taskId, reason);
		},
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setStatusFeedback("Tugas kebersihan dibuka kembali untuk perbaikan bukti.");
		},
		onError: (err) => {
			setStatusFeedback(
				err instanceof Error ? err.message : "Gagal membuka kembali tugas.",
			);
		},
	});

	const uploadCleanupEvidenceMutation = useMutation({
		mutationFn: async (file: File) => {
			const tasks = cleanupTasksQuery.data?.cleanupTasks ?? [];
			const targetTask =
				tasks.find((t) => t.id === selectedCleanupTaskId) || tasks[0];
			if (!targetTask) {
				throw new Error("Belum ada tugas kebersihan terdaftar pada kegiatan ini. Buat tugas terlebih dahulu.");
			}
			return uploadCleanupEvidence(targetTask.id, file, evidenceStage);
		},
		onSuccess: () => {
			void cleanupTasksQuery.refetch();
			setStatusFeedback(`Foto bukti tahap "${evidenceStage}" berhasil diunggah.`);
		},
		onError: (err) => {
			setStatusFeedback(
				err instanceof Error ? err.message : "Gagal mengunggah foto bukti kebersihan.",
			);
		},
	});

	const recordWasteMutation = useMutation({
		mutationFn: async () => {
			if (!isRealUuidEvent) {
				setStatusFeedback("Catatan sampah disimpan (mode simulasi draf).");
				return;
			}
			const records = [];
			if (organicKg && Number(organicKg) > 0) {
				records.push(
					createWasteRecord(eventId, {
						category: "organic",
						quantityKg: Number(organicKg),
						measurementMethod: "weighed",
					}),
				);
			}
			if (recyclableKg && Number(recyclableKg) > 0) {
				records.push(
					createWasteRecord(eventId, {
						category: "recyclable",
						quantityKg: Number(recyclableKg),
						measurementMethod: "weighed",
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
			await Promise.all(records);
		},
		onSuccess: () => {
			setStatusFeedback("Catatan timbunan sampah berhasil disimpan ke pangkalan data.");
		},
		onError: (err) => {
			setStatusFeedback(
				err instanceof Error ? err.message : "Gagal mencatat data sampah.",
			);
		},
	});

	const verifyCleanupMutation = useMutation({
		mutationFn: async (params?: { taskId?: string }) => {
			const tasks = cleanupTasksQuery.data?.cleanupTasks ?? [];
			const targetTask =
				tasks.find((t) => t.id === params?.taskId) ||
				tasks.find((t) => t.id === selectedCleanupTaskId) ||
				tasks[0];
			if (targetTask && isRealUuidEvent) {
				await verifyCleanupTask(targetTask.id, "Diverifikasi oleh Prajuru Adat.");
			}
		},
		onSuccess: () => {
			setCleanupVerified(true);
			void cleanupTasksQuery.refetch();
			setStatusFeedback(
				"Kebersihan area berhasil diverifikasi oleh Prajuru Adat. Pengingat aturan domain: Pembukaan jalan tetap wewenang pos Pecalang dan tidak dibuka otomatis.",
			);
		},
		onError: (err) => {
			setStatusFeedback(
				err instanceof Error ? err.message : "Gagal memverifikasi tugas kebersihan.",
			);
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

	const villageWithLiveStatuses = useMemo(
		() => ({
			...activeVillage,
			roadSegments: activeVillage.roadSegments.map((seg) => ({
				...seg,
				status: segmentStatuses[seg.id] ?? seg.status,
			})),
		}),
		[activeVillage, segmentStatuses],
	);

	const officerRoadList = useMemo(() => {
		if (isRealUuidEvent && eventRoadImpactsQuery.data?.roadImpacts) {
			return eventRoadImpactsQuery.data.roadImpacts.map((imp) => ({
				id: imp.id,
				roadName: imp.displayName || "Ruas Jalan Terdampak",
				corridorSection: imp.coverageArea || "Koridor Wilayah",
				windowWita: formatWitaRange(imp.plannedFrom, imp.plannedTo),
				status: (segmentStatuses[imp.id] ??
					(imp.operationalStatus?.effectiveStatus === "unconfirmed"
						? "unknown"
						: (imp.operationalStatus?.effectiveStatus ?? "unknown"))) as OperationalRoadStatus,
				expiresAt: imp.operationalStatus?.expiresAt,
				isStale: imp.operationalStatus?.isStale,
			}));
		}
		return activeVillage.roadSegments.map((seg) => ({
			...seg,
			status: (segmentStatuses[seg.id] ?? seg.status) as OperationalRoadStatus,
			expiresAt: null as string | null,
			isStale: false,
		}));
	}, [isRealUuidEvent, eventRoadImpactsQuery.data, activeVillage, segmentStatuses]);

	const isMapSplitMode =
		currentTabValue === "roads" || currentTabValue === "field";

	const headerNode = (
		<LayoutHeader hasDivider paddingBlockEnd={0}>
			<VStack gap={3}>
				<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
					<HStack gap={2} vAlign="center" wrap="wrap">
						<Button
							as={RouterLinkBridge}
							href="/dashboard"
							variant="ghost"
							size="sm"
							label="Daftar Upacara"
							icon={<Icon icon={ArrowLeft} size="sm" />}
						/>
						<Heading level={1}>{title}</Heading>
					</HStack>
					<Token color="gray" size="sm" label={activeVillage.desaAdatName} />
				</HStack>

				<TabList
					value={currentTabValue}
					onChange={handleTabChange}
					size="sm"
					isFullBleed
				>
					{isOrganizer ? <Tab value="document" label="Surat Edaran" /> : null}
					{isOrganizer ? <Tab value="roads" label="Rute & Jalan" /> : null}
					{isOrganizer || canTraffic ? (
						<Tab value="field" label="Pos Pecalang" />
					) : null}
					{isOrganizer || canCleanup ? (
						<Tab value="cleanup" label="Kebersihan" />
					) : null}
					{isOrganizer ? <Tab value="team" label="Petugas" /> : null}
				</TabList>
			</VStack>
		</LayoutHeader>
	);

	// Ticket 04 / TC-010: Handle 403 Forbidden for unassigned field officers
	if (
		pathname.startsWith("/field") &&
		isRealUuidEvent &&
		fieldDetailQuery.isError
	) {
		return (
			<Layout
				defaultHasDividers
				height="fill"
				contentWidth={720}
				header={
					<LayoutHeader hasDivider>
						<HStack gap={2} vAlign="center">
							<Button
								as={RouterLinkBridge}
								href="/field"
								variant="ghost"
								size="sm"
								label="Daftar Tugas"
								icon={<Icon icon={ArrowLeft} size="sm" />}
							/>
							<Heading level={1}>Akses Ditolak (403 Forbidden)</Heading>
						</HStack>
					</LayoutHeader>
				}
				content={
					<LayoutContent>
						<VStack gap={4}>
							<Banner
								status="error"
								collapsible={false}
								title="Akses Ditolak: Anda Tidak Memiliki Hak Akses"
								description="Akun Anda belum terdaftar dalam penugasan resmi untuk kegiatan ini. Pembaruan kondisi jalan dan kebersihan hanya dapat dilakukan oleh petugas yang ditugaskan."
							/>
							<HStack gap={2}>
								<Button
									variant="primary"
									size="md"
									label="Kembali ke Penugasan Lapangan"
									onClick={() => navigate("/field")}
								/>
							</HStack>
						</VStack>
					</LayoutContent>
				}
			/>
		);
	}

	if (isMapSplitMode) {
		return (
			<Layout
				defaultHasDividers
				height="fill"
				header={headerNode}
				content={
					<LayoutContent padding={0} isScrollable={false}>
						<BaliMapTilerView
							village={villageWithLiveStatuses}
							allVillages={[villageWithLiveStatuses]}
							selectedSegmentId={selectedSegmentId}
							onSelectSegment={setSelectedSegmentId}
							height="100%"
						/>
					</LayoutContent>
				}
				end={
					<LayoutPanel
						width={400}
						hasDivider
						isScrollable
						label="Kendali Status Ruas Jalan"
					>
						<VStack gap={4}>
							<Heading level={2}>
								{currentTabValue === "field"
									? "Perbarui Status Jalan (Pecalang)"
									: "Daftar Ruas Jalan Terdampak"}
							</Heading>

							{!isRealUuidEvent ? (
								<Banner
									status="info"
									collapsible={false}
									title="Mode Pratinjau Alur Petugas (Simulasi)"
									description="Halaman ini menggunakan data simulasi untuk keperluan demonstrasi alur Pecalang. Pembaruan status bersifat demonstratif (tidak tersimpan ke server)."
								/>
							) : null}

							{statusFeedback ? (
								<Banner
									status="success"
									collapsible={false}
									title="Status Diperbarui"
									description={statusFeedback}
								/>
							) : null}

							{isRealUuidEvent && eventRoadImpactsQuery.isLoading ? (
								<LoadingStateBlock label="Memuat ruas jalan Pos Pecalang..." rows={3} />
							) : officerRoadList.length === 0 ? (
								<EmptyStateCard
									title={SYSTEM_STATE_MESSAGES.noMatchingRoad.title}
									description={SYSTEM_STATE_MESSAGES.noMatchingRoad.description}
								/>
							) : (
								<List hasDividers edge="bleed" density="balanced">
									{officerRoadList.map((seg) => (
										<ListItem
											key={seg.id}
											align="start"
											startContent={<Icon icon={Radio} size="sm" />}
											label={seg.roadName}
											description={
												<VStack gap={2}>
													<Text type="supporting" size="xsm">
														{seg.corridorSection} • {seg.windowWita}
													</Text>
													<HStack gap={1.5} wrap="wrap">
														<Button
															variant={
																seg.status === "closed"
																	? "destructive"
																	: "secondary"
															}
															size="sm"
															label="Tutup"
															onClick={() =>
																setPendingStatusChange({
																	segmentId: seg.id,
																	roadName: seg.roadName,
																	nextStatus: "closed",
																})
															}
														/>
														<Button
															variant={
																seg.status === "intermittent"
																	? "primary"
																	: "secondary"
															}
															size="sm"
															label="Buka-Tutup"
															onClick={() =>
																setPendingStatusChange({
																	segmentId: seg.id,
																	roadName: seg.roadName,
																	nextStatus: "intermittent",
																})
															}
														/>
														<Button
															variant={
																seg.status === "open" ? "primary" : "secondary"
															}
															size="sm"
															label="Buka"
															onClick={() =>
																setPendingStatusChange({
																	segmentId: seg.id,
																	roadName: seg.roadName,
																	nextStatus: "open",
																})
															}
														/>
													</HStack>
												</VStack>
											}
											endContent={
												<RoadStatusBadge
													status={seg.status}
													expiresAt={seg.expiresAt}
												/>
											}
										/>
									))}
								</List>
							)}

							<TextInput
								label="Catatan Pos Pecalang (Opsional)"
								placeholder="Contoh: Iring-iringan tiba di Catus Pata"
								value={fieldNote}
								onChange={setFieldNote}
								width="100%"
							/>
						</VStack>

						<AlertDialog
							isOpen={Boolean(pendingStatusChange)}
							onOpenChange={(open) => {
								if (!open) setPendingStatusChange(null);
							}}
							onAction={() => {
								if (!pendingStatusChange) return;
								if (isRealUuidEvent) {
									void updateStatusMutation.mutateAsync({
										impactId: pendingStatusChange.segmentId,
										nextStatus: pendingStatusChange.nextStatus as
											| "open"
											| "intermittent"
											| "closed",
										note: fieldNote || undefined,
									});
								} else {
									setSegmentStatuses((prev) => ({
										...prev,
										[pendingStatusChange.segmentId]:
											pendingStatusChange.nextStatus,
									}));
									setStatusFeedback(
										`Status "${pendingStatusChange.roadName}" diperbarui pada pratinjau demonstrasi (mode simulasi).`,
									);
									setPendingStatusChange(null);
								}
							}}
							title="Konfirmasi Perubahan Status Jalan"
							description={
								pendingStatusChange
									? `Ubah status "${pendingStatusChange.roadName}" sekarang? Perubahan akan langsung tampil di peta warga.`
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
					</LayoutPanel>
				}
			/>
		);
	}

	return (
		<Layout
			defaultHasDividers
			height="fill"
			contentWidth={720}
			header={headerNode}
			content={
				<LayoutContent>
					{/* TAB: SURAT EDARAN & PEMERIKSAAN */}
					{currentTabValue === "document" ? (
						<VStack gap={5}>
							<FileInput
								mode="dropzone"
								label="Unggah Surat Pengumuman Desa Adat (PDF, JPG, PNG • Maks. 8 MB)"
								accept=".pdf,image/jpeg,image/png,image/webp"
								value={uploadedFiles}
								onChange={(files) =>
									setUploadedFiles(
										Array.isArray(files) ? files : files ? [files] : [],
									)
								}
							/>

							<Divider variant="subtle" />

							<Heading level={2}>Periksa Rincian Hasil Bacaan Surat</Heading>

							<FormLayout direction="vertical" defaultOptionality="required">
								<TextInput
									label="Nama Upacara"
									value={extractedTitle}
									onChange={setExtractedTitle}
									isRequired
									width="100%"
								/>
								<TextInput
									label="Lokasi Pura & Tujuan Prosesi"
									value={extractedVenue}
									onChange={setExtractedVenue}
									isRequired
									width="100%"
								/>
								<TextInput
									label="Jadwal Pelaksanaan (WITA)"
									value={extractedWindow}
									onChange={setExtractedWindow}
									isRequired
									width="100%"
								/>
								<TextArea
									label="Ringkasan Pengalihan Arus"
									value={activeVillage.alternativeRouteSummary}
									rows={2}
									width="100%"
								/>
							</FormLayout>

							<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
								<Token
									color={extractionChecked ? "green" : "orange"}
									size="sm"
									label={
										extractionChecked
											? "Rincian telah dikonfirmasi Panitia"
											: "Belum dikonfirmasi"
									}
								/>
								<HStack gap={2}>
									<Button
										variant="secondary"
										size="md"
										label="Konfirmasi Data"
										icon={<Icon icon={CheckCircle2} size="sm" />}
										onClick={() => setExtractionChecked(true)}
									/>
									<Button
										as={RouterLinkBridge}
										href={`/dashboard/events/${eventId}/roads`}
										variant="primary"
										size="md"
										label="Lanjut ke Rute Jalan"
									/>
								</HStack>
							</HStack>
						</VStack>
					) : null}

					{/* TAB: KEBERSIHAN PASCA-KARYA */}
					{currentTabValue === "cleanup" ? (
						<VStack gap={5}>
							<Banner
								status="info"
								collapsible={false}
								title="Catatan Penting"
								description={OPERATIONAL_DISCLAIMERS.CLEANUP_INDEPENDENCE_NOTE}
							/>

							{cleanupTasksQuery.data?.cleanupTasks &&
							cleanupTasksQuery.data.cleanupTasks.length > 0 ? (
								<VStack gap={3}>
									<HStack justify="between" vAlign="center" wrap="wrap">
										<Heading level={2}>Daftar Tugas Kebersihan</Heading>
										<Button
											variant="secondary"
											size="sm"
											label="Tambah Tugas"
											onClick={() => setIsAddingTask(true)}
										/>
									</HStack>
									<List hasDividers density="balanced">
										{cleanupTasksQuery.data.cleanupTasks.map((task) => (
											<ListItem
												key={task.id}
												startContent={<Icon icon={ClipboardCheck} size="sm" />}
												label={task.title}
												description={`${task.description || "Area Utama"} • Status: ${task.status}`}
												endContent={
													<HStack gap={1.5} vAlign="center" wrap="wrap">
														<CleanupStatusBadge
															status={task.status as CleanupTaskStatus}
														/>
														{task.status === "in_progress" ||
														task.status === "todo" ? (
															<Button
																variant="secondary"
																size="sm"
																label="Serahkan"
																onClick={() =>
																	void submitCleanupMutation.mutateAsync(task.id)
																}
															/>
														) : null}
														{task.status === "submitted" ? (
															<>
																<Button
																	variant="primary"
																	size="sm"
																	label="Verifikasi"
																	onClick={() =>
																		void verifyCleanupMutation.mutateAsync({
																			taskId: task.id,
																		})
																	}
																/>
																<Button
																	variant="secondary"
																	size="sm"
																	label="Buka Kembali"
																	onClick={() =>
																		void reopenCleanupMutation.mutateAsync({
																			taskId: task.id,
																			reason:
																				"Periksa kembali pembersihan sisa sampah canang.",
																		})
																	}
																/>
															</>
														) : null}
													</HStack>
												}
											/>
										))}
									</List>
								</VStack>
							) : null}

							{isAddingTask ? (
								<VStack gap={3}>
									<Heading level={3}>Tambah Tugas Kebersihan Baru</Heading>
									<TextInput
										label="Judul Tugas"
										placeholder="Contoh: Pembersihan Koridor Utama Pura"
										value={newTaskTitle}
										onChange={setNewTaskTitle}
										isRequired
										width="100%"
									/>
									<TextInput
										label="Catatan Lokasi"
										placeholder="Contoh: Seputar Catus Pata dan Jaba Tengah"
										value={newTaskLocation}
										onChange={setNewTaskLocation}
										width="100%"
									/>
									<HStack gap={2} justify="end">
										<Button
											variant="secondary"
											size="sm"
											label="Batal"
											onClick={() => setIsAddingTask(false)}
										/>
										<Button
											variant="primary"
											size="sm"
											label="Simpan Tugas"
											isDisabled={!newTaskTitle.trim()}
											isLoading={createCleanupTaskMutation.isPending}
											onClick={() => {
												void createCleanupTaskMutation.mutateAsync({
													title: newTaskTitle,
													locationNotes: newTaskLocation,
												});
											}}
										/>
									</HStack>
								</VStack>
							) : !cleanupTasksQuery.data?.cleanupTasks?.length ? (
								<HStack justify="end">
									<Button
										variant="secondary"
										size="sm"
										label="Tambah Tugas Kebersihan"
										onClick={() => setIsAddingTask(true)}
									/>
								</HStack>
							) : null}

							<Divider variant="subtle" />

							<Heading level={2}>Unggah Bukti Foto Lapangan</Heading>

							{cleanupTasksQuery.data?.cleanupTasks &&
							cleanupTasksQuery.data.cleanupTasks.length > 1 ? (
								<SegmentedControl
									label="Pilih Tugas Sasaran Bukti Foto"
									value={
										selectedCleanupTaskId ||
										cleanupTasksQuery.data.cleanupTasks[0]?.id ||
										""
									}
									onChange={(v) => setSelectedCleanupTaskId(v)}
									size="sm"
								>
									{cleanupTasksQuery.data.cleanupTasks.map((t) => (
										<SegmentedControlItem key={t.id} value={t.id} label={t.title} />
									))}
								</SegmentedControl>
							) : null}

							<SegmentedControl
								label="Tahap Dokumentasi Foto"
								value={evidenceStage}
								onChange={(v) => setEvidenceStage(v as "before" | "after")}
								size="sm"
							>
								<SegmentedControlItem value="before" label="Sebelum Pembersihan (Before)" />
								<SegmentedControlItem value="after" label="Setelah Pembersihan (After)" />
							</SegmentedControl>

							<FileInput
								mode="dropzone"
								label="Foto Bukti Pembersihan Area (JPG, PNG • Maks. 8 MB)"
								accept="image/jpeg,image/png"
								value={uploadedFiles}
								onChange={(files) => {
									const list = Array.isArray(files)
										? files
										: files
											? [files]
											: [];
									setUploadedFiles(list);
									if (list.length > 0 && isRealUuidEvent) {
										void uploadCleanupEvidenceMutation.mutateAsync(list[0]);
									}
								}}
							/>

							<Heading level={2}>Catatan Sampah Pasca-Upacara</Heading>

							<Grid columns={{ minWidth: 200, max: 3 }} gap={4}>
								<TextInput
									label="Organik / Canang (Kg)"
									value={organicKg}
									onChange={setOrganicKg}
									width="100%"
								/>
								<TextInput
									label="Daur Ulang / Plastik (Kg)"
									value={recyclableKg}
									onChange={setRecyclableKg}
									width="100%"
								/>
								<TextInput
									label="Residu (Jumlah Karung)"
									value={residualSacks}
									onChange={setResidualSacks}
									width="100%"
								/>
							</Grid>

							<HStack justify="end">
								<Button
									variant="secondary"
									size="sm"
									label="Simpan Catatan Sampah"
									icon={<Icon icon={Save} size="sm" />}
									isLoading={recordWasteMutation.isPending}
									onClick={() => {
										void recordWasteMutation.mutateAsync();
									}}
								/>
							</HStack>

							<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
								<Token
									color={cleanupVerified ? "green" : "orange"}
									size="sm"
									label={
										cleanupVerified
											? "Kebersihan Diverifikasi (Jalan tetap dikendalikan Pecalang)"
											: "Menunggu Verifikasi"
									}
								/>
								<Button
									variant="primary"
									size="md"
									label="Verifikasi Kebersihan"
									icon={<Icon icon={ClipboardCheck} size="sm" />}
									isLoading={verifyCleanupMutation.isPending}
									onClick={() => {
										void verifyCleanupMutation.mutateAsync();
									}}
								/>
							</HStack>
						</VStack>
					) : null}

					{/* TAB: PETUGAS LAPANGAN & PENGELOLA */}
					{currentTabValue === "team" ? (
						<VStack gap={4}>
							<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
								<VStack gap={1}>
									<Heading level={2}>Tim Operasional & Petugas Lapangan</Heading>
									<Text type="supporting" size="sm">
										Kelola penugasan pos pecalang, tim kebersihan, dan prajuru adat untuk kegiatan ini.
									</Text>
								</VStack>
								<Button
									variant="primary"
									size="sm"
									label="Undang Petugas Baru"
									icon={<Icon icon={UserPlus} size="sm" />}
									onClick={() => setIsInvitingMember(true)}
								/>
							</HStack>

							{teamFeedback ? (
								<Banner
									status="info"
									collapsible={false}
									title="Pemberitahuan"
									description={teamFeedback}
								/>
							) : null}

							<Banner
								status="info"
								collapsible={false}
								title="Pengiriman Tautan Undangan Langsung"
								description="Rangkai tidak mengirimkan email otomatis. Silakan salin tautan undangan dan kirimkan secara langsung melalui WhatsApp atau pesan singkat kepada calon petugas."
							/>

							{manualCopyUrl ? (
								<VStack
									gap={2}
									style={{
										padding: 16,
										border: "1px solid #E5E7EB",
										borderRadius: 8,
										background: "#F9FAFB",
									}}
								>
									<TextInput
										label="Tautan Undangan Terakhir (Kirimkan ke Petugas)"
										value={manualCopyUrl}
										isReadOnly
										width="100%"
									/>
									<HStack gap={2}>
										<Button
											variant="secondary"
											size="sm"
											label="Salin Tautan"
											icon={<Icon icon={Copy} size="sm" />}
											onClick={() => void copyInviteLink(manualCopyUrl, "last-created")}
										/>
									</HStack>
								</VStack>
							) : null}

							{/* FORM TAMBAH UNDANGAN */}
							{isInvitingMember ? (
								<VStack
									gap={3}
									style={{
										padding: 16,
										border: "1px solid #E5E7EB",
										borderRadius: 8,
										background: "#F9FAFB",
									}}
								>
									<Heading level={3}>Buat Tautan Undangan Baru</Heading>

									<SegmentedControl
										label="Peran Akun"
										value={inviteRole}
										onChange={(val) => setInviteRole(val as "officer" | "organizer")}
										size="sm"
									>
										<SegmentedControlItem value="officer" label="Petugas Lapangan" />
										<SegmentedControlItem value="organizer" label="Prajuru Adat (Penyelenggara)" />
									</SegmentedControl>

									<TextInput
										label="Email Penerima (Opsional)"
										placeholder="contoh: pecalang.desa@gmail.com"
										value={inviteEmail}
										onChange={setInviteEmail}
										description="Bila diisi, hanya akun dengan email ini yang dapat menerima undangan."
										width="100%"
									/>

									{inviteRole === "officer" ? (
										<VStack gap={2}>
											<Text weight="medium" size="sm">
												Izin Penugasan Lapangan
											</Text>
											<HStack gap={3} wrap="wrap">
												<label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
													<input
														type="checkbox"
														checked={inviteCanTraffic}
														onChange={(e) => setInviteCanTraffic(e.target.checked)}
													/>
													<span>Pos Pecalang (Pembaruan Status Jalan)</span>
												</label>
												<label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
													<input
														type="checkbox"
														checked={inviteCanCleanup}
														onChange={(e) => setInviteCanCleanup(e.target.checked)}
													/>
													<span>Tim Kebersihan (Dokumentasi Foto & Sampah)</span>
												</label>
											</HStack>
										</VStack>
									) : null}

									<HStack gap={2} justify="end">
										<Button
											variant="secondary"
											size="sm"
											label="Batal"
											onClick={() => setIsInvitingMember(false)}
										/>
										<Button
											variant="primary"
											size="sm"
											label="Buat Tautan Undangan"
											isLoading={createInviteMutation.isPending}
											isDisabled={inviteRole === "officer" && !inviteCanTraffic && !inviteCanCleanup}
											onClick={() => {
												void createInviteMutation.mutateAsync();
											}}
										/>
									</HStack>
								</VStack>
							) : null}

							{/* DAFTAR PETUGAS AKTIF */}
							<VStack gap={2}>
								<Heading level={3}>Petugas Aktif Ditugaskan</Heading>
								{assignmentsQuery.isLoading ? (
									<LoadingStateBlock label="Memuat petugas aktif..." rows={2} />
								) : !assignmentsQuery.data?.assignments?.length ? (
									<EmptyStateCard
										title="Belum Ada Petugas Terdaftar"
										description="Kegiatan ini belum memiliki petugas pecalang atau tim kebersihan yang ditugaskan. Buat undangan di atas untuk menugaskan petugas."
									/>
								) : (
									<List hasDividers density="balanced">
										{assignmentsQuery.data.assignments.map((assignment) => (
											<ListItem
												key={assignment.id}
												startContent={<Icon icon={Users} size="sm" />}
												label={assignment.userName || "Petugas Lapangan"}
												description={
													<VStack gap={1}>
														<Text type="supporting" size="xsm">
															{assignment.userEmail}
														</Text>
														<HStack gap={1} wrap="wrap">
															{assignment.canUpdateTraffic ? (
																<Token color="blue" size="sm" label="Pos Pecalang (Jalan)" />
															) : null}
															{assignment.canUpdateCleanup ? (
																<Token color="green" size="sm" label="Tim Kebersihan" />
															) : null}
														</HStack>
													</VStack>
												}
												endContent={
													<Button
														variant="destructive"
														size="sm"
														label="Cabut Penugasan"
														isLoading={revokeAssignmentMutation.isPending}
														onClick={() => {
															void revokeAssignmentMutation.mutateAsync(assignment.id);
														}}
													/>
												}
											/>
										))}
									</List>
								)}
							</VStack>

							<Divider variant="subtle" />

							{/* DAFTAR UNDANGAN PENDING */}
							<VStack gap={2}>
								<Heading level={3}>Undangan Menunggu Konfirmasi</Heading>
								{invitationsQuery.isLoading ? (
									<LoadingStateBlock label="Memuat daftar undangan..." rows={2} />
								) : !invitationsQuery.data?.invitations?.filter((i) => i.status === "pending" && (!i.eventId || i.eventId === eventId))?.length ? (
									<Text type="supporting" size="sm">
										Tidak ada undangan aktif yang menunggu konfirmasi saat ini.
									</Text>
								) : (
									<List hasDividers density="balanced">
										{invitationsQuery.data.invitations
											.filter((i) => i.status === "pending" && (!i.eventId || i.eventId === eventId))
											.map((inv) => {
												const invUrl = inv.inviteUrl || (inv.token ? `${window.location.origin}/invite/${inv.token}` : "");
												return (
													<ListItem
														key={inv.id}
														startContent={<Icon icon={Users} size="sm" />}
														label={
															<HStack gap={2} vAlign="center" wrap="wrap">
																<span>{inv.recipientEmail ? `Untuk: ${inv.recipientEmail}` : "Tautan Terbuka"}</span>
																<Token
																	color={inv.role === "organizer" ? "purple" : "blue"}
																	size="sm"
																	label={inv.role === "organizer" ? "Prajuru Desa" : "Petugas Lapangan"}
																/>
															</HStack>
														}
														description={`Dibuat oleh ${inv.createdByName || "Prajuru"} • Berlaku hingga ${new Date(inv.expiresAt).toLocaleDateString("id-ID")}`}
														endContent={
															<HStack gap={1.5} vAlign="center">
																{invUrl ? (
																	<Button
																		variant="secondary"
																		size="sm"
																		label={copiedTokenId === inv.id ? "Tersalin!" : "Salin Tautan"}
																		icon={<Icon icon={copiedTokenId === inv.id ? Check : Copy} size="sm" />}
																		onClick={() => void copyInviteLink(invUrl, inv.id)}
																	/>
																) : null}
																<Button
																	variant="destructive"
																	size="sm"
																	label="Batalkan"
																	isLoading={revokeInviteMutation.isPending}
																	onClick={() => {
																		void revokeInviteMutation.mutateAsync(inv.id);
																	}}
																/>
															</HStack>
														}
													/>
												);
											})}
									</List>
								)}
							</VStack>
						</VStack>
					) : null}
				</LayoutContent>
			}
		/>
	);
}
