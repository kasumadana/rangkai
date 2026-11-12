import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, apiFetch } from "../lib/api-client";
import { useAuthSession } from "../lib/auth";
import { TerritoryMapEditor, type TerritoryGeometry } from "../features/map/TerritoryMapEditor";

type Organization = { id: string; name: string; village: string | null; district: string | null };
type Territory = { id: string; organizationId: string; version: number; geojson: TerritoryGeometry; sourceType: "imported" | "manual" | "synthetic"; sourceLabel: string; sourceUrl: string | null; contentHash: string; isSimulation: boolean; status: "pending_verification" | "verified" | "revoked"; createdAt: string; verifiedAt: string | null; verificationReason: string | null };
type SourceType = Territory["sourceType"];

function extractGeometry(data: unknown): TerritoryGeometry {
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("File harus berisi GeoJSON Feature atau Polygon/MultiPolygon.");
	const object = data as Record<string, unknown>;
	const candidate = object.type === "Feature" ? object.geometry : object.type === "FeatureCollection" && Array.isArray(object.features) && object.features.length === 1 && object.features[0] && typeof object.features[0] === "object" ? (object.features[0] as Record<string, unknown>).geometry : object;
	if (!candidate || typeof candidate !== "object" || !["Polygon", "MultiPolygon"].includes(String((candidate as Record<string, unknown>).type))) throw new Error("Pilih tepat satu GeoJSON Polygon atau MultiPolygon.");
	return candidate as TerritoryGeometry;
}

