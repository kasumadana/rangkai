import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, apiFetch } from "../lib/api-client";
import { useAuthSession } from "../lib/auth";

type Organization = { id: string; name: string; village: string | null; district: string | null };
type Territory = { id: string; organizationId: string; version: number; isSimulation: boolean; status: string };
type Reviewer = { userId: string; name: string; email: string; assignmentStatus: string | null };

export function AdminReviewersPage() {
  const session = useAuthSession();
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [territoryVersionId, setTerritoryVersionId] = useState("");
  const [reviewerId, setReviewerId] = useState("");

  const organizations = useQuery({
    queryKey: ["admin", "reviewer-organizations"],
    queryFn: () => apiFetch<{ organizations: Organization[] }>("/api/admin/users/organizations"),
    enabled: Boolean(session.data?.user),
    retry: false,
  });
  const territories = useQuery({
    queryKey: ["admin", "reviewer-territories", organizationId],
    queryFn: () => apiFetch<{ territories: Territory[] }>(`/api/admin/territories?organizationId=${encodeURIComponent(organizationId)}`),
    enabled: Boolean(session.data?.user && organizationId),
    retry: false,
  });
  const reviewers = useQuery({
    queryKey: ["admin", "reviewers", territoryVersionId],
    queryFn: () => apiFetch<{ reviewers: Reviewer[] }>(`/api/admin/reviewers?territoryVersionId=${encodeURIComponent(territoryVersionId)}`),
    enabled: Boolean(session.data?.user && territoryVersionId),
    retry: false,
  });
  const verifiedTerritories = useMemo(
    () => (territories.data?.territories || []).filter((item) => item.status === "verified"),
    [territories.data],
  );
  const orgName = useMemo(
    () => organizations.data?.organizations.find((item) => item.id === organizationId)?.name,
    [organizations.data, organizationId],
  );

  const assign = useMutation({
    mutationFn: () => apiFetch(`/api/admin/territories/${territoryVersionId}/reviewers`, { method: "POST", body: { userId: reviewerId } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["admin", "reviewers", territoryVersionId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => apiFetch(`/api/admin/territories/${territoryVersionId}/reviewers/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["admin", "reviewers", territoryVersionId] });
    },
  });

  if (session.isLoading) return <main className="teduh-page-shell"><p role="status">Memeriksa sesi...</p></main>;
  if (session.isError) return <main className="teduh-page-shell"><p role="alert">Sesi belum dapat diperiksa. <button className="ui-button" onClick={() => void session.refetch()}>Coba lagi</button></p></main>;
  if (!session.data?.user) return <main className="teduh-page-shell"><Link to="/login" state={{ from: "/admin/reviewers" }}>Masuk sebagai administrator</Link></main>;
  if (organizations.error instanceof ApiClientError && organizations.error.status === 403) {
    return <main className="teduh-page-shell"><section className="teduh-auth-card" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}><h1>Akses administrator diperlukan</h1><p>Halaman ini hanya tersedia untuk superadmin aktif.</p><Link to="/">Kembali ke beranda</Link></section></main>;
  }

  return (
    <main className="teduh-page-shell">
      <div className="teduh-auth-card" style={{ width: "100%", maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <header>
          <h1>Penetapan reviewer</h1>
          <p>Penetapan ini mengatur cakupan tinjauan internal. Ia tidak memberikan izin penutupan jalan resmi.</p>
        </header>
        <nav aria-label="Navigasi administrator" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBlock: 16 }}>
          <Link to="/admin/organizations">Pengajuan organisasi</Link>
          <Link to="/admin/users">Akun & undangan</Link>
          <Link to="/admin/territories">Wilayah organisasi</Link>
          <Link to="/admin/reviewers" aria-current="page">Reviewer pemerintah</Link>
        </nav>
        <label className="ui-field">
          Organisasi
          <select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setTerritoryVersionId(""); setReviewerId(""); }}>
            <option value="">Pilih organisasi</option>
            {organizations.data?.organizations.map((org) => (
              <option key={org.id} value={org.id}>{org.name} · {org.village || org.district || "Lokasi belum dicatat"}</option>
            ))}
          </select>
        </label>
        {organizations.isLoading && <p role="status">Memuat organisasi...</p>}
        {organizations.isError && <p role="alert">Organisasi tidak dapat dimuat. <button onClick={() => void organizations.refetch()}>Coba lagi</button></p>}
        {organizationId && (
          <>
            <label className="ui-field" style={{ marginTop: 16 }}>
              Versi wilayah terverifikasi{orgName ? ` ${orgName}` : ""}
              <select value={territoryVersionId} onChange={(event) => { setTerritoryVersionId(event.target.value); setReviewerId(""); }}>
                <option value="">Pilih versi</option>
                {verifiedTerritories.map((item) => (
                  <option key={item.id} value={item.id}>Versi {item.version}{item.isSimulation ? " · SIMULASI" : ""}</option>
                ))}
              </select>
            </label>
            {territories.isLoading && <p role="status">Memuat versi wilayah...</p>}
            {territories.isError && <p role="alert">Versi wilayah tidak dapat dimuat. <button onClick={() => void territories.refetch()}>Coba lagi</button></p>}
            {territories.data && verifiedTerritories.length === 0 && <p>Belum ada versi wilayah terverifikasi. Reviewer dapat ditetapkan setelah wilayah diverifikasi.</p>}
          </>
        )}
        {territoryVersionId && (
          <section style={{ marginTop: 24 }}>
            <h2>Reviewer pemerintah</h2>
            {reviewers.isLoading ? (
              <p role="status">Memuat reviewer...</p>
            ) : reviewers.isError ? (
              <p role="alert">Daftar reviewer tidak dapat dimuat. <button onClick={() => void reviewers.refetch()}>Coba lagi</button></p>
            ) : !reviewers.data?.reviewers.length ? (
              <p>Belum ada akun reviewer aktif.</p>
            ) : (
              <ul>
                {reviewers.data.reviewers.map((item) => (
                  <li key={item.userId} style={{ paddingBlock: 12 }}>
                    <strong>{item.name}</strong> <span>{item.email}</span>
                    <p>{item.assignmentStatus === "active" ? "Sudah ditugaskan" : "Belum ditugaskan"}</p>
                    {item.assignmentStatus === "active" && (
                      <button className="ui-button" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(item.userId)}>
                        Cabut penugasan
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(event) => { event.preventDefault(); if (reviewerId) assign.mutate(); }}
              style={{ display: "grid", gap: 12, marginTop: 16 }}
            >
              <label className="ui-field">
                Tetapkan reviewer
                <select required value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}>
                  <option value="">Pilih reviewer</option>
                  {(reviewers.data?.reviewers || []).filter((item) => item.assignmentStatus !== "active").map((item) => (
                    <option key={item.userId} value={item.userId}>{item.name} · {item.email}</option>
                  ))}
                </select>
              </label>
              <button className="ui-button ui-button-primary" type="submit" disabled={assign.isPending || !reviewerId}>
                {assign.isPending ? "Menyimpan..." : "Tetapkan penugasan"}
              </button>
            </form>
            {assign.isError && <p role="alert">{assign.error.message}</p>}
            {revoke.isError && <p role="alert">{revoke.error.message}</p>}
            {(assign.isSuccess || revoke.isSuccess) && <p role="status">Penugasan tersimpan.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
