import { useEffect, useState } from "react";
import { CalendarDays, Home, Map } from "lucide-react";
import { Link, useLocation } from "react-router";
import { ProfileMenu } from "./ProfileMenu";
import { BrandLogo } from "./BrandLogo";

function getPublicNavItems(pathname: string) {
	return [
		{ to: "/", label: "Beranda", Icon: Home, current: pathname === "/" },
		{
			to: "/events",
			label: "Kegiatan",
			Icon: CalendarDays,
			current: pathname.startsWith("/events"),
		},
		{ to: "/peta", label: "Peta", Icon: Map, current: pathname === "/peta" },
	];
}
function PublicNavLinks({ pathname, mobile = false }: { pathname: string; mobile?: boolean }) {
	return getPublicNavItems(pathname).map(({ to, label, Icon, current }) => (
		<Link key={to} to={to} aria-current={current ? "page" : undefined}>
			{mobile ? <Icon aria-hidden="true" size={18} strokeWidth={2} /> : null}
			<span>{label}</span>
		</Link>
	));
}

export function PublicMobileBottomNav() {
	const { pathname } = useLocation();

	return (
		<nav className="public-mobile-bottom-nav" aria-label="Navigasi utama">
			<PublicNavLinks pathname={pathname} mobile />
		</nav>
	);
}

export function PublicHeader({ map = false }: { map?: boolean }) {
	const [scrolled, setScrolled] = useState(false);
	const { pathname } = useLocation();

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 36);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	const isLanding = pathname === "/";
	const headerClasses = [
		"public-header",
		map ? "public-header-map" : "",
		isLanding ? "public-header-landing" : "",
		scrolled ? "is-scrolled" : "is-at-top",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<>
			<header className={headerClasses}>
				<BrandLogo />
				<nav className="public-header-links" aria-label="Navigasi publik">
					<PublicNavLinks pathname={pathname} />
				</nav>
				<div className="public-header-actions">
					<ProfileMenu />
				</div>
			</header>
			<PublicMobileBottomNav />
		</>
	);
}