export function AdminTerritoriesPage() {
	const session = useAuthSession();
	const client = useQueryClient();
	const [organizationId, setOrganizationId] = useState("");
	const [sourceType, setSourceType] = useState<SourceType>("synthetic");
	const [sourceLabel, setSourceLabel] = useState("Kawasan pilot sintetis");
	const [sourceUrl, setSourceUrl] = useState("");
	const [isSimulation, setIsSimulation] = useState(true);
	const [geometry, setGeometry] = useState<TerritoryGeometry | null>(null);
	const [fileError, setFileError] = useState("");
	const [reason, setReason] = useState<Record<string, string>>({});
	const [actionMessage, setActionMessage] = useState("");
	const organizations = useQuery({ queryKey: ["admin", "territory-organizations"], queryFn: () => apiFetch<{ organizations: Organization[] }>("/api/admin/users/organizations"), enabled: Boolean(session.data?.user), retry: false });
	const territories = useQuery({ queryKey: ["admin", "territories", organizationId], queryFn: () => apiFetch<{ territories: Territory[] }>(`/api/admin/territories?organizationId=${encodeURIComponent(organizationId)}`), enabled: Boolean(session.data?.user && organizationId), retry: false });
	const orgName = useMemo(() => organizations.data?.organizations.find(item => item.id === organizationId)?.name, [organizations.data, organizationId]);
	const create = useMutation({
		mutationFn: () => {
			if (!geometry) throw new Error("Impor file atau gambar polygon terlebih dahulu.");
			return apiFetch<{ territory: { id: string; version: number } }>(`/api/admin/organizations/${organizationId}/territories`, { method: "POST", body: { geojson: geometry, sourceType, sourceLabel, ...(sourceUrl ? { sourceUrl } : {}), isSimulation } });
		},
		onSuccess: async result => { setActionMessage(`Versi wilayah ${result.territory.version} disimpan untuk verifikasi.`); await client.invalidateQueries({ queryKey: ["admin", "territories", organizationId] }); },
	});
	const verify = useMutation({
		mutationFn: ({ territoryId, verificationReason }: { territoryId: string; verificationReason: string }) => apiFetch(`/api/admin/organizations/${organizationId}/territories/${territoryId}/verify`, { method: "POST", body: { reason: verificationReason } }),
		onSuccess: async () => { setActionMessage("Batas wilayah ditandai telah ditinjau. Ini tidak membuktikan kewenangan hukum."); await client.invalidateQueries({ queryKey: ["admin", "territories", organizationId] }); },
	});
	const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		setFileError("");
		if (!file) return;
		try {
			if (file.size > 512 * 1024) throw new Error("Ukuran file maksimal 512 KiB.");
			const nextGeometry = extractGeometry(JSON.parse(await file.text()));
			setGeometry(nextGeometry); setSourceType("imported"); setIsSimulation(false); setSourceLabel(file.name.slice(0, 200));
		} catch (error) { setFileError(error instanceof Error ? error.message : "File GeoJSON tidak dapat dibaca."); }
	};

	if (session.isLoading) return <main className="teduh-page-shell"><p role="status">Memeriksa sesi...</p></main>;
	if (session.isError) return <main className="teduh-page-shell"><p role="alert">Sesi belum dapat diperiksa. <button className="ui-button" onClick={() => void session.refetch()}>Coba lagi</button></p></main>;
	if (!session.data?.user) return <main className="teduh-page-shell"><Link to="/login" state={{ from: "/admin/territories" }}>Masuk sebagai administrator</Link></main>;
	if (organizations.error instanceof ApiClientError && organizations.error.status === 403) return <main className="teduh-page-shell"><section className="teduh-auth-card" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}><h1>Akses administrator diperlukan</h1><p>Halaman ini hanya tersedia untuk superadmin aktif.</p><Link to="/">Kembali ke beranda</Link></section></main>;

	return <main className="teduh-page-shell"><div className="teduh-auth-card" style={{ width: "100%", maxWidth: 960, margin: "0 auto", padding: 24 }}>
		<header><h1>Wilayah organisasi</h1><p>Setiap impor atau gambar baru disimpan sebagai versi pending. Verifikasi hanya mencatat pemeriksaan internal dan tidak menetapkan batas hukum desa adat atau izin penutupan jalan.</p></header>
		<nav aria-label="Navigasi administrator" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBlock: 16 }}><Link to="/admin/organizations">Pengajuan organisasi</Link><Link to="/admin/users">Akun & undangan</Link><Link to="/admin/territories" aria-current="page">Wilayah organisasi</Link><Link to="/admin/reviewers">Reviewer pemerintah</Link></nav>
		<label className="ui-field">Organisasi<select value={organizationId} onChange={event => { setOrganizationId(event.target.value); setActionMessage(""); }}><option value="">Pilih organisasi</option>{organizations.data?.organizations.map(org => <option key={org.id} value={org.id}>{org.name} · {org.village || org.district || "Lokasi belum dicatat"}</option>)}</select></label>
		{organizations.isLoading && <p role="status">Memuat organisasi...</p>}{organizations.isError && <p role="alert">Organisasi tidak dapat dimuat. <button onClick={() => void organizations.refetch()}>Coba lagi</button></p>}
		{organizationId && <>
			<section style={{ marginBlock: 24 }}><h2>Tambah versi batas</h2><p>GeoJSON harus berupa Polygon atau MultiPolygon WGS84 lon/lat, maksimal 512 KiB dan 10.000 posisi.</p>
				<label className="ui-field">Impor GeoJSON (.json atau .geojson)<input type="file" accept=".json,.geojson,application/geo+json,application/json" onChange={event => void loadFile(event)} /></label>
				<label className="ui-field">Asal geometri<select value={sourceType} onChange={event => { const next = event.target.value as SourceType; setSourceType(next); if (next === "synthetic") { setIsSimulation(true); setSourceLabel("Kawasan pilot sintetis"); } else if (next === "manual") setSourceLabel(`Gambar manual ${orgName || "organisasi"}`); else setIsSimulation(false); }}><option value="synthetic">Sintetis untuk simulasi</option><option value="imported">GeoJSON impor</option><option value="manual">Gambar manual di peta</option></select></label>
				<label className="ui-field">Label sumber<input value={sourceLabel} maxLength={200} onChange={event => setSourceLabel(event.target.value)} /></label>
				{sourceType === "imported" && <label className="ui-field">Tautan/keterangan sumber (opsional; tidak diambil otomatis)<input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} maxLength={2048} /></label>}
				<label><input type="checkbox" checked={isSimulation} onChange={event => setIsSimulation(event.target.checked)} /> Tandai sebagai simulasi</label>
				{fileError && <p role="alert">{fileError}</p>}
				{create.isError && <p role="alert">{create.error.message}</p>}
				<TerritoryMapEditor key={sourceType} geometry={geometry} editable={sourceType === "manual"} onChange={setGeometry} />
				{geometry && <p>Polygon siap diperiksa server. Simpanan tidak mengubah versi terverifikasi sampai superadmin memberi alasan verifikasi.</p>}
				<button className="ui-button ui-button-primary" type="button" disabled={create.isPending || !geometry || !sourceLabel.trim()} onClick={() => { setActionMessage(""); create.mutate(); }}>{create.isPending ? "Menyimpan versi..." : "Simpan sebagai pending"}</button>
			</section>
			<section><h2>Versi tersimpan {orgName && `· ${orgName}`}</h2>
				{territories.isLoading ? <p role="status">Memuat versi wilayah...</p> : territories.isError ? <p role="alert">Versi wilayah tidak dapat dimuat. <button onClick={() => void territories.refetch()}>Coba lagi</button></p> : !territories.data?.territories.length ? <p>Belum ada batas wilayah. Organisasi tetap dapat bekerja pada draf dan simulasi.</p> : <ol>{territories.data.territories.map(item => <li key={item.id} style={{ paddingBlock: 16, borderBottom: "1px solid #d7dbe0" }}><h3>Versi {item.version} · {item.status === "pending_verification" ? "Menunggu verifikasi" : item.status === "verified" ? "Ditinjau" : "Dicabut"}{item.isSimulation ? " · SIMULASI" : ""}</h3><p>{item.sourceLabel} ({item.sourceType}) · hash {item.contentHash.slice(0, 12)}…</p>{item.sourceUrl && <p>Sumber: <a href={item.sourceUrl} target="_blank" rel="noreferrer">buka referensi</a></p>}<p>Dibuat {new Date(item.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA.</p>{item.verifiedAt && <p>Ditinjau {new Date(item.verifiedAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA · {item.verificationReason}</p>}{item.status === "pending_verification" && <div style={{ display: "grid", gap: 8, maxWidth: 700 }}><label className="ui-field">Alasan tinjauan<input value={reason[item.id] || ""} maxLength={1000} onChange={event => setReason({ ...reason, [item.id]: event.target.value })} /></label><button className="ui-button" type="button" disabled={verify.isPending || !(reason[item.id] || "").trim()} onClick={() => verify.mutate({ territoryId: item.id, verificationReason: reason[item.id] })}>Tandai sudah ditinjau</button></div>}</li>)}</ol>}
				{verify.isError && <p role="alert">{verify.error.message}</p>}
			</section>
			{actionMessage && <p role="status">{actionMessage}</p>}
		</>}
	</div></main>;
}
