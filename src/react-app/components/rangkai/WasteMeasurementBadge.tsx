import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token, type TokenProps } from "@astryxdesign/core/Token";
import { Scale } from "lucide-react";

/**
 * Waste categories & measurement method distinction per AGENTS.md §13 & SRS FR-054, FR-055:
 * - Categories: Organic, Recyclable, Residual
 * - Methods: Measured weight (`weighed`), Estimated weight (`estimated`), Sack count (`sack_count`)
 *
 * Invariant: Never convert estimated quantities into measured facts.
 */
export type WasteCategory = "organic" | "recyclable" | "residual";
export type WasteMeasurementMethod = "weighed" | "estimated" | "sack_count";

export interface WasteMeasurementBadgeProps {
	category: WasteCategory;
	method: WasteMeasurementMethod;
	quantity: number;
	unit: "kg" | "karung";
}

const CATEGORY_LABELS: Record<WasteCategory, string> = {
	organic: "Organik (Canang/Janur)",
	recyclable: "Daur Ulang (Plastik/Botol)",
	residual: "Residu",
};

const METHOD_CONFIG: Record<
	WasteMeasurementMethod,
	{ label: string; color: NonNullable<TokenProps["color"]>; note: string }
> = {
	weighed: {
		label: "Berat Tertimbang (Fakta Terukur)",
		color: "green",
		note: "Ditimbang langsung dengan alat ukur",
	},
	estimated: {
		label: "Berat Estimasi (Perkiraan)",
		color: "orange",
		note: "Perkiraan petugas, bukan hasil timbangan",
	},
	sack_count: {
		label: "Jumlah Karung (Hitungan Fisik)",
		color: "blue",
		note: "Dihitung berdasarkan jumlah karung terkumpul",
	},
};

export function WasteMeasurementBadge({
	category,
	method,
	quantity,
	unit,
}: WasteMeasurementBadgeProps) {
	const methodInfo = METHOD_CONFIG[method];
	return (
		<HStack gap={2} vAlign="center" wrap="wrap">
			<Token
				color="gray"
				size="sm"
				icon={<Icon icon={Scale} size="xsm" />}
				label={`${CATEGORY_LABELS[category]}: ${quantity} ${unit}`}
			/>
			<Token color={methodInfo.color} size="sm" label={methodInfo.label} />
			<Text size="xsm" color="secondary">
				({methodInfo.note})
			</Text>
		</HStack>
	);
}
