import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import {
	getRoadStatusPresentation,
	type OperationalRoadStatus,
} from "../../lib/road-status";
import { isTimestampExpired } from "../../lib/wita";

export type { OperationalRoadStatus } from "../../lib/road-status";

export interface RoadStatusBadgeProps {
	status: OperationalRoadStatus;
	expiresAt?: string | number | Date | null;
	now?: Date;
	showCongestionHint?: boolean;
}

export function RoadStatusBadge({
	status,
	expiresAt,
	now,
	showCongestionHint = false,
}: RoadStatusBadgeProps) {
	const isStale = isTimestampExpired(expiresAt, now);
	const base = getRoadStatusPresentation(status);

	if (isStale) {
		return (
			<HStack gap={2} vAlign="center" wrap="wrap">
				<Token
					color="orange"
					size="sm"
					icon={<Icon icon="warning" size="xsm" />}
					label={`BELUM DIKONFIRMASI ULANG • Status terakhir: ${base.code}`}
				/>
			</HStack>
		);
	}

	return (
		<HStack gap={1.5} vAlign="center" wrap="wrap">
			<Token color={base.tokenColor} size="sm" label={base.label} />
			{showCongestionHint && status === "open" ? (
				<Text size="xsm" color="secondary">
					(Tidak menjamin bebas kepadatan)
				</Text>
			) : null}
		</HStack>
	);
}
