import type { MiddlewareHandler } from "hono";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";

export const requireAuth: MiddlewareHandler<{
	Bindings: Env;
	Variables: AppVariables;
}> = async (c, next) => {
	const auth = c.get("auth");
	if (!auth) {
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Authentication service is unavailable due to missing or invalid server configuration.",
			503,
		);
	}

	let sessionResult: Awaited<ReturnType<typeof auth.api.getSession>>;
	try {
		sessionResult = await auth.api.getSession({
			headers: c.req.raw.headers,
		});
	} catch {
		// Upstream database or authentication service failure must return 503 DEPENDENCY_UNAVAILABLE
		// rather than misclassifying infrastructure outages as invalid sessions (401).
		return sendError(
			c,
			"DEPENDENCY_UNAVAILABLE",
			"Authentication dependency service is temporarily unavailable.",
			503,
		);
	}

	if (!sessionResult || !sessionResult.user) {
		return sendError(
			c,
			"UNAUTHORIZED",
			"Authentication required.",
			401,
		);
	}

	c.set("user", sessionResult.user);
	c.set("session", sessionResult.session);
	await next();
};
