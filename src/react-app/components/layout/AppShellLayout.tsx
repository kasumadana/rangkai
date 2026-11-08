import {
	ArrowLeft,
	Bell,
	Building2,
	ClipboardCheck,
	Compass,
	FileText,
	KeyRound,
	LayoutDashboard,
	LogOut,
	MapPinned,
	Menu,
	PlusCircle,
	Radio,
	Settings,
	ShieldCheck,
	Users,
	X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink, Outlet, useLocation } from "react-router";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { EventLifecycleBadge, RangkaiPreloader, shouldPlayPreloader } from "../rangkai";
import {
	useAuthSession,
	useMyOrganizationsQuery,
	useSignOutMutation,
} from "../../lib/auth";
import {
	fetchEventDetail,
	fetchPublicEvents,
	formatWitaEventSchedule,
	getSavedOrganizationId,
} from "../../lib/events-api";
import { useGsapRouteTransition } from "../../lib/gsap-motion";

export const RouterLinkBridge = forwardRef<
	HTMLAnchorElement,
	AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }
>(function RouterLinkBridge({ href = "/", children, ...rest }, ref) {
	return (
		<RouterLink ref={ref} to={href} {...rest}>
			{children}
		</RouterLink>
	);
});

export function PublicShellLayout() {
	const { pathname } = useLocation();
	const [isWindowScrolled, setIsWindowScrolled] = useState(false);
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const [isNotifOpen, setIsNotifOpen] = useState(false);
	const [readNotifIds, setReadNotifIds] = useState<string[]>([]);
	const [isPreloaderActive, setIsPreloaderActive] = useState(() =>
		pathname === "/" ? shouldPlayPreloader() : false,
	);
	const notifRef = useRef<HTMLDivElement>(null);
	const mainContentRef = useRef<HTMLElement>(null);

	const { data: sessionData } = useAuthSession();
	const signOutMutation = useSignOutMutation();

	useGsapRouteTransition(mainContentRef, pathname);

	const { data: publicEventsData } = useQuery({
		queryKey: ["public", "events", { limit: 6 }],
		queryFn: () => fetchPublicEvents({ limit: 6 }),
		staleTime: 60_000,
	});
	const upcomingCeremonies = (publicEventsData?.events ?? []).slice(0, 4);

	useEffect(() => {
		function handleScroll() {
			const threshold = pathname === "/" ? Math.max(280, window.innerHeight * 0.65) : 40;
			setIsWindowScrolled(window.scrollY > threshold);
		}

		handleScroll();
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, [pathname]);

	// Close dropdowns & reset scroll position on route change
	const [prevPathname, setPrevPathname] = useState(pathname);
	if (prevPathname !== pathname) {
		setPrevPathname(pathname);
		setIsMobileMenuOpen(false);
		setIsNotifOpen(false);
	}

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
		}
	}, [pathname]);

	// Close notif dropdown on click outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
				setIsNotifOpen(false);
			}
		}
		if (isNotifOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isNotifOpen]);

	const isFullViewportPage =
		pathname === "/peta" ||
		pathname.endsWith("/map");

	// On full-screen map routes, the map console has its own split floating topbar and mobile dock.
	// We return pure Outlet with the Rangkai map preloader on initial visit/reload
	if (isFullViewportPage) {
		return (
			<>
				<RangkaiPreloader preloaderKey="peta" />
				<Outlet />
			</>
		);
	}

	return (
		<div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", position: "relative", backgroundColor: "#FBFBFA" }}>
			{pathname === "/" && (
				<RangkaiPreloader
					preloaderKey="landing"
					onComplete={() => setIsPreloaderActive(false)}
				/>
			)}
			{/* Floating Capsule Navbar (Teduh Style) */}
			<header
				className={`navbar ${pathname === "/" ? "navbar-landing" : ""} ${isWindowScrolled ? "navbar-scrolled" : ""}`}
				style={
					isPreloaderActive
						? { opacity: 0, pointerEvents: "none", transition: "opacity 0.4s ease" }
						: undefined
				}
			>
				<div className="navbar-inner">
					<RouterLinkBridge href="/" className="navbar-brand" aria-label="Rangkai Beranda">
						<img src="/logo.png" alt="Rangkai Logo" className="navbar-brand-logo" />
					</RouterLinkBridge>

					<nav className="navbar-links" aria-label="Menu Utama">
						<RouterLinkBridge href="/" className={`navbar-link ${pathname === "/" ? "active" : ""}`}>
							Beranda
						</RouterLinkBridge>
						<RouterLinkBridge href="/peta" className={`navbar-link ${pathname === "/peta" ? "active" : ""}`}>
							Peta Kawasan
						</RouterLinkBridge>
						<RouterLinkBridge href="/events" className={`navbar-link ${pathname.startsWith("/events") ? "active" : ""}`}>
							Jadwal Upacara
						</RouterLinkBridge>
					</nav>

					<div className="navbar-actions">
						{/* Notification bell for active ceremonies (Teduh Style) */}
						<div className="nav-notif-wrapper" ref={notifRef}>
							<button
								type="button"
								className="nav-notif-btn"
								onClick={() => setIsNotifOpen((prev) => !prev)}
								aria-label="Ringkasan Upacara Hari Ini"
								title="Upacara Adat & Jalur Aktif Hari Ini"
							>
								<Bell size={18} />
							</button>

							{isNotifOpen && (
								<div className="nav-notif-popup">
									<div className="nav-notif-header">
										<span className="nav-notif-title">Acara & Rekayasa Jalur Aktif</span>
										{upcomingCeremonies.length > 0 && (
											<button
												type="button"
												className="nav-notif-mark-read-btn"
												onClick={() => setReadNotifIds(upcomingCeremonies.map((c) => c.id))}
											>
												Tandai Dibaca
											</button>
										)}
									</div>

									<div className="nav-notif-list">
										{upcomingCeremonies.length === 0 ? (
											<div style={{ padding: "20px 18px", textAlign: "center", fontSize: 13, color: "#545B67" }}>
												Belum ada pengumuman upacara adat aktif saat ini.
											</div>
										) : (
											upcomingCeremonies.map((item) => {
												const isRead = readNotifIds.includes(item.id);
												const isClosed = item.status === "active";
												const schedule = formatWitaEventSchedule(item.startsAt, item.endsAt);

												return (
													<RouterLinkBridge
														key={item.id}
														href={`/events/${item.slug}`}
														className={`nav-notif-item ${isRead ? "is-read" : "is-unread"}`}
														onClick={() => {
															if (!isRead) {
																setReadNotifIds((prev) => [...prev, item.id]);
															}
															setIsNotifOpen(false);
														}}
													>
														<div
															className="nav-notif-icon-box"
															style={{
																background: isClosed ? "#FEF2F2" : "#FFFBEB",
																color: isClosed ? "#B91C1C" : "#D97706",
															}}
														>
															<MapPinned size={15} />
														</div>
														<div className="nav-notif-content">
															<p className="nav-notif-item-msg">{item.title}</p>
															<p className="nav-notif-item-time">
																{item.organizationName} • {item.venueName || item.village} • {schedule.windowWita}
															</p>
														</div>
													</RouterLinkBridge>
												);
											})
										)}
									</div>

									<div className="nav-notif-footer">
										<RouterLinkBridge
											href="/events"
											className="nav-notif-view-all-btn"
											onClick={() => setIsNotifOpen(false)}
										>
											Lihat Semua Jadwal Upacara →
										</RouterLinkBridge>
									</div>
								</div>
							)}
						</div>

						{/* Authenticated Profile or Akses Petugas CTA */}
						{sessionData?.user ? (
							<div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
								<RouterLinkBridge href="/dashboard" className="btn-nav-officer">
									<LayoutDashboard size={15} />
									<span>Panel Desa</span>
								</RouterLinkBridge>
								<button
									type="button"
									disabled={signOutMutation.isPending}
									onClick={() => signOutMutation.mutate()}
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 6,
										padding: "8px 12px",
										borderRadius: 9999,
										border: "1px solid #E5E3DC",
										background: "#FFFFFF",
										color: "#545B67",
										fontSize: 13,
										fontWeight: 500,
										cursor: "pointer",
									}}
								>
									<LogOut size={14} />
									<span>Keluar</span>
								</button>
							</div>
						) : (
							<RouterLinkBridge href="/login" className="btn-nav-officer">
								<ShieldCheck size={16} />
								<span>Akses Petugas</span>
							</RouterLinkBridge>
						)}

						{/* Hamburger menu for mobile */}
						<button
							type="button"
							className="navbar-hamburger"
							onClick={() => setIsMobileMenuOpen(true)}
							aria-label="Buka menu navigasi"
						>
							<Menu size={20} />
						</button>
					</div>
				</div>
			</header>

			{/* Mobile Slide-Over Drawer */}
			<div
				className={`mobile-nav-overlay ${isMobileMenuOpen ? "is-visible" : ""}`}
				onClick={() => setIsMobileMenuOpen(false)}
			/>
			<aside className={`mobile-nav-menu ${isMobileMenuOpen ? "is-open" : ""}`} aria-label="Menu Ponsel">
				<div className="mobile-nav-top">
					<div className="mobile-nav-header">
						<RouterLinkBridge href="/" className="navbar-brand">
							<img src="/logo.png" alt="Rangkai Logo" style={{ height: 32 }} />
						</RouterLinkBridge>
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
						<RouterLinkBridge href="/" className={`mobile-nav-link ${pathname === "/" ? "is-active" : ""}`}>
							Beranda
						</RouterLinkBridge>
						<RouterLinkBridge href="/peta" className={`mobile-nav-link ${pathname === "/peta" ? "is-active" : ""}`}>
							Peta Kawasan
						</RouterLinkBridge>
						<RouterLinkBridge href="/events" className={`mobile-nav-link ${pathname.startsWith("/events") ? "is-active" : ""}`}>
							Jadwal Upacara
						</RouterLinkBridge>
					</div>
				</div>

				<div style={{ paddingTop: 20, borderTop: "1px solid #E2E4E8" }}>
					{sessionData?.user ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
							<RouterLinkBridge
								href="/dashboard"
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
								<LayoutDashboard size={18} color="#264D3B" />
								<span>Panel Petugas Desa</span>
							</RouterLinkBridge>
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
						<RouterLinkBridge
							href="/login"
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
						</RouterLinkBridge>
					)}
				</div>
			</aside>

			{/* Main Content Viewport */}
			<main ref={mainContentRef} id="main-content" style={{ flex: 1 }}>
				<Outlet />
			</main>

			{/* Light Civic Footer (Teduh Footer-New Style) */}
			<footer className="footer-new">
				<div className="footer-inner">
					<div className="footer-row-top">
						<div className="footer-brand-col">
							<RouterLinkBridge href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
								<img src="/logo.png" alt="Rangkai Logo" style={{ height: 38 }} />
								<span style={{ fontSize: 20, fontWeight: 500, color: "#264D3B" }}>Rangkai</span>
							</RouterLinkBridge>
							<p className="brand-bio">
								Sistem koordinasi operasional upacara adat Bali untuk ruang publik, status ruas jalan terverifikasi oleh Pecalang, kantong parkir, dan pengelolaan kebersihan pasca-kegiatan.
							</p>
							<div
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 8,
									background: "#FFFFFF",
									border: "1px solid #E2E4E8",
									padding: "6px 14px",
									borderRadius: 9999,
									fontSize: 12.5,
									color: "#545B67",
								}}
							>
								<span>Waktu Operasional: <strong>WITA (UTC+8)</strong> • Seluruh Bali</span>
							</div>
						</div>

						<div className="footer-links-grid">
							<div className="footer-nav-group">
								<h5>Layanan Publik</h5>
								<ul>
									<li>
										<RouterLinkBridge href="/">Beranda</RouterLinkBridge>
									</li>
									<li>
										<RouterLinkBridge href="/peta">Konsol Peta Desa</RouterLinkBridge>
									</li>
									<li>
										<RouterLinkBridge href="/events">Jadwal Upacara Se-Bali</RouterLinkBridge>
									</li>
									<li>
										<RouterLinkBridge href="/info-desa">Pos Pecalang & Parkir</RouterLinkBridge>
									</li>
								</ul>
							</div>

							<div className="footer-nav-group">
								<h5>Ruang Kerja Desa</h5>
								<ul>
									<li>
										<RouterLinkBridge href="/dashboard">Panel Panitia Desa</RouterLinkBridge>
									</li>
									<li>

										<RouterLinkBridge href="/field">Pos Komando Lapangan</RouterLinkBridge>

									</li>
									<li>
										<RouterLinkBridge href="/login">Akses Masuk Petugas</RouterLinkBridge>
									</li>
								</ul>
							</div>

							<div className="footer-nav-group">
								<h5>Pedoman & Regulasi</h5>
								<p style={{ fontSize: 13, color: "#545B67", lineHeight: 1.6, margin: 0 }}>
									Rangkai adalah instrumen koordinasi operasional upacara adat Bali. Sistem ini bukan instrumen izin resmi penutupan jalan kepolisian atau Dishub sesuai ketentuan UU No. 22 Tahun 2009.
								</p>
							</div>
						</div>
					</div>

					<div className="footer-bottom-line">
						<div>
							© 2026 Rangkai. Inovasi Koordinasi Upacara Adat & Lalu Lintas Bali.
						</div>
						<div className="footer-bottom-links">
							<span>Status Terverifikasi Manusia</span>
							<span>•</span>
							<span>Standar WCAG 2.2 AA</span>
						</div>
					</div>
				</div>
			</footer>
		</div>
	);
}

