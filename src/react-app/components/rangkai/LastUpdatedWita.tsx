import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import {
	WITA_TIMEZONE,
	formatRelativeAgeId,
	formatWitaDateTime,
	parseDate,
} from "../../lib/wita";

export interface LastUpdatedWitaProps {
	timestamp: string | number | Date | null | undefined;
	labelPrefix?: string;
	showRelative?: boolean;
}

/**
 * Displays an authoritative UTC timestamp formatted in Asia/Makassar (WITA)
 * alongside Astryx `Timestamp` for hover multi-timezone verification (SRS FR-016, FR-039, NFR-015).
 */
export function LastUpdatedWita({
	timestamp,
	labelPrefix = "Pembaruan terakhir",
	showRelative = true,
}: LastUpdatedWitaProps) {
	const parsed = parseDate(timestamp);
	if (!parsed) {
		return (
			<HStack gap={1.5} vAlign="center">
				<Icon icon="clock" size="xsm" color="secondary" />
				<Text size="xsm" color="secondary">
					{labelPrefix}: Belum ada catatan waktu
				</Text>
			</HStack>
		);
	}

	const formatted = formatWitaDateTime(parsed);
	const relative = formatRelativeAgeId(parsed);

	return (
		<HStack gap={1.5} vAlign="center" wrap="wrap">
			<Icon icon="clock" size="xsm" color="secondary" />
			<Text size="xsm" color="secondary">
				{labelPrefix}: {formatted}
				{showRelative ? ` (${relative})` : null}
			</Text>
			<Timestamp
				value={parsed.toISOString()}
				format="relative_short"
				size="xsm"
				tooltipEntries={[
					{
						timezoneID: WITA_TIMEZONE,
						label: "WITA (Bali)",
						isCopyable: true,
					},
					{
						timezoneID: "UTC",
						label: "UTC (Server)",
						isCopyable: true,
					},
				]}
			/>
		</HStack>
	);
}
