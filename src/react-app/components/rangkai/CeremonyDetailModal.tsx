import { useEffect } from "react";
import { useNavigate } from "react-router";
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
				label: "Dibuka",
				className: "status-open",
			};
		default:
			return {
				label: "Belum dikonfirmasi",
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

				<div className="flex flex-wrap items-center gap-2">
					<span className={`map-popup-badge ${statusBadge.className}`}>
						{statusBadge.label}
					</span>
					{ceremony.isSimulation !== false ? (
						<span className="map-popup-badge simulation-token">SIMULASI</span>
					) : null}
				</div>

				<div className="map-detail-summary-list">
					<div className="map-detail-summary-item">
						<span className="map-detail-summary-label">Pusat Upacara</span>
						<span className="map-detail-summary-val">
							{ceremony.sacredCenterName}
						</span>
					</div>
					<div className="map-detail-summary-item">
						<span className="map-detail-summary-label">Jadwal Pelaksanaan</span>
						<span className="map-detail-summary-val tabular-nums">
							{ceremony.dateLabel ? `${ceremony.dateLabel} • ` : ""}
							{ceremony.windowWita}
						</span>
					</div>
					<div className="map-detail-summary-item">
						<span className="map-detail-summary-label">Ruas Jalan Terdampak</span>
						<span className="map-detail-summary-val">
							{ceremony.roadName || "Ruas belum ditentukan"}
						</span>
					</div>
					<div className="map-detail-summary-item">
						<span className="map-detail-summary-label">Arahan Rute Alternatif</span>
						<span className="map-detail-summary-val">
							{ceremony.detourRoute ||
								"Ikuti arahan petugas di lokasi."}
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
