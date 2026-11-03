import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as authSchema from "./auth-schema";
import * as domainSchema from "./schema";

export const schema = {
	...authSchema,
	...domainSchema,
};

export type AppSchema = typeof schema;

// ponytail: stateless Neon HTTP client without persistent TCP overhead, suitable for Cloudflare Workers
// Note: Neon HTTP driver supports atomic multi-statement operations via db.batch()
export function getDb(databaseUrl?: string) {
	const url =
		databaseUrl !== undefined
			? databaseUrl.trim()
			: typeof process !== "undefined"
				? process.env?.DATABASE_URL?.trim()
				: undefined;

	if (!url) {
		throw new Error(
			"DATABASE_URL is not configured. Please supply DATABASE_URL in .dev.vars (for local development) or Cloudflare Worker secrets (for production).",
		);
	}
	const sql = neon(url);
	return drizzle(sql, { schema });
}

export type DbClient = ReturnType<typeof getDb>;
