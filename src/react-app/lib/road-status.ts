/**
 * Allowed operational road statuses per AGENTS.md §13 & docs/02-SRS.md FR-034:
 * - OPEN
 * - INTERMITTENT
 * - CLOSED
 * - UNKNOWN
 */
export type OperationalRoadStatus = "open" | "intermittent" | "closed" | "unknown";

export interface StatusPresentation {
	code: "OPEN" | "INTERMITTENT" | "CLOSED" | "UNKNOWN";
	label: string;
	tokenColor: "green" | "orange" | "red" | "gray";
	dotVariant: "success" | "warning" | "error" | "neutral";
	summary: string;
}

export const ROAD_STATUS_MAP: Record<OperationalRoadStatus, StatusPresentation> = {
	open: {
		code: "OPEN",
		label: "DIBUKA (OPEN)",
		tokenColor: "green",
		dotVariant: "success",
		summary: "Dapat dilalui; tidak menjamin bebas kepadatan lalu lintas.",
	},
	intermittent: {
		code: "INTERMITTENT",
		label: "BUKA-TUTUP (INTERMITTENT)",
		tokenColor: "orange",
		dotVariant: "warning",
		summary: "Arus diatur bergantian atau tertahan sementara saat prosesi berlangsung.",
	},
	closed: {
		code: "CLOSED",
		label: "DITUTUP (CLOSED)",
		tokenColor: "red",
		dotVariant: "error",
		summary: "Ruas ditutup sementara untuk kegiatan. Gunakan jalur lain.",
	},
	unknown: {
		code: "UNKNOWN",
		label: "BELUM DIKETAHUI (UNKNOWN)",
		tokenColor: "gray",
		dotVariant: "neutral",
		summary: "Belum ada laporan status lapangan terverifikasi pada ruas ini.",
	},
};

export function getRoadStatusPresentation(
	status: OperationalRoadStatus,
): StatusPresentation {
	return ROAD_STATUS_MAP[status] ?? ROAD_STATUS_MAP.unknown;
}
