import * as dotenv from "dotenv";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { assertDevBranch } from "./guard";
import { getDb } from "./index";

// ponytail: fail-closed branch preflight assertion before running any database migrations
dotenv.config({ path: ".dev.vars" });

export async function runMigrations(customUrl?: string) {
	// Preflight guard: fail-closed if not targeting the authorized Neon development branch
	const { branchId, pinnedUrl } = await assertDevBranch(customUrl);
	// Pin connection strictly to verified endpoint (unpooled)
	const unpooledUrl = pinnedUrl.replace("-pooler.", ".");
	const db = getDb(unpooledUrl);

	await migrate(db, { migrationsFolder: "./drizzle" });

	return { branchId, pinnedUrl: unpooledUrl };
}

// CLI runner for `pnpm db:migrate`
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
	runMigrations()
		.then(({ branchId }) => {
			console.log(
				`[✓] Migrations applied successfully to Neon branch '${branchId}'`,
			);
		})
		.catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("[✗] Migration failed:", msg);
			process.exit(1);
		});
}
