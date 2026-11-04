import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import * as dotenv from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
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
	roadStatusUpdates,
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
			let publishedSlug = "";

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
				const impRows = await db.select({ id: roadImpacts.id }).from(roadImpacts).where(eq(roadImpacts.roadSegmentId, verifiedSegmentId));
				if (impRows.length > 0) {
					await db.delete(roadStatusUpdates).where(inArray(roadStatusUpdates.roadImpactId, impRows.map((i) => i.id)));
					await db.delete(roadImpacts).where(eq(roadImpacts.roadSegmentId, verifiedSegmentId));
				}
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
				publishedSlug = body1.event.publicSlug;

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

			it("executes workerd runtime road status updates and anonymous public queries", async () => {
				const origin = baseUrl.replace(/\/$/, "");

				// 1. Query road segments catalog via workerd
				const catRes = await httpRequest(
					`${baseUrl}api/road-segments?bbox=115.2,-8.7,115.3,-8.6`,
					{ headers: { Cookie: sessionCookie } },
				);
				expect(catRes.statusCode).toBe(200);
				const catBody = catRes.json<{ segments: Array<{ id: string }> }>();
				expect(catBody.segments.length).toBeGreaterThanOrEqual(1);

				// 2. Query published event road impacts
				const impacts = await db
					.select({ id: roadImpacts.id })
					.from(roadImpacts)
					.where(eq(roadImpacts.roadSegmentId, verifiedSegmentId));
				expect(impacts.length).toBeGreaterThanOrEqual(1);
				const impactId = impacts[0].id;

				// 3. Update road status via workerd
				const statusRes = await httpRequest(
					`${baseUrl}api/road-impacts/${impactId}/status`,
					{
						method: "POST",
						headers: {
							Cookie: sessionCookie,
							Origin: origin,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							status: "closed",
							observedAt: new Date().toISOString(),
							mutationId: crypto.randomUUID(),
						}),
					},
				);
				expect(statusRes.statusCode).toBe(200);

				// 4. Anonymous public list & roads query via workerd
				const pubRes = await httpRequest(`${baseUrl}api/public/events`);
				expect(pubRes.statusCode).toBe(200);
				const pubBody = pubRes.json<{ events: Array<{ publicSlug: string }> }>();
				expect(pubBody.events.length).toBeGreaterThanOrEqual(1);

				const roadsRes = await httpRequest(
					`${baseUrl}api/public/events/${publishedSlug}/roads`,
				);
				expect(roadsRes.statusCode).toBe(200);
				const roadsBody = roadsRes.json<{
					roads: Array<{ effectiveStatus: string; isExpired: boolean }>;
				}>();
				expect(roadsBody.roads.length).toBeGreaterThanOrEqual(1);
				expect(roadsBody.roads[0].effectiveStatus).toBe("closed");
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

			describe("real browser execution via headless Chrome & CDP against workerd", () => {
				let profile = "";
				let chromeProcess: cp.ChildProcess | null = null;
				let ws: WebSocket | null = null;
				let otherServer: http.Server | null = null;
				let otherOrigin = "";
				let seq = 0;
				const pending = new Map<
					number,
					{ resolve: (val: unknown) => void; reject: (err: unknown) => void }
				>();
				let cookieDelivered = false;
				let csrfStatusCode: number | null = null;

				const cmd = (method: string, params: Record<string, unknown> = {}) =>
					new Promise((resolve, reject) => {
						const id = ++seq;
						pending.set(id, { resolve, reject });
						ws?.send(JSON.stringify({ id, method, params }));
					});

				const evaluate = async <T = unknown>(expression: string): Promise<T> => {
					const res = (await cmd("Runtime.evaluate", {
						expression,
						awaitPromise: true,
						returnByValue: true,
					})) as { exceptionDetails?: unknown; result?: { value?: unknown } };
					if (res.exceptionDetails) {
						throw new Error(
							`Browser evaluation failed: ${JSON.stringify(res.exceptionDetails)}`,
						);
					}
					return res.result?.value as T;
				};

				beforeAll(async () => {
					const chromePath =
						"C:/Program Files/Google/Chrome/Application/chrome.exe";
					if (!fs.existsSync(chromePath)) return;

					profile = fs.mkdtempSync(
						path.join(os.tmpdir(), "rangkai-browser-"),
					);
					chromeProcess = cp.spawn(
						chromePath,
						[
							"--headless=new",
							"--no-first-run",
							"--no-default-browser-check",
							"--disable-background-networking",
							"--remote-debugging-port=0",
							`--user-data-dir=${profile}`,
							"about:blank",
						],
						{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
					);

					const devPortFile = path.join(profile, "DevToolsActivePort");
					for (let i = 0; i < 100 && !fs.existsSync(devPortFile); i++) {
						await new Promise((r) => setTimeout(r, 100));
					}
					const debugPort = Number(
						fs.readFileSync(devPortFile, "utf8").split("\n")[0].trim(),
					);

					const tabRes = await fetch(
						`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(baseUrl)}`,
						{ method: "PUT" },
					);
					const tab = (await tabRes.json()) as { webSocketDebuggerUrl: string };

					ws = new WebSocket(tab.webSocketDebuggerUrl);
					await new Promise<void>((resolve, reject) => {
						if (!ws) return reject(new Error("No WebSocket"));
						ws.addEventListener("open", () => resolve(), { once: true });
						ws.addEventListener("error", (err) => reject(err), { once: true });
					});

					ws.addEventListener("message", (e: MessageEvent) => {
						const m = JSON.parse(String(e.data));
						if (m.id) {
							const p = pending.get(m.id);
							if (p) {
								pending.delete(m.id);
								if (m.error) p.reject(new Error("CDP command failed"));
								else p.resolve(m.result);
							}
						} else if (
							m.method === "Network.requestWillBeSentExtraInfo" &&
							otherOrigin &&
							(m.params.headers?.Origin === otherOrigin ||
								m.params.headers?.origin === otherOrigin ||
								m.params.headers?.["Sec-Fetch-Site"] === "cross-site" ||
								m.params.headers?.["sec-fetch-site"] === "cross-site" ||
								m.params.headers?.["Sec-Fetch-Site"] === "same-site" ||
								m.params.headers?.["sec-fetch-site"] === "same-site")
						) {
							if (
								m.params.associatedCookies?.some(
									(c: {
										blockedReasons: unknown[];
										cookie: { name: string };
									}) =>
										c.blockedReasons.length === 0 &&
										c.cookie.name === "rangkai.session_token",
								)
							) {
								cookieDelivered = true;
							}
						} else if (
							m.method === "Network.responseReceivedExtraInfo" &&
							m.params.statusCode === 403
						) {
							csrfStatusCode = 403;
						}
					});

					await cmd("Network.enable");
					await cmd("Page.enable");
					await cmd("Page.navigate", { url: baseUrl });
					await new Promise((r) => setTimeout(r, 400));
				});

				afterAll(async () => {
					try {
						ws?.close();
					} catch {
						// ignore ws close error
					}
					if (otherServer) {
						try {
							otherServer.closeAllConnections();
						} catch {
							// ignore closeAllConnections error
						}
						await new Promise<void>((r) => otherServer?.close(() => r()));
					}
					if (chromeProcess) {
						try {
							chromeProcess.kill();
						} catch {
							// ignore chromeProcess kill error
						}
					}
					if (profile && fs.existsSync(profile)) {
						try {
							fs.rmSync(profile, {
								recursive: true,
								force: true,
								maxRetries: 5,
							});
						} catch {
							// ignore profile directory removal error
						}
					}
				});

				it("authenticates in real browser, sets session cookie, and resolves active session", async () => {
					const status = await evaluate<number>(`
						fetch('/api/auth/sign-in/email', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								email: 'workerd.${runKey}@test.local',
								password: '${testPassword}'
							})
						}).then(r => r.status)
					`);
					expect(status).toBe(200);

					const userCheck = await evaluate<{ user?: { id?: string } }>(`
						fetch('/api/auth/get-session').then(r => r.json())
					`);
					expect(userCheck?.user?.id).toBe(fixtureUserId);
				});

				it("blocks cross-origin text/plain mutation with 403 in browser despite cookie delivery", async () => {
					const host = new URL(baseUrl).hostname;
					otherServer = http.createServer((_req, res) => {
						res.setHeader("Content-Type", "text/html");
						res.end("<!doctype html><title>External Origin</title>");
					});
					await new Promise<void>((r) => otherServer?.listen(0, host, r));
					const addr = otherServer.address() as AddressInfo;
					otherOrigin = `http://${host}:${addr.port}`;

					await cmd("Page.navigate", { url: otherOrigin });
					await new Promise((r) => setTimeout(r, 300));

					const eventCountBefore = (
						await db
							.select()
							.from(events)
							.where(eq(events.organizationId, fixtureOrgId))
					).length;

					const resStatus = await evaluate<number>(`
						fetch('${baseUrl}api/events', {
							method: 'POST',
							credentials: 'include',
							headers: { 'Content-Type': 'text/plain' },
							body: JSON.stringify({
								organizationId: '${fixtureOrgId}',
								title: 'Browser CSRF should fail'
							})
						}).then(r => r.status).catch(() => -1)
					`);

					expect(resStatus === -1 || resStatus === 403).toBe(true);
					expect(cookieDelivered).toBe(true);
					expect(csrfStatusCode).toBe(403);

					const eventCountAfter = (
						await db
							.select()
							.from(events)
							.where(eq(events.organizationId, fixtureOrgId))
					).length;
					expect(eventCountAfter).toBe(eventCountBefore);
				});

				it("revokes browser session on sign-out and rejects subsequent requests with 401", async () => {
					await cmd("Page.navigate", { url: baseUrl });
					await new Promise((r) => setTimeout(r, 300));

					const logoutStatus = await evaluate<number>(`
						fetch('/api/auth/sign-out', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: '{}'
						}).then(r => r.status)
					`);
					expect(logoutStatus).toBe(200);

					const afterLogoutStatus = await evaluate<number>(`
						fetch('/api/events').then(r => r.status)
					`);
					expect(afterLogoutStatus).toBe(401);
				});

				it("rejects browser access when session is expired in database (401)", async () => {
					// Log back in
					const loginStatus = await evaluate<number>(`
						fetch('/api/auth/sign-in/email', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								email: 'workerd.${runKey}@test.local',
								password: '${testPassword}'
							})
						}).then(r => r.status)
					`);
					expect(loginStatus).toBe(200);

					// Expire session in database
					await db.execute(
						sql`UPDATE session SET expires_at = now() - interval '1 minute' WHERE user_id = ${fixtureUserId}`,
					);

					const expiredStatus = await evaluate<number>(`
						fetch('/api/events').then(r => r.status)
					`);
					expect(expiredStatus).toBe(401);
				});
			});
		});
	});
});
