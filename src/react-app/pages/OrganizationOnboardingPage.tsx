import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { apiFetch } from "../lib/api-client";
import { useAuthSession } from "../lib/auth";

type Application = { id: string; name: string; village: string; district: string; status: "pending" | "approved" | "rejected"; decisionReason: string | null; organizationId: string | null };
export function OrganizationOnboardingPage() {
 const { data: session, isLoading, isError: sessionError, refetch: retrySession } = useAuthSession();
 const client = useQueryClient(); const navigate = useNavigate();
 const [name, setName] = useState(""); const [village, setVillage] = useState(""); const [district, setDistrict] = useState("");
 const applications = useQuery({ queryKey: ["organization-applications", session?.user.id], queryFn: () => apiFetch<{ applications: Application[] }>("/api/me/organization-applications"), enabled: Boolean(session?.user), retry: false });
 const { refetch: refreshApplications } = applications;
 const hasPending = applications.data?.applications.some(item => item.status === "pending") ?? false;
 useEffect(() => {
  if (!hasPending) return;
  const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshApplications(); }, 60_000);
  return () => clearInterval(timer);
 }, [hasPending, refreshApplications]);
 const submit = useMutation({ mutationFn: () => apiFetch("/api/me/organization-applications", { method: "POST", body: { name, village, district } }), onSuccess: async () => { setName(""); setVillage(""); setDistrict(""); await client.invalidateQueries({ queryKey: ["organization-applications"] }); navigate("/onboarding/status"); } });
 if (isLoading) return <main className="teduh-page-shell"><p role="status">Memeriksa sesi...</p></main>;
 if (sessionError) return <main className="teduh-page-shell"><p role="alert">Sesi belum dapat diperiksa.</p><button className="ui-button" onClick={() => void retrySession()}>Coba lagi</button></main>;
 if (!session?.user) return <main className="teduh-page-shell"><h1>Masuk untuk melihat pengajuan</h1><Link to="/login" state={{ from: "/onboarding/status" }}>Masuk</Link> atau <Link to="/register">daftar akun</Link>.</main>;
 return <main className="teduh-page-shell"><div className="teduh-auth-card" style={{ maxWidth: 620, margin: "auto", padding: 24 }}>
  <h1>Pengajuan organisasi</h1><p>Pengajuan ditinjau administrator. Persetujuan memberi akses pengelola, bukan izin penutupan jalan atau kewenangan operasional.</p>
  <button type="button" className="ui-button" disabled={applications.isFetching} onClick={() => void applications.refetch()}>Periksa status</button>{hasPending && <p>Status diperiksa setiap 60 detik saat halaman terlihat.</p>}
  {applications.isLoading ? <p role="status">Memuat pengajuan...</p> : applications.isError ? <p role="alert">Status belum tersedia. Periksa kembali.</p> : applications.data?.applications.length ? <ul>{applications.data.applications.map(item => <li key={item.id}><strong>{item.name}</strong> ({item.village}, {item.district}): {item.status === "pending" ? "Menunggu tinjauan" : item.status === "approved" ? "Disetujui" : "Ditolak"}{item.decisionReason && <p>Alasan: {item.decisionReason}</p>}{item.status === "approved" && <p><Link to="/dashboard">Buka panel kegiatan</Link></p>}</li>)}</ul> : <p>Belum ada pengajuan.</p>}
  {!hasPending && applications.isSuccess && <form onSubmit={e => { e.preventDefault(); submit.mutate(); }} style={{ display: "grid", gap: 12 }}><h2>Ajukan organisasi</h2><label>Nama organisasi<input className="teduh-form-input" value={name} onChange={e => setName(e.target.value)} required minLength={3} maxLength={150} /></label><label>Desa / wilayah<input className="teduh-form-input" value={village} onChange={e => setVillage(e.target.value)} required minLength={2} maxLength={100} /></label><label>Kabupaten / kota<input className="teduh-form-input" value={district} onChange={e => setDistrict(e.target.value)} required minLength={2} maxLength={100} /></label>{submit.isError && <p role="alert">{submit.error.message}</p>}<button className="ui-button ui-button-primary" disabled={submit.isPending}>{submit.isPending ? "Mengirim..." : "Kirim pengajuan"}</button></form>}
  <p><Link to="/admin/organizations">Tinjau pengajuan sebagai administrator</Link></p>
 </div></main>;
}
