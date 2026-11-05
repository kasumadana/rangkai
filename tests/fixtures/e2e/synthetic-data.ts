/**
 * Synthetic E2E test data for Rangkai.
 * Adheres to AGENTS.md §1 & §13:
 * - Must never represent simulated data as real operational data.
 * - Explicit [SIMULATED] tags.
 * - Road segments must strictly be verified segments or flagged unverified.
 */

import { PILOT_ROAD_SEGMENTS } from "../../../src/db/fixtures/road-segments";

export const SYNTHETIC_E2E_DATA = {
	organization: {
		id: "11111111-1111-4111-8111-111111111111",
		name: "Banjar Uji Coba Sari (Simulasi E2E)",
		village: "Desa Simulasi",
		district: "Denpasar Barat",
	},
	event: {
		id: "33333333-3333-4333-8333-333333333333",
		title: "[SIMULATED] Upacara Piodalan Pura Desa E2E",
		category: "upacara",
		description: "Data kegiatan adat simulasi untuk validasi end-to-end browser Playwright.",
		venueName: "Balai Banjar Uji Coba",
		status: "draft" as const,
		publicSlug: "simulated-piodalan-pura-desa-e2e",
		startsAt: "2026-11-10T08:00:00+08:00",
		endsAt: "2026-11-10T14:00:00+08:00",
	},
	document: {
		validPdf: {
			filename: "surat-pengumuman-simulasi.pdf",
			contentType: "application/pdf",
			sizeBytes: 1024 * 500, // 500 KB (valid <= 8 MB)
		},
		oversizedPdf: {
			filename: "surat-pengumuman-oversized.pdf",
			contentType: "application/pdf",
			sizeBytes: 1024 * 1024 * 9, // 9 MB (exceeds 8 MB limit)
		},
		sampleGajahMadaImage: {
			filePath: "tests/fixtures/eval-dataset/images/1.png",
			filename: "1.png",
			contentType: "image/png",
			eventName: "Pekerjaan Rehabilitasi Jalan dan Penataan Pedestrian Kawasan Kota Denpasar",
			affectedRoadsInDoc: ["Jalan Gajah Mada", "Simpang Catur Muka"],
		},
	},
	roadSegments: {
		// Explicitly registered verified segments in Kawasan Gajah Mada / Catur Muka:
		gajahMada: PILOT_ROAD_SEGMENTS[0], // [SIMULATED] Jl. Gajah Mada (Catur Muka - Pasar Badung)
		surapati: PILOT_ROAD_SEGMENTS[1],  // [SIMULATED] Jl. Surapati (Catur Muka - Lapangan Puputan Timur)
		veteran: PILOT_ROAD_SEGMENTS[2],   // [SIMULATED] Jl. Veteran (Catur Muka - RSUD Wangaya)
		udayana: PILOT_ROAD_SEGMENTS[3],   // [SIMULATED] Jl. Udayana (Catur Muka - Lapangan Puputan Selatan)
		primaryVerified: PILOT_ROAD_SEGMENTS[0],
		secondaryVerified: PILOT_ROAD_SEGMENTS[1],
	},
	cleanup: {
		id: "44444444-4444-4444-8444-444444444444",
		title: "[SIMULATED] Pembersihan Area Pos Catur Muka",
		description: "Tugas pembersihan simulasi pasca kegiatan adat.",
		status: "todo" as const,
		wasteRecord: {
			category: "organic" as const,
			sackCount: 5,
			estimatedKg: 50,
			weighedKg: null,
			measurementMethod: "estimated" as const,
		},
	},
};
