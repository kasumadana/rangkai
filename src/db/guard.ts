import * as dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

// ponytail: load .dev.vars for tooling/guards without exposing values
dotenv.config({ path: ".dev.vars" });

export const AUTHORIZED_DEV_BRANCH = "br-wandering-paper-aogdxs48";

// Centralized error message sanitizer that categorizes errors safely and suppresses connection details
export function sanitizeDatabaseError(err: unknown): string {
	if (!err) return "Unknown database error";
	let message = err instanceof Error ? err.message : String(err);

	// 1. Entire configured-value suppression: redact configured env URLs and credentials
	const envUrls = [
		typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined,
		typeof process !== "undefined" ? process.env?.DATABASE_URL_UNPOOLED : undefined,
	].filter((u): u is string => typeof u === "string" && u.trim().length > 0);

	for (const envUrl of envUrls) {
		const trimmed = envUrl.trim();
		if (trimmed.length > 0 && message.includes(trimmed)) {
			message = message.replaceAll(trimmed, "[REDACTED_DATABASE_URL]");
		}
	}

	// 2. Known safe domain error categories (preserve actionable recovery without secrets)
	if (message.includes("DATABASE_URL is not configured")) {
		return "DATABASE_URL is not configured. Please supply DATABASE_URL in .dev.vars (for local development) or set DATABASE_URL_UNPOOLED.";
	}
	if (message.includes("Unauthorized database target")) {
		return message;
	}
	if (
		message.includes("Preflight verification failed connecting to target database")
	) {
		return "Preflight verification failed connecting to target database: [REDACTED_DATABASE_URL]. Database writes are strictly forbidden.";
	}

	// 3. Raw connection strings or driver URL parse errors:
	// If the message contains connection strings or driver URL parse errors, suppress completely
	if (
		message.includes("postgres://") ||
		message.includes("postgresql://") ||
		message.includes("Invalid URL") ||
		message.includes("ECONNREFUSED") ||
		message.includes("ENOTFOUND") ||
		message.includes("fetch failed")
	) {
		return "Database connection failed: [REDACTED_DATABASE_URL]. Verify network connectivity and database configuration.";
	}

	// 4. Redact any isolated credentials or query parameters
	message = message.replace(
		/(password|secret|token|key)=([^&\s]+)/gi,
		"$1=[REDACTED]",
	);

	return message;
}

export function resolveDatabaseUrl(explicitUrl?: string): string {
	const url =
		explicitUrl !== undefined
			? explicitUrl.trim()
			: typeof process !== "undefined"
				? (process.env.DATABASE_URL_UNPOOLED?.trim() ||
					process.env.DATABASE_URL?.trim())
				: undefined;

	if (!url) {
		throw new Error(
			"DATABASE_URL is not configured. Please supply DATABASE_URL in .dev.vars (for local development) or set DATABASE_URL_UNPOOLED.",
		);
	}
	return url;
}

// ponytail: fail-closed preflight verifying authorized Neon dev branch before any mutation/migration/seed
export async function assertDevBranch(
	explicitUrl?: string,
): Promise<{ branchId: string; pinnedUrl: string }> {
	const pinnedUrl = resolveDatabaseUrl(explicitUrl);
	const sql = neon(pinnedUrl);

	let res: Record<string, unknown>[];
	try {
		res = (await sql`SELECT current_setting('neon.branch_id', true) AS branch_id`) as unknown as Record<string, unknown>[];
	} catch {
		throw new Error(
			"Preflight verification failed connecting to target database: [REDACTED_DATABASE_URL]. Database writes are strictly forbidden.",
		);
	}

	const branchId = res[0]?.branch_id;

	if (branchId !== AUTHORIZED_DEV_BRANCH) {
		throw new Error(
			`Unauthorized database target: expected Neon development branch '${AUTHORIZED_DEV_BRANCH}', but connected to '${branchId ?? "unknown"}'. Database writes are strictly forbidden.`,
		);
	}

	return { branchId: branchId as string, pinnedUrl };
}
