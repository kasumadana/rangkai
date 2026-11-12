import { useQuery } from "@tanstack/react-query";

import { useEffect, useRef, useState, forwardRef, type AnchorHTMLAttributes } from "react";

import { Link, Outlet, useLocation } from "react-router";

import { Menu, X } from "lucide-react";

import { useAuthSession, useMyOrganizationsQuery } from "../../lib/auth";

import { fetchEventDetail, fetchFieldEventDetail, getSavedOrganizationId } from "../../lib/events-api";

import { ProfileMenu } from "../ui/ProfileMenu";



export const RouterLinkBridge = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }>(function RouterLinkBridge({ href = "/", ...props }, ref) { return <Link ref={ref} to={href} {...props} />; });



export function PublicShellLayout() {

 const { pathname } = useLocation();

 if (pathname === "/peta" || pathname.endsWith("/map")) return <Outlet />;

 return <div className="public-shell"><header className="simple-topbar"><Link to="/" aria-label="Rangkai beranda"><img src="/logo.png" alt="Rangkai" /></Link><ProfileMenu /></header><main id="main-content"><Outlet /></main><footer className="simple-footer"><nav aria-label="Tautan publik"><Link to="/events">Jadwal kegiatan</Link><Link to="/peta">Peta kawasan</Link><Link to="/tanya">Tanya kegiatan</Link></nav><p>Rangkai membantu koordinasi dan bukan izin resmi penutupan jalan.</p></footer></div>;

}



export function WorkspaceShellLayout() {

 const { pathname } = useLocation();

 const [open, setOpen] = useState(false);

 const [orgId, setOrgId] = useState(getSavedOrganizationId);

 const trigger = useRef<HTMLButtonElement>(null);

 const drawer = useRef<HTMLElement>(null);

 const { data: session } = useAuthSession();

 const organizations = useMyOrganizationsQuery();

 const orgs = organizations.data?.organizations || [];

 const active = orgs.find(org => org.id === orgId) || orgs.find(org => org.role === "organizer") || orgs[0];

 const organizer = active?.role !== "officer";

 const match = pathname.match(/^\/(dashboard|field)\/events\/([^/]+)/);

 const eventId = match?.[2] !== "new" ? match?.[2] : undefined;

 const isField = match?.[1] === "field";

 const event = useQuery({ queryKey: ["events", "detail", eventId], queryFn: () => fetchEventDetail(eventId!), enabled: !!eventId && !isField });

 const field = useQuery({ queryKey: ["field", "event", eventId], queryFn: () => fetchFieldEventDetail(eventId!), enabled: !!eventId && isField });

 useEffect(() => { const update = () => setOrgId(getSavedOrganizationId()); window.addEventListener("rangkai:organization-changed", update); return () => window.removeEventListener("rangkai:organization-changed", update); }, []);

 useEffect(() => { if (!open) return; const nodes = () => Array.from(drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || []); nodes()[0]?.focus(); const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } else if (e.key === "Tab") { const list = nodes(); if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list[list.length - 1]?.focus(); } else if (!e.shiftKey && document.activeElement === list[list.length - 1]) { e.preventDefault(); list[0]?.focus(); } } }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [open]);

 const link = (to: string, label: string, current: boolean) => <Link to={to} onClick={() => setOpen(false)} aria-current={current ? "page" : undefined} className={`teduh-sidebar-link ${current ? "is-active" : ""}`}>{label}</Link>;

 return <div className="teduh-workspace-shell"><header className="teduh-workspace-topbar"><div className="teduh-workspace-topbar-left"><button ref={trigger} type="button" className="workspace-menu-toggle" aria-label={open ? "Tutup menu ruang kerja" : "Buka menu ruang kerja"} aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button><Link to="/" className="teduh-workspace-brand"><img src="/logo.png" alt="Rangkai" /></Link></div><ProfileMenu /></header>

 <div className="teduh-workspace-body">{open && <button type="button" className="workspace-menu-backdrop" aria-label="Tutup menu ruang kerja" onClick={() => { setOpen(false); trigger.current?.focus(); }} />}

 <aside ref={drawer} id="workspace-navigation" className={`teduh-workspace-sidebar ${open ? "is-open" : ""}`} aria-label="Menu ruang kerja"><nav className="stable-navigation">

 {organizer && <>{link("/dashboard", "Ringkasan", pathname === "/dashboard")}{link("/dashboard/events", "Kegiatan", pathname.startsWith("/dashboard/events"))}</>}

 {organizer && eventId && !isField && <div className="context-navigation"><p>{event.data?.event.title || "Kegiatan terpilih"}</p>{[["", "Detail kegiatan"], ["/document", "Dokumen & AI"], ["/roads", "Dampak jalan"], ["/cleanup", "Kebersihan"], ["/team", "Tim & Petugas"]].map(([suffix, label]) => link(`/dashboard/events/${eventId}${suffix}`, label, pathname === `/dashboard/events/${eventId}${suffix}` || (suffix === "/document" && pathname.endsWith("/review"))))}</div>}

 {link("/field", organizer ? "Operasional lapangan" : "Tugas saya", pathname === "/field")}

 {eventId && isField && <div className="context-navigation"><p>{field.data?.event.title || "Tugas lapangan"}</p>{field.data?.permissions.canUpdateTraffic && link(`/field/events/${eventId}/traffic`, "Lalu lintas", pathname.endsWith("/traffic"))}{field.data?.permissions.canUpdateCleanup && link(`/field/events/${eventId}/cleanup`, "Kebersihan", pathname.includes("/cleanup"))}</div>}

 <div className="sidebar-bottom">{link("/settings", "Pengaturan", pathname === "/settings")}</div></nav></aside>

 <main className="teduh-workspace-main" id="main-content">{session?.user && active && <p className="workspace-context">{active.name} Â· {active.role === "organizer" ? "Panitia" : "Petugas"}</p>}<Outlet /></main></div></div>;

}



