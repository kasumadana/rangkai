import type { RoadImpactRecord } from "../../lib/events-api";
export function catalogVisibility(mode: string): "visible" | "none" { return mode === "catalog" ? "visible" : "none"; }
export function roadDetails(road: Pick<RoadImpactRecord, "displayName" | "segment" | "impactType" | "plannedFrom" | "plannedTo" | "operationalStatus">) {
 const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Makassar", dateStyle: "medium", timeStyle: "short" }) + " WITA" : "Belum ditetapkan";
 const status = road.operationalStatus;
 const fresh = status && !status.isStale && status.expiresAt && Date.parse(status.expiresAt) > Date.now();
 const labels: Record<string, string> = { open: "Terbuka", closed: "Ditutup", intermittent: "Buka-tutup", unconfirmed: "Belum terkonfirmasi", closure: "Penutupan", narrowing: "Penyempitan", procession: "Prosesi" };
 return [road.displayName || road.segment?.displayName || "Nama ruas belum tersedia", `Dampak: ${labels[road.impactType] || road.impactType}`, `Status: ${fresh ? labels[status.effectiveStatus] || "Belum terkonfirmasi" : "Belum terkonfirmasi"}`, `Mulai: ${date(road.plannedFrom)}`, `Selesai: ${date(road.plannedTo)}`].join("\n");
}
