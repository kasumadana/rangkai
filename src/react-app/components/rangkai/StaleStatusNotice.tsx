import { UX_EMPTY_COPY } from "../../lib/constants";
import { formatWitaDateTime, isTimestampExpired } from "../../lib/wita";
import {
	getRoadStatusPresentation,
	type OperationalRoadStatus,
} from "../../lib/road-status";

export interface StaleStatusNoticeProps {
	lastKnownStatus: OperationalRoadStatus;
	observedAt?: string | number | Date | null;
	expiresAt?: string | number | Date | null;
	now?: Date;
	forceShow?: boolean;
}

/**
 * Displays an explicit uncertainty warning when a road status update has expired
 * (SRS FR-036, FR-037, AC-04, UX-FLOW §7).
 *
 * Invariant: Never assumes an expired status means the road is OPEN.
 */
export function StaleStatusNotice({
	lastKnownStatus,
	observedAt,
	expiresAt,
	now,
	forceShow = false,
}: StaleStatusNoticeProps) {
	const expired = forceShow || isTimestampExpired(expiresAt, now);
	if (!expired) {
		return null;
	}

	const presentation = getRoadStatusPresentation(lastKnownStatus);

	return (
		<section className="rounded-xl bg-amber-50 p-4 text-amber-950" role="status">
			<strong>{UX_EMPTY_COPY.STALE_STATUS}</strong>
				<p className="text-sm">
					Laporan terakhir tercatat sebagai <strong>{presentation.label}</strong>{" "}
					pada <strong>{formatWitaDateTime(observedAt)}</strong> (batas berlaku:{" "}
					{formatWitaDateTime(expiresAt)}). Sistem tidak mengasumsikan ruas jalan
					sudah dibuka sebelum ada konfirmasi baru dari petugas lapangan.
				</p>
		</section>
	);
}