export function WorkspaceShellLayout() {
	const { pathname } = useLocation();
	const workspaceContentRef = useRef<HTMLDivElement>(null);

	const { data: sessionData, isLoading: isSessionLoading } = useAuthSession();
	const signOutMutation = useSignOutMutation();
	const myOrgsQuery = useMyOrganizationsQuery();

	useGsapRouteTransition(workspaceContentRef, pathname);

	const [activeOrgIdState, setActiveOrgIdState] = useState(() =>
		getSavedOrganizationId(),
	);

	useEffect(() => {
		function onOrgChanged(e: Event) {
			const custom = e as CustomEvent<string>;
			if (custom.detail) {
				setActiveOrgIdState(custom.detail);
			} else {
				setActiveOrgIdState(getSavedOrganizationId());
			}
		}
		window.addEventListener("rangkai:organization-changed", onOrgChanged);
		return () =>
			window.removeEventListener("rangkai:organization-changed", onOrgChanged);
	}, []);

	const organizations = useMemo(
		() => myOrgsQuery.data?.organizations ?? [],
		[myOrgsQuery.data?.organizations],
	);

	// Extract active event ID from URL strictly
	const eventIdMatch = pathname.match(/(?:dashboard|field)\/events\/([^/]+)/);
	const urlEventId =
		eventIdMatch && eventIdMatch[1] !== "new" ? eventIdMatch[1] : null;
	const activeNavEventId = urlEventId;

	// Query active event details for contextual header if inside an event
	const eventDetailQuery = useQuery({
		queryKey: ["events", "detail", activeNavEventId],
		queryFn: () => fetchEventDetail(activeNavEventId!),
		enabled: Boolean(activeNavEventId),
		staleTime: 30_000,
	});
	const activeEvent = eventDetailQuery.data?.event ?? null;

	const activeOrg = useMemo(() => {
		if (organizations.length === 0) return null;
		if (activeOrgIdState && activeOrgIdState !== "all") {
			const found = organizations.find((o) => o.id === activeOrgIdState);
			if (found) return found;
		}
		if (activeEvent?.organizationId) {
			const eventOrg = organizations.find((o) => o.id === activeEvent.organizationId);
			if (eventOrg) return eventOrg;
		}
		const organizerOrg = organizations.find((o) => o.role === "organizer");
		return organizerOrg ?? organizations[0];
	}, [organizations, activeOrgIdState, activeEvent]);

	const currentOrgRole = activeOrg?.role ?? null;
	const isCurrentOrgOrganizer = currentOrgRole === "organizer";
	const isCurrentOrgOfficer = currentOrgRole === "officer";

	const isOrgLoading = isSessionLoading || myOrgsQuery.isLoading;

	return (
		<div className="teduh-workspace-shell">
			{/* Top Bar */}
			<header className="teduh-workspace-topbar">
				<div className="teduh-workspace-topbar-left">
					<RouterLink to="/dashboard" className="teduh-workspace-brand">
						<img src="/logo.png" alt="Rangkai" />
					</RouterLink>

					<span
						className={`teduh-workspace-role-pill ${isCurrentOrgOfficer ? "is-officer" : ""}`}
					>
						{isOrgLoading
							? "Memuat keanggotaan..."
							: !sessionData?.user
								? "Mode Tamu / Pratinjau"
								: isCurrentOrgOrganizer
									? "Panitia Desa (Organizer)"
									: isCurrentOrgOfficer
										? "Petugas Lapangan (Pecalang)"
										: organizations.length === 0
											? "Belum terdaftar desa adat"
											: "Pilih organisasi"}
					</span>

					{activeOrg ? (
						<span className="teduh-workspace-org-badge" title={activeOrg.name}>
							<Building2 size={13} />
							<span>{activeOrg.name}</span>
						</span>
					) : null}
				</div>

				<div className="teduh-workspace-topbar-right">
					<RouterLink
						to="/"
						className="teduh-map-tool-btn"
						style={{ textDecoration: "none" }}
					>
						<Compass size={14} />
						<span className="hidden sm:inline">Portal Publik</span>
					</RouterLink>

					{!isSessionLoading && sessionData?.user ? (
						<>
							<RouterLink
								to="/settings"
								className="teduh-map-tool-btn"
								style={{ textDecoration: "none" }}
								title={sessionData.user.email}
							>
								<Settings size={14} />
								<span className="max-w-24 truncate">
									{sessionData.user.name || "Akun"}
								</span>
							</RouterLink>
							<button
								type="button"
								className="teduh-map-tool-btn is-danger"
								disabled={signOutMutation.isPending}
								onClick={() => signOutMutation.mutate()}
							>
								<LogOut size={14} />
								<span>Keluar</span>
							</button>
						</>
					) : (
						<RouterLink
							to="/login"
							className="teduh-map-tool-btn"
							style={{
								textDecoration: "none",
								background: "#264D3B",
								color: "#FFFFFF",
								borderColor: "#264D3B",
							}}
						>
							<KeyRound size={14} />
							<span>Masuk Akun</span>
						</RouterLink>
					)}
				</div>
			</header>

			{/* Main Body: Sidebar + Content */}
			<div className="teduh-workspace-body">
				<aside
					className="teduh-workspace-sidebar"
					aria-label="Menu Ruang Kerja"
				>
					<div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
						{pathname.startsWith("/field") ? (
							activeNavEventId ? (
								<>
									{/* Field Officer Contextual Navigation */}
									<div className="teduh-sidebar-group">
										<RouterLink
											to="/field"
											className="teduh-sidebar-link font-medium text-[#264D3B]"
										>
											<ArrowLeft size={16} />
											<span>Kembali ke Pos Jaga</span>
										</RouterLink>

										<VStack gap={1.5} className="p-3 mt-1.5 rounded-xl bg-white border border-[#E2E4E8]">
											<HStack justify="between" align="center" gap={1.5}>
												<Text type="label" color="secondary" className="uppercase tracking-wider text-xs font-semibold">
													Tugas Lapangan
												</Text>
												{activeEvent ? (
													<EventLifecycleBadge status={activeEvent.status} />
												) : null}
											</HStack>
											<Text type="body" weight="bold" maxLines={2} className="text-sm leading-snug m-0 text-[#181B20]">
												{activeEvent?.title || "Memuat kegiatan..."}
											</Text>
										</VStack>
									</div>

									<div className="teduh-sidebar-group">
										<div className="teduh-sidebar-group-label">
											Operasional Pos Jaga
										</div>
										<RouterLink
											to={`/field/events/${activeNavEventId}`}
											className={`teduh-sidebar-link ${
												pathname === `/field/events/${activeNavEventId}`
													? "is-active"
													: ""
											}`}
										>
											<Radio size={16} />
											<span>Pos Jaga Lapangan</span>
										</RouterLink>
										<RouterLink
											to={`/field/events/${activeNavEventId}/cleanup`}
											className={`teduh-sidebar-link ${
												pathname.endsWith("/cleanup") ? "is-active" : ""
											}`}
										>
											<ClipboardCheck size={16} />
											<span>Kebersihan &amp; Bukti</span>
										</RouterLink>
									</div>

									<div className="teduh-sidebar-group">
										<div className="teduh-sidebar-group-label">
											Akses Lapangan
										</div>
										<RouterLink
											to="/field"
											className={`teduh-sidebar-link ${
												pathname === "/field" ? "is-active" : ""
											}`}
										>
											<Radio size={16} />
											<span>Daftar Pos Jaga</span>
										</RouterLink>
										<RouterLink
											to="/settings"
											className={`teduh-sidebar-link ${
												pathname === "/settings" ? "is-active" : ""
											}`}
										>
											<Settings size={16} />
											<span>Pengaturan Akun</span>
										</RouterLink>
									</div>
								</>
							) : (
								<>
									{/* Field Officer Root Navigation */}
									<div className="teduh-sidebar-group">
										<div className="teduh-sidebar-group-label">
											Operasional Lapangan
										</div>
										<RouterLink
											to="/field"
											className={`teduh-sidebar-link ${
												pathname === "/field" ? "is-active" : ""
											}`}
										>
											<Radio size={16} />
											<span>Pos Jaga Lapangan</span>
										</RouterLink>
										<RouterLink
											to="/settings"
											className={`teduh-sidebar-link ${
												pathname === "/settings" ? "is-active" : ""
											}`}
										>
											<Settings size={16} />
											<span>Pengaturan Akun</span>
										</RouterLink>
									</div>

									<div className="p-3.5 rounded-xl border border-dashed border-[#D5D3CB] bg-[#FBFBFA] space-y-1">
										<span className="text-xs font-semibold text-[#181817] block">
											Pos Jaga Pecalang
										</span>
										<p className="text-[12px] text-[#545B67] leading-relaxed m-0">
											Pantau status jalan dan kirim bukti kebersihan kegiatan yang ditugaskan kepada Anda.
										</p>
									</div>
								</>
							)
						) : isCurrentOrgOfficer ? (
							<>
								{/* Selected organization is officer role: provide field navigation, no organizer management */}
								<div className="teduh-sidebar-group">
									<div className="teduh-sidebar-group-label">
										Operasional Lapangan
									</div>
									<RouterLink
										to="/field"
										className={`teduh-sidebar-link ${
											pathname.startsWith("/field") ? "is-active" : ""
										}`}
									>
										<Radio size={16} />
										<span>Buka Pos Jaga Lapangan</span>
									</RouterLink>
									<RouterLink
										to="/settings"
										className={`teduh-sidebar-link ${
											pathname === "/settings" ? "is-active" : ""
										}`}
									>
										<Building2 size={16} />
										<span>Pengaturan Akun</span>
									</RouterLink>
								</div>

								<div className="p-3.5 rounded-xl border border-dashed border-[#D5D3CB] bg-[#FBFBFA] space-y-1">
									<span className="text-xs font-semibold text-[#181817] block">
										Penugasan Petugas Lapangan
									</span>
									<p className="text-[12px] text-[#545B67] leading-relaxed m-0">
										Anda terdaftar sebagai Petugas Lapangan untuk desa adat ini. Buka Pos Jaga Lapangan untuk melaksanakan pembaruan operasional.
									</p>
								</div>
							</>
						) : activeNavEventId ? (
							<>
								{/* Contextual Event Card & Return to List */}
								<div className="teduh-sidebar-group">
									<RouterLink
										to="/dashboard"
										className="teduh-sidebar-link font-medium text-[#264D3B]"
									>
										<ArrowLeft size={16} />
										<span>Kembali ke Daftar</span>
									</RouterLink>

									<VStack gap={1.5} className="p-3 mt-1.5 rounded-xl bg-white border border-[#E2E4E8]">
										<HStack justify="between" align="center" gap={1.5}>
											<Text type="label" color="secondary" className="uppercase tracking-wider text-xs font-semibold">
												Kegiatan Terpilih
											</Text>
											{activeEvent ? (
												<EventLifecycleBadge status={activeEvent.status} />
											) : null}
										</HStack>
										<Text type="body" weight="bold" maxLines={2} className="text-sm leading-snug m-0 text-[#181B20]">
											{activeEvent?.title || "Memuat kegiatan..."}
										</Text>
									</VStack>
								</div>

								<div className="teduh-sidebar-group">
									<div className="teduh-sidebar-group-label">
										Alur Kerja Kegiatan
									</div>
									<RouterLink
										to={`/dashboard/events/${activeNavEventId}`}
										className={`teduh-sidebar-link ${
											pathname === `/dashboard/events/${activeNavEventId}`
												? "is-active"
												: ""
										}`}
									>
										<FileText size={16} />
										<span>Ringkasan / Detail</span>
									</RouterLink>
									<RouterLink
										to={`/dashboard/events/${activeNavEventId}/document`}
										className={`teduh-sidebar-link ${
											pathname.endsWith("/document") ||
											pathname.endsWith("/review")
												? "is-active"
												: ""
										}`}
									>
										<ShieldCheck size={16} />
										<span>Dokumen &amp; AI</span>
									</RouterLink>
									<RouterLink
										to={`/dashboard/events/${activeNavEventId}/roads`}
										className={`teduh-sidebar-link ${
											pathname.endsWith("/roads") ? "is-active" : ""
										}`}
									>
										<MapPinned size={16} />
										<span>Dampak Jalan</span>
									</RouterLink>
									<RouterLink
										to={`/dashboard/events/${activeNavEventId}/cleanup`}
										className={`teduh-sidebar-link ${
											pathname.endsWith("/cleanup") ? "is-active" : ""
										}`}
									>
										<ClipboardCheck size={16} />
										<span>Kebersihan</span>
									</RouterLink>
									<RouterLink
										to={`/dashboard/events/${activeNavEventId}/team`}
										className={`teduh-sidebar-link ${
											pathname.endsWith("/team") ? "is-active" : ""
										}`}
									>
										<Users size={16} />
										<span>Tim &amp; Petugas</span>
									</RouterLink>
								</div>

								<div className="teduh-sidebar-group">
									<div className="teduh-sidebar-group-label">
										Manajemen Desa
									</div>
									<RouterLink
										to="/dashboard"
										className={`teduh-sidebar-link ${
											pathname === "/dashboard" ||
											pathname === "/dashboard/events"
												? "is-active"
												: ""
										}`}
									>
										<LayoutDashboard size={16} />
										<span>Ikhtisar Kegiatan</span>
									</RouterLink>
									<RouterLink
										to="/dashboard/events/new"
										className={`teduh-sidebar-link ${
											pathname === "/dashboard/events/new" ? "is-active" : ""
										}`}
									>
										<PlusCircle size={16} />
										<span>Buat Kegiatan</span>
									</RouterLink>
									<RouterLink
										to="/settings"
										className={`teduh-sidebar-link ${
											pathname === "/settings" ? "is-active" : ""
										}`}
									>
										<Building2 size={16} />
										<span>Pengaturan</span>
									</RouterLink>
								</div>
							</>
						) : (
							<>
								{/* Global Organizer Navigation */}
								<div className="teduh-sidebar-group">
									<div className="teduh-sidebar-group-label">
										Manajemen Desa
									</div>
									<RouterLink
										to="/dashboard"
										className={`teduh-sidebar-link ${
											pathname === "/dashboard" ||
											pathname === "/dashboard/events"
												? "is-active"
												: ""
										}`}
									>
										<LayoutDashboard size={16} />
										<span>Ikhtisar Kegiatan</span>
									</RouterLink>
									<RouterLink
										to="/dashboard/events/new"
										className={`teduh-sidebar-link ${
											pathname === "/dashboard/events/new" ? "is-active" : ""
										}`}
									>
										<PlusCircle size={16} />
										<span>Buat Kegiatan</span>
									</RouterLink>
									<RouterLink
										to="/settings"
										className={`teduh-sidebar-link ${
											pathname === "/settings" ? "is-active" : ""
										}`}
									>
										<Building2 size={16} />
										<span>Pengaturan</span>
									</RouterLink>
								</div>

								{/* Helpful concise workflow guidance without broken fake links */}
								<div className="p-3.5 rounded-xl border border-dashed border-[#D5D3CB] bg-[#FBFBFA] space-y-1">
									<span className="text-xs font-semibold text-[#181817] block">
										Alur Kerja Kegiatan
									</span>
									<p className="text-[12px] text-[#545B67] leading-relaxed m-0">
										Pilih kegiatan dari daftar untuk mengelola Dokumen &amp; AI,
										Dampak Jalan, Kebersihan, atau Tim Petugas.
									</p>
								</div>

								<div className="teduh-sidebar-group">
									<div className="teduh-sidebar-group-label">
										Operasional Lapangan
									</div>
									<RouterLink
										to="/field"
										className={`teduh-sidebar-link ${
											pathname.startsWith("/field") ? "is-active" : ""
										}`}
									>
										<Radio size={16} />
										<span>Pos Jaga Lapangan</span>
									</RouterLink>
								</div>
							</>
						)}
					</div>

					<div
						style={{
							marginTop: "auto",
							padding: "12px 14px",
							borderRadius: 12,
							background: "#EEECE6",
							fontSize: 11.5,
							lineHeight: 1.5,
							color: "#545B67",
						}}
					>
						<strong
							style={{ color: "#181B20", display: "block", marginBottom: 2 }}
						>
							Koordinasi Adat &amp; Sipil
						</strong>
						Setiap publikasi acara wajib melalui verifikasi Prajuru Adat dan
						ruas jalan terverifikasi.
					</div>
				</aside>

				<main ref={workspaceContentRef} className="teduh-workspace-main">
					<Outlet />
				</main>
			</div>

			{/* Mobile Bottom Navigation */}
			<nav
				className="teduh-workspace-mobile-nav"
				aria-label="Navigasi Bawah Ruang Kerja"
			>
				{pathname.startsWith("/field") ? (
					<>
						<RouterLink
							to="/field"
							className="teduh-mobile-nav-item is-active"
						>
							<ClipboardCheck size={18} />
							<span>Tugas</span>
						</RouterLink>
						<RouterLink to="/settings" className="teduh-mobile-nav-item">
							<Settings size={18} />
							<span>Akun</span>
						</RouterLink>
					</>
				) : activeNavEventId ? (
					<>
						<RouterLink to="/dashboard" className="teduh-mobile-nav-item">
							<LayoutDashboard size={18} />
							<span>Daftar</span>
						</RouterLink>
						<RouterLink
							to={`/dashboard/events/${activeNavEventId}`}
							className={`teduh-mobile-nav-item ${
								pathname === `/dashboard/events/${activeNavEventId}`
									? "is-active"
									: ""
							}`}
						>
							<FileText size={18} />
							<span>Detail</span>
						</RouterLink>
						<RouterLink
							to={`/dashboard/events/${activeNavEventId}/roads`}
							className={`teduh-mobile-nav-item ${
								pathname.endsWith("/roads") ? "is-active" : ""
							}`}
						>
							<MapPinned size={18} />
							<span>Jalan</span>
						</RouterLink>
						<RouterLink
							to={`/dashboard/events/${activeNavEventId}/team`}
							className={`teduh-mobile-nav-item ${
								pathname.endsWith("/team") ? "is-active" : ""
							}`}
						>
							<Users size={18} />
							<span>Tim</span>
						</RouterLink>
						<RouterLink
							to={`/dashboard/events/${activeNavEventId}/cleanup`}
							className={`teduh-mobile-nav-item ${
								pathname.endsWith("/cleanup") ? "is-active" : ""
							}`}
						>
							<ClipboardCheck size={18} />
							<span>Kebersihan</span>
						</RouterLink>
					</>
				) : (
					<>
						<RouterLink
							to="/dashboard"
							className={`teduh-mobile-nav-item ${
								pathname === "/dashboard" || pathname === "/dashboard/events"
									? "is-active"
									: ""
							}`}
						>
							<LayoutDashboard size={18} />
							<span>Kegiatan</span>
						</RouterLink>
						<RouterLink
							to="/dashboard/events/new"
							className={`teduh-mobile-nav-item ${
								pathname === "/dashboard/events/new" ? "is-active" : ""
							}`}
						>
							<PlusCircle size={18} />
							<span>Buat Baru</span>
						</RouterLink>
						<RouterLink
							to="/field"
							className={`teduh-mobile-nav-item ${
								pathname.startsWith("/field") ? "is-active" : ""
							}`}
						>
							<Radio size={18} />
							<span>Lapangan</span>
						</RouterLink>
						<RouterLink
							to="/settings"
							className={`teduh-mobile-nav-item ${
								pathname === "/settings" ? "is-active" : ""
							}`}
						>
							<Settings size={18} />
							<span>Akun</span>
						</RouterLink>
					</>
				)}
			</nav>
		</div>
	);
}
