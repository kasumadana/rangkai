import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, apiFetch } from "../lib/api-client";
import { useAuthSession } from "../lib/auth";

type AdminOrganization = { id: string; name: string; village: string | null; district: string | null };
type AdminEvent = { id: string; title: string; status: string };
type ActivationInvitation = { id: string; recipientEmail: string; role: "organizer" | "officer" | "government_reviewer"; organizationId: string | null; organizationName: string | null; eventId: string | null; eventTitle: string | null; status: "pending" | "accepted" | "revoked"; expiresAt: string; createdAt: string; acceptedAt: string | null };
type CreatedActivation = { id: string; inviteUrl: string; expiresAt: string; recipientEmail: string; role: ActivationInvitation["role"] };

const roleLabels = { organizer: "Organizer", officer: "Petugas lapangan", government_reviewer: "Reviewer pemerintah" } as const;

export function AdminUsersPage() {
	const session = useAuthSession();
	const client = useQueryClient();
	const [recipientEmail, setRecipientEmail] = useState("");
	const [role, setRole] = useState<ActivationInvitation["role"]>("organizer");
	const [organizationId, setOrganizationId] = useState("");
	const [eventId, setEventId] = useState("");
	const [canUpdateTraffic, setCanUpdateTraffic] = useState(false);
	const [canUpdateCleanup, setCanUpdateCleanup] = useState(false);
	const [expiresInDays, setExpiresInDays] = useState(7);
	const [created, setCreated] = useState<CreatedActivation | null>(null);
	const [copyMessage, setCopyMessage] = useState("");

	const organizations = useQuery({ queryKey: ["admin", "user-organizations"], queryFn: () => apiFetch<{ organizations: AdminOrganization[] }>("/api/admin/users/organizations"), enabled: Boolean(session.data?.user), retry: false });
	const events = useQuery({ queryKey: ["admin", "user-events", organizationId], queryFn: () => apiFetch<{ events: AdminEvent[] }>(`/api/admin/users/events?organizationId=${encodeURIComponent(organizationId)}`), enabled: Boolean(session.data?.user && organizationId && role === "officer"), retry: false });
	const invitations = useQuery({ queryKey: ["admin", "activation-invitations"], queryFn: () => apiFetch<{ invitations: ActivationInvitation[] }>("/api/admin/users/activation-invitations"), enabled: Boolean(session.data?.user), retry: false });
	const orgOptions = organizations.data?.organizations || [];

	const create = useMutation({
		mutationFn: () => apiFetch<{ invitation: CreatedActivation }>("/api/admin/users/activation-invitations", { method: "POST", body: { recipientEmail, role, organizationId: role === "government_reviewer" ? null : organizationId, eventId: role === "officer" ? eventId : null, canUpdateTraffic: role === "officer" && canUpdateTraffic, canUpdateCleanup: role === "officer" && canUpdateCleanup, expiresInDays } }),
		onSuccess: async result => { setCreated(result.invitation); setCopyMessage(""); setRecipientEmail(""); await client.invalidateQueries({ queryKey: ["admin", "activation-invitations"] }); },
	});
	const revoke = useMutation({ mutationFn: (id: string) => apiFetch(`/api/admin/users/activation-invitations/${id}`, { method: "DELETE" }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin", "activation-invitations"] }); } });

	if (session.isLoading) return <main className="teduh-page-shell"><p role="status">Memeriksa sesi...</p></main>;
	if (session.isError) return <main className="teduh-page-shell"><p role="alert">Sesi belum dapat diperiksa.</p><button className="ui-button" type="button" onClick={() => void session.refetch()}>Coba lagi</button></main>;
	if (!session.data?.user) return <main className="teduh-page-shell"><Link to="/login" state={{ from: "/admin/users" }}>Masuk sebagai administrator</Link></main>;
	if (organizations.error instanceof ApiClientError && organizations.error.status === 403) return <main className="teduh-page-shell"><section className="teduh-auth-card" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}><h1>Akses administrator diperlukan</h1><p>Halaman ini hanya tersedia untuk superadmin aktif.</p><Link to="/">Kembali ke beranda</Link></section></main>;

	return <main className="teduh-page-shell"><div className="teduh-auth-card" style={{ width: "100%", maxWidth: 900, margin: "0 auto", padding: 24 }}>
		<header><h1>Akun & undangan</h1><p>Buat tautan aktivasi sekali pakai. Pengguna menentukan kata sandinya sendiri; tautan tidak dikirim otomatis.</p></header>
		<nav aria-label="Navigasi administrator" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBlock: 16 }}><Link to="/admin/organizations">Pengajuan organisasi</Link><Link to="/admin/users" aria-current="page">Akun & undangan</Link><Link to="/admin/territories">Wilayah organisasi</Link><Link to="/admin/reviewers">Reviewer pemerintah</Link></nav>
		<form onSubmit={event => { event.preventDefault(); create.mutate(); }} style={{ display: "grid", gap: 16 }}>
			<label className="ui-field">Email penerima<input type="email" required maxLength={255} autoComplete="email" value={recipientEmail} onChange={event => setRecipientEmail(event.target.value)} /></label>
			<label className="ui-field">Akses<select value={role} onChange={event => { const value = event.target.value as ActivationInvitation["role"]; setRole(value); setEventId(""); setCanUpdateTraffic(false); setCanUpdateCleanup(false); }}><option value="organizer">Organizer</option><option value="officer">Petugas lapangan</option><option value="government_reviewer">Reviewer pemerintah</option></select></label>
			{role !== "government_reviewer" && <label className="ui-field">Organisasi<select required value={organizationId} onChange={event => { setOrganizationId(event.target.value); setEventId(""); }}><option value="">Pilih organisasi</option>{orgOptions.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
			{role === "officer" && <>
				<label className="ui-field">Kegiatan<select required disabled={!organizationId || events.isLoading || events.isError} value={eventId} onChange={event => setEventId(event.target.value)}><option value="">Pilih kegiatan</option>{events.data?.events.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
				<fieldset><legend>Izin petugas</legend><label><input type="checkbox" checked={canUpdateTraffic} onChange={event => setCanUpdateTraffic(event.target.checked)} /> Pembaruan jalan</label><label><input type="checkbox" checked={canUpdateCleanup} onChange={event => setCanUpdateCleanup(event.target.checked)} /> Laporan kebersihan</label></fieldset>
				{events.isError && <p role="alert">Kegiatan organisasi tidak dapat dimuat. <button type="button" onClick={() => void events.refetch()}>Coba lagi</button></p>}
			</>}
			{role === "government_reviewer" && <p>Reviewer menerima akses platform. Penetapan wilayah tugas dilakukan melalui pengaturan reviewer dan tidak otomatis memberi kewenangan izin resmi.</p>}
			<label className="ui-field">Berlaku<select value={expiresInDays} onChange={event => setExpiresInDays(Number(event.target.value))}><option value={1}>1 hari</option><option value={3}>3 hari</option><option value={7}>7 hari</option><option value={14}>14 hari</option><option value={30}>30 hari</option></select></label>
			<button className="ui-button ui-button-primary" type="submit" disabled={create.isPending || organizations.isLoading || (role === "officer" && events.isLoading)}>{create.isPending ? "Membuat tautan..." : "Buat tautan aktivasi"}</button>
		</form>
		{organizations.isError && <p role="alert">Organisasi tidak dapat dimuat atau akses superadmin ditolak. <button type="button" onClick={() => void organizations.refetch()}>Coba lagi</button></p>}
		{create.isError && <p role="alert">{create.error.message}</p>}
		{created && <section aria-labelledby="activation-created-title" style={{ marginTop: 24 }}><h2 id="activation-created-title">Tautan siap disalin</h2><p>{created.recipientEmail} · {roleLabels[created.role]} · berlaku sampai {new Date(created.expiresAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA.</p><label className="ui-field">Tautan aktivasi<input readOnly value={created.inviteUrl} onFocus={event => event.currentTarget.select()} /></label><button className="ui-button" type="button" onClick={() => void (async () => { try { if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable"); await navigator.clipboard.writeText(created.inviteUrl); setCopyMessage("Tautan disalin."); } catch { setCopyMessage("Salin tautan secara manual dari kolom di atas."); } })()}>Salin tautan</button>{copyMessage && <p role="status">{copyMessage}</p>}<p>Kirim tautan ini sendiri melalui kanal yang Anda pilih. Rangkai tidak mengirimkannya.</p></section>}
		<section aria-labelledby="activation-list-title" style={{ marginTop: 32 }}><header><h2 id="activation-list-title">Undangan aktivasi terbaru</h2><button className="ui-button" type="button" disabled={invitations.isFetching} onClick={() => void invitations.refetch()}>Muat ulang</button></header>
			{invitations.isLoading ? <p role="status">Memuat undangan...</p> : invitations.isError ? <p role="alert">Undangan tidak dapat dimuat. <button type="button" onClick={() => void invitations.refetch()}>Coba lagi</button></p> : !invitations.data?.invitations.length ? <p>Belum ada undangan aktivasi.</p> : <ul>{invitations.data.invitations.map(item => <li key={item.id} style={{ paddingBlock: 16 }}><strong>{item.recipientEmail}</strong><p>{roleLabels[item.role]}{item.organizationName ? ` · ${item.organizationName}` : ""}{item.eventTitle ? ` · ${item.eventTitle}` : ""} · {item.status === "pending" && Date.parse(item.expiresAt) <= Date.now() ? "Kedaluwarsa" : item.status === "pending" ? "Menunggu aktivasi" : item.status === "accepted" ? "Diterima" : "Dicabut"}</p><p>Berlaku sampai {new Date(item.expiresAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA</p>{item.status === "pending" && Date.parse(item.expiresAt) > Date.now() && <button className="ui-button" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>Cabut undangan</button>}</li>)}</ul>}
			{revoke.isError && <p role="alert">{revoke.error.message}</p>}{revoke.isSuccess && <p role="status">Undangan dicabut.</p>}
		</section>
	</div></main>;
}
