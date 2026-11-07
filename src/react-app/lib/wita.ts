/**
 * Timezone and timestamp utilities for Rangkai (SRS FR-016, NFR-014, NFR-015).
 *
 * Rules:
 * - Database and API store timestamps in UTC (ISO 8601).
 * - UI always displays local time in Asia/Makassar (WITA, UTC+08:00).
 * - Expired road status updates must be surfaced as unconfirmed (FR-037).
 */

export const WITA_TIMEZONE = "Asia/Makassar" as const;
export const WITA_LABEL = "WITA" as const;

const witaDateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
	timeZone: WITA_TIMEZONE,
	day: "2-digit",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const witaDateFormatter = new Intl.DateTimeFormat("id-ID", {
	timeZone: WITA_TIMEZONE,
	weekday: "short",
	day: "2-digit",
	month: "short",
	year: "numeric",
});

const witaTimeFormatter = new Intl.DateTimeFormat("id-ID", {
	timeZone: WITA_TIMEZONE,
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

export function parseDate(input: string | number | Date | null | undefined): Date | null {
	if (input === null || input === undefined || input === "") {
		return null;
	}
	const date = input instanceof Date ? input : new Date(input);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats an ISO/UTC timestamp into `DD MMM YYYY, HH.mm WITA`.
 */
export function formatWitaDateTime(
	input: string | number | Date | null | undefined,
): string {
	const date = parseDate(input);
	if (!date) {
		return "Waktu belum tercatat";
	}
	return `${witaDateTimeFormatter.format(date)} ${WITA_LABEL}`;
}

/**
 * Formats an ISO/UTC timestamp into `Rab, DD MMM YYYY`.
 */
export function formatWitaDate(
	input: string | number | Date | null | undefined,
): string {
	const date = parseDate(input);
	if (!date) {
		return "Tanggal belum ditentukan";
	}
	return witaDateFormatter.format(date);
}

/**
 * Formats an ISO/UTC timestamp into `HH.mm WITA`.
 */
export function formatWitaTime(
	input: string | number | Date | null | undefined,
): string {
	const date = parseDate(input);
	if (!date) {
		return "--:-- WITA";
	}
	return `${witaTimeFormatter.format(date)} ${WITA_LABEL}`;
}

/**
 * Formats an event or road impact window in WITA.
 */
export function formatWitaRange(
	startsAt: string | number | Date | null | undefined,
	endsAt: string | number | Date | null | undefined,
): string {
	const start = parseDate(startsAt);
	const end = parseDate(endsAt);
	if (!start && !end) {
		return "Jadwal belum ditentukan";
	}
	if (start && !end) {
		return `Mulai ${formatWitaDateTime(start)}`;
	}
	if (!start && end) {
		return `Sampai ${formatWitaDateTime(end)}`;
	}
	const startDateStr = witaDateFormatter.format(start!);
	const endDateStr = witaDateFormatter.format(end!);
	if (startDateStr === endDateStr) {
		return `${startDateStr}, ${witaTimeFormatter.format(start!)}–${witaTimeFormatter.format(end!)} ${WITA_LABEL}`;
	}
	return `${formatWitaDateTime(start)} – ${formatWitaDateTime(end)}`;
}

/**
 * Checks whether a status expiry timestamp has passed relative to `now` (FR-036, FR-037).
 */
export function isTimestampExpired(
	expiresAt: string | number | Date | null | undefined,
	now: Date = new Date(),
): boolean {
	const expiry = parseDate(expiresAt);
	if (!expiry) {
		return false;
	}
	return expiry.getTime() <= now.getTime();
}

/**
 * Human-readable relative elapsed description in Bahasa Indonesia.
 */
export function formatRelativeAgeId(
	input: string | number | Date | null | undefined,
	now: Date = new Date(),
): string {
	const date = parseDate(input);
	if (!date) {
		return "belum pernah diperbarui";
	}
	const diffSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
	if (diffSeconds < 45) {
		return "baru saja";
	}
	const diffMinutes = Math.round(diffSeconds / 60);
	if (diffMinutes < 60) {
		return `${diffMinutes} menit lalu`;
	}
	const diffHours = Math.round(diffMinutes / 60);
	if (diffHours < 24) {
		return `${diffHours} jam lalu`;
	}
	const diffDays = Math.round(diffHours / 24);
	return `${diffDays} hari lalu`;
}
