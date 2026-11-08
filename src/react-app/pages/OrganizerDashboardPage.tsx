import { useQuery } from "@tanstack/react-query";
import { Token } from "@astryxdesign/core/Token";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import {
	Table,
	TableBody,
	TableCell,
	TableHeader,
	TableHeaderCell,
	TableRow,
} from "@astryxdesign/core/Table";
import {
	ArrowRight,
	Building2,
	CheckCircle2,
	Clock,
	FileText,
	MapPinned,
	PlusCircle,
	RefreshCw,
	Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
	EmptyStateCard,
	ErrorStateBanner,
	EventLifecycleBadge,
	LoadingStateBlock,
} from "../components/rangkai";
import type { EventLifecycleStatus } from "../lib/api-client";
import { useAuthSession, useMyOrganizationsQuery } from "../lib/auth";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";
import {
	type EventRecord,
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

	return (
		<div className="space-y-6">
			{/* Header Workspace: Calm & Focused */}
			<div className="teduh-workspace-header">
				<div>
					<h1 className="teduh-workspace-title">
						Ikhtisar Kegiatan Upacara
					</h1>
					<p className="teduh-workspace-subtitle">
						Kelola draf pengumuman upacara adat, status jalan terdampak, kebersihan,
						dan penugasan petugas desa.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={() => void eventsQuery.refetch()}
						className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#E5E3DC] bg-white text-sm font-semibold text-[#181817] hover:bg-[#F3F1EC] transition-colors"
					>
						<RefreshCw className="w-4 h-4 text-[#585854]" />
						<span>Segarkan</span>
					</button>

					<Link
						to="/dashboard/events/new"
						className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#264D3B] text-sm font-semibold text-white hover:bg-[#1d3c2e] transition-colors no-underline shadow-xs"
					>
						<PlusCircle className="w-4 h-4" />
						<span>Buat Kegiatan Baru</span>
					</Link>
				</div>
			</div>

			{/* Onboarding Banner if logged in user has no Desa Adat membership */}
			{sessionData?.user &&
			!myOrgsQuery.isLoading &&
			organizations.length === 0 ? (
				<div className="rounded-2xl border border-[#F3D9A4] bg-[#FDF7EB] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

			{/* KPI Summary Row: Restrained & Proportional */}
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
			<div className="teduh-workspace-card p-4">
				<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-1.5">
						{STATUS_FILTER_OPTIONS.map((opt) => {
							const active = statusFilter === opt.value;
							return (
								<button
									key={opt.value}
									type="button"
									onClick={() => setStatusFilter(opt.value)}
									className={`px-3.5 py-2.5 rounded-xl text-base font-semibold transition-colors ${
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

					<div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
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
								className="w-full sm:w-auto max-w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2.5 text-base font-medium text-[#181817] truncate focus:outline-none focus:border-[#264D3B]"
							>
								<option value="all">Semua Desa Adat Saya</option>
								{organizations.map((org) => (
									<option key={org.id} value={org.id}>
										{org.name} ({org.role === "organizer" ? "Panitia" : "Petugas"})
									</option>
								))}
							</select>
						) : null}

						<div className="relative min-w-[200px] w-full sm:w-auto sm:flex-initial">
							<Search className="w-4 h-4 text-[#8A8984] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
							<input
								type="search"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Cari nama upacara, lokasi, surat..."
								className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] pl-9 pr-3.5 py-2.5 text-base text-[#181817] placeholder:text-[#8A8984] focus:outline-none focus:border-[#264D3B]"
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Main Content Area: Responsive Activity Overview */}
			<div>
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
										className="px-4 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC]"
									>
										Reset Filter
									</button>
									<Link
										to="/dashboard/events/new"
										className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#264D3B] text-xs font-semibold text-white hover:bg-[#1d3c2e] no-underline"
									>
										<PlusCircle className="w-4 h-4" />
										<span>Buat Draf Pengumuman</span>
									</Link>
								</div>
							}
						/>
					</div>
				) : (
					<>
						{/* Desktop / Tablet Table View (Structured Astryx Table) */}
						<div className="hidden md:block rounded-2xl border border-[#E2E4E8] bg-white shadow-xs overflow-x-auto">
							<Table density="spacious" dividers="rows" hasHover>
								<TableHeader>
									<TableRow>
										<TableHeaderCell className="min-w-[280px]">Kegiatan Upacara &amp; Lokasi</TableHeaderCell>
										<TableHeaderCell className="min-w-[180px]">Jadwal &amp; Status</TableHeaderCell>
										<TableHeaderCell className="min-w-[190px] w-[200px]">Tindakan</TableHeaderCell>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredEvents.map((evt) => {
										const scheduleText =
											evt.startsAt && evt.endsAt
												? formatWitaRange(evt.startsAt, evt.endsAt)
												: evt.startsAt
													? formatWitaDateTime(evt.startsAt)
													: "Jadwal belum ditetapkan";
										const orgLabel =
											orgNameById.get(evt.organizationId) ||
											(evt.organizationId === getSavedOrganizationId()
												? "Desa Adat Aktif"
												: "Desa Adat Penyelenggara");
										const categoryLabel = evt.category
											? CATEGORY_LABELS[evt.category] || evt.category
											: "Upacara Adat";

										return (
											<TableRow key={evt.id}>
												<TableCell>
													<VStack gap={1} className="py-1">
														<HStack gap={2} align="center" wrap="wrap">
															<span className="text-xs font-medium text-[#264D3B] bg-[#EBF3EE] px-2.5 py-0.5 rounded-full">
																{categoryLabel}
															</span>
															{evt.isSimulation !== false ? (
																<Token color="orange" size="sm" label="SIMULASI" />
															) : null}
															{evt.permitReference ? (
																<Text type="code" color="secondary" className="text-xs font-mono">
																	No: {evt.permitReference}
																</Text>
															) : null}
														</HStack>
														<Text type="large" weight="bold" className="text-lg text-[#181817] leading-snug m-0">
															{evt.title}
														</Text>
														<HStack gap={3} align="center" wrap="wrap" className="text-base text-[#545B67] pt-0.5">
															<HStack gap={1} align="center" className="shrink-0">
																<Building2 className="w-4 h-4 text-[#264D3B] shrink-0" />
																<Text type="body" weight="medium" className="text-[#181817] max-w-[220px] truncate">
																	{orgLabel}
																</Text>
															</HStack>
															<HStack gap={1} align="center" className="shrink-0">
																<MapPinned className="w-4 h-4 text-[#545B67] shrink-0" />
																<Text type="body" color="secondary" className="max-w-[220px] truncate">
																	{evt.venueName || "Lokasi belum diisi"}
																</Text>
															</HStack>
														</HStack>
													</VStack>
												</TableCell>

												<TableCell>
													<VStack gap={1.5} className="py-1">
														<HStack gap={1.5} align="center" className="text-base text-[#545B67]">
															<Clock className="w-4 h-4 text-[#264D3B] shrink-0" />
															<Text type="body" color="secondary" className="tabular-nums">
																{scheduleText}
															</Text>
														</HStack>
														<div>
															<EventLifecycleBadge status={evt.status} />
														</div>
													</VStack>
												</TableCell>

												<TableCell className="overflow-visible min-w-[190px] w-[200px]">
													<VStack gap={1.5} align="start" className="py-1 min-w-[180px]">
														<Link
															to={`/dashboard/events/${evt.id}`}
															className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-base font-semibold hover:bg-[#1d3c2e] transition-colors no-underline shadow-xs shrink-0"
														>
															<FileText className="w-4 h-4" />
															<span>Kelola Kegiatan</span>
														</Link>
														{evt.publicSlug &&
														(evt.status === "published" || evt.status === "active") ? (
															<Link
																to={`/events/${evt.publicSlug}`}
																className="inline-flex items-center gap-1 text-base font-semibold text-[#264D3B] hover:underline no-underline shrink-0"
															>
																<CheckCircle2 className="w-4 h-4" />
																<span>Lihat Publik</span>
															</Link>
														) : null}
													</VStack>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>

						{/* Mobile Card List View (Clean & Touch-friendly) */}
						<div className="md:hidden space-y-3">
							{filteredEvents.map((evt) => {
								const scheduleText =
									evt.startsAt && evt.endsAt
										? formatWitaRange(evt.startsAt, evt.endsAt)
										: evt.startsAt
											? formatWitaDateTime(evt.startsAt)
											: "Jadwal belum ditetapkan";
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
										className="rounded-2xl border border-[#E2E4E8] bg-white p-4 space-y-3 shadow-xs"
									>
										<VStack gap={1.5}>
											<HStack gap={1.5} align="center" wrap="wrap">
												<span className="text-sm font-medium text-[#264D3B] bg-[#EBF3EE] px-2.5 py-0.5 rounded-full">
													{categoryLabel}
												</span>
												<EventLifecycleBadge status={evt.status} />
												{evt.isSimulation !== false ? (
													<Token color="orange" size="sm" label="SIMULASI" />
												) : null}
												{evt.permitReference ? (
													<Text type="code" color="secondary" className="text-xs font-mono">
														No: {evt.permitReference}
													</Text>
												) : null}
											</HStack>
											<Text type="large" weight="bold" as="h2" className="text-lg text-[#181817] leading-snug m-0">
												{evt.title}
											</Text>
										</VStack>

										<VStack gap={1.5} className="text-base text-[#545B67] pt-1 border-t border-[#F0EFEA]">
											<HStack gap={1.5} align="center">
												<Building2 className="w-4 h-4 text-[#264D3B] shrink-0" />
												<Text type="body" weight="medium" className="truncate text-[#181817]">
													{orgLabel}
												</Text>
											</HStack>
											<HStack gap={1.5} align="center">
												<MapPinned className="w-4 h-4 text-[#545B67] shrink-0" />
												<Text type="body" color="secondary" className="truncate">
													{evt.venueName || "Lokasi belum diisi"}
												</Text>
											</HStack>
											<HStack gap={1.5} align="center">
												<Clock className="w-4 h-4 text-[#264D3B] shrink-0" />
												<Text type="body" color="secondary">
													{scheduleText}
												</Text>
											</HStack>
										</VStack>

										<div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0EFEA]">
											<Link
												to={`/dashboard/events/${evt.id}`}
												className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#264D3B] text-white text-base font-semibold hover:bg-[#1d3c2e] transition-colors no-underline shadow-xs w-full sm:w-auto"
											>
												<FileText className="w-4 h-4" />
												<span>Kelola Kegiatan</span>
												<ArrowRight className="w-4 h-4 ml-1" />
											</Link>

											{evt.publicSlug &&
											(evt.status === "published" || evt.status === "active") ? (
												<Link
													to={`/events/${evt.publicSlug}`}
													className="inline-flex items-center gap-1 text-base font-semibold text-[#264D3B] hover:underline no-underline py-1"
												>
													<CheckCircle2 className="w-3.5 h-3.5" />
													<span>Lihat Halaman Publik</span>
												</Link>
											) : null}
										</div>
									</div>
								);
							})}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
