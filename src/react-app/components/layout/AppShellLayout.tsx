import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import {
	SideNav,
	SideNavItem,
	SideNavSection,
} from "@astryxdesign/core/SideNav";
import { HStack } from "@astryxdesign/core/Stack";
import { Token } from "@astryxdesign/core/Token";
import {
	TopNav,
	TopNavHeading,
	TopNavItem,
} from "@astryxdesign/core/TopNav";
import {
	Bell,
	ClipboardCheck,
	Compass,
	KeyRound,
	LayoutDashboard,
	LogOut,
	MapPinned,
	Menu,
	PlusCircle,
	Radio,
	ShieldCheck,
	X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useEffect, useRef, useState, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink, Outlet, useLocation } from "react-router";
import { RangkaiPreloader, shouldPlayPreloader } from "../rangkai";
import { useAuthSession, useSignOutMutation } from "../../lib/auth";
import { fetchPublicEvents, formatWitaEventSchedule } from "../../lib/events-api";
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

function WorkspaceHeaderActions() {
	const { data: sessionData, isLoading: isSessionLoading } = useAuthSession();
	const signOutMutation = useSignOutMutation();
	const { pathname } = useLocation();
	const isFieldMode =
		pathname.startsWith("/field") || pathname.endsWith("/cleanup");

	return (
		<HStack gap={2} vAlign="center">
			<Token
				color={isFieldMode ? "orange" : "blue"}
				size="sm"
				label={isFieldMode ? "Pecalang" : "Panitia Desa"}
			/>

			{!isSessionLoading && sessionData?.user ? (
				<HStack gap={1.5} vAlign="center">
					<RouterLinkBridge href="/settings" title="Pengaturan Akun & Desa Adat" style={{ display: "inline-flex", textDecoration: "none" }}>
						<Avatar
							name={sessionData.user.name || sessionData.user.email}
							size="xsm"
							shape="circle"
							tooltip={sessionData.user.email}
						/>
					</RouterLinkBridge>
					<Button
						variant="ghost"
						size="sm"
						label="Keluar"
						icon={<Icon icon={LogOut} size="sm" />}
						isLoading={signOutMutation.isPending}
						onClick={() => {
							signOutMutation.mutate();
						}}
					/>
				</HStack>
			) : (
				<Button
					as={RouterLinkBridge}
					href="/login"
					variant="secondary"
					size="sm"
					label="Akun"
					icon={<Icon icon={KeyRound} size="sm" />}
				/>
			)}
		</HStack>
	);
}

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
							<HStack gap={1.5} vAlign="center">
								<RouterLinkBridge href="/dashboard" style={{ display: "inline-flex", textDecoration: "none" }}>
									<Avatar
										name={sessionData.user.name || sessionData.user.email}
										size="xsm"
										shape="circle"
										tooltip={sessionData.user.email}
									/>
								</RouterLinkBridge>
								<Button
									variant="ghost"
									size="sm"
									label="Keluar"
									icon={<Icon icon={LogOut} size="sm" />}
									isLoading={signOutMutation.isPending}
									onClick={() => signOutMutation.mutate()}
								/>
							</HStack>
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
										<RouterLinkBridge href="/field/events/evt-pilot">Pos Komando Lapangan</RouterLinkBridge>
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

	useGsapRouteTransition(workspaceContentRef, pathname);

	// Extract active event ID from current path if present (e.g. /dashboard/events/:id or /field/events/:id)
	const eventIdMatch = pathname.match(/(?:dashboard|field)\/events\/([^/]+)/);
	const activeNavEventId =
		eventIdMatch && eventIdMatch[1] !== "new" ? eventIdMatch[1] : "evt-pilot";

	const topNav = (
		<TopNav
			label="Navigasi Ruang Kerja Rangkai"
			heading={
				<TopNavHeading
					as={RouterLinkBridge}
					heading="Rangkai"
					subheading="Panel Desa Adat"
					headingHref="/dashboard"
				/>
			}
			endContent={<WorkspaceHeaderActions />}
		>
			<TopNavItem
				as={RouterLinkBridge}
				href="/dashboard"
				label="Panitia Desa"
				icon={<Icon icon={LayoutDashboard} size="sm" />}
				isSelected={
					pathname.startsWith("/dashboard") && !pathname.endsWith("/cleanup")
				}
			/>
			<TopNavItem
				as={RouterLinkBridge}
				href={`/field/events/${activeNavEventId}`}
				label="Pos Pecalang"
				icon={<Icon icon={Radio} size="sm" />}
				isSelected={
					pathname.startsWith("/field") || pathname.endsWith("/cleanup")
				}
			/>
			<TopNavItem
				as={RouterLinkBridge}
				href="/"
				label="Peta Warga"
				icon={<Icon icon={Compass} size="sm" />}
				isSelected={pathname === "/"}
			/>
		</TopNav>
	);

	const sideNav = (
		<SideNav collapsible>
			<SideNavSection title="Panitia Desa">
				<SideNavItem
					as={RouterLinkBridge}
					href="/dashboard"
					label="Daftar Upacara"
					icon={LayoutDashboard}
					isSelected={
						pathname === "/dashboard" || pathname === "/dashboard/events"
					}
				/>
				<SideNavItem
					as={RouterLinkBridge}
					href="/dashboard/events/new"
					label="Buat Pengumuman"
					icon={PlusCircle}
					isSelected={pathname === "/dashboard/events/new"}
				/>
				<SideNavItem
					as={RouterLinkBridge}
					href={`/dashboard/events/${activeNavEventId}/review`}
					label="Surat Edaran"
					icon={ShieldCheck}
					isSelected={
						pathname.endsWith("/review") || pathname.endsWith("/document")
					}
				/>
				<SideNavItem
					as={RouterLinkBridge}
					href={`/dashboard/events/${activeNavEventId}/roads`}
					label="Rute & Jalan"
					icon={MapPinned}
					isSelected={pathname.endsWith("/roads")}
				/>
			</SideNavSection>

			<SideNavSection title="Lapangan">
				<SideNavItem
					as={RouterLinkBridge}
					href={`/field/events/${activeNavEventId}`}
					label="Status Jalan Pecalang"
					icon={Radio}
					isSelected={pathname.startsWith("/field")}
				/>
				<SideNavItem
					as={RouterLinkBridge}
					href={`/dashboard/events/${activeNavEventId}/cleanup`}
					label="Kebersihan Pasca-Karya"
					icon={ClipboardCheck}
					isSelected={pathname.endsWith("/cleanup")}
				/>
			</SideNavSection>
		</SideNav>
	);

	return (
		<AppShell
			variant="elevated"
			height="fill"
			topNav={topNav}
			sideNav={sideNav}
			contentPadding={0}
		>
			<div
				ref={workspaceContentRef}
				style={{ height: "100%", display: "flex", flexDirection: "column" }}
			>
				<Outlet />
			</div>
		</AppShell>
	);
}
