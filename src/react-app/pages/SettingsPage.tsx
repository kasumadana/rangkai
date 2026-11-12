import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuthSession, useMyOrganizationsQuery } from "../lib/auth";
import { getSavedOrganizationId, saveOrganizationId } from "../lib/events-api";

export function SettingsPage() {
 const session = useAuthSession();
 const organizations = useMyOrganizationsQuery();
 const [selected, setSelected] = useState(getSavedOrganizationId);
 const [message, setMessage] = useState("");
 const orgs = organizations.data?.organizations || [];
 const active = orgs.find(org => org.id === selected);
 useEffect(() => { const changed = () => setSelected(getSavedOrganizationId()); window.addEventListener("rangkai:organization-changed", changed); return () => window.removeEventListener("rangkai:organization-changed", changed); }, []);
 function select(id: string) { if (!orgs.some(org => org.id === id)) return; saveOrganizationId(id); setSelected(id); setMessage("Organisasi aktif diperbarui."); }

 return <div className="workspace-page"><header><h1>Pengaturan</h1><p>Kelola akun dan organisasi aktif Anda.</p></header>
  <section className="settings-section"><h2>Akun</h2>{session.isLoading ? <p role="status">Memuat akun...</p> : session.isError ? <div role="alert"><p>Gagal memuat akun.</p><button className="ui-button" type="button" onClick={() => void session.refetch()}>Coba lagi</button></div> : session.data?.user ? <dl className="settings-details"><div><dt>Nama</dt><dd>{session.data.user.name}</dd></div><div><dt>Email</dt><dd>{session.data.user.email}</dd></div><div><dt>Peran</dt><dd>{active ? active.role === "organizer" ? "Panitia" : "Petugas" : "Pilih organisasi"}</dd></div></dl> : <p>Anda belum masuk. <Link to="/login">Masuk</Link> atau <Link to="/register">daftar</Link>.</p>}</section>
  <section className="settings-section"><h2>Organisasi</h2>{organizations.isLoading ? <p role="status">Memuat organisasi...</p> : organizations.isError ? <div role="alert"><p>Gagal memuat organisasi.</p><button className="ui-button" type="button" onClick={() => void organizations.refetch()}>Coba lagi</button></div> : orgs.length ? <><label className="ui-field">Organisasi aktif<select value={active?.id || ""} onChange={e => select(e.target.value)}><option value="">Pilih organisasi</option>{orgs.map(org => <option key={org.id} value={org.id}>{org.name} ({org.role === "organizer" ? "Panitia" : "Petugas"})</option>)}</select></label>{active && <p>{active.hasOperationalAuthority ? "Organisasi memiliki kewenangan operasional yang tercatat." : "Kewenangan operasional belum tercatat. Kegiatan operasional memerlukan kewenangan yang sesuai."}</p>}</> : <p>Belum ada organisasi terhubung.</p>}
  {message && <p role="status">{message}</p>}
  {session.data?.user && <p><Link to="/onboarding/organization">Ajukan organisasi untuk ditinjau</Link></p>}</section>
  <section className="settings-section"><h2>Batas kewenangan</h2><p>Rangkai membantu koordinasi dan bukan izin resmi penutupan jalan. Penyelesaian kebersihan tidak membuka jalan secara otomatis; pembaruan jalan dilakukan petugas yang berwenang.</p></section>
 </div>;
}
