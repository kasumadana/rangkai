import { describe, expect, it } from "vitest";
import app from "../../src/worker/index";

describe("GET /api/health", () => {
	it("returns 200 with deterministic process liveness payload", async () => {
		const res = await app.request("/api/health");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");

		const body = await res.json();
		expect(body).toEqual({
			status: "ok",
			service: "rangkai",
		});
	});
});
