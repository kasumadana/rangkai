import type { MiddlewareHandler } from "hono";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UNSAFE_CONTENT_TYPES = [
	"application/x-www-form-urlencoded",
	"multipart/form-data",
	"text/plain",
];

export const csrfAndOriginProtection: MiddlewareHandler<{
	Bindings: Env;
	Variables: AppVariables;
}> = async (c, next) => {
	// Safe HTTP methods (GET, HEAD, OPTIONS) do not mutate state
	if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
		return next();
	}

	const originHeader = c.req.header("origin");
	const secFetchSite = c.req.header("sec-fetch-site")?.toLowerCase();
	const contentType = c.req.header("content-type")?.toLowerCase() || "";

	// Resolve trusted origin: canonical configured origin from BETTER_AUTH_URL or request URL origin
	const requestUrl = new URL(c.req.url);
	const trustedOrigin = requestUrl.origin;
	const configuredBaseUrl =
		c.env?.BETTER_AUTH_URL ||
		(typeof process !== "undefined" ? process.env?.BETTER_AUTH_URL : undefined);
	let configuredOrigin: string | null = null;
	if (configuredBaseUrl) {
		try {
			configuredOrigin = new URL(configuredBaseUrl).origin;
		} catch {
			// Handled by auth config validator
		}
	}

	// 1. Origin header verification: if Origin is present, it MUST match trusted server origin
	if (originHeader) {
		const isTrusted =
			originHeader === trustedOrigin ||
			(configuredOrigin !== null && originHeader === configuredOrigin);

		if (!isTrusted) {
			return sendError(
				c,
				"FORBIDDEN",
				"Untrusted request origin. Mutation rejected for security.",
				403,
			);
		}
	}

	// 2. Sec-Fetch-Site verification: reject cross-site requests
	if (secFetchSite === "cross-site") {
		return sendError(
			c,
			"FORBIDDEN",
			"Cross-site mutation request rejected.",
			403,
		);
	}

	// 3. Content-Type enforcement for application APIs: reject form-compatible / simple request types
	// that browsers permit without CORS preflights (e.g. text/plain, urlencoded, multipart)
	for (const unsafeType of UNSAFE_CONTENT_TYPES) {
		if (contentType.startsWith(unsafeType)) {
			return sendError(
				c,
				"BAD_REQUEST",
				`Unsupported Content-Type: ${unsafeType}. Application API mutations require application/json.`,
				400,
			);
		}
	}

	await next();
};
