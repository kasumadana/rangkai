import { Icon } from "@astryxdesign/core/Icon";
import { Token, type TokenProps } from "@astryxdesign/core/Token";
import {
	FileQuestion,
	PencilLine,
	Sparkles,
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
	{ label: string; color: NonNullable<TokenProps["color"]>; icon: ReactNode }
> = {
	extracted: {
		label: "Diekstrak AI (Draf)",
		color: "blue",
		icon: <Icon icon={Sparkles} size="xsm" />,
	},
	missing: {
		label: "Tidak Tercantum (Missing)",
		color: "gray",
		icon: <Icon icon={FileQuestion} size="xsm" />,
	},
	needs_review: {
		label: "Perlu Tinjauan Manual",
		color: "orange",
		icon: <Icon icon="warning" size="xsm" />,
	},
	corrected: {
		label: "Dikoreksi Panitia",
		color: "purple",
		icon: <Icon icon={PencilLine} size="xsm" />,
	},
	confirmed: {
		label: "Terkonfirmasi",
		color: "green",
		icon: <Icon icon="success" size="xsm" />,
	},
};

export function FieldReviewIndicator({ state }: FieldReviewIndicatorProps) {
	const config = STATE_CONFIG[state];
	return (
		<Token
			color={config.color}
			size="sm"
			icon={config.icon}
			label={config.label}
		/>
	);
}
