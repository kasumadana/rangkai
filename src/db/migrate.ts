import * as dotenv from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { assertDevBranch, sanitizeDatabaseError } from "./guard";

// ponytail: fail-closed branch preflight assertion and transactional migration runner
dotenv.config({ path: ".dev.vars" });

if (typeof WebSocket !== "undefined") {
	neonConfig.webSocketConstructor = WebSocket;
}

export async function runMigrations(
	customUrl?: string,
	options?: { migrationsFolder?: string; migrationsSchema?: string },
) {
	// Preflight guard: fail-closed if not targeting the authorized Neon development branch
	const { branchId, pinnedUrl } = await assertDevBranch(customUrl);
	// Pin connection strictly to verified endpoint (unpooled)
	const unpooledUrl = pinnedUrl.replace("-pooler.", ".");

	const pool = new Pool({ connectionString: unpooledUrl });
	const db = drizzle(pool);

	try {
		await migrate(db, {
			migrationsFolder: options?.migrationsFolder ?? "./drizzle",
			migrationsSchema: options?.migrationsSchema,
		});
		return { branchId, pinnedUrl: unpooledUrl };
	} catch (err: unknown) {
		throw new Error(
			`Migration execution failed: ${sanitizeDatabaseError(err)}`,
		);
	} finally {
		await pool.end();
	}
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
			const msg = sanitizeDatabaseError(err);
			console.error("[✗] Migration failed:", msg);
			process.exit(1);
		});
}
