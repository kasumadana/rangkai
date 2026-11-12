import { getRoadStatusPresentation, type OperationalRoadStatus } from "../../lib/road-status";
import { isTimestampExpired } from "../../lib/wita";

export type { OperationalRoadStatus } from "../../lib/road-status";

export interface RoadStatusBadgeProps {
	status: OperationalRoadStatus;
	expiresAt?: string | number | Date | null;
	now?: Date;
	showCongestionHint?: boolean;
}

export function RoadStatusBadge({ status, expiresAt, now, showCongestionHint = false }: RoadStatusBadgeProps) {
	const stale = isTimestampExpired(expiresAt, now);
	const presentation = getRoadStatusPresentation(status);
	return <span className="inline-flex flex-wrap items-center gap-2">
		<span className={`road-status-badge status-${stale ? "unknown" : status}`} style={{ whiteSpace: "normal" }}>
			{stale ? `BELUM DIKONFIRMASI ULANG • Status terakhir: ${presentation.code}` : presentation.label}
		</span>
		{!stale && showCongestionHint && status === "open" ? <small>(Tidak menjamin bebas kepadatan)</small> : null}
	</span>;
}
