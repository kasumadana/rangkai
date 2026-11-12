import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { ProfileMenu } from "./ProfileMenu";
import { BrandLogo } from "./BrandLogo";

export function PublicHeader({ map = false }: { map?: boolean }) {
 const [open, setOpen] = useState(false);
 const trigger = useRef<HTMLButtonElement>(null);
 const drawer = useRef<HTMLElement>(null);
 const header = useRef<HTMLElement>(null);
 const { pathname } = useLocation();
 useEffect(() => {
  if (!open) return;
  const siblings = Array.from(header.current?.parentElement?.children || []).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== header.current);
  const previousInert = siblings.map(node => node.inert);
  siblings.forEach(node => { node.inert = true; });
  const focusable = () => Array.from(drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || []);
  focusable()[0]?.focus();
  const onKey = (event: KeyboardEvent) => {
   if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
   if (event.key !== "Tab") return;
   const items = focusable();
   if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
   else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
  };
  document.addEventListener("keydown", onKey); return () => { document.removeEventListener("keydown", onKey); siblings.forEach((node, index) => { node.inert = previousInert[index]; }); };
 }, [open]);
 const links = <><Link aria-current={pathname === "/" ? "page" : undefined} to="/" onClick={() => setOpen(false)}>Beranda</Link><Link aria-current={pathname.startsWith("/events") ? "page" : undefined} to="/events" onClick={() => setOpen(false)}>Kegiatan</Link><Link aria-current={pathname === "/peta" ? "page" : undefined} to="/peta" onClick={() => setOpen(false)}>Peta</Link></>;
 return <header ref={header} className={`public-header ${map ? "public-header-map" : ""}`}><BrandLogo /><nav className="public-header-links" aria-label="Navigasi publik">{links}</nav><div className="public-header-actions"><ProfileMenu /><button ref={trigger} className="public-menu-trigger" type="button" aria-label="Buka menu publik" aria-expanded={open} aria-controls="public-navigation-drawer" onClick={() => setOpen(true)}><Menu size={22} /></button></div>{open && <><button type="button" className="public-menu-backdrop" aria-label="Tutup menu publik" onClick={() => { setOpen(false); trigger.current?.focus(); }} /><aside ref={drawer} id="public-navigation-drawer" className="public-menu-drawer" role="dialog" aria-modal="true" aria-label="Menu publik"><button type="button" className="ui-button" onClick={() => { setOpen(false); trigger.current?.focus(); }} aria-label="Tutup menu publik"><X size={20} /></button><nav aria-label="Navigasi publik seluler">{links}</nav></aside></>}</header>;
}
