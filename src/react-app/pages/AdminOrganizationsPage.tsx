import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { apiFetch } from "../lib/api-client";
import { useAuthSession } from "../lib/auth";

type Application = { id: string; name: string; village: string; district: string; status: "pending" | "approved" | "rejected"; decisionReason: string | null; applicantId: string; applicantName: string; applicantEmail: string };
export function AdminOrganizationsPage() {
 const session = useAuthSession(); const client = useQueryClient(); const [reasons, setReasons] = useState<Record<string, string>>({}); const [page, setPage] = useState(1);
 const queue = useQuery({ queryKey: ["admin", "organization-applications", session.data?.user.id, page], queryFn: () => apiFetch<{ applications: Application[]; hasMore: boolean }>(`/api/admin/organization-applications?page=${page}`), enabled: Boolean(session.data?.user), retry: false });
 const decide = useMutation({ mutationFn: ({ id, decision, reason }: { id: string; decision: "approve" | "reject"; reason?: string }) => apiFetch(`/api/admin/organization-applications/${id}/decision`, { method: "POST", body: { decision, ...(reason ? { reason } : {}) } }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin", "organization-applications"] }); } });
 if (session.isLoading) return <main className="teduh-page-shell"><p role="status">Memeriksa sesi...</p></main>;
 if (session.isError) return <main className="teduh-page-shell"><p role="alert">Sesi belum dapat diperiksa.</p><button className="ui-button" onClick={() => void session.refetch()}>Coba lagi</button></main>;
 if (!session.data?.user) return <main className="teduh-page-shell"><Link to="/login" state={{ from: "/admin/organizations" }}>Masuk sebagai administrator</Link></main>;
 return <main className="teduh-page-shell"><div className="teduh-auth-card" style={{ maxWidth: 760, margin: "auto", padding: 24 }}><h1>Tinjauan organisasi</h1><p>Persetujuan tidak memberikan kewenangan operasional atau izin penutupan jalan.</p>
 <button className="ui-button" type="button" onClick={() => void queue.refetch()} disabled={queue.isFetching}>Muat ulang</button>
 {queue.isLoading ? <p role="status">Memuat pengajuan...</p> : queue.isError ? <p role="alert">Pengajuan tidak dapat dimuat atau akses administrator ditolak.</p> : !queue.data?.applications.length ? <p>Belum ada pengajuan.</p> : <ul>{queue.data.applications.map(item => <li key={item.id} style={{ marginBlock: 20 }}><h2>{item.name}</h2><p>{item.village}, {item.district}</p><p>Pemohon: {item.applicantName} ({item.applicantEmail})</p><p>{item.status === "pending" ? "Menunggu tinjauan" : item.status === "approved" ? "Disetujui" : "Ditolak"}</p>{item.decisionReason && <p>Alasan: {item.decisionReason}</p>}{item.status === "pending" && <><label>Alasan penolakan<textarea className="teduh-form-input" value={reasons[item.id] || ""} maxLength={1000} onChange={e => setReasons({ ...reasons, [item.id]: e.target.value })} /></label><div><button className="ui-button ui-button-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: item.id, decision: "approve" })}>Setujui</button> <button className="ui-button" disabled={decide.isPending || !(reasons[item.id] || "").trim()} onClick={() => decide.mutate({ id: item.id, decision: "reject", reason: reasons[item.id] })}>Tolak</button></div></>}</li>)}</ul>}
 <nav aria-label="Halaman pengajuan"><button className="ui-button" disabled={page === 1} onClick={() => setPage(page - 1)}>Sebelumnya</button> Halaman {page} <button className="ui-button" disabled={!queue.data?.hasMore} onClick={() => setPage(page + 1)}>Berikutnya</button></nav>
 {decide.isError && <p role="alert">{decide.error.message}</p>}{decide.isSuccess && <p role="status">Keputusan tersimpan.</p>}
 </div></main>;
}
