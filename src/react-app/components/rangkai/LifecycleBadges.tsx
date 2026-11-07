import { Token, type TokenProps } from "@astryxdesign/core/Token";
import type { EventLifecycleStatus } from "../../lib/api-client";

/**
 * Event lifecycle indicator per AGENTS.md §13:
 * DRAFT -> REVIEW -> PUBLISHED -> ACTIVE -> COMPLETED (plus CANCELLED / ARCHIVED)
 */
const EVENT_STATUS_MAP: Record<
	EventLifecycleStatus,
	{
		label: string;
		color: NonNullable<TokenProps["color"]>;
	}
> = {
	draft: {
		label: "DRAF (DRAFT)",
		color: "gray",
	},
	review: {
		label: "TINJAUAN TERVERIFIKASI (REVIEW)",
		color: "blue",
	},
	published: {
		label: "DIPUBLIKASIKAN (PUBLISHED)",
		color: "teal",
	},
	active: {
		label: "BERLANGSUNG (ACTIVE)",
		color: "green",
	},
	completed: {
		label: "SELESAI (COMPLETED)",
		color: "blue",
	},
	cancelled: {
		label: "DIBATALKAN (CANCELLED)",
		color: "red",
	},
	archived: {
		label: "DIARSIPKAN (ARCHIVED)",
		color: "gray",
	},
};

export function EventLifecycleBadge({
	status,
}: {
	status: EventLifecycleStatus;
}) {
	const config = EVENT_STATUS_MAP[status] ?? EVENT_STATUS_MAP.draft;
	return <Token color={config.color} size="sm" label={config.label} />;
}

/**
 * Cleanup task states per AGENTS.md §13:
 * TODO | IN_PROGRESS | SUBMITTED | VERIFIED | REOPENED
 */
export type CleanupTaskStatus =
	| "todo"
	| "in_progress"
	| "submitted"
	| "verified"
	| "reopened";

const CLEANUP_STATUS_MAP: Record<
	CleanupTaskStatus,
	{ label: string; color: NonNullable<TokenProps["color"]> }
> = {
	todo: {
		label: "BELUM DIMULAI (TODO)",
		color: "gray",
	},
	in_progress: {
		label: "SEDANG DIKERJAKAN (IN_PROGRESS)",
		color: "blue",
	},
	submitted: {
		label: "MENUNGGU VERIFIKASI (SUBMITTED)",
		color: "orange",
	},
	verified: {
		label: "TERVERIFIKASI BERSIH (VERIFIED)",
		color: "green",
	},
	reopened: {
		label: "DIBUKA KEMBALI (REOPENED)",
		color: "red",
	},
};

export function CleanupStatusBadge({ status }: { status: CleanupTaskStatus }) {
	const config = CLEANUP_STATUS_MAP[status] ?? CLEANUP_STATUS_MAP.todo;
	return <Token color={config.color} size="sm" label={config.label} />;
}
