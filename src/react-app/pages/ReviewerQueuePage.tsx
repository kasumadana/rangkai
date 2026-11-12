import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, apiFetch } from "../lib/api-client";
import { useAuthSession } from "../lib/auth";

type RoadRequest = {
  id: string;
  eventId: string;
  eventTitle: string;
  roadSegmentId: string;
  roadName: string;
  coverageArea: string | null;
  plannedFrom: string;
  plannedTo: string;
  impactType: string;
  isSimulation: boolean;
  territoryVersion: number;
  territoryIsSimulation: boolean;
};

function formatWita(value: string) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
}

export function ReviewerQueuePage() {
  const session = useAuthSession();
  const client = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const queue = useQuery({
    queryKey: ["reviewer", "road-requests"],
    queryFn: () => apiFetch<{ requests: RoadRequest[] }>("/api/reviewer/road-requests"),
    enabled: Boolean(session.data?.user),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) => {
      const reason = (reasons[id] || "").trim();
      return apiFetch(`/api/reviewer/road-requests/${id}/decision`, {
        method: "POST",
        body: { decision, reason },
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["reviewer", "road-requests"] });
    },
  });

  if (session.isLoading) return <main className="teduh-page-shell"><p role="status">Memeriksa sesi...</p></main>;
  if (session.isError) return <main className="teduh-page-shell"><p role="alert">Sesi belum dapat diperiksa. <button className="ui-button" onClick={() => void session.refetch()}>Coba lagi</button></p></main>;
  if (!session.data?.user) return <main className="teduh-page-shell"><Link to="/login" state={{ from: "/reviewer/road-requests" }}>Masuk sebagai reviewer</Link></main>;
  if (queue.error instanceof ApiClientError && queue.error.status === 403) {
    return <main className="teduh-page-shell"><section className="teduh-auth-card" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}><h1>Akses reviewer diperlukan</h1><p>Halaman ini hanya tersedia untuk reviewer pemerintah aktif yang mendapat cakupan wilayah tugas.</p><Link to="/">Kembali ke beranda</Link></section></main>;
  }

  return (
    <main className="teduh-page-shell">
      <div className="teduh-auth-card" style={{ width: "100%", maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <header>
          <h1>Antrean tinjauan ruas</h1>
          <p>Keputusan ini mencatat tinjauan wilayah, bukan izin operasional resmi. Pengajuan hanya tampil bila berada dalam cakupan wilayah tugas Anda.</p>
        </header>
        <div style={{ marginBlock: 16 }}>
          <button className="ui-button" type="button" disabled={queue.isFetching} onClick={() => void queue.refetch()}>
            Muat ulang
          </button>
        </div>
        {queue.isLoading ? (
          <p role="status">Memuat pengajuan...</p>
        ) : queue.isError ? (
          <p role="alert">Antrean tidak dapat dimuat. <button onClick={() => void queue.refetch()}>Coba lagi</button></p>
        ) : !queue.data?.requests.length ? (
          <p>Tidak ada pengajuan menunggu keputusan.</p>
        ) : (
          <ul>
            {queue.data.requests.map((item) => (
              <li key={item.id} style={{ paddingBlock: 16, borderBottom: "1px solid #d7dbe0" }}>
                <h2>{item.roadName || "Nama ruas belum dicatat"}</h2>
                <p>{item.eventTitle}{item.coverageArea ? ` · ${item.coverageArea}` : ""}</p>
                <p>Dampak: {item.impactType} · Wilayah versi {item.territoryVersion}{item.territoryIsSimulation ? " · SIMULASI" : ""}{item.isSimulation ? " · Pengajuan SIMULASI" : ""}</p>
                <p>
                  {formatWita(item.plannedFrom)} WITA s.d. {formatWita(item.plannedTo)} WITA
                </p>
                <div style={{ display: "grid", gap: 8, maxWidth: 700 }}>
                  <label className="ui-field">
                    Alasan keputusan (wajib)
                    <input
                      value={reasons[item.id] || ""}
                      maxLength={1000}
                      onChange={(event) => setReasons((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    />
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      className="ui-button ui-button-primary"
                      type="button"
                      disabled={decide.isPending || (reasons[item.id] || "").trim().length < 3}
                      onClick={() => decide.mutate({ id: item.id, decision: "approve" })}
                    >
                      Setujui pengajuan
                    </button>
                    <button
                      className="ui-button"
                      type="button"
                      disabled={decide.isPending || (reasons[item.id] || "").trim().length < 3}
                      onClick={() => decide.mutate({ id: item.id, decision: "reject" })}
                    >
                      Tolak pengajuan
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {decide.isError && <p role="alert">{decide.error.message}</p>}
        {decide.isSuccess && <p role="status">Keputusan tersimpan.</p>}
      </div>
    </main>
  );
}
