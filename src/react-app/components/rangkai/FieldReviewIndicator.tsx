import {
	AlertTriangle,
	CheckCircle2,
	FileQuestion,
	PencilLine,
	FileText,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * AI Extraction Field Review Indicators per docs/07-UX-FLOW.md §3.E:
 * - Extracted: Candidate value extracted by Gemini, awaiting human verification.
 * - Missing: Field not present in the source document (must remain unknown, never invented).
 * - Needs review: Ambiguous or low-clarity value requiring organizer judgment.
 * - Corrected: Manually edited by the organizer from the initial extraction.
 * - Confirmed: Explicitly verified by the organizer for publication.
 */
export type FieldReviewState =
	| "extracted"
	| "missing"
	| "needs_review"
	| "corrected"
	| "confirmed";

export interface FieldReviewIndicatorProps {
	state: FieldReviewState;
}

const STATE_CONFIG: Record<
	FieldReviewState,
	{ label: string; color: string; icon: ReactNode }
> = {
	extracted: {
		label: "Diekstrak AI (Draf)",
		color: "bg-blue-50 text-blue-900",
		icon: <FileText size={14} aria-hidden="true" />,
	},
	missing: {
		label: "Tidak Tercantum",
		color: "bg-stone-100 text-stone-800",
		icon: <FileQuestion size={14} aria-hidden="true" />,
	},
	needs_review: {
		label: "Perlu Tinjauan Manual",
		color: "bg-orange-50 text-orange-900",
		icon: <AlertTriangle size={14} aria-hidden="true" />,
	},
	corrected: {
		label: "Dikoreksi Panitia",
		color: "bg-purple-50 text-purple-900",
		icon: <PencilLine size={14} aria-hidden="true" />,
	},
	confirmed: {
		label: "Terkonfirmasi",
		color: "bg-green-50 text-green-900",
		icon: <CheckCircle2 size={14} aria-hidden="true" />,
	},
};

export function FieldReviewIndicator({ state }: FieldReviewIndicatorProps) {
	const config = STATE_CONFIG[state];
	return <span className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-base font-semibold ${config.color}`}>{config.icon}{config.label}</span>;
}
