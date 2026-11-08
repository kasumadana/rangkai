import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Token } from "@astryxdesign/core/Token";
import type { OperationalRoadStatus } from "../../lib/road-status";

export interface CeremonyDetailItem {
	id: string;
	title: string;
	desaAdatName: string;
	kabupaten?: string;
	slug: string;
	status: OperationalRoadStatus;
	dateLabel?: string;
	windowWita: string;
	sacredCenterName: string;
	roadName?: string;
	detourRoute?: string;
	isSimulation?: boolean;
}

interface CeremonyDetailModalProps {
	ceremony: CeremonyDetailItem | null;
	onClose: () => void;
}

function getStatusBadgeConfig(status: OperationalRoadStatus) {
	switch (status) {
		case "closed":
			return {
				label: "Ditutup Total",
				className: "status-closed",
			};
		case "intermittent":
			return {
				label: "Buka-Tutup",
				className: "status-intermittent",
			};
		case "open":
			return {
				label: "Jalur Normal",
				className: "status-open",
			};
		default:
			return {
				label: "Konfirmasi",
				className: "status-unknown",
			};
	}
}

export function CeremonyDetailModal({
	ceremony,
	onClose,
}: CeremonyDetailModalProps) {
	const navigate = useNavigate();

	// Close on Escape key
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		if (ceremony) {
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}
	}, [ceremony, onClose]);

	if (!ceremony) return null;

	const statusBadge = getStatusBadgeConfig(ceremony.status);

	return (
		<div
			className="map-detail-modal-backdrop"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-labelledby="ceremony-modal-title"
		>
			<div
				className="map-detail-modal-card"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="map-detail-modal-header">
					<div>
						<div className="map-detail-modal-desa">
							{ceremony.desaAdatName}
							{ceremony.kabupaten ? ` • ${ceremony.kabupaten}` : ""}
						</div>
						<h3 id="ceremony-modal-title" className="map-detail-modal-title">
							{ceremony.title}
						</h3>
					</div>
					<button
						type="button"
						className="map-detail-modal-close"
						onClick={onClose}
						aria-label="Tutup Rincian Upacara"
						title="Tutup (Esc)"
					>
						✕
					</button>
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
					<span className={`map-popup-badge ${statusBadge.className}`}>
						{statusBadge.label}
					</span>
					{ceremony.isSimulation ? (
						<Token color="orange" size="sm" label="SIMULASI" />
					) : null}
					<span style={{ fontSize: 12, color: "#71717A", fontWeight: 500 }}>
						{ceremony.windowWita}
						{ceremony.dateLabel ? ` • ${ceremony.dateLabel}` : ""}
					</span>
				</div>

				<div className="map-detail-summary-list">
					<div className="map-detail-summary-item">
						<span className="map-detail-summary-label">Lokasi & Koridor</span>
						<span className="map-detail-summary-val">
							{ceremony.sacredCenterName} • {ceremony.roadName || "Koridor Utama Desa"}
						</span>
					</div>
					<div className="map-detail-summary-item">
						<span className="map-detail-summary-label">Arahan Rute Alternatif</span>
						<span className="map-detail-summary-val">
							{ceremony.detourRoute ||
								"Gunakan jalur lingkar desa atau ikuti arahan Pecalang di lokasi"}
						</span>
					</div>
				</div>

				<button
					type="button"
					className="btn-modal-primary"
					onClick={() => {
						onClose();
						navigate(`/events/${ceremony.slug}`);
					}}
				>
					<span>Lihat Rincian Lengkap Acara</span>
					<span aria-hidden="true">→</span>
				</button>
			</div>
		</div>
	);
}
