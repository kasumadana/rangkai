import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as dotenv from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBuilder, preview, type PreviewServer } from "vite";
import { hashPassword } from "better-auth/crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db/index";
import { account, session, user } from "../../src/db/auth-schema";
import {
	auditLogs,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
} from "../../src/db/schema";
import app from "../../src/worker/index";

// ponytail: minimal stdlib http helper preserving raw browser headers that global fetch overwrites
function httpRequest(
	targetUrl: string,
	options: {
		headers?: Record<string, string>;
		method?: string;
		body?: string;
	} = {},
): Promise<{
	statusCode: number;
	contentType: string;
	headers: http.IncomingHttpHeaders;
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
						contentType: (res.headers["content-type"] as string) ?? "",
						headers: res.headers,
						body: data,
						json: () => (data ? JSON.parse(data) : {}),
					});
				});
			},
		);
		req.on("error", reject);
		if (options.body) {
			req.write(options.body);
		}
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
		}, 60000);

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

		describe("workerd runtime auth, session cookies, CSRF, and concurrent publication", () => {
			const runKey = crypto.randomUUID().slice(0, 8);
			const testPassword = "WorkerdPassword123!";
			let db: DbClient;
			let fixtureOrgId: string;
			let fixtureUserId: string;
			let sessionCookie = "";
			let verifiedSegmentId: string;

			beforeAll(async () => {
				dotenv.config({ path: ".dev.vars" });
				const { pinnedUrl } = await assertDevBranch();
				db = getDb(pinnedUrl);

				fixtureOrgId = crypto.randomUUID();
				fixtureUserId = `usr_workerd_${runKey}`;
				const fixtureAccountId = `acc_workerd_${runKey}`;

				await db.insert(organizations).values({
					id: fixtureOrgId,
					name: `Workerd Org (${runKey})`,
					village: "Desa Workerd",
					district: "Kecamatan Workerd",
				});

				await db.insert(user).values({
					id: fixtureUserId,
					name: `Workerd User ${runKey}`,
					email: `workerd.${runKey}@test.local`,
					emailVerified: true,
				});

				const hashedPass = await hashPassword(testPassword);
				await db.insert(account).values({
					id: fixtureAccountId,
					accountId: fixtureUserId,
					providerId: "credential",
					userId: fixtureUserId,
					password: hashedPass,
				});

				await db.insert(memberships).values({
					organizationId: fixtureOrgId,
					userId: fixtureUserId,
					role: "organizer",
				});

				const segRows = await db
					.insert(roadSegments)
					.values({
						id: crypto.randomUUID(),
						displayName: `Workerd Segment ${runKey}`,
						geom: sql`ST_GeomFromEWKT('SRID=4326;LINESTRING(115.2166 -8.6500, 115.2170 -8.6510)')`,
						coverageArea: "Area Workerd",
						verifiedBy: fixtureUserId,
						verifiedAt: new Date(),
					})
					.returning();
				verifiedSegmentId = segRows[0].id;
			});

			afterAll(async () => {
				if (!db) return;
				// Clean up fixtures
				await db.delete(roadImpacts).where(eq(roadImpacts.roadSegmentId, verifiedSegmentId));
				await db.delete(roadSegments).where(eq(roadSegments.id, verifiedSegmentId));
				await db.delete(auditLogs).where(eq(auditLogs.organizationId, fixtureOrgId));
				await db.delete(events).where(eq(events.organizationId, fixtureOrgId));
				await db.delete(memberships).where(eq(memberships.organizationId, fixtureOrgId));
				await db.delete(session).where(eq(session.userId, fixtureUserId));
				await db.delete(account).where(eq(account.userId, fixtureUserId));
				await db.delete(user).where(eq(user.id, fixtureUserId));
				await db.delete(organizations).where(eq(organizations.id, fixtureOrgId));
			});

			it("authenticates via workerd, delivering rangkai.session_token with HttpOnly attribute", async () => {
				const origin = baseUrl.replace(/\/$/, "");
				const res = await httpRequest(`${baseUrl}api/auth/sign-in/email`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: origin,
					},
					body: JSON.stringify({
						email: `workerd.${runKey}@test.local`,
						password: testPassword,
					}),
				});

				expect(res.statusCode).toBe(200);
				const setCookie = res.headers["set-cookie"]?.[0] || "";
				expect(setCookie).toContain("rangkai.session_token");
				expect(setCookie.toLowerCase()).toContain("httponly");
				sessionCookie = setCookie.split(";")[0];
			});

			it("rejects cross-origin mutation in workerd (403 Forbidden)", async () => {
				const res = await httpRequest(`${baseUrl}api/events`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: sessionCookie,
						Origin: "http://attacker-cross-origin.local",
					},
					body: JSON.stringify({
						organizationId: fixtureOrgId,
						title: "CSRF Event",
					}),
				});

				expect(res.statusCode).toBe(403);
				const body = res.json<{ error: { code: string; message: string } }>();
				expect(body.error.code).toBe("FORBIDDEN");
			});

			it("executes real concurrent publication in workerd converging to 1 slug and exactly 1 audit row", async () => {
				const origin = baseUrl.replace(/\/$/, "");
				const eventRows = await db
					.insert(events)
					.values({
						organizationId: fixtureOrgId,
						createdBy: fixtureUserId,
						title: `Workerd Concurrent Event ${runKey}`,
						venueName: "Balai Banjar Workerd",
						startsAt: new Date("2026-11-28T08:00:00Z"),
						endsAt: new Date("2026-11-28T14:00:00Z"),
						status: "review",
						verifiedBy: fixtureUserId,
						verifiedAt: new Date(),
					})
					.returning();
				const workerdEventId = eventRows[0].id;

				await db.insert(roadImpacts).values({
					eventId: workerdEventId,
					roadSegmentId: verifiedSegmentId,
					plannedFrom: new Date("2026-11-28T08:00:00Z"),
					plannedTo: new Date("2026-11-28T14:00:00Z"),
					impactType: "closure",
					diversionNote: "Pengalihan workerd concurrent",
				});

				const [res1, res2] = await Promise.all([
					httpRequest(`${baseUrl}api/events/${workerdEventId}/publish`, {
						method: "POST",
						headers: { Cookie: sessionCookie, Origin: origin },
					}),
					httpRequest(`${baseUrl}api/events/${workerdEventId}/publish`, {
						method: "POST",
						headers: { Cookie: sessionCookie, Origin: origin },
					}),
				]);

				expect(res1.statusCode).toBe(200);
				expect(res2.statusCode).toBe(200);

				const body1 = res1.json<{ event: { status: string; publicSlug: string } }>();
				const body2 = res2.json<{ event: { status: string; publicSlug: string } }>();

				expect(body1.event.status).toBe("published");
				expect(body2.event.status).toBe("published");
				expect(body1.event.publicSlug).toBe(body2.event.publicSlug);

				// Assert exactly 1 publication audit log row was committed to Neon!
				const audits = await db
					.select()
					.from(auditLogs)
					.where(
						and(
							eq(auditLogs.eventId, workerdEventId),
							eq(auditLogs.action, "event.published"),
						),
					);
				expect(audits.length).toBe(1);
				expect((audits[0].afterJson as { publicSlug: string }).publicSlug).toBe(body1.event.publicSlug);
			});

			it("revokes session via workerd sign-out, denying subsequent protected requests (401)", async () => {
				const origin = baseUrl.replace(/\/$/, "");
				const resSignOut = await httpRequest(`${baseUrl}api/auth/sign-out`, {
					method: "POST",
					headers: {
						Cookie: sessionCookie,
						"Content-Type": "application/json",
						Origin: origin,
					},
					body: "{}",
				});
				expect(resSignOut.statusCode).toBe(200);

				// Subsequent request with the same cookie must be 401
				const resProtected = await httpRequest(`${baseUrl}api/events`, {
					headers: { Cookie: sessionCookie },
				});
				expect(resProtected.statusCode).toBe(401);
			});
		});
	});
});
