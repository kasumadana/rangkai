import { OPERATIONAL_DISCLAIMERS, UX_EMPTY_COPY } from "../../lib/constants";
import type { OperationalRoadStatus } from "../../lib/road-status";
import { formatWitaDateTime, formatWitaRange, isTimestampExpired } from "../../lib/wita";
import { RoadStatusBadge } from "./RoadStatusBadge";

export interface RoadSegmentFallbackItem {
	id: string;
	segmentName: string;
	corridorArea: string;
	impactType: "closure" | "intermittent_flow" | "parking_restriction" | "procession_route";
	plannedFrom: string | null;
	plannedTo: string | null;
	status: OperationalRoadStatus;
	observedAt?: string | null;
	expiresAt?: string | null;
	diversionNote?: string | null;
	isSimulation?: boolean;
}

const IMPACT_TYPE_LABELS: Record<RoadSegmentFallbackItem["impactType"], string> = {
	closure: "Penutupan Sementara",
	intermittent_flow: "Pengaturan Buka-Tutup",
	parking_restriction: "Pembatasan Parkir Tepi Jalan",
	procession_route: "Jalur Prosesi / Arak-arakan",
};

export function MapFallbackRoadList({ segments, showMapUnavailableNotice = false, now }: {
	segments: RoadSegmentFallbackItem[];
	showMapUnavailableNotice?: boolean;
	now?: Date;
}) {
	return <section aria-label="Informasi ruas jalan">
		{showMapUnavailableNotice ? <div role="status" className="rounded-xl bg-stone-100 p-4 mb-4">
			<strong>{UX_EMPTY_COPY.MAP_UNAVAILABLE}</strong><p>{OPERATIONAL_DISCLAIMERS.OPEN_ROAD_NOTE}</p>
		</div> : null}
		{segments.length === 0 ? <p>{UX_EMPTY_COPY.NO_MATCHING_ROAD}</p> : <>
			<h3>Daftar Ruas Jalan Terdampak ({segments.length} segmen)</h3>
			<ul className="m-0 list-none p-0">
				{segments.map((seg) => <li key={seg.id} className="border-b border-stone-200 py-4 last:border-0">
					<div className="flex flex-wrap items-center gap-2"><strong>{seg.segmentName}</strong>{seg.isSimulation ? <strong>SIMULASI</strong> : null}</div>
					<p>Rencana dampak: {IMPACT_TYPE_LABELS[seg.impactType]}</p>
					<p>Kawasan: {seg.corridorArea} • Jadwal rencana: {formatWitaRange(seg.plannedFrom, seg.plannedTo)}</p>
					<RoadStatusBadge status={seg.status} expiresAt={seg.expiresAt} now={now} showCongestionHint />
					<p>Konfirmasi lapangan terakhir: {formatWitaDateTime(seg.observedAt)}</p>
					<p>Masa berlaku: {formatWitaDateTime(seg.expiresAt)}</p>
					{isTimestampExpired(seg.expiresAt, now) ? <p>{UX_EMPTY_COPY.STALE_STATUS} Sistem tidak mengasumsikan ruas jalan sudah dibuka sebelum ada konfirmasi baru dari petugas lapangan.</p> : null}
					{seg.diversionNote ? <p>Catatan pengalihan panitia: {seg.diversionNote}</p> : null}
				</li>)}
			</ul>
		</>}
	</section>;
}
