import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DbClient } from "../db/index";
import { account, session, user, verification } from "../db/auth-schema";
import type { Env } from "./types";

export function createAuth(db: DbClient, env?: Env) {
	const secret =
		env?.BETTER_AUTH_SECRET ||
		(typeof process !== "undefined" ? process.env?.BETTER_AUTH_SECRET : undefined) ||
		"development-secret-for-rangkai-testing-min-32-chars-long";

	const baseURL =
		env?.BETTER_AUTH_URL ||
		(typeof process !== "undefined" ? process.env?.BETTER_AUTH_URL : undefined) ||
		"http://localhost:5173";

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: { user, session, account, verification },
		}),
		baseURL,
		basePath: "/api/auth",
		secret,
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
		},
	});
}

export type AuthInstance = ReturnType<typeof createAuth>;
