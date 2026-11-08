import { useQuery } from "@tanstack/react-query";
import { Token } from "@astryxdesign/core/Token";
import { Stack } from "@astryxdesign/core/Stack";
import {
	Building2,
	CheckCircle2,
	ClipboardCheck,
	Clock,
	FileText,
	MapPinned,
	PlusCircle,
	Radio,
	RefreshCw,
	Search,
	Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
	EmptyStateCard,
	ErrorStateBanner,
	EventLifecycleBadge,
	LoadingStateBlock,
	RoadStatusBadge,
} from "../components/rangkai";
import { DashboardRoadMapInput } from "../features/map/DashboardRoadMapInput";
import { getImpactTypeLabel } from "./EventWizardPage";
import type { EventLifecycleStatus } from "../lib/api-client";
import { useAuthSession, useMyOrganizationsQuery } from "../lib/auth";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";
import {
	type EventRecord,
	fetchEventRoadImpacts,
	fetchEventsList,
	getSavedOrganizationId,
	saveOrganizationId,
} from "../lib/events-api";
import { formatWitaDateTime, formatWitaRange } from "../lib/wita";

type StatusFilterValue = "all" | EventLifecycleStatus;

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilterValue; label: string }> =
	[
		{ value: "all", label: "Semua" },
		{ value: "active", label: "Aktif" },
		{ value: "published", label: "Diumumkan" },
		{ value: "review", label: "Ditinjau" },
		{ value: "draft", label: "Draf" },
		{ value: "completed", label: "Selesai" },
	];

const CATEGORY_LABELS: Record<string, string> = {
	upacara_adat: "Upacara Adat",
	odalan: "Piodalan / Pujawali",
	melasti: "Melasti",
	pengerupukan: "Pengerupukan / Ogoh-Ogoh",
	karya: "Karya Agung",
	lainnya: "Kegiatan Adat Lainnya",
};

