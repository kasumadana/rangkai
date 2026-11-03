import * as dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

// ponytail: load .dev.vars for tooling/guards without exposing values
dotenv.config({ path: ".dev.vars" });

export const AUTHORIZED_DEV_BRANCH = "br-wandering-paper-aogdxs48";

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
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Preflight verification failed connecting to target database: ${msg}. Database writes are strictly forbidden.`,
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
