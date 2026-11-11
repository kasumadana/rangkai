import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../../src/worker/middleware/rate-limit";

describe("authentication rate limit trust boundary", () => {
	it("does not let forwarded addresses bypass the unknown-address bucket", async () => {
		const app = new Hono();
		app.use("*", rateLimit({ windowMs: 60_000, max: 1, keyPrefix: crypto.randomUUID() }));
		app.get("/", (c) => c.text("ok"));
		const request = (address: string) => app.request("/", {
			headers: { "x-test-rate-limit": "1", "x-forwarded-for": address },
		});
		expect((await request("192.0.2.1")).status).toBe(200);
		expect((await request("192.0.2.2")).status).toBe(429);
	});
});
