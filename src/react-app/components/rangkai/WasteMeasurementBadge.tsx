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
	{ label: string; color: string; note: string }
> = {
	weighed: {
		label: "Berat Tertimbang (Fakta Terukur)",
		color: "bg-green-50 text-green-900",
		note: "Ditimbang langsung dengan alat ukur",
	},
	estimated: {
		label: "Berat Estimasi (Perkiraan)",
		color: "bg-orange-50 text-orange-900",
		note: "Perkiraan petugas, bukan hasil timbangan",
	},
	sack_count: {
		label: "Jumlah Karung (Hitungan Fisik)",
		color: "bg-blue-50 text-blue-900",
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
		<span className="inline-flex flex-wrap items-center gap-2">
			<span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-800"><Scale size={14} aria-hidden="true" />{CATEGORY_LABELS[category]}: {quantity} {unit}</span>
			<span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${methodInfo.color}`}>{methodInfo.label}</span>
			<small>({methodInfo.note})</small>
		</span>
	);
}
