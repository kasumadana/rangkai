import { useQuery } from "@tanstack/react-query";

import { useEffect, useRef, useState, forwardRef, type AnchorHTMLAttributes } from "react";

import { Link, Outlet, useLocation } from "react-router";

import { Menu, X } from "lucide-react";

import { useAuthSession, useMyOrganizationsQuery } from "../../lib/auth";

import { fetchEventDetail, getSavedOrganizationId } from "../../lib/events-api";

import { ProfileMenu } from "../ui/ProfileMenu";
import { BrandLogo } from "../ui/BrandLogo";
import { PublicHeader } from "../ui/PublicHeader";
import { RangkaiPreloader } from "../rangkai";



export const RouterLinkBridge = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }>(function RouterLinkBridge({ href = "/", ...props }, ref) { return <Link ref={ref} to={href} {...props} />; });



export function PublicShellLayout() {

 const { pathname } = useLocation();

 if (pathname === "/peta" || pathname.endsWith("/map")) return <><RangkaiPreloader preloaderKey="peta" /><Outlet /></>;

 return (
  <div className="public-shell">
   {pathname === "/" && <RangkaiPreloader preloaderKey="landing" />}
   <PublicHeader />
   <main id="main-content"><Outlet /></main>
   <footer className="public-footer">
    <div className="public-footer-inner">
     <div className="public-footer-main">
      <div className="public-footer-brand">
       <BrandLogo />
       <p>Informasi kegiatan adat dan koordinasi ruang publik di Bali.</p>
      </div>
      <div className="public-footer-links">
       <section aria-labelledby="footer-explore-title">
        <h2 id="footer-explore-title">Jelajahi</h2>
        <ul>
         <li><Link to="/">Beranda</Link></li>
         <li><Link to="/events">Jadwal kegiatan</Link></li>
         <li><Link to="/peta">Peta kawasan</Link></li>
        </ul>
       </section>
       <section aria-labelledby="footer-help-title">
        <h2 id="footer-help-title">Panduan</h2>
        <ul><li><Link to="/tanya">Tanya kegiatan</Link></li></ul>
       </section>
       <section aria-labelledby="footer-work-title">
        <h2 id="footer-work-title">Ruang kerja</h2>
        <ul>
         <li><Link to="/dashboard">Penyelenggara</Link></li>
         <li><Link to="/field">Petugas lapangan</Link></li>
        </ul>
       </section>
      </div>
     </div>
     <div className="public-footer-bottom">
      <p>Rangkai membantu koordinasi dan bukan izin resmi penutupan jalan. Penyelesaian kebersihan tidak membuka jalan secara otomatis; pembaruan jalan dilakukan petugas berwenang.</p>
     </div>
    </div>
   </footer>
  </div>
 );

}



export function WorkspaceShellLayout() {

 const { pathname } = useLocation();

 const [open, setOpen] = useState(false);

 const [orgId, setOrgId] = useState(getSavedOrganizationId);

 const trigger = useRef<HTMLButtonElement>(null);

 const drawer = useRef<HTMLElement>(null);
 const content = useRef<HTMLElement>(null);
 const previousPath = useRef(pathname);

 const { data: session } = useAuthSession();

 const organizations = useMyOrganizationsQuery();

 const orgs = organizations.data?.organizations || [];

 const active = orgs.find(org => org.id === orgId) || orgs.find(org => org.role === "organizer") || orgs[0];

 const organizer = active?.role === "organizer";

 const match = pathname.match(/^\/(dashboard|field)\/events\/([^/]+)/);

 const eventId = match?.[2] !== "new" ? match?.[2] : undefined;

 const isField = match?.[1] === "field";

 const event = useQuery({ queryKey: ["events", "detail", eventId], queryFn: () => fetchEventDetail(eventId!), enabled: !!eventId && !isField });

 useEffect(() => { const update = () => setOrgId(getSavedOrganizationId()); window.addEventListener("rangkai:organization-changed", update); return () => window.removeEventListener("rangkai:organization-changed", update); }, []);

 useEffect(() => { if (previousPath.current !== pathname) content.current?.focus(); previousPath.current = pathname; }, [pathname]);

 useEffect(() => { if (!open) return; const nodes = () => Array.from(drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || []); nodes()[0]?.focus(); const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } else if (e.key === "Tab") { const list = nodes(); if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list[list.length - 1]?.focus(); } else if (!e.shiftKey && document.activeElement === list[list.length - 1]) { e.preventDefault(); list[0]?.focus(); } } }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [open]);

 const link = (to: string, label: string, current: boolean) => <Link key={to} to={to} onClick={() => setOpen(false)} aria-current={current ? "page" : undefined} className={`teduh-sidebar-link ${current ? "is-active" : ""}`}>{label}</Link>;

 return <div className="teduh-workspace-shell"><header className="teduh-workspace-topbar"><div className="teduh-workspace-topbar-left"><button ref={trigger} type="button" className="workspace-menu-toggle" aria-label={open ? "Tutup menu ruang kerja" : "Buka menu ruang kerja"} aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button><BrandLogo /></div><ProfileMenu /></header>

 <div className="teduh-workspace-body">{open && <button type="button" className="workspace-menu-backdrop" aria-label="Tutup menu ruang kerja" onClick={() => { setOpen(false); trigger.current?.focus(); }} />}

 <aside ref={drawer} id="workspace-navigation" className={`teduh-workspace-sidebar ${open ? "is-open" : ""}`} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label="Menu ruang kerja"><nav className="stable-navigation">

 {organizer && <>{link("/dashboard", "Ringkasan", pathname === "/dashboard")}{link("/dashboard/events", "Kegiatan", pathname.startsWith("/dashboard/events"))}</>}

 {organizer && eventId && !isField && <div className="context-navigation"><p>{event.data?.event.title || "Kegiatan terpilih"}</p>{[["", "Detail kegiatan"], ["/document", "Dokumen & AI"], ["/roads", "Dampak jalan"], ["/cleanup", "Kebersihan"], ["/team", "Tim & Petugas"]].map(([suffix, label]) => link(`/dashboard/events/${eventId}${suffix}`, label, pathname === `/dashboard/events/${eventId}${suffix}` || (suffix === "/document" && pathname.endsWith("/review"))))}</div>}

 {link("/field", organizer ? "Operasional lapangan" : "Tugas saya", pathname === "/field" || pathname.startsWith("/field/events/"))}

 <div className="sidebar-bottom">{link("/settings", "Pengaturan", pathname === "/settings")}</div></nav></aside>

 <main ref={content} tabIndex={-1} inert={open} className="teduh-workspace-main" id="main-content">{session?.user && active && <p className="workspace-context">{active.name} - {active.role === "organizer" ? "Panitia" : "Petugas"}</p>}<Outlet /></main></div></div>;

}
