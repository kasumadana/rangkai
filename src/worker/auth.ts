import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DbClient } from "../db/index";
import { account, session, user, verification } from "../db/auth-schema";
import type { Env } from "./types";

export class AuthConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthConfigError";
	}
}

export function validateAuthConfig(env?: Env): {
	secret: string;
	baseURL: string;
	isProduction: boolean;
} {
	const isProduction =
		typeof process !== "undefined" && process.env?.NODE_ENV === "production";

	const secret =
		env && "BETTER_AUTH_SECRET" in env
			? env.BETTER_AUTH_SECRET
			: typeof process !== "undefined"
				? process.env?.BETTER_AUTH_SECRET
				: undefined;

	if (!secret || typeof secret !== "string" || secret.trim().length < 32) {
		throw new AuthConfigError(
			"Authentication secret (BETTER_AUTH_SECRET) is missing or has insufficient entropy (min 32 characters required).",
		);
	}

	const rawBaseURL =
		env && "BETTER_AUTH_URL" in env
			? env.BETTER_AUTH_URL
			: typeof process !== "undefined"
				? process.env?.BETTER_AUTH_URL
				: undefined;

	if (!rawBaseURL || typeof rawBaseURL !== "string" || rawBaseURL.trim().length === 0) {
		throw new AuthConfigError(
			"Authentication base URL (BETTER_AUTH_URL) is not configured.",
		);
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(rawBaseURL.trim());
	} catch {
		throw new AuthConfigError("Authentication base URL (BETTER_AUTH_URL) is invalid.");
	}

	if (isProduction) {
		if (parsedUrl.protocol !== "https:") {
			throw new AuthConfigError(
				"HTTPS is strictly required for BETTER_AUTH_URL in production environment.",
			);
		}
	} else {
		// In development/testing, explicitly allow loopback HTTP or HTTPS
		const isLoopback =
			parsedUrl.hostname === "localhost" ||
			parsedUrl.hostname === "127.0.0.1" ||
			parsedUrl.hostname === "::1" ||
			parsedUrl.protocol === "https:";
		if (!isLoopback) {
			throw new AuthConfigError(
				"In development, BETTER_AUTH_URL must be a loopback address (localhost/127.0.0.1) or HTTPS.",
			);
		}
	}

	return {
		secret: secret.trim(),
		baseURL: parsedUrl.origin,
		isProduction,
	};
}

export function createAuth(db: DbClient, env?: Env) {
	const { secret, baseURL, isProduction } = validateAuthConfig(env);

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
		advanced: {
			useSecureCookies: isProduction || baseURL.startsWith("https://"),
		},
	});
}

export type AuthInstance = ReturnType<typeof createAuth>;
