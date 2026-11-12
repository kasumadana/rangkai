import type { EventLifecycleStatus } from "../../lib/api-client";

type StatusColor = "gray" | "blue" | "teal" | "green" | "red" | "orange";
const STATUS_COLOR_CLASSES: Record<StatusColor, string> = {
	gray: "bg-stone-100 text-stone-800",
	blue: "bg-blue-50 text-blue-900",
	teal: "bg-teal-50 text-teal-900",
	green: "bg-green-50 text-green-900",
	red: "bg-red-50 text-red-900",
	orange: "bg-orange-50 text-orange-900",
};

function StatusLabel({ color, label }: { color: StatusColor; label: string }) {
	return <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLOR_CLASSES[color]}`}>{label}</span>;
}

/**
 * Event lifecycle indicator per AGENTS.md §13:
 * DRAFT -> REVIEW -> PUBLISHED -> ACTIVE -> COMPLETED (plus CANCELLED / ARCHIVED)
 */
const EVENT_STATUS_MAP: Record<
	EventLifecycleStatus,
	{
		label: string;
		color: StatusColor;
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
	return <StatusLabel color={config.color} label={config.label} />;
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
	{ label: string; color: StatusColor }
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
	return <StatusLabel color={config.color} label={config.label} />;
}
