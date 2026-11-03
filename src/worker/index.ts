import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/index";

declare global {
	interface Env {
		DATABASE_URL?: string;
	}
}

const app = new Hono<{ Bindings: Env }>();

// ponytail: deterministic process liveness check, no external dependency probing
app.get("/api/health", (c) =>
	c.json({
		status: "ok",
		service: "rangkai",
	}),
);

// ponytail: workerd connection smoke check against Neon development branch without exposing secrets
app.get("/api/db-check", async (c) => {
	try {
		const db = getDb(c.env.DATABASE_URL);
		const res = await db.execute<{ setting: string }>(
			sql`SELECT setting FROM pg_settings WHERE name = 'neon.branch_id'`,
		);
		return c.json({
			status: "ok",
			branchId: res.rows[0]?.setting,
		});
	} catch (err: unknown) {
		const msg =
			err instanceof Error ? err.message : "Database connection failed";
		return c.json({ status: "error", message: msg }, 500);
	}
});

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

export default app;
