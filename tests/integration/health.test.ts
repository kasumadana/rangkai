import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBuilder, preview, type PreviewServer } from "vite";
import app from "../../src/worker/index";

// ponytail: minimal stdlib http helper preserving raw browser headers that global fetch overwrites
function httpRequest(
	targetUrl: string,
	options: {
		headers?: Record<string, string>;
		method?: string;
	} = {},
): Promise<{
	statusCode: number;
	contentType: string;
	body: string;
	json: <T = unknown>() => T;
}> {
	const url = new URL(targetUrl);
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: url.hostname,
				port: url.port,
				path: `${url.pathname}${url.search}`,
				method: options.method ?? "GET",
				headers: options.headers,
			},
			(res) => {
				let data = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					resolve({
						statusCode: res.statusCode ?? 0,
						contentType: res.headers["content-type"] ?? "",
						body: data,
						json: () => JSON.parse(data),
					});
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

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

	describe("transport header preservation verification", () => {
		it("transmits Sec-Fetch-Mode: navigate without client-side sanitization", async () => {
			const echoServer = http.createServer((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify(req.headers));
			});
			await new Promise<void>((resolve) =>
				echoServer.listen(0, "127.0.0.1", resolve),
			);
			const address = echoServer.address() as AddressInfo;
			const echoUrl = `http://127.0.0.1:${address.port}/`;

			try {
				const res = await httpRequest(echoUrl, {
					headers: {
						"Sec-Fetch-Mode": "navigate",
						Accept:
							"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					},
				});
				const receivedHeaders = res.json<Record<string, string>>();
				expect(receivedHeaders["sec-fetch-mode"]).toBe("navigate");
				expect(receivedHeaders["accept"]).toContain("text/html");
			} finally {
				await new Promise<void>((resolve) =>
					echoServer.close(() => resolve()),
				);
			}
		});
	});

	describe("workerd asset routing integration (preview server)", () => {
		let server: PreviewServer;
		let baseUrl: string;

		beforeAll(async () => {
			// Enforce fresh build of both worker and client environments before preview
			const builder = await createBuilder();
			await builder.buildApp();
			server = await preview({ preview: { port: 0 } });
			const localUrl = server.resolvedUrls?.local[0];
			if (!localUrl) {
				throw new Error("Preview server did not expose a local URL");
			}
			baseUrl = localUrl;
		});

		afterAll(async () => {
			await server?.close();
		});

		it("returns JSON for ordinary GET request", async () => {
			const res = await httpRequest(`${baseUrl}api/health`);
			expect(res.statusCode).toBe(200);
			expect(res.contentType).toContain("application/json");

			const body = res.json();
			expect(body).toEqual({
				status: "ok",
				service: "rangkai",
			});
		});

		it("returns JSON for browser navigation GET request (Sec-Fetch-Mode: navigate)", async () => {
			const res = await httpRequest(`${baseUrl}api/health`, {
				headers: {
					"Sec-Fetch-Mode": "navigate",
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});
			expect(res.statusCode).toBe(200);
			expect(res.contentType).toContain("application/json");

			const body = res.json();
			expect(body).toEqual({
				status: "ok",
				service: "rangkai",
			});
		});

		it("preserves SPA HTML fallback for frontend root navigation route", async () => {
			const res = await httpRequest(`${baseUrl}`, {
				headers: {
					"Sec-Fetch-Mode": "navigate",
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});
			expect(res.statusCode).toBe(200);
			expect(res.contentType).toContain("text/html");
			expect(res.body).toContain("<!doctype html>");
		});

		it("preserves SPA HTML fallback for client deep-link navigation routes", async () => {
			const res = await httpRequest(`${baseUrl}dashboard`, {
				headers: {
					"Sec-Fetch-Mode": "navigate",
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});
			expect(res.statusCode).toBe(200);
			expect(res.contentType).toContain("text/html");
			expect(res.body).toContain("<!doctype html>");
		});

		it("preserves legacy API response at /api/", async () => {
			const res = await httpRequest(`${baseUrl}api/`);
			expect(res.statusCode).toBe(200);
			expect(res.contentType).toContain("application/json");
			expect(res.json()).toEqual({ name: "Cloudflare" });
		});

		it("confirms database connectivity under workerd runtime via /api/db-check", async () => {
			const res = await httpRequest(`${baseUrl}api/db-check`);
			expect(res.statusCode).toBe(200);
			expect(res.contentType).toContain("application/json");
			expect(res.json()).toEqual({
				status: "ok",
				branchId: "br-wandering-paper-aogdxs48",
			});
		});
	});
});
