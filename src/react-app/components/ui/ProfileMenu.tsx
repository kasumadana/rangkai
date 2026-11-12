import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuthSession, useMyOrganizationsQuery, signOutCurrentSession } from "../../lib/auth";
import { getSavedOrganizationId, saveOrganizationId } from "../../lib/events-api";

export function ProfileMenu() {
 const [open, setOpen] = useState(false);
 const [error, setError] = useState("");
 const [pending, setPending] = useState(false);
 const [orgId, setOrgId] = useState(getSavedOrganizationId);
 const trigger = useRef<HTMLButtonElement>(null);
 const root = useRef<HTMLDivElement>(null);
 const { data: session } = useAuthSession();
 const organizations = useMyOrganizationsQuery();
 const client = useQueryClient();
 const navigate = useNavigate();
 useEffect(() => {
  const changed = () => setOrgId(getSavedOrganizationId());
  window.addEventListener("rangkai:organization-changed", changed);
  return () => window.removeEventListener("rangkai:organization-changed", changed);
 }, []);
 useEffect(() => {
  if (!open) return;
  const focusable = () => Array.from(root.current?.querySelectorAll<HTMLElement>('.profile-popover a[href], .profile-popover button:not(:disabled), .profile-popover select:not(:disabled)') || []);
  focusable()[0]?.focus();
  const key = (event: KeyboardEvent) => {
   if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
   if (event.key !== "Tab") return;
   const items = focusable();
   if (!items.length) return;
   if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
   else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
  };
  const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener("keydown", key); document.addEventListener("mousedown", outside);
  return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", outside); };
 }, [open]);
 const items = organizations.data?.organizations || [];
 const platformRoles = organizations.data?.platformRoles || [];
 const isSuperadmin = platformRoles.includes("superadmin");
 const isReviewer = platformRoles.includes("government_reviewer");
 const active = items.find(org => org.id === orgId) || items.find(org => org.role === "organizer") || items[0];
 async function logout() {
  setPending(true); setError("");
  try {
   const result = await signOutCurrentSession();
   if (result.success === false) throw new Error("Sign out failed");
   await client.cancelQueries(); client.clear();
   window.dispatchEvent(new Event("rangkai:session-changed"));
   setOpen(false); navigate("/", { replace: true });
  } catch { setError("Tidak dapat keluar. Periksa koneksi dan coba lagi."); }
  finally { setPending(false); }
 }
 return <div className="profile-menu" ref={root}>
  <button ref={trigger} type="button" className="profile-trigger" aria-expanded={open} aria-controls="profile-menu" onClick={() => setOpen(!open)}>Profil</button>
  {open && <div id="profile-menu" className="profile-popover">
   {session?.user ? <>
    <strong>{session.user.name}</strong><p>{session.user.email}</p>
    {active && <p>{active.name} - {active.role === "organizer" ? "Panitia" : "Petugas"}</p>}
    {isSuperadmin && <p>Peran: Superadmin Platform</p>}
    {isReviewer && <p>Peran: Polisi / Reviewer Pemerintah</p>}
    {items.length > 1 && <label>Organisasi<select value={active?.id || ""} onChange={e => { if (items.some(org => org.id === e.target.value)) saveOrganizationId(e.target.value); }}>{items.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
    {isSuperadmin && <Link to="/admin/organizations" onClick={() => setOpen(false)}>Panel Superadmin</Link>}
    {isReviewer && <Link to="/reviewer/road-requests" onClick={() => setOpen(false)}>Antrean Tinjauan Polisi</Link>}
    <Link to={active?.role === "officer" ? "/field" : "/dashboard"} onClick={() => setOpen(false)}>Ruang kerja</Link>
    <Link to="/" onClick={() => setOpen(false)}>Portal publik</Link><Link to="/settings" onClick={() => setOpen(false)}>Pengaturan</Link>
    <button type="button" disabled={pending} onClick={() => void logout()}>{pending ? "Sedang keluar..." : "Keluar"}</button>
    {error && <p role="alert">{error}</p>}
   </> : <><Link to="/login" onClick={() => setOpen(false)}>Masuk</Link><Link to="/register" onClick={() => setOpen(false)}>Daftar</Link></>}
  </div>}
 </div>;
}
