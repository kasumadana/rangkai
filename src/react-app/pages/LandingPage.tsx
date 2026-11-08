import { useQuery } from "@tanstack/react-query";
import { Token } from "@astryxdesign/core/Token";
import {
	ArrowRight,
	Calendar,
	MapPin,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { BaliLandingSatelliteMap } from "../features/map/BaliLandingSatelliteMap";
import {
	fetchPublicEvents,
	formatWitaEventSchedule,
	mapPublicEventToCeremonyProfile,
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

	// Live API connection for published/active events from backend
	const { data: publicEventsData, isLoading: isEventsLoading } = useQuery({
		queryKey: ["public", "events", { limit: 20 }],
		queryFn: () => fetchPublicEvents({ limit: 20 }),
		staleTime: 60_000,
	});

	const liveEvents = useMemo(
		() => publicEventsData?.events ?? [],
		[publicEventsData],
	);

	const ceremonyProfiles = useMemo(
		() =>
			liveEvents.map((evt, idx) =>
				mapPublicEventToCeremonyProfile(evt, [], idx),
			).filter((profile) => profile.roadSegments.some((road) => road.coordinates.length > 0)),
		[liveEvents],
	);

	const displayEvents: NormalizedLandingEvent[] = useMemo(
		() =>
			liveEvents.map((e) => {
				const schedule = formatWitaEventSchedule(e.startsAt, e.endsAt);
				return {
					id: e.id,
					slug: e.slug || e.id,
					title: e.title,
					village: e.organizationName || e.village || "Desa Adat",
					regency: e.district || "Bali",
					roadName: e.venueName || e.village || "Koridor Wilayah Desa",
					status: "unknown" as const,
					isSimulation: e.isSimulation !== false,
					timeLabel: `${schedule.dateLabel} • ${schedule.windowWita}`,
				};
			}),
		[liveEvents],
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
			{/* 1. HERO SPLIT SECTION */}
			<section className="hero">
				<div className="hero-left">
					<div className="hero-left-inner">
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

				<div className="hero-right">
					<div className="hero-fade-overlay" />
					<img
						src="/images/bali-culture-hero.jpg"
						alt="Pura Ulun Danu Beratan Bali"
						className="hero-full-img"
					/>
				</div>
			</section>

			{/* 2. PETA MAP FULL SECTION SCREEN DENGAN MARGIN RINGAN */}
			<section id="peta-kawasan" className="landing-map-section">
				<div className="landing-map-header">
					<h2 className="landing-map-title">
						Peta Wilayah Upacara & Rekayasa Jalur Bali
					</h2>
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
					<p style={{ fontSize: 16, color: "#545B67", marginTop: 8 }}>
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
							borderRadius: 16,
							padding: "48px 24px",
							textAlign: "center",
							color: "#545B67",
						}}
					>
						<p style={{ margin: 0, fontSize: 15 }}>
							Memuat jadwal upacara terpublikasi dari server...
						</p>
					</div>
				) : filteredEvents.length > 0 ? (
					<div className="schedule-grid">
						{filteredEvents.map((evt: NormalizedLandingEvent) => {
							let statusClass = "status-intermittent";
							let statusText = "Terjadwal";
							if (evt.status === "closed") {
								statusClass = "status-closed";
								statusText = "Sedang Berlangsung";
							} else if (evt.status === "open") {
								statusClass = "status-open";
								statusText = "Selesai";
							} else if (evt.status === "unknown") {
								statusClass = "status-unknown";
								statusText = "Butuh Konfirmasi";
							}

							return (
								<div
									key={evt.id}
									className="schedule-card"
									data-gsap="scroll-card"
								>
									<div>
										<div className="schedule-card-header">
											<span className="schedule-village-label">{evt.village} • {evt.regency}</span>
											<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
												{evt.isSimulation ? (
													<Token color="orange" size="sm" label="SIMULASI" />
												) : null}
												<span className={`road-status-badge ${statusClass}`}>
													{statusText}
												</span>
											</div>
										</div>

										<h3 className="schedule-card-title">{evt.title}</h3>

										<div className="schedule-card-meta">
											<div className="schedule-meta-row">
												<Calendar size={15} color="#64748B" />
												<span style={{ fontVariantNumeric: "tabular-nums" }}>
													{evt.timeLabel}
												</span>
											</div>
											<div className="schedule-meta-row">
												<MapPin size={15} color="#64748B" />
												<span>{evt.roadName}</span>
											</div>
										</div>
									</div>

									<div className="schedule-card-footer">
										<Link to={`/peta?village=${evt.slug}`} style={{ fontSize: 13, color: "#264D3B", textDecoration: "none", fontWeight: 500 }}>
											Lihat di Peta →
										</Link>
										<Link to={`/events/${evt.slug}`} className="btn-schedule-detail">
											<span>Rincian Upacara</span>
											<ArrowRight size={14} />
										</Link>
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<div
						data-gsap="scroll-card"
						style={{
							background: "#FFFFFF",
							borderRadius: 16,
							padding: "48px 24px",
							textAlign: "center",
							color: "#545B67",
						}}
					>
						<p style={{ margin: "0 0 12px 0", fontSize: 16, color: "#181B20" }}>
							Belum ada jadwal upacara terpublikasi untuk wilayah ini.
						</p>
						<p style={{ margin: "0 0 20px 0", fontSize: 14, color: "#545B67" }}>
							Jadwal hanya ditampilkan setelah panitia desa adat memverifikasi dan memublikasikan pengumuman resmi.
						</p>
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
							<span>Buka Direktori Jadwal Upacara</span>
							<ArrowRight size={15} />
						</Link>
					</div>
				)}
			</section>
		</div>
	);
}
