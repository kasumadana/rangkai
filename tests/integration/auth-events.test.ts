import crypto from "node:crypto";
import * as dotenv from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { assertDevBranch, AUTHORIZED_DEV_BRANCH } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db/index";
import {
	account,
	session,
	user,
} from "../../src/db/auth-schema";
import {
	auditLogs,
	eventAssignments,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
} from "../../src/db/schema";
import { AuthConfigError, validateAuthConfig } from "../../src/worker/auth";
import app from "../../src/worker/index";

dotenv.config({ path: ".dev.vars" });

describe("A03 + A04 Integrated: Auth, RBAC, Event CRUD, Review & Publication", () => {
	let db: DbClient;
	let pinnedUrl: string;

	const runKey = crypto.randomUUID().slice(0, 8);
	const testPassword = "TestPassword123!";

	// Run-owned test fixture IDs
	const fixtureOrgA = {
		id: crypto.randomUUID(),
		name: `Banjar Test A (${runKey})`,
		village: "Desa A",
		district: "Kecamatan A",
	};

	const fixtureOrgB = {
		id: crypto.randomUUID(),
		name: `Banjar Test B (${runKey})`,
		village: "Desa B",
		district: "Kecamatan B",
	};

	const fixtureUserOrganizerA = {
		id: `usr_org_a_${runKey}`,
		name: `Organizer A ${runKey}`,
		email: `organizer.a.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureUserOfficerA = {
		id: `usr_off_a_${runKey}`,
		name: `Officer A ${runKey}`,
		email: `officer.a.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureUserOrganizerB = {
		id: `usr_org_b_${runKey}`,
		name: `Organizer B ${runKey}`,
		email: `organizer.b.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureUserOfficerB = {
		id: `usr_off_b_${runKey}`,
		name: `Officer B ${runKey}`,
		email: `officer.b.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureVerifiedRoadSegment = {
		id: crypto.randomUUID(),
		displayName: `[TEST] Jl. Segmen Terverifikasi (${runKey})`,
		geom: "SRID=4326;LINESTRING(115.2166 -8.6500, 115.2170 -8.6510)",
		coverageArea: "Area Uji",
		verifiedBy: "system_test_verifier",
		verifiedAt: new Date("2026-11-01T00:00:00Z"),
	};

	const fixtureUnverifiedRoadSegment = {
		id: crypto.randomUUID(),
		displayName: `[TEST] Jl. Segmen Belum Verifikasi (${runKey})`,
		geom: "SRID=4326;LINESTRING(115.2180 -8.6520, 115.2185 -8.6530)",
		coverageArea: "Area Uji",
		verifiedBy: null,
		verifiedAt: null,
	};

	let organizerACookie = "";
	let officerACookie = "";
	let organizerBCookie = "";

	beforeAll(async () => {
		const preflight = await assertDevBranch();
		expect(preflight.branchId).toBe(AUTHORIZED_DEV_BRANCH);
		pinnedUrl = preflight.pinnedUrl;
		db = getDb(pinnedUrl);

		// Seed run-owned organizations
		await db.insert(organizations).values([fixtureOrgA, fixtureOrgB]);

		// Seed run-owned users
		await db.insert(user).values([
			fixtureUserOrganizerA,
			fixtureUserOfficerA,
			fixtureUserOrganizerB,
			fixtureUserOfficerB,
		]);

		// Seed Better Auth accounts with distinct credentials
		const hashedPw = await hashPassword(testPassword);
		await db.insert(account).values([
			{
				id: `acc_org_a_${runKey}`,
				accountId: fixtureUserOrganizerA.id,
				providerId: "credential",
				userId: fixtureUserOrganizerA.id,
				password: hashedPw,
			},
			{
				id: `acc_off_a_${runKey}`,
				accountId: fixtureUserOfficerA.id,
				providerId: "credential",
				userId: fixtureUserOfficerA.id,
				password: hashedPw,
			},
			{
				id: `acc_org_b_${runKey}`,
				accountId: fixtureUserOrganizerB.id,
				providerId: "credential",
				userId: fixtureUserOrganizerB.id,
				password: hashedPw,
			},
			{
				id: `acc_off_b_${runKey}`,
				accountId: fixtureUserOfficerB.id,
				providerId: "credential",
				userId: fixtureUserOfficerB.id,
				password: hashedPw,
			},
		]);

		// Seed memberships
		await db.insert(memberships).values([
			{
				organizationId: fixtureOrgA.id,
				userId: fixtureUserOrganizerA.id,
				role: "organizer",
			},
			{
				organizationId: fixtureOrgA.id,
				userId: fixtureUserOfficerA.id,
				role: "officer",
			},
			{
				organizationId: fixtureOrgB.id,
				userId: fixtureUserOrganizerB.id,
				role: "organizer",
			},
			{
				organizationId: fixtureOrgB.id,
				userId: fixtureUserOfficerB.id,
				role: "officer",
			},
		]);

		// Seed road segments (one verified, one unverified)
		await db.insert(roadSegments).values([
			{
				id: fixtureVerifiedRoadSegment.id,
				displayName: fixtureVerifiedRoadSegment.displayName,
				geom: fixtureVerifiedRoadSegment.geom,
				coverageArea: fixtureVerifiedRoadSegment.coverageArea,
				verifiedBy: fixtureVerifiedRoadSegment.verifiedBy,
				verifiedAt: fixtureVerifiedRoadSegment.verifiedAt,
			},
			{
				id: fixtureUnverifiedRoadSegment.id,
				displayName: fixtureUnverifiedRoadSegment.displayName,
				geom: fixtureUnverifiedRoadSegment.geom,
				coverageArea: fixtureUnverifiedRoadSegment.coverageArea,
				verifiedBy: fixtureUnverifiedRoadSegment.verifiedBy,
				verifiedAt: fixtureUnverifiedRoadSegment.verifiedAt,
			},
		]);
	});

	afterAll(async () => {
		if (!db) return;
		try {
			const orgIds = [fixtureOrgA.id, fixtureOrgB.id];
			const testEvents = await db
				.select({ id: events.id })
				.from(events)
				.where(inArray(events.organizationId, orgIds));

			const eventIds = testEvents.map((e) => e.id);
			if (eventIds.length > 0) {
				await db.delete(auditLogs).where(inArray(auditLogs.eventId, eventIds));
				await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
				await db
					.delete(eventAssignments)
					.where(inArray(eventAssignments.eventId, eventIds));
				await db.delete(events).where(inArray(events.id, eventIds));
			}

			// Clean up segments
			await db
				.delete(roadSegments)
				.where(
					inArray(roadSegments.id, [
						fixtureVerifiedRoadSegment.id,
						fixtureUnverifiedRoadSegment.id,
					]),
				);

			// Clean up memberships
			await db
				.delete(memberships)
				.where(inArray(memberships.organizationId, orgIds));

			// Clean up sessions and accounts
			const userIds = [
				fixtureUserOrganizerA.id,
				fixtureUserOfficerA.id,
				fixtureUserOrganizerB.id,
				fixtureUserOfficerB.id,
			];
			await db.delete(session).where(inArray(session.userId, userIds));
			await db.delete(account).where(inArray(account.userId, userIds));
			await db.delete(user).where(inArray(user.id, userIds));

			// Clean up organizations
			await db.delete(organizations).where(inArray(organizations.id, orgIds));
		} catch (err: unknown) {
			console.error("Cleanup error in afterAll:", err);
		}
	});

	describe("1. Better Auth & Session Management (A03)", () => {
		it("signs in Organizer A with valid email/password and receives session cookie", async () => {
			const res = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: fixtureUserOrganizerA.email,
					password: testPassword,
				}),
			});

			expect(res.status).toBe(200);
			const setCookieHeader = res.headers.get("set-cookie") || "";
			expect(setCookieHeader).toContain("better-auth.session_token");
			organizerACookie = setCookieHeader.split(";")[0];

			const data = (await res.json()) as { user: { id: string; email: string } };
			expect(data.user.email).toBe(fixtureUserOrganizerA.email);
		});

		it("signs in Officer A with valid email/password", async () => {
			const res = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: fixtureUserOfficerA.email,
					password: testPassword,
				}),
			});

			expect(res.status).toBe(200);
			const setCookie = res.headers.get("set-cookie") || "";
			expect(setCookie).toContain("better-auth.session_token");
			officerACookie = setCookie.split(";")[0];
		});

		it("signs in Organizer B with valid email/password", async () => {
			const res = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: fixtureUserOrganizerB.email,
					password: testPassword,
				}),
			});

			expect(res.status).toBe(200);
			const setCookie = res.headers.get("set-cookie") || "";
			organizerBCookie = setCookie.split(";")[0];
		});

		it("rejects sign-in with invalid password", async () => {
			const res = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: fixtureUserOrganizerA.email,
					password: "WrongPassword999!",
				}),
			});

			expect(res.status).not.toBe(200);
		});

		it("retrieves active session via /api/auth/get-session", async () => {
			const res = await app.request("http://localhost:5173/api/auth/get-session", {
				headers: { Cookie: organizerACookie },
			});

			expect(res.status).toBe(200);
			const sessionData = (await res.json()) as { user: { email: string } };
			expect(sessionData.user.email).toBe(fixtureUserOrganizerA.email);
		});

		it("revokes session via /api/auth/sign-out", async () => {
			const tempRes = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: fixtureUserOfficerB.email,
					password: testPassword,
				}),
			});
			const tempCookie = (tempRes.headers.get("set-cookie") || "").split(";")[0];

			const signOutRes = await app.request("http://localhost:5173/api/auth/sign-out", {
				method: "POST",
				headers: { Cookie: tempCookie },
			});
			expect(signOutRes.status).toBe(200);

			const checkRes = await app.request("http://localhost:5173/api/auth/get-session", {
				headers: { Cookie: tempCookie },
			});
			const data = await checkRes.json();
			expect(data).toBeNull();
		});
	});

	describe("2. CSRF & Origin Protections (AGENTS §19, docs/08-SECURITY-OPS §3)", () => {
		it("REJECTS same-site simple request from untrusted origin (e.g. Origin: http://localhost:9999 + Content-Type: text/plain)", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					Cookie: organizerACookie,
					Origin: "http://localhost:9999",
					"Sec-Fetch-Site": "same-site",
					"Content-Type": "text/plain",
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "CSRF Malicious Event",
					startsAt: "2026-11-20T08:00:00Z",
					endsAt: "2026-11-20T14:00:00Z",
				}),
			});

			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("FORBIDDEN");
			expect(body.error.message).toContain("Untrusted request origin");

			// Ensure no event was created in the database
			const check = await db
				.select()
				.from(events)
				.where(eq(events.title, "CSRF Malicious Event"));
			expect(check.length).toBe(0);
		});

		it("REJECTS mutating request with cross-site Sec-Fetch-Site header", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					Cookie: organizerACookie,
					"Sec-Fetch-Site": "cross-site",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Cross Site Attempt",
					startsAt: "2026-11-20T08:00:00Z",
					endsAt: "2026-11-20T14:00:00Z",
				}),
			});

			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("FORBIDDEN");
		});

		it("REJECTS form-encoded Content-Type for JSON API mutations", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					Cookie: organizerACookie,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: "organizationId=foo&title=bar",
			});

			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("BAD_REQUEST");
			expect(body.error.message).toContain("Application API mutations require application/json");
		});
	});

	describe("3. Fail-Closed Authentication Configuration (AGENTS §19, docs/08-SECURITY-OPS §3)", () => {
		it("throws AuthConfigError when BETTER_AUTH_SECRET is missing or insufficient length", () => {
			expect(() =>
				validateAuthConfig({
					BETTER_AUTH_SECRET: undefined,
					BETTER_AUTH_URL: "http://localhost:5173",
				}),
			).toThrowError(AuthConfigError);

			expect(() =>
				validateAuthConfig({
					BETTER_AUTH_SECRET: "too-short-secret-less-than-32",
					BETTER_AUTH_URL: "http://localhost:5173",
				}),
			).toThrowError(AuthConfigError);
		});

		it("throws AuthConfigError when BETTER_AUTH_URL is missing", () => {
			expect(() =>
				validateAuthConfig({
					BETTER_AUTH_SECRET: "high-entropy-secret-with-more-than-32-chars-long!",
					BETTER_AUTH_URL: undefined,
				}),
			).toThrowError(AuthConfigError);
		});

		it("strictly requires HTTPS for BETTER_AUTH_URL when NODE_ENV is production", () => {
			const prevEnv = process.env.NODE_ENV;
			try {
				process.env.NODE_ENV = "production";
				expect(() =>
					validateAuthConfig({
						BETTER_AUTH_SECRET: "high-entropy-secret-with-more-than-32-chars-long!",
						BETTER_AUTH_URL: "http://localhost:5173",
					}),
				).toThrowError(/HTTPS is strictly required/);

				const valid = validateAuthConfig({
					BETTER_AUTH_SECRET: "high-entropy-secret-with-more-than-32-chars-long!",
					BETTER_AUTH_URL: "https://rangkai.id",
				});
				expect(valid.baseURL).toBe("https://rangkai.id");
				expect(valid.isProduction).toBe(true);
			} finally {
				process.env.NODE_ENV = prevEnv;
			}
		});

		it("returns 503 DEPENDENCY_UNAVAILABLE when request context lacks database configuration", async () => {
			const res = await app.fetch(
				new Request("http://localhost:5173/api/events", {
					method: "GET",
				}),
				{ DATABASE_URL: "" },
			);

			expect(res.status).toBe(503);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
			expect(body.error.message).toContain("Database configuration is missing");
		});
	});

	describe("4. Authentication & Authorization Guards (A03 / FR-003, FR-072)", () => {
		it("returns 401 Unauthorized for protected endpoints without session cookie", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Unauthenticated Event",
				}),
			});

			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
			expect(body.error.code).toBe("UNAUTHORIZED");
			expect(body.error.message).toContain("Authentication required");
			expect(body.error.requestId).toBeDefined();
		});

		it("returns 401 Unauthorized with corrupted session cookie", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				headers: { Cookie: "better-auth.session_token=forged_token_val" },
			});

			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("UNAUTHORIZED");
		});

		it("returns 403 Forbidden when organizer attempts action in non-member organization", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerBCookie,
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Intrusion Attempt",
				}),
			});

			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("FORBIDDEN");
			expect(body.error.message).toContain("not a member");
		});

		it("returns 403 Forbidden when field officer attempts organizer-only event creation", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: officerACookie,
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Officer Event Attempt",
				}),
			});

			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("FORBIDDEN");
			expect(body.error.message).toContain("Organizer permission required");
		});
	});

	describe("5. Event CRUD, Boundary Validation & Pagination (A04 / FR-010..013)", () => {
		let createdEventId = "";

		it("rejects offsetless timestamps without explicit timezone", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Offsetless Time Event",
					startsAt: "2026-11-20T08:00:00",
					endsAt: "2026-11-20T10:00:00",
				}),
			});

			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("VALIDATION_FAILED");
			expect(body.error.message).toContain("timezone information is required");
		});

		it("rejects date-only strings without time and timezone", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Date-only Event",
					startsAt: "2026-11-20",
					endsAt: "2026-11-21",
				}),
			});

			expect(res.status).toBe(422);
		});

		it("creates a draft event with explicit timezone timestamp, saving in UTC and recording audit log", async () => {
			const startsAt = "2026-11-20T08:00:00+08:00";
			const endsAt = "2026-11-20T16:00:00+08:00";

			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
					"x-request-id": "req_event_create_001",
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Upacara Odalan Test",
					category: "upacara",
					description: "Kegiatan keagamaan banjar",
					venueName: "Pura Banjar A",
					startsAt,
					endsAt,
				}),
			});

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				event: {
					id: string;
					title: string;
					status: string;
					startsAt: string;
					endsAt: string;
				};
			};
			expect(body.event.id).toBeDefined();
			createdEventId = body.event.id;
			expect(body.event.status).toBe("draft");
			expect(body.event.title).toBe("Upacara Odalan Test");
			expect(new Date(body.event.startsAt).toISOString()).toBe(
				new Date(startsAt).toISOString(),
			);

			// Verify atomic audit log
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, createdEventId),
						eq(auditLogs.action, "event.created"),
					),
				);
			expect(audits.length).toBe(1);
			expect(audits[0].actorId).toBe(fixtureUserOrganizerA.id);
			expect(audits[0].entityType).toBe("event");
		});

		it("rejects event creation when endsAt <= startsAt", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "Invalid Dates Event",
					startsAt: "2026-11-20T16:00:00Z",
					endsAt: "2026-11-20T08:00:00Z",
				}),
			});

			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("VALIDATION_FAILED");
			expect(body.error.message).toContain("End time must be after start time");
		});

		it("returns bounded pagination envelope on GET /api/events", async () => {
			const res = await app.request("http://localhost:5173/api/events?page=1&limit=2", {
				headers: { Cookie: organizerACookie },
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				events: Array<{ id: string }>;
				pagination: { page: number; limit: number; total: number; totalPages: number };
			};
			expect(body.pagination).toBeDefined();
			expect(body.pagination.page).toBe(1);
			expect(body.pagination.limit).toBe(2);
			expect(body.pagination.total).toBeGreaterThanOrEqual(1);
			expect(body.pagination.totalPages).toBeGreaterThanOrEqual(1);
			expect(body.events.length).toBeLessThanOrEqual(2);
		});

		it("ENFORCES officer assignment scoping: unassigned officer receives 0 events in list and 403 on detail", async () => {
			// Officer A is a member of Org A, but NOT assigned to createdEventId
			const listRes = await app.request("http://localhost:5173/api/events", {
				headers: { Cookie: officerACookie },
			});
			expect(listRes.status).toBe(200);
			const listBody = (await listRes.json()) as {
				events: Array<{ id: string }>;
				pagination: { total: number };
			};
			// Officer A must NOT see createdEventId
			expect(listBody.events.some((e) => e.id === createdEventId)).toBe(false);

			// Detail query for unassigned event must return 403
			const detailRes = await app.request(
				`http://localhost:5173/api/events/${createdEventId}`,
				{
					headers: { Cookie: officerACookie },
				},
			);
			expect(detailRes.status).toBe(403);
		});

		it("clears stale verification and resets review status to draft when core fields are edited (PATCH)", async () => {
			// First, transition to review
			await db
				.update(events)
				.set({
					status: "review",
					verifiedBy: fixtureUserOrganizerA.id,
					verifiedAt: new Date(),
				})
				.where(eq(events.id, createdEventId));

			// Now edit venueName on event in review
			const patchRes = await app.request(
				`http://localhost:5173/api/events/${createdEventId}`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerACookie,
					},
					body: JSON.stringify({
						venueName: "Balai Banjar Utama (Baru)",
					}),
				},
			);

			expect(patchRes.status).toBe(200);
			const patchBody = (await patchRes.json()) as {
				event: { status: string; verifiedBy: string | null; venueName: string };
			};
			expect(patchBody.event.venueName).toBe("Balai Banjar Utama (Baru)");
			// Verification must be cleared and status reset to draft
			expect(patchBody.event.status).toBe("draft");
			expect(patchBody.event.verifiedBy).toBeNull();
		});

		it("rejects removing venueName on published event", async () => {
			// Set event to published temporarily
			await db
				.update(events)
				.set({ status: "published" })
				.where(eq(events.id, createdEventId));

			const res = await app.request(
				`http://localhost:5173/api/events/${createdEventId}`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerACookie,
					},
					body: JSON.stringify({ venueName: null }),
				},
			);

			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Cannot remove venue name");

			// Reset back to draft
			await db
				.update(events)
				.set({ status: "draft" })
				.where(eq(events.id, createdEventId));
		});
	});

	describe("6. Assignment Scoping & Revocation (A03 / FR-004, FR-005)", () => {
		let testEventId = "";
		let assignmentId = "";

		beforeAll(async () => {
			const eventRows = await db
				.insert(events)
				.values({
					organizationId: fixtureOrgA.id,
					createdBy: fixtureUserOrganizerA.id,
					title: "Assignment Test Event",
					status: "draft",
				})
				.returning();
			testEventId = eventRows[0].id;
		});

		it("organizer grants officer assignment atomically with audit log", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/assignments`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerACookie,
					},
					body: JSON.stringify({
						userId: fixtureUserOfficerA.id,
						canUpdateTraffic: true,
						canUpdateCleanup: false,
					}),
				},
			);

			expect(res.status).toBe(201);
			const data = (await res.json()) as {
				assignment: {
					id: string;
					userId: string;
					canUpdateTraffic: boolean;
					canUpdateCleanup: boolean;
				};
			};
			expect(data.assignment.userId).toBe(fixtureUserOfficerA.id);
			expect(data.assignment.canUpdateTraffic).toBe(true);
			assignmentId = data.assignment.id;

			// Audit log recorded
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, testEventId),
						eq(auditLogs.action, "assignment.created"),
					),
				);
			expect(audits.length).toBe(1);
		});

		it("assigned officer can now view assigned event detail AND see it in event listing", async () => {
			// Detail view allowed
			const detailRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}`,
				{
					headers: { Cookie: officerACookie },
				},
			);
			expect(detailRes.status).toBe(200);

			// Listing now includes the assigned event
			const listRes = await app.request("http://localhost:5173/api/events", {
				headers: { Cookie: officerACookie },
			});
			expect(listRes.status).toBe(200);
			const listData = (await listRes.json()) as { events: Array<{ id: string }> };
			expect(listData.events.some((e) => e.id === testEventId)).toBe(true);
		});

		it("organizer revokes officer assignment, immediately denying officer access again", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/assignments/${assignmentId}`,
				{
					method: "DELETE",
					headers: { Cookie: organizerACookie },
				},
			);

			expect(res.status).toBe(200);

			// Detail query is now 403 Forbidden
			const detailRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}`,
				{
					headers: { Cookie: officerACookie },
				},
			);
			expect(detailRes.status).toBe(403);

			// Revoked event no longer in officer listing
			const listRes = await app.request("http://localhost:5173/api/events", {
				headers: { Cookie: officerACookie },
			});
			const listData = (await listRes.json()) as { events: Array<{ id: string }> };
			expect(listData.events.some((e) => e.id === testEventId)).toBe(false);
		});
	});

	describe("7. Event Review & Publication Prerequisites (A04 / FR-013..015, AC-07)", () => {
		let publishEventId = "";

		beforeAll(async () => {
			const eventRows = await db
				.insert(events)
				.values({
					organizationId: fixtureOrgA.id,
					createdBy: fixtureUserOrganizerA.id,
					title: "Ngaben Massal Desa A",
					venueName: "Sentra Krematorium A",
					startsAt: new Date("2026-11-25T07:00:00Z"),
					endsAt: new Date("2026-11-25T15:00:00Z"),
					status: "draft",
				})
				.returning();
			publishEventId = eventRows[0].id;
		});

		it("REJECTS direct publication from draft status without human review (409 Conflict)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${publishEventId}/publish`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);

			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("STATE_CONFLICT");
			expect(body.error.message).toContain("Event must be in review status before publication");
		});

		it("transitions draft event to review state with human verification metadata", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${publishEventId}/review`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);

			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				event: { status: string; verifiedBy: string; verifiedAt: string };
			};
			expect(data.event.status).toBe("review");
			expect(data.event.verifiedBy).toBe(fixtureUserOrganizerA.id);
			expect(data.event.verifiedAt).toBeDefined();
		});

		it("REJECTS publication when road impact references an UNVERIFIED road segment", async () => {
			// Attach road impact referencing unverified segment
			const impactRows = await db
				.insert(roadImpacts)
				.values({
					eventId: publishEventId,
					roadSegmentId: fixtureUnverifiedRoadSegment.id,
					plannedFrom: new Date("2026-11-25T07:00:00Z"),
					plannedTo: new Date("2026-11-25T15:00:00Z"),
					impactType: "closure",
				})
				.returning();

			const res = await app.request(
				`http://localhost:5173/api/events/${publishEventId}/publish`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);

			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("unverified road segment");

			// Clean up unverified impact
			await db.delete(roadImpacts).where(eq(roadImpacts.id, impactRows[0].id));
		});

		it("successfully publishes event once VERIFIED road impact is attached", async () => {
			// Attach verified road impact
			await db.insert(roadImpacts).values({
				eventId: publishEventId,
				roadSegmentId: fixtureVerifiedRoadSegment.id,
				plannedFrom: new Date("2026-11-25T07:00:00Z"),
				plannedTo: new Date("2026-11-25T15:00:00Z"),
				impactType: "closure",
				diversionNote: "Pengalihan uji coba",
			});

			const res = await app.request(
				`http://localhost:5173/api/events/${publishEventId}/publish`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				event: { status: string; publicSlug: string; publishedAt: string };
			};
			expect(body.event.status).toBe("published");
			expect(body.event.publicSlug).toContain("ngaben-massal-desa-a");
			expect(body.event.publishedAt).toBeDefined();

			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, publishEventId),
						eq(auditLogs.action, "event.published"),
					),
				);
			expect(audits.length).toBe(1);
		});

		it("is strictly idempotent: repeated publish call does NOT generate duplicate audit logs", async () => {
			const auditsBefore = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, publishEventId),
						eq(auditLogs.action, "event.published"),
					),
				);

			const resRepeat = await app.request(
				`http://localhost:5173/api/events/${publishEventId}/publish`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);

			expect(resRepeat.status).toBe(200);

			const auditsAfter = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, publishEventId),
						eq(auditLogs.action, "event.published"),
					),
				);

			// Count of publication audits must remain exactly identical
			expect(auditsAfter.length).toBe(auditsBefore.length);
		});
	});

	describe("8. Terminal Lifecycle Enforcement (A04 / AGENTS §13)", () => {
		let completedEventId = "";

		beforeAll(async () => {
			const eventRows = await db
				.insert(events)
				.values({
					organizationId: fixtureOrgA.id,
					createdBy: fixtureUserOrganizerA.id,
					title: "Terminal Test Event",
					status: "published",
				})
				.returning();
			completedEventId = eventRows[0].id;
		});

		it("completes published event successfully", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${completedEventId}/complete`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { event: { status: string } };
			expect(body.event.status).toBe("completed");
		});

		it("REJECTS transition to review on completed event (409 Conflict)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${completedEventId}/review`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);
			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("STATE_CONFLICT");
		});

		it("REJECTS publication on completed event (409 Conflict)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${completedEventId}/publish`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);
			expect(res.status).toBe(409);
		});

		it("REJECTS completion on draft event (409 Conflict)", async () => {
			const draftEvent = await db
				.insert(events)
				.values({
					organizationId: fixtureOrgA.id,
					createdBy: fixtureUserOrganizerA.id,
					title: "Draft Complete Test",
					status: "draft",
				})
				.returning();

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEvent[0].id}/complete`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
				},
			);
			expect(res.status).toBe(409);

			// Clean up
			await db.delete(events).where(eq(events.id, draftEvent[0].id));
		});

		it("cancels published event with non-empty reason", async () => {
			const eventToCancel = await db
				.insert(events)
				.values({
					organizationId: fixtureOrgA.id,
					createdBy: fixtureUserOrganizerA.id,
					title: "Event to Cancel",
					status: "published",
				})
				.returning();

			const res = await app.request(
				`http://localhost:5173/api/events/${eventToCancel[0].id}/cancel`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerACookie,
					},
					body: JSON.stringify({ reason: "Cuaca buruk" }),
				},
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { event: { status: string }; reason: string };
			expect(body.event.status).toBe("cancelled");
			expect(body.reason).toBe("Cuaca buruk");

			// Clean up
			await db.delete(auditLogs).where(eq(auditLogs.eventId, eventToCancel[0].id));
			await db.delete(events).where(eq(events.id, eventToCancel[0].id));
		});
	});

	describe("9. Atomic Batch Rollback (A04 / AGENTS §17)", () => {
		it("rolls back event creation when audit insert statement fails", async () => {
			const testEventId = crypto.randomUUID();

			// Test atomic batch failure: query 1 is valid event insert, query 2 is invalid audit insert (violating FK constraint)
			try {
				await db.batch([
					db.insert(events).values({
						id: testEventId,
						organizationId: fixtureOrgA.id,
						createdBy: fixtureUserOrganizerA.id,
						title: "Should Not Persist Event",
						status: "draft",
					}),
					db.insert(auditLogs).values({
						id: crypto.randomUUID(),
						organizationId: "00000000-0000-4000-8000-000000000000",
						eventId: testEventId,
						actorId: fixtureUserOrganizerA.id,
						action: "event.created",
						entityType: "event",
						entityId: testEventId,
					}),
				]);
				expect.unreachable("Batch should have failed due to foreign key violation");
			} catch (err: unknown) {
				// Expected foreign key failure
				expect(String(err)).toContain("violates foreign key constraint");
			}

			// Verify that the event was NOT persisted in the database
			const checkEvent = await db
				.select()
				.from(events)
				.where(eq(events.id, testEventId));
			expect(checkEvent.length).toBe(0);

			const checkAudit = await db
				.select()
				.from(auditLogs)
				.where(eq(auditLogs.eventId, testEventId));
			expect(checkAudit.length).toBe(0);
		});
	});
});