export function OrganizerDashboardPage() {
	const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedEventId, setSelectedEventId] = useState<string>("");

	const { data: sessionData } = useAuthSession();
	const myOrgsQuery = useMyOrganizationsQuery();
	const organizations = useMemo(
		() => myOrgsQuery.data?.organizations ?? [],
		[myOrgsQuery.data?.organizations],
	);

	const [activeOrgFilter, setActiveOrgFilter] = useState<string>("all");

	const eventsQuery = useQuery({
		queryKey: [
			"events",
			{
				status: statusFilter === "all" ? undefined : statusFilter,
				organizationId: activeOrgFilter === "all" ? undefined : activeOrgFilter,
			},
		],
		queryFn: () =>
			fetchEventsList({
				page: 1,
				limit: 50,
				status: statusFilter === "all" ? undefined : statusFilter,
				organizationId: activeOrgFilter === "all" ? undefined : activeOrgFilter,
			}),
		retry: false,
	});

	const allEvents: EventRecord[] = useMemo(() => {
		return eventsQuery.data?.events ?? [];
	}, [eventsQuery.data]);

	const filteredEvents = useMemo(() => {
		const trimmed = searchQuery.trim().toLowerCase();
		if (!trimmed) return allEvents;
		return allEvents.filter((evt) => {
			return (
				evt.title.toLowerCase().includes(trimmed) ||
				(evt.venueName || "").toLowerCase().includes(trimmed) ||
				(evt.permitReference || "").toLowerCase().includes(trimmed)
			);
		});
	}, [allEvents, searchQuery]);

	const activeEvent = useMemo(() => {
		if (filteredEvents.length === 0) return null;
		if (selectedEventId) {
			const found = filteredEvents.find((e) => e.id === selectedEventId);
			if (found) return found;
		}
		return filteredEvents[0];
	}, [filteredEvents, selectedEventId]);

	const activeRoadImpactsQuery = useQuery({
		queryKey: ["events", activeEvent?.id, "road-impacts"],
		queryFn: () => fetchEventRoadImpacts(activeEvent!.id),
		enabled: Boolean(activeEvent?.id),
		staleTime: 20_000,
	});

	const activeRoadImpacts = activeRoadImpactsQuery.data?.roadImpacts ?? [];

	const kpiCounts = useMemo(() => {
		let draftReview = 0;
		let publishedActive = 0;
		let completedCancelled = 0;
		for (const evt of allEvents) {
			if (evt.status === "draft" || evt.status === "review") {
				draftReview += 1;
			} else if (evt.status === "published" || evt.status === "active") {
				publishedActive += 1;
			} else {
				completedCancelled += 1;
			}
		}
		return {
			total: allEvents.length,
			draftReview,
			publishedActive,
			completedCancelled,
		};
	}, [allEvents]);

	const orgNameById = useMemo(() => {
		const map = new Map<string, string>();
		for (const org of organizations) {
			map.set(
				org.id,
				`${org.name}${org.village ? ` (${org.village})` : ""}`,
			);
		}
		return map;
	}, [organizations]);

	const quickActionTargetId = activeEvent?.id || allEvents[0]?.id || "";

	return (
		<div>
			{/* Header Workspace */}
			<div className="teduh-workspace-header">
				<div>
					<div className="teduh-workspace-eyebrow">
						<span>Pusat Koordinasi Desa Adat • Zona Waktu WITA</span>
					</div>
					<h1 className="teduh-workspace-title">
						Jadwal &amp; Pengumuman Upacara
					</h1>
					<p className="teduh-workspace-subtitle">
						Kelola draf pengumuman, ekstraksi surat edaran AI, verifikasi ruas
						jalan terdampak, penugasan Pecalang, hingga dokumentasi kebersihan
						pasca-acara.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2.5">
					<button
						type="button"
						onClick={() => void eventsQuery.refetch()}
						className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] transition-colors"
					>
						<RefreshCw className="w-3.5 h-3.5 text-[#585854]" />
						<span>Segarkan</span>
					</button>
					{quickActionTargetId ? (
						<Link
							to={`/field/events/${quickActionTargetId}`}
							className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#264D3B]/25 bg-[#EBF3EE] text-xs font-semibold text-[#264D3B] hover:bg-[#dfece4] transition-colors no-underline"
						>
							<Radio className="w-3.5 h-3.5" />
							<span>Pos Pecalang</span>
						</Link>
					) : null}
					<Link
						to="/dashboard/events/new"
						className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#264D3B] text-xs font-semibold text-white hover:bg-[#1d3c2e] transition-colors no-underline"
					>
						<PlusCircle className="w-3.5 h-3.5" />
						<span>Buat Pengumuman Baru</span>
					</Link>
				</div>
			</div>

			{/* Onboarding Banner if logged in user has no Desa Adat membership */}
			{sessionData?.user &&
			!myOrgsQuery.isLoading &&
			organizations.length === 0 ? (
				<div className="mb-6 rounded-2xl border border-[#F3D9A4] bg-[#FDF7EB] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div className="space-y-1">
						<div className="text-xs font-semibold text-[#9A5B13]">
							<span>Belum terhubung ke desa adat</span>
						</div>
						<p className="text-sm font-medium text-[#181817]">
							Akun Anda ({sessionData.user.email}) belum terdaftar sebagai
							Panitia atau Petugas di Desa Adat mana pun.
						</p>
						<p className="text-xs text-[#585854]">
							Daftarkan Desa Adat / Banjar Anda terlebih dahulu agar dapat
							membuat draf pengumuman upacara dan mengatur penutupan jalan.
						</p>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<Link
							to="/onboarding/organization"
							className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#264D3B] text-xs font-semibold text-white hover:bg-[#1d3c2e] transition-colors no-underline"
						>
							<Building2 className="w-3.5 h-3.5" />
							<span>Daftarkan Desa Adat</span>
						</Link>
						<Link
							to="/settings"
							className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] transition-colors no-underline"
						>
							<span>Pengaturan Akun</span>
						</Link>
					</div>
				</div>
			) : null}

			{/* KPI Summary Row */}
			<div className="teduh-kpi-grid">
				<div className="teduh-kpi-card">
					<span className="teduh-kpi-label">Total Kegiatan</span>
					<span className="teduh-kpi-value">{kpiCounts.total}</span>
					<span className="teduh-kpi-meta">
						Terdaftar pada pangkalan data operasional
					</span>
				</div>
				<div className="teduh-kpi-card">
					<span className="teduh-kpi-label">Draf &amp; Ditinjau</span>
					<span className="teduh-kpi-value">{kpiCounts.draftReview}</span>
					<span className="teduh-kpi-meta">
						Menunggu verifikasi panitia sebelum terbit
					</span>
				</div>
				<div className="teduh-kpi-card">
					<span className="teduh-kpi-label">Diumumkan &amp; Aktif</span>
					<span className="teduh-kpi-value text-[#264D3B]">
						{kpiCounts.publishedActive}
					</span>
					<span className="teduh-kpi-meta">
						Tampil pada peta publik &amp; pantauan Pecalang
					</span>
				</div>
				<div className="teduh-kpi-card">
					<span className="teduh-kpi-label">Selesai / Arsip</span>
					<span className="teduh-kpi-value">{kpiCounts.completedCancelled}</span>
					<span className="teduh-kpi-meta">
						Riwayat kegiatan dan dokumentasi pasca-acara
					</span>
				</div>
			</div>

			{/* Filter & Search Bar */}
			<div className="teduh-workspace-card mb-6 p-4">
				<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-1.5">
						{STATUS_FILTER_OPTIONS.map((opt) => {
							const active = statusFilter === opt.value;
							return (
								<button
									key={opt.value}
									type="button"
									onClick={() => setStatusFilter(opt.value)}
									className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
										active
											? "bg-[#264D3B] text-white"
											: "bg-[#F3F1EC] text-[#585854] hover:text-[#181817]"
									}`}
								>
									{opt.label}
								</button>
							);
						})}
					</div>

					<div className="flex flex-wrap items-center gap-2.5">
						{organizations.length > 0 ? (
							<select
								aria-label="Filter Desa Adat"
								value={activeOrgFilter}
								onChange={(e) => {
									const val = e.target.value;
									setActiveOrgFilter(val);
									if (val !== "all") {
										saveOrganizationId(val);
									}
								}}
								className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs font-medium text-[#181817]"
							>
								<option value="all">Semua Desa Adat Saya</option>
								{organizations.map((org) => (
									<option key={org.id} value={org.id}>
										{org.name} ({org.role === "organizer" ? "Panitia" : "Petugas"})
									</option>
								))}
							</select>
						) : null}

						<div className="relative min-w-[230px] flex-1 sm:flex-initial">
							<Search className="w-3.5 h-3.5 text-[#8A8984] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
							<input
								type="search"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Cari nama upacara, lokasi, surat..."
								className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] pl-8 pr-3 py-2 text-xs text-[#181817] placeholder:text-[#8A8984] focus:outline-none focus:border-[#264D3B]"
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Main Two-Column Grid: Event List + Spatial Inspector */}
			<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
				{/* Left Column: Event List */}
				<div className="xl:col-span-7 space-y-3">
					{eventsQuery.isLoading ? (
						<div className="teduh-workspace-card">
							<LoadingStateBlock
								label={SYSTEM_STATE_MESSAGES.loadingData.description}
								rows={4}
							/>
						</div>
					) : eventsQuery.isError ? (
						<div className="teduh-workspace-card">
							<ErrorStateBanner
								title="Gagal Memuat Jadwal Upacara"
								error={eventsQuery.error}
								onRetry={() => {
									void eventsQuery.refetch();
								}}
							/>
						</div>
					) : filteredEvents.length === 0 ? (
						<div className="teduh-workspace-card">
							<EmptyStateCard
								title={SYSTEM_STATE_MESSAGES.noEvents.title}
								description={SYSTEM_STATE_MESSAGES.noEvents.description}
								actions={
									<div className="flex flex-wrap items-center gap-2">
										<button
											type="button"
											onClick={() => {
												setStatusFilter("all");
												setSearchQuery("");
												setActiveOrgFilter("all");
											}}
											className="px-3.5 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC]"
										>
											Reset Filter
										</button>
										<Link
											to="/dashboard/events/new"
											className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-xs font-semibold text-white hover:bg-[#1d3c2e] no-underline"
										>
											<PlusCircle className="w-3.5 h-3.5" />
											<span>Buat Draf Pengumuman</span>
										</Link>
									</div>
								}
							/>
						</div>
					) : (
						filteredEvents.map((evt) => {
							const isSelected = activeEvent?.id === evt.id;
							const scheduleText =
								evt.startsAt && evt.endsAt
									? formatWitaRange(evt.startsAt, evt.endsAt)
									: evt.startsAt
										? formatWitaDateTime(evt.startsAt)
										: "Jadwal WITA belum ditetapkan";
							const orgLabel =
								orgNameById.get(evt.organizationId) ||
								(evt.organizationId === getSavedOrganizationId()
									? "Desa Adat Aktif"
									: "Desa Adat Penyelenggara");
							const categoryLabel = evt.category
								? CATEGORY_LABELS[evt.category] || evt.category
								: "Upacara Adat";

							return (
								<div
									key={evt.id}
									onClick={() => setSelectedEventId(evt.id)}
									className={`teduh-event-row-card cursor-pointer ${
										isSelected
											? "border-[#264D3B] ring-2 ring-[#264D3B]/10"
											: ""
									}`}
								>
									<div className="flex flex-col gap-3 w-full">
										<div className="flex flex-wrap items-start justify-between gap-2">
											<div className="space-y-1">
												<div className="flex flex-wrap items-center gap-2">
													<span className="text-xs font-medium text-[#264D3B] bg-[#EBF3EE] px-2.5 py-0.5 rounded-full">
														{categoryLabel}
													</span>
													<EventLifecycleBadge status={evt.status} />
													{evt.isSimulation !== false ? (
														<Token color="orange" size="sm" label="SIMULASI" />
													) : null}
													{evt.permitReference ? (
														<span className="text-[11px] text-[#585854] font-mono">
															No: {evt.permitReference}
														</span>
													) : null}
												</div>
												<h2 className="text-base font-bold text-[#181817] leading-snug">
													{evt.title}
												</h2>
											</div>

											<div
												className="flex flex-wrap items-center gap-1.5"
												onClick={(e) => e.stopPropagation()}
											>
												<Link
													to={`/dashboard/events/${evt.id}`}
													className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] transition-colors no-underline"
												>
													<FileText className="w-3.5 h-3.5" />
													<span>Edit &amp; Wizard</span>
												</Link>
											</div>
										</div>

										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#585854]">
											<div className="flex items-center gap-1.5">
												<MapPinned className="w-3.5 h-3.5 text-[#264D3B] shrink-0" />
												<span className="truncate">
													{evt.venueName || "Lokasi utama belum diisi"} •{" "}
													{orgLabel}
												</span>
											</div>
											<div className="flex items-center gap-1.5">
												<Clock className="w-3.5 h-3.5 text-[#264D3B] shrink-0" />
												<span className="truncate">{scheduleText}</span>
											</div>
										</div>

										{/* Direct Workflow Module Shortcuts */}
										<div
											className="pt-2.5 border-t border-[#F0EFEA] flex flex-wrap items-center justify-between gap-2"
											onClick={(e) => e.stopPropagation()}
										>
											<div className="flex flex-wrap items-center gap-1.5">
												<Link
													to={`/dashboard/events/${evt.id}/roads`}
													className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E3DC] bg-[#FBFBFA] text-[11px] font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
												>
													<MapPinned className="w-3 h-3 text-[#264D3B]" />
													<span>Peta &amp; Ruas Jalan</span>
												</Link>
												<Link
													to={`/dashboard/events/${evt.id}/team`}
													className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E3DC] bg-[#FBFBFA] text-[11px] font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
												>
													<Users className="w-3 h-3 text-[#264D3B]" />
													<span>Tim &amp; Undangan</span>
												</Link>
												<Link
													to={`/field/events/${evt.id}`}
													className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E3DC] bg-[#FBFBFA] text-[11px] font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
												>
													<Radio className="w-3 h-3 text-[#264D3B]" />
													<span>Pos Pecalang</span>
												</Link>
												<Link
													to={`/dashboard/events/${evt.id}/cleanup`}
													className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E3DC] bg-[#FBFBFA] text-[11px] font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
												>
													<ClipboardCheck className="w-3 h-3 text-[#264D3B]" />
													<span>Kebersihan</span>
												</Link>
											</div>

											{evt.publicSlug &&
											(evt.status === "published" || evt.status === "active") ? (
												<Link
													to={`/events/${evt.publicSlug}`}
													className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#264D3B] hover:underline no-underline"
												>
													<CheckCircle2 className="w-3.5 h-3.5" />
													<span>Lihat Halaman Publik</span>
												</Link>
											) : null}
										</div>
									</div>
								</div>
							);
						})
					)}
				</div>

				{/* Right Column: Spatial Inspector & Road Impacts Summary */}
				<div className="xl:col-span-5">
					<div className="teduh-workspace-card sticky top-20 space-y-4">
						{activeEvent ? (
							<>
								<div className="flex items-start justify-between gap-3">
									<div className="space-y-1 min-w-0 flex-1">
										<Stack direction="horizontal" gap={1} align="center" wrap="wrap">
											<h3 className="teduh-workspace-card-title truncate">
												Peta kegiatan: {activeEvent.title}
											</h3>
											{activeEvent.isSimulation !== false ? (
												<Token color="orange" size="sm" label="SIMULASI" />
											) : null}
										</Stack>
										<p className="text-xs text-[#585854] truncate">
											{activeEvent.venueName || "Lokasi belum ditetapkan"} •{" "}
											{activeEvent.startsAt && activeEvent.endsAt
												? formatWitaRange(
														activeEvent.startsAt,
														activeEvent.endsAt,
													)
												: "Jadwal WITA belum lengkap"}
										</p>
									</div>
									<div className="shrink-0">
										<EventLifecycleBadge status={activeEvent.status} />
									</div>
								</div>

								{/* Dedicated Dashboard Road Map (No Kecamatan polygons) */}
								<DashboardRoadMapInput
									mode="operational"
									height={250}
									attachedRoadImpacts={activeRoadImpacts}
								/>

								{/* Attached Road Impacts List */}
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<span className="text-xs font-bold text-[#181817]">
											Ruas Jalan Terdampak ({activeRoadImpacts.length})
										</span>
										<Link
											to={`/dashboard/events/${activeEvent.id}/roads`}
											className="text-xs font-semibold text-[#264D3B] hover:underline no-underline"
										>
											+ Tambah / Ubah Ruas
										</Link>
									</div>

									{activeRoadImpactsQuery.isLoading ? (
										<p className="text-xs text-[#585854]">
											Memuat data ruas jalan...
										</p>
									) : activeRoadImpacts.length === 0 ? (
										<div className="rounded-xl border border-dashed border-[#D5D3CB] bg-[#FBFBFA] p-3.5 text-xs text-[#585854]">
											Belum ada ruas jalan terdampak yang diverifikasi untuk
											kegiatan ini. Buka menu{" "}
											<Link
												to={`/dashboard/events/${activeEvent.id}/roads`}
												className="font-semibold text-[#264D3B] underline"
											>
												Peta &amp; Ruas Jalan
											</Link>{" "}
											untuk menggambar atau memilih ruas jalan di peta.
										</div>
									) : (
										<div className="space-y-2 max-h-56 overflow-y-auto pr-1">
											{activeRoadImpacts.map((ri) => {
												const rawEff =
													ri.operationalStatus?.effectiveStatus ?? "unknown";
												const effectiveStatus =
													rawEff === "unconfirmed" ? "unknown" : rawEff;
												return (
													<div
														key={ri.id}
														className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-2.5 flex items-center justify-between gap-2"
													>
														<div className="min-w-0">
															<p className="text-xs font-semibold text-[#181817] truncate">
																{ri.segment?.displayName ||
																	ri.displayName ||
																	`Ruas #${ri.id.slice(0, 8)}`}
															</p>
															<p className="text-[11px] text-[#585854] truncate">
																Tipe:{" "}
																<span className="font-medium">
																	{getImpactTypeLabel(ri.impactType)}
																</span>
																{ri.diversionNote
																	? ` • Alihan: ${ri.diversionNote}`
																	: ""}
															</p>
														</div>
														<RoadStatusBadge
															status={effectiveStatus}
															expiresAt={ri.operationalStatus?.expiresAt}
														/>
													</div>
												);
											})}
										</div>
									)}
								</div>

								{/* Quick Action Buttons */}
								<div className="pt-2 grid grid-cols-2 gap-2">
									<Link
										to={`/dashboard/events/${activeEvent.id}`}
										className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
									>
										<FileText className="w-3.5 h-3.5 text-[#264D3B]" />
										<span>Surat &amp; AI</span>
									</Link>
									<Link
										to={`/dashboard/events/${activeEvent.id}/roads`}
										className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
									>
										<MapPinned className="w-3.5 h-3.5 text-[#264D3B]" />
										<span>Input Peta Jalan</span>
									</Link>
									<Link
										to={`/field/events/${activeEvent.id}`}
										className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
									>
										<Radio className="w-3.5 h-3.5 text-[#264D3B]" />
										<span>Update Status Jalan</span>
									</Link>
									<Link
										to={`/dashboard/events/${activeEvent.id}/cleanup`}
										className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
									>
										<ClipboardCheck className="w-3.5 h-3.5 text-[#264D3B]" />
										<span>Tugas Kebersihan</span>
									</Link>
								</div>
							</>
						) : (
							<div className="py-8 text-center space-y-2">
								<h3 className="teduh-workspace-card-title">
									Peta kegiatan
								</h3>
								<p className="text-xs text-[#585854] max-w-xs mx-auto">
									Pilih salah satu kegiatan upacara di daftar kiri atau buat
									pengumuman baru untuk menampilkan peta ruas jalan terdampak.
								</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
