import { z } from "zod";
const source = "https://peraturan.bpk.go.id/Download/349404/2024pw5109007.pdf";
const catalog = [
 { name: "Bali Wastu Lestari", latitude: -8.629519, longitude: 115.208943, address: "Jl. A. Yani Utara, Gg. Garuda No. 1, Peguyangan, Denpasar Utara" },
 { name: "Bali Bersih", latitude: -8.645878, longitude: 115.185263, address: "Jl. Kebo Iwa Selatan Gang Agastia No. 3, Denpasar" },
 { name: "Prema Bali Lestari", latitude: -8.673715, longitude: 115.209651, address: "Jl. Gili Biaha No. 6, Dauh Puri Kelod" },
] as const;
export const locationSchema = z.object({ latitude: z.number().finite().min(-9).max(-8), longitude: z.number().finite().min(114).max(116) }).strict();
export function nearbyFacilities(location?: z.infer<typeof locationSchema>) {
 const nearbyCandidates = location ? catalog.map(item => {
  const rad = Math.PI / 180;
  const dlat = (item.latitude - location.latitude) * rad;
  const dlon = (item.longitude - location.longitude) * rad;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(location.latitude * rad) * Math.cos(item.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return { ...item, distanceKm: Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10, distanceMethod: "straight_line" as const, acceptanceConfirmed: false, needsConfirmation: true, operationalStatus: "unknown" as const, source, sourceYear: 2023, sourceAccessedAt: "2026-11-11", fieldVerified: false };
 }).sort((a, b) => a.distanceKm - b.distanceKm) : [];
 return { version: 1, status: "suitability_unavailable" as const, suitableMatches: [], nearbyCandidates, message: "Konfirmasi langsung kategori yang diterima, wilayah layanan, jam dan operasi sebelum mengirim sampah." };
}
