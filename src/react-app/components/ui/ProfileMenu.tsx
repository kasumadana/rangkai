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
  const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
  const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener("keydown", key); document.addEventListener("mousedown", outside);
  return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", outside); };
 }, [open]);
 const items = organizations.data?.organizations || [];
 const active = items.find(org => org.id === orgId) || items[0];
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
    {active && <p>{active.name} Â· {active.role === "organizer" ? "Panitia" : "Petugas"}</p>}
    {items.length > 1 && <label>Organisasi<select value={active?.id || ""} onChange={e => { if (items.some(org => org.id === e.target.value)) saveOrganizationId(e.target.value); }}>{items.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
    <Link to={active?.role === "officer" ? "/field" : "/dashboard"} onClick={() => setOpen(false)}>Ruang kerja</Link>
    <Link to="/" onClick={() => setOpen(false)}>Portal publik</Link><Link to="/settings" onClick={() => setOpen(false)}>Pengaturan</Link>
    <button type="button" disabled={pending} onClick={() => void logout()}>{pending ? "Sedang keluar..." : "Keluar"}</button>
    {error && <p role="alert">{error}</p>}
   </> : <><Link to="/login" onClick={() => setOpen(false)}>Masuk</Link><Link to="/register" onClick={() => setOpen(false)}>Daftar</Link></>}
  </div>}
 </div>;
}

