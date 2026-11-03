import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview, type PreviewServer } from "vite";
import app from "../../src/worker/index";

describe("GET /api/health", () => {
	it("returns 200 with deterministic process liveness payload (Hono app)", async () => {
		const res = await app.request("/api/health");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");

		const body = await res.json();
		expect(body).toEqual({
			status: "ok",
			service: "rangkai",
		});
	});

	describe("workerd asset routing integration (preview server)", () => {
		let server: PreviewServer;
		let baseUrl: string;

		beforeAll(async () => {
			if (!fs.existsSync("./dist/client/index.html")) {
				await build();
			}
			server = await preview({ preview: { port: 0 } });
			baseUrl = server.resolvedUrls.local[0];
		});

		afterAll(async () => {
			await server?.close();
		});

		it("returns JSON for ordinary GET request", async () => {
			const res = await fetch(new URL("/api/health", baseUrl));
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("application/json");

			const body = await res.json();
			expect(body).toEqual({
				status: "ok",
				service: "rangkai",
			});
		});

		it("returns JSON for browser navigation GET request (Sec-Fetch-Mode: navigate)", async () => {
			const res = await fetch(new URL("/api/health", baseUrl), {
				headers: {
					"Sec-Fetch-Mode": "navigate",
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("application/json");

			const body = await res.json();
			expect(body).toEqual({
				status: "ok",
				service: "rangkai",
			});
		});

		it("preserves SPA HTML fallback for frontend navigation routes", async () => {
			const res = await fetch(new URL("/", baseUrl), {
				headers: {
					"Sec-Fetch-Mode": "navigate",
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/html");
			const html = await res.text();
			expect(html).toContain("<!doctype html>");
		});
	});
});
