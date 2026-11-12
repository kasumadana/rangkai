import { useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	Calendar,
	MapPin,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { BaliLandingSatelliteMap } from "../features/map/BaliLandingSatelliteMap";
import {
	fetchPublicEvents,
	fetchPublicRoadImpacts,
	formatWitaEventSchedule,
	mapPublicEventToCeremonyProfile,
	roadImpactFeatureToRecord,
	type RoadImpactRecord,
} from "../lib/events-api";
import { useGsapLandingScroll } from "../lib/gsap-motion";

interface NormalizedLandingEvent {
	id: string;
	slug: string;
	title: string;
	village: string;
	regency: string;
	roadName: string;
	status: "open" | "intermittent" | "closed" | "unknown";
	isSimulation: boolean;
	timeLabel: string;
}

export function LandingPage() {
	const [selectedRegencyFilter, setSelectedRegencyFilter] = useState("all");
	const landingRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();

	// Live API connection for published/active events and road impacts from backend
	const { data: publicEventsData, isLoading: isEventsLoading, isError: isEventsError, refetch: refetchEvents } = useQuery({
		queryKey: ["public", "events", { limit: 20 }],
		queryFn: () => fetchPublicEvents({ limit: 20 }),
		staleTime: 30_000,
		refetchInterval: 30_000,
	});

	const {
		data: roadImpactsData,
		isError: isRoadsError,
		refetch: refetchRoads,
	} = useQuery({
		queryKey: ["public", "road-impacts", { limit: 300 }],
		queryFn: () => fetchPublicRoadImpacts({ limit: 300 }),
		staleTime: 30_000,
		refetchInterval: 30_000,
	});

	const liveEvents = useMemo(
		() => publicEventsData?.events ?? [],
		[publicEventsData],
	);

	const impactsByEvent = useMemo(() => {
		const map = new Map<string, RoadImpactRecord[]>();
		if (!roadImpactsData?.features) return map;
		for (const feat of roadImpactsData.features) {
			const rec = roadImpactFeatureToRecord(feat);
			const eId = feat.properties.eventId;
			const eSlug = feat.properties.eventSlug;
			if (eId) {
				const existing = map.get(eId) ?? [];
				existing.push(rec);
				map.set(eId, existing);
			}
			if (eSlug && eSlug !== eId) {
				const existing = map.get(eSlug) ?? [];
				existing.push(rec);
				map.set(eSlug, existing);
			}
		}
		return map;
	}, [roadImpactsData]);

	const ceremonyProfiles = useMemo(
		() =>
			liveEvents.map((evt, idx) => {
				const roads =
					impactsByEvent.get(evt.id) ??
					(evt.slug ? impactsByEvent.get(evt.slug) : undefined) ??
					[];
				return mapPublicEventToCeremonyProfile(evt, roads, idx);
			}),
		[liveEvents, impactsByEvent],
	);

	const displayEvents: NormalizedLandingEvent[] = useMemo(
		() =>
			liveEvents.map((e) => {
				const schedule = formatWitaEventSchedule(e.startsAt, e.endsAt);
				const roads =
					impactsByEvent.get(e.id) ??
					(e.slug ? impactsByEvent.get(e.slug) : undefined) ??
					[];
				const primaryRoad = roads[0];
				let effStatus: "open" | "intermittent" | "closed" | "unknown" = "unknown";
				if (primaryRoad?.operationalStatus) {
					const s = primaryRoad.operationalStatus;
					if (!s.isStale && (s.effectiveStatus === "open" || s.effectiveStatus === "intermittent" || s.effectiveStatus === "closed")) {
						effStatus = s.effectiveStatus;
					}
				}
				return {
					id: e.id,
					slug: e.slug || e.id,
					title: e.title,
					village: e.organizationName || e.village || "Desa Adat",
					regency: e.district || "Bali",
					roadName: primaryRoad?.displayName || e.venueName || e.village || "Koridor Wilayah Desa",
					status: effStatus,
					isSimulation: e.isSimulation !== false,
					timeLabel: `${schedule.dateLabel} • ${schedule.windowWita}`,
				};
			}),
		[liveEvents, impactsByEvent],
	);

	const filteredEvents = displayEvents.filter((evt: NormalizedLandingEvent) => {
		if (selectedRegencyFilter === "all") return true;
		return (
			evt.regency.toLowerCase().includes(selectedRegencyFilter.toLowerCase()) ||
			evt.village.toLowerCase().includes(selectedRegencyFilter.toLowerCase())
		);
	});

	useGsapLandingScroll(landingRef, [
		filteredEvents.length,
		selectedRegencyFilter,
		isEventsLoading,
	]);

	return (
		<div ref={landingRef} style={{ width: "100%", overflowX: "hidden" }}>
			{/* 1. HERO SPLIT SECTION WITH RESPONSIVE PHOTO FADE */}
			<section className="hero">
				<img
					src="/images/bali-culture-hero.webp"
					alt="Pura Ulun Danu Beratan Bali"
					className="hero-bg-img"
				/>
				<div className="hero-scrim" />
				<div className="hero-content">
					<div className="hero-content-inner">
						<h1 className="hero-title" data-gsap="hero-item">
							Koordinasi Upacara Adat & Jalur Publik Lebih Teratur
						</h1>

						<p className="hero-desc" data-gsap="hero-item">
							Platform koordinasi jadwal karya adat, pembaruan status ruas jalan oleh petugas Pecalang terverifikasi, serta dokumentasi penanganan kebersihan pasca-upacara di Bali.
						</p>

						<div className="hero-action-row" data-gsap="hero-item">
							<a href="#peta-kawasan" className="btn-hero-primary">
								<span>Lihat Peta Kawasan</span>
								<ArrowRight size={16} />
							</a>
							<a href="#jadwal" className="btn-hero-secondary">
								<span>Jadwal Upacara</span>
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* 2. PETA MAP FULL SECTION SCREEN DENGAN MARGIN RINGAN */}
			<section id="peta-kawasan" className="landing-map-section">
				<div className="landing-map-header">
					<h2 className="landing-map-title">
						Peta Wilayah Upacara & Rekayasa Jalur Bali
					</h2>
					{isRoadsError ? (
						<p style={{ fontSize: "1rem", color: "#B91C1C", marginTop: 4 }}>
							Sebagian data ruas jalan belum dapat dimuat.{" "}
							<button
								type="button"
								onClick={() => refetchRoads()}
								style={{
									textDecoration: "underline",
									background: "none",
									border: "none",
									color: "#B91C1C",
									cursor: "pointer",
									fontWeight: 600,
								}}
							>
								Muat Ulang
							</button>
						</p>
					) : roadImpactsData?.pagination?.truncated ? (
						<p style={{ fontSize: "1rem", color: "#92400E", marginTop: 4 }}>
							Menampilkan {roadImpactsData.features.length} dari {roadImpactsData.pagination.total} ruas jalan terdampak di Bali.
						</p>
					) : null}
				</div>
				<div className="landing-map-inner">
					<BaliLandingSatelliteMap ceremonies={ceremonyProfiles} />
				</div>
			</section>

			{/* 3. JADWAL UPACARA & PENUTUPAN JALAN TERKINI */}
			<section id="jadwal" className="schedule-section">
				<div className="schedule-header schedule-top-bar">
					<h2 className="hd">
						Jadwal Upacara & Rekayasa Jalur Terkini
					</h2>
					<p style={{ fontSize: "1rem", color: "#545B67", marginTop: 8 }}>
						Pilih kabupaten/kota untuk melihat agenda prosesi adat terpublikasi, waktu pelaksanaan dalam WITA, dan lokasi kegiatan.
					</p>
				</div>

				<div className="schedule-filter-bar">
					{[
						{ id: "all", label: "Semua Wilayah" },
						{ id: "denpasar", label: "Kota Denpasar" },
						{ id: "badung", label: "Kab. Badung" },
						{ id: "gianyar", label: "Kab. Gianyar" },
						{ id: "tabanan", label: "Kab. Tabanan" },
						{ id: "klungkung", label: "Kab. Klungkung" },
					].map((f) => (
						<button
							type="button"
							key={f.id}
							className={`schedule-filter-btn ${selectedRegencyFilter === f.id ? "is-active" : ""}`}
							onClick={() => setSelectedRegencyFilter(f.id)}
						>
							{f.label}
						</button>
					))}
				</div>

				{isEventsLoading ? (
					<div
						style={{
							background: "#FFFFFF",
							border: "1px solid var(--color-border)",
							borderRadius: 4,
							padding: "48px 24px",
							textAlign: "center",
							color: "#545B67",
						}}
					>
						<p style={{ margin: 0, fontSize: "1rem" }}>
							Memuat jadwal upacara terpublikasi dari server...
						</p>
					</div>
				) : isEventsError ? (
					<div role="alert" className="teduh-empty-surface">
						<p>Gagal memuat jadwal kegiatan.</p>
						<button className="ui-button" type="button" onClick={() => void refetchEvents()}>
							Coba lagi
						</button>
					</div>
				) : filteredEvents.length > 0 ? (
					<div className="schedule-grid">
						{filteredEvents.map((evt: NormalizedLandingEvent) => {
							let statusClass = "status-intermittent";
							let statusText = "Jalan buka-tutup";
							if (evt.status === "closed") {
								statusClass = "status-closed";
								statusText = "Jalan ditutup";
							} else if (evt.status === "open") {
								statusClass = "status-open";
								statusText = "Jalan terbuka";
							} else if (evt.status === "unknown") {
								statusClass = "status-unknown";
								statusText = "Status jalan belum dikonfirmasi";
							}

							return (
								<article
									key={evt.id}
									className="schedule-card schedule-card-clickable"
									data-gsap="scroll-card"
									onClick={(e) => {
										if (!(e.target as HTMLElement).closest("a, button")) {
											navigate(`/events/${evt.slug}`);
										}
									}}
								>
									<div>
										<div className="schedule-card-header">
											<span className="schedule-village-label">{evt.village.replace(/\s*\([Ss]imulasi\)/g, "").trim()} • {evt.regency}</span>
											<div className="schedule-card-badges">
												{evt.isSimulation !== false ? (
													<span className="simulation-label">SIMULASI</span>
												) : null}
												<span className={`status-label ${statusClass}`}>
													{statusText}
												</span>
											</div>
										</div>

										<h3 className="schedule-card-title">
											<Link
												to={`/events/${evt.slug}`}
												className="schedule-card-title-link"
											>
												{evt.title.replace(/^\[SIMULATED\]\s*/i, "").trim()}
											</Link>
										</h3>

										<div className="schedule-card-meta">
											<div className="schedule-meta-row">
												<Calendar size={16} color="#4D702F" style={{ flexShrink: 0 }} />
												<span style={{ fontVariantNumeric: "tabular-nums" }}>
													{evt.timeLabel}
												</span>
											</div>
											<div className="schedule-meta-row">
												<MapPin size={16} color="#4D702F" style={{ flexShrink: 0 }} />
												<span>{evt.roadName}</span>
											</div>
										</div>
									</div>

									<div className="schedule-card-footer">
										<Link
											to={`/peta?village=${evt.slug}`}
											className="btn-schedule-map"
											onClick={(e) => e.stopPropagation()}
										>
											<span>Lihat di Peta</span>
										</Link>
										<Link
											to={`/events/${evt.slug}`}
											className="btn-schedule-detail"
											onClick={(e) => e.stopPropagation()}
										>
											<span>Rincian Upacara</span>
											<ArrowRight size={15} />
										</Link>
									</div>
								</article>
							);
						})}
					</div>
				) : (
					<div
						data-gsap="scroll-card"
						style={{
							background: "#FFFFFF",
							border: "1px solid var(--color-border)",
							borderRadius: 4,
							padding: "48px 24px",
							textAlign: "center",
							color: "#545B67",
						}}
					>
						<p style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#181B20", fontWeight: 600 }}>
							Belum ada jadwal upacara terpublikasi untuk wilayah ini.
						</p>
						<p style={{ margin: "0 0 20px 0", fontSize: "1rem", color: "#545B67" }}>
							Jadwal hanya ditampilkan setelah panitia desa adat memverifikasi dan memublikasikan pengumuman resmi.
						</p>
						<Link
							to="/events"
							className="ui-button ui-button-primary"
							style={{ gap: 8 }}
						>
							<span>Buka Direktori Jadwal Upacara</span>
							<ArrowRight size={15} />
						</Link>
					</div>
				)}
			</section>
		</div>
	);
}
