import type { MiddlewareHandler } from "hono";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";

interface RateLimitOptions {
	windowMs: number;
	max: number;
	keyPrefix?: string;
}

interface RateLimitRecord {
	count: number;
	resetAt: number;
}

// In-memory sliding window store (Workers isolates share state across requests in the same isolate)
const store = new Map<string, RateLimitRecord>();

// Clean expired records periodically
function cleanupExpired(now: number) {
	if (store.size > 1000) {
		for (const [key, record] of store.entries()) {
			if (now > record.resetAt) {
				store.delete(key);
			}
		}
	}
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler<{
	Bindings: Env;
	Variables: AppVariables;
}> {
	const { windowMs, max, keyPrefix = "rl" } = options;

	return async (c, next) => {
		// In test environments, disable throttling unless explicitly testing it
		if (process.env.NODE_ENV === "test" && !c.req.header("x-test-rate-limit")) {
			return next();
		}

		const ip =
			c.req.header("cf-connecting-ip") ||
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
			"unknown-ip";

		const key = `${keyPrefix}:${ip}`;
		const now = Date.now();
		cleanupExpired(now);

		const record = store.get(key);

		if (!record || now > record.resetAt) {
			store.set(key, {
				count: 1,
				resetAt: now + windowMs,
			});
			c.header("X-RateLimit-Limit", max.toString());
			c.header("X-RateLimit-Remaining", (max - 1).toString());
			c.header("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000).toString());
			return next();
		}

		if (record.count >= max) {
			const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
			c.header("Retry-After", retryAfterSeconds.toString());
			c.header("X-RateLimit-Limit", max.toString());
			c.header("X-RateLimit-Remaining", "0");
			c.header("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000).toString());
			return sendError(
				c,
				"TOO_MANY_REQUESTS",
				"Terlalu banyak permintaan. Silakan tunggu beberapa saat sebelum mencoba kembali.",
				429,
			);
		}

		record.count += 1;
		c.header("X-RateLimit-Limit", max.toString());
		c.header("X-RateLimit-Remaining", (max - record.count).toString());
		c.header("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000).toString());

		return next();
	};
}
