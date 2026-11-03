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
			"Authentication service is unavailable.",
			503,
		);
	}

	try {
		const session = await auth.api.getSession({
			headers: c.req.raw.headers,
		});

		if (!session || !session.user) {
			return sendError(
				c,
				"UNAUTHORIZED",
				"Authentication required.",
				401,
			);
		}

		c.set("user", session.user);
		c.set("session", session.session);
		await next();
	} catch {
		return sendError(
			c,
			"UNAUTHORIZED",
			"Invalid or expired session.",
			401,
		);
	}
};
