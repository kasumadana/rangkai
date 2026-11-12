import { useQuery } from "@tanstack/react-query";
import {
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

const STATUS_LABELS: Record<EventLifecycleStatus, string> = {
	draft: "Draf", review: "Dalam tinjauan", published: "Diumumkan", active: "Aktif",
	completed: "Selesai", cancelled: "Dibatalkan", archived: "Diarsipkan",
};

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
						Kegiatan Upacara
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
						className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#E5E3DC] bg-white text-base font-semibold text-[#181817] hover:bg-white transition-colors"
					>
						<RefreshCw className="w-4 h-4 text-[#585854]" />
						<span>Segarkan</span>
					</button>

					<Link
						to="/dashboard/events/new"
						className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#4D702F] text-sm font-semibold text-white hover:bg-[#405E28] transition-colors no-underline shadow-xs"
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
						<div className="text-base font-semibold text-[#9A5B13]">
							<span>Belum terhubung ke desa adat</span>
						</div>
						<p className="text-base font-medium text-[#181817]">
							Akun Anda ({sessionData.user.email}) belum terdaftar sebagai
							Panitia atau Petugas di Desa Adat mana pun.
						</p>
						<p className="text-base text-[#585854]">
							Daftarkan Desa Adat / Banjar Anda terlebih dahulu agar dapat
							membuat draf pengumuman upacara dan mengatur penutupan jalan.
						</p>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<Link
							to="/onboarding/organization"
							className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#4D702F] text-xs font-semibold text-white hover:bg-[#405E28] transition-colors no-underline"
						>
							<Building2 className="w-3.5 h-3.5" />
							<span>Daftarkan Desa Adat</span>
						</Link>
						<Link
							to="/settings"
							className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#E5E3DC] bg-white text-base font-semibold text-[#181817] hover:bg-white transition-colors no-underline"
						>
							<span>Pengaturan Akun</span>
						</Link>
					</div>
				</div>
			) : null}

			{/* Filter & Search Bar */}
			<div className="teduh-workspace-card p-4">
				<div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 min-w-0">
					<div className="flex flex-wrap items-center gap-1.5 min-w-0">
						{STATUS_FILTER_OPTIONS.map((opt) => {
							const active = statusFilter === opt.value;
							return (
								<button
									key={opt.value}
									type="button"
									onClick={() => setStatusFilter(opt.value)}
									className={`px-3.5 py-2.5 rounded-xl text-base font-semibold transition-colors ${
										active
											? "bg-[#4D702F] text-white"
											: "bg-[#F3F1EC] text-[#585854] hover:text-[#181817]"
									}`}
								>
									{opt.label}
								</button>
							);
						})}
					</div>

					<div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 w-full xl:w-auto min-w-0">
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
								className="w-full sm:w-auto sm:max-w-xs max-w-full min-w-0 rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2.5 text-lg font-medium text-[#181817] truncate focus:outline-none focus:border-[#4D702F]"
							>
								<option value="all">Semua Desa Adat Saya</option>
								{organizations.map((org) => (
									<option key={org.id} value={org.id}>
										{org.name} ({org.role === "organizer" ? "Panitia" : "Petugas"})
									</option>
								))}
							</select>
						) : null}

						<div className="relative min-w-0 sm:min-w-[200px] w-full sm:w-auto sm:flex-initial">
							<Search className="w-4 h-4 text-[#8A8984] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
							<input
								type="search"
								aria-label="Cari kegiatan"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Cari nama upacara, lokasi, surat..."
								className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] pl-9 pr-3.5 py-2.5 text-lg text-[#181817] placeholder:text-[#8A8984] focus:outline-none focus:border-[#4D702F]"
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
					<EmptyStateCard
							title="Belum ada kegiatan"
							description="Tidak ada kegiatan yang cocok dengan filter. Buat draf baru atau ubah filter."
							actions={
								<div className="flex flex-wrap items-center gap-2">
									<button
										type="button"
										onClick={() => {
											setStatusFilter("all");
											setSearchQuery("");
											setActiveOrgFilter("all");
										}}
										className="px-4 py-2 rounded-xl border border-[#E5E3DC] bg-white text-base font-semibold text-[#181817] hover:bg-white"
									>
										Reset Filter
									</button>
									<Link
										to="/dashboard/events/new"
										className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#4D702F] text-xs font-semibold text-white hover:bg-[#405E28] no-underline"
									>
										<PlusCircle className="w-4 h-4" />
										<span>Buat Draf Pengumuman</span>
									</Link>
								</div>
							}
						/>
				) : (
					<div className="space-y-3.5 min-w-0" data-testid="events-list">
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
									data-testid="event-row"
									data-event-id={evt.id}
									className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs transition-shadow hover:shadow-md min-w-0"
								>
									<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 min-w-0">
										<div className="min-w-0 flex-1 space-y-2">
											<div className="flex flex-wrap items-center gap-2">
												<span className="text-xs sm:text-sm font-medium text-[#4D702F] bg-[#F0F4EB] px-2.5 py-0.5 rounded-full shrink-0">
													{categoryLabel}
												</span>
												<div className="min-w-0 max-w-full">
													<span className="font-medium">{STATUS_LABELS[evt.status]}</span>
												</div>
												{evt.isSimulation !== false ? (
													<div className="shrink-0">
														<span className="map-popup-badge simulation-token">SIMULASI</span>
													</div>
												) : null}
												{evt.permitReference ? (
													<span className="text-xs font-mono shrink-0 text-stone-600">
														No: {evt.permitReference}
													</span>
												) : null}
											</div>

											<h2 className="text-base sm:text-lg font-bold text-[#181817] leading-snug m-0 break-words">
												{evt.title}
											</h2>

											<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm sm:text-base text-[#545B67] pt-0.5">
												<div className="flex items-center gap-1.5 min-w-0">
													<Building2 className="w-4 h-4 text-[#4D702F] shrink-0" />
													<span className="font-medium text-[#181817] truncate max-w-[260px] break-words">
														{orgLabel}
													</span>
												</div>
												<div className="flex items-center gap-1.5 min-w-0">
													<MapPinned className="w-4 h-4 text-[#545B67] shrink-0" />
													<span className="truncate max-w-[240px] break-words">
														{evt.venueName || "Lokasi belum diisi"}
													</span>
												</div>
												<div className="flex items-center gap-1.5 min-w-0 max-w-full">
													<Clock className="w-4 h-4 text-[#4D702F] shrink-0" />
													<span className="tabular-nums break-words">
														{scheduleText}
													</span>
												</div>
											</div>
										</div>

										<div className="flex sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#F0EFEA]">
											<Link
												to={`/dashboard/events/${evt.id}`}
												className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#4D702F] text-white text-base font-semibold hover:bg-[#405E28] transition-colors no-underline shadow-xs shrink-0"
											>
												<FileText className="w-4 h-4" />
												<span>Kelola Kegiatan</span>
											</Link>
											{evt.publicSlug &&
											(evt.status === "published" || evt.status === "active") ? (
												<Link
													to={`/events/${evt.publicSlug}`}
													className="inline-flex items-center gap-1 text-sm sm:text-base font-semibold text-[#4D702F] hover:underline no-underline shrink-0"
												>
													<CheckCircle2 className="w-4 h-4" />
													<span>Lihat Publik</span>
												</Link>
											) : null}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
