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
	cleanupTasks,
	eventAssignments,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
} from "../../src/db/schema";
import { SIMULATED_DATA, SIMULATED_DEV_PASSWORD } from "../../src/db/seed";
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

	const fixtureRoadSegment = {
		id: crypto.randomUUID(),
		displayName: `[TEST] Jl. Segmen Uji (${runKey})`,
		geom: "SRID=4326;LINESTRING(115.2166 -8.6500, 115.2170 -8.6510)",
		coverageArea: "Area Uji",
		verifiedBy: "system_test",
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

		// Seed Better Auth accounts
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

		// Seed road segment
		await db.insert(roadSegments).values({
			id: fixtureRoadSegment.id,
			displayName: fixtureRoadSegment.displayName,
			geom: fixtureRoadSegment.geom,
			coverageArea: fixtureRoadSegment.coverageArea,
			verifiedBy: fixtureRoadSegment.verifiedBy,
			verifiedAt: new Date(),
		});
	});

	afterAll(async () => {
		if (!db) return;
		try {
			// Clean up created event records for this run
			const orgIds = [fixtureOrgA.id, fixtureOrgB.id];
			const testEvents = await db
				.select({ id: events.id })
				.from(events)
				.where(inArray(events.organizationId, orgIds));

			const eventIds = testEvents.map((e) => e.id);
			if (eventIds.length > 0) {
				await db.delete(auditLogs).where(inArray(auditLogs.eventId, eventIds));
				await db.delete(cleanupTasks).where(inArray(cleanupTasks.eventId, eventIds));
				await db.delete(eventAssignments).where(inArray(eventAssignments.eventId, eventIds));
				await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
				await db.delete(events).where(inArray(events.id, eventIds));
			}

			// Clean up audit logs for orgs
			await db.delete(auditLogs).where(inArray(auditLogs.organizationId, orgIds));

			// Clean up road segment
			await db.delete(roadSegments).where(eq(roadSegments.id, fixtureRoadSegment.id));

			// Clean up memberships
			await db.delete(memberships).where(inArray(memberships.organizationId, orgIds));

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

			const data = await res.json() as { user: { id: string; email: string } };
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

		it("verifies pre-seeded simulated development pilot accounts can authenticate", async () => {
			const resOrg = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: SIMULATED_DATA.users.organizer.email,
					password: SIMULATED_DEV_PASSWORD,
				}),
			});
			expect(resOrg.status).toBe(200);

			const resOff = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: SIMULATED_DATA.users.officer.email,
					password: SIMULATED_DEV_PASSWORD,
				}),
			});
			expect(resOff.status).toBe(200);
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
			const sessionData = await res.json() as { user: { email: string } };
			expect(sessionData.user.email).toBe(fixtureUserOrganizerA.email);
		});

		it("revokes session via /api/auth/sign-out", async () => {
			// Sign in temporary session
			const tempRes = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: fixtureUserOfficerB.email,
					password: testPassword,
				}),
			});
			const tempCookie = (tempRes.headers.get("set-cookie") || "").split(";")[0];

			// Sign out
			const signOutRes = await app.request("http://localhost:5173/api/auth/sign-out", {
				method: "POST",
				headers: { Cookie: tempCookie },
			});
			expect(signOutRes.status).toBe(200);

			// Session should now be null/inactive
			const checkRes = await app.request("http://localhost:5173/api/auth/get-session", {
				headers: { Cookie: tempCookie },
			});
			const data = await checkRes.json();
			expect(data).toBeNull();
		});
	});

	describe("2. Authentication & Authorization Guards (A03 / FR-003, FR-072)", () => {
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
			const body = await res.json() as { error: { code: string; message: string; requestId: string } };
			expect(body.error.code).toBe("UNAUTHORIZED");
			expect(body.error.message).toContain("Authentication required");
			expect(body.error.requestId).toBeDefined();
		});

		it("returns 401 Unauthorized with corrupted session cookie", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				headers: { Cookie: "better-auth.session_token=forged_token_val" },
			});

			expect(res.status).toBe(401);
			const body = await res.json() as { error: { code: string } };
			expect(body.error.code).toBe("UNAUTHORIZED");
		});

		it("returns 403 Forbidden when organizer attempts action in non-member organization", async () => {
			// Organizer B attempts to create event in Organization A
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
			const body = await res.json() as { error: { code: string; message: string } };
			expect(body.error.code).toBe("FORBIDDEN");
			expect(body.error.message).toContain("not a member");
		});

		it("returns 403 Forbidden when field officer attempts organizer-only event creation", async () => {
			// Officer A attempts to create an event in Organization A
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
			const body = await res.json() as { error: { code: string; message: string } };
			expect(body.error.code).toBe("FORBIDDEN");
			expect(body.error.message).toContain("Organizer permission required");
		});
	});

	describe("3. Event CRUD & Validation (A04 / FR-010..013, FR-016)", () => {
		let createdEventId = "";

		it("creates a draft event with valid core fields, saving in UTC and recording audit log", async () => {
			const startsAt = "2026-11-20T08:00:00Z";
			const endsAt = "2026-11-20T16:00:00Z";

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
			const body = await res.json() as { event: { id: string; title: string; status: string; startsAt: string; endsAt: string } };
			expect(body.event.id).toBeDefined();
			createdEventId = body.event.id;
			expect(body.event.status).toBe("draft");
			expect(body.event.title).toBe("Upacara Odalan Test");
			expect(new Date(body.event.startsAt).toISOString()).toBe(new Date(startsAt).toISOString());
			expect(new Date(body.event.endsAt).toISOString()).toBe(new Date(endsAt).toISOString());

			// Verify persistent audit record was created atomically
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
			const body = await res.json() as { error: { code: string; message: string } };
			expect(body.error.code).toBe("VALIDATION_FAILED");
			expect(body.error.message).toContain("End time must be after start time");
		});

		it("rejects event creation with empty title", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: JSON.stringify({
					organizationId: fixtureOrgA.id,
					title: "   ",
				}),
			});

			expect(res.status).toBe(422);
		});

		it("lists events scoped to user organization, preventing cross-tenant leakage", async () => {
			// Organizer A lists events
			const resA = await app.request("http://localhost:5173/api/events", {
				headers: { Cookie: organizerACookie },
			});
			expect(resA.status).toBe(200);
			const dataA = await resA.json() as { events: Array<{ id: string; organizationId: string }> };
			expect(dataA.events.some((e) => e.id === createdEventId)).toBe(true);
			expect(dataA.events.every((e) => e.organizationId === fixtureOrgA.id)).toBe(true);

			// Organizer B lists events (must NOT see Org A events)
			const resB = await app.request("http://localhost:5173/api/events", {
				headers: { Cookie: organizerBCookie },
			});
			expect(resB.status).toBe(200);
			const dataB = await resB.json() as { events: Array<{ id: string; organizationId: string }> };
			expect(dataB.events.some((e) => e.id === createdEventId)).toBe(false);
		});

		it("retrieves event details by ID, hiding private event from non-members with 404", async () => {
			// Organizer A can view
			const resOwner = await app.request(`http://localhost:5173/api/events/${createdEventId}`, {
				headers: { Cookie: organizerACookie },
			});
			expect(resOwner.status).toBe(200);

			// Organizer B cannot view (returns 404 to avoid leaking resource existence)
			const resForeign = await app.request(`http://localhost:5173/api/events/${createdEventId}`, {
				headers: { Cookie: organizerBCookie },
			});
			expect(resForeign.status).toBe(404);
		});

		it("updates draft event details and appends audit log", async () => {
			const updatedTitle = "Upacara Odalan Test (Revisi)";
			const res = await app.request(`http://localhost:5173/api/events/${createdEventId}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: JSON.stringify({
					title: updatedTitle,
					venueName: "Balai Banjar Utama",
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json() as { event: { title: string; venueName: string } };
			expect(body.event.title).toBe(updatedTitle);
			expect(body.event.venueName).toBe("Balai Banjar Utama");

			// Check audit record
			const updateAudits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, createdEventId),
						eq(auditLogs.action, "event.updated"),
					),
				);
			expect(updateAudits.length).toBe(1);
			expect(updateAudits[0].afterJson).toMatchObject({
				title: updatedTitle,
				venueName: "Balai Banjar Utama",
			});
		});

		it("rejects PATCH from field officer with 403 Forbidden", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${createdEventId}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Cookie: officerACookie,
				},
				body: JSON.stringify({ title: "Unauthorized Patch" }),
			});

			expect(res.status).toBe(403);
		});
	});

	describe("4. Assignment Scoping & Revocation (A03 / FR-004, FR-005)", () => {
		let testEventId = "";
		let assignmentId = "";

		beforeAll(async () => {
			// Create dedicated test event in Org A
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

		it("organizer creates an event assignment for officer", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}/assignments`, {
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
			});

			expect(res.status).toBe(201);
			const data = await res.json() as { assignment: { id: string; userId: string; canUpdateTraffic: boolean; canUpdateCleanup: boolean } };
			expect(data.assignment.userId).toBe(fixtureUserOfficerA.id);
			expect(data.assignment.canUpdateTraffic).toBe(true);
			expect(data.assignment.canUpdateCleanup).toBe(false);
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

		it("assigned officer can now access assigned event details", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}`, {
				headers: { Cookie: officerACookie },
			});
			expect(res.status).toBe(200);
		});

		it("unassigned officer from foreign org receives 404 on event details", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}`, {
				headers: { Cookie: organizerBCookie },
			});
			expect(res.status).toBe(404);
		});

		it("field officer cannot manage assignments (returns 403)", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}/assignments`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: officerACookie,
				},
				body: JSON.stringify({
					userId: fixtureUserOfficerA.id,
					canUpdateCleanup: true,
				}),
			});
			expect(res.status).toBe(403);
		});

		it("organizer lists assignments for event", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}/assignments`, {
				headers: { Cookie: organizerACookie },
			});

			expect(res.status).toBe(200);
			const data = await res.json() as { assignments: Array<{ id: string; userId: string; userName: string }> };
			expect(data.assignments.some((a) => a.id === assignmentId)).toBe(true);
			expect(data.assignments[0].userName).toBe(fixtureUserOfficerA.name);
		});

		it("organizer revokes officer assignment and records audit log", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}/assignments/${assignmentId}`, {
				method: "DELETE",
				headers: { Cookie: organizerACookie },
			});

			expect(res.status).toBe(200);

			// Verify assignment removed from database
			const check = await db
				.select()
				.from(eventAssignments)
				.where(eq(eventAssignments.id, assignmentId));
			expect(check.length).toBe(0);

			// Verify revocation audit log
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, testEventId),
						eq(auditLogs.action, "assignment.revoked"),
					),
				);
			expect(audits.length).toBe(1);
		});
	});

	describe("5. Event Review & Verified Publication (A04 / FR-013..015, AC-07)", () => {
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

		it("moves draft event to review state with human verification metadata", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${publishEventId}/review`, {
				method: "POST",
				headers: { Cookie: organizerACookie },
			});

			expect(res.status).toBe(200);
			const data = await res.json() as { event: { status: string; verifiedBy: string; verifiedAt: string } };
			expect(data.event.status).toBe("review");
			expect(data.event.verifiedBy).toBe(fixtureUserOrganizerA.id);
			expect(data.event.verifiedAt).toBeDefined();

			// Audit record
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, publishEventId),
						eq(auditLogs.action, "event.reviewed"),
					),
				);
			expect(audits.length).toBe(1);
		});

		it("REJECTS publication when event has NO verified road impacts (AC-07 prerequisite)", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${publishEventId}/publish`, {
				method: "POST",
				headers: { Cookie: organizerACookie },
			});

			expect(res.status).toBe(422);
			const body = await res.json() as { error: { code: string; message: string } };
			expect(body.error.code).toBe("VALIDATION_FAILED");
			expect(body.error.message).toContain("verified road impact");

			// Event status must still be review, NOT published
			const eventCheck = await db
				.select({ status: events.status })
				.from(events)
				.where(eq(events.id, publishEventId));
			expect(eventCheck[0].status).toBe("review");
		});

		it("successfully publishes event once verified road impact fixture is attached", async () => {
			// Attach verified road impact fixture
			await db.insert(roadImpacts).values({
				eventId: publishEventId,
				roadSegmentId: fixtureRoadSegment.id,
				plannedFrom: new Date("2026-11-25T07:00:00Z"),
				plannedTo: new Date("2026-11-25T15:00:00Z"),
				impactType: "closure",
				diversionNote: "Jalur dialihkan ke Jl. Uji Coba Segmen B",
			});

			// Now attempt publication
			const res = await app.request(`http://localhost:5173/api/events/${publishEventId}/publish`, {
				method: "POST",
				headers: { Cookie: organizerACookie },
			});

			expect(res.status).toBe(200);
			const body = await res.json() as { event: { status: string; publicSlug: string; publishedAt: string } };
			expect(body.event.status).toBe("published");
			expect(body.event.publicSlug).toBeDefined();
			expect(body.event.publicSlug).toContain("ngaben-massal-desa-a");
			expect(body.event.publishedAt).toBeDefined();

			// Audit record
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
			expect(audits[0].afterJson).toMatchObject({
				status: "published",
				publicSlug: body.event.publicSlug,
			});
		});

		it("is idempotent: repeated publish call preserves slug and does not duplicate status", async () => {
			const resFirst = await app.request(`http://localhost:5173/api/events/${publishEventId}`, {
				headers: { Cookie: organizerACookie },
			});
			const slugFirst = (await resFirst.json() as { event: { publicSlug: string } }).event.publicSlug;

			const resRepeat = await app.request(`http://localhost:5173/api/events/${publishEventId}/publish`, {
				method: "POST",
				headers: { Cookie: organizerACookie },
			});

			expect(resRepeat.status).toBe(200);
			const dataRepeat = await resRepeat.json() as { event: { publicSlug: string } };
			expect(dataRepeat.event.publicSlug).toBe(slugFirst);
		});

		it("rejects publish request from officer with 403 Forbidden", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${publishEventId}/publish`, {
				method: "POST",
				headers: { Cookie: officerACookie },
			});
			expect(res.status).toBe(403);
		});
	});

	describe("6. Event Lifecycle Transitions (A04 / FR-012, AGENTS.md §13)", () => {
		let lifecycleEventId = "";

		beforeAll(async () => {
			const eventRows = await db
				.insert(events)
				.values({
					organizationId: fixtureOrgA.id,
					createdBy: fixtureUserOrganizerA.id,
					title: "Pawai Ogoh-ogoh Simulasi",
					status: "published",
				})
				.returning();
			lifecycleEventId = eventRows[0].id;
		});

		it("cancels an event with mandatory reason and records audit log", async () => {
			const cancellationReason = "Kondisi cuaca ekstrem dan angin kencang";

			const res = await app.request(`http://localhost:5173/api/events/${lifecycleEventId}/cancel`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: JSON.stringify({ reason: cancellationReason }),
			});

			expect(res.status).toBe(200);
			const body = await res.json() as { event: { status: string }; reason: string };
			expect(body.event.status).toBe("cancelled");
			expect(body.reason).toBe(cancellationReason);

			// Audit record contains cancellation reason
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, lifecycleEventId),
						eq(auditLogs.action, "event.cancelled"),
					),
				);
			expect(audits.length).toBe(1);
			expect(audits[0].afterJson).toMatchObject({
				status: "cancelled",
				cancellationReason,
			});
		});

		it("rejects cancellation without reason", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${lifecycleEventId}/cancel`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: JSON.stringify({ reason: "   " }),
			});

			expect(res.status).toBe(422);
		});

		it("completes operational event lifecycle and records audit log", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${lifecycleEventId}/complete`, {
				method: "POST",
				headers: { Cookie: organizerACookie },
			});

			expect(res.status).toBe(200);
			const body = await res.json() as { event: { status: string } };
			expect(body.event.status).toBe("completed");

			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, lifecycleEventId),
						eq(auditLogs.action, "event.completed"),
					),
				);
			expect(audits.length).toBe(1);
		});
	});

	describe("7. Safe Error Handling Envelope (docs/06-API-CONTRACT.md §2)", () => {
		it("returns 404 envelope for non-existent routes", async () => {
			const res = await app.request("http://localhost:5173/api/non-existent-route");
			expect(res.status).toBe(404);
			const body = await res.json() as { error: { code: string; message: string; requestId: string } };
			expect(body.error.code).toBe("NOT_FOUND");
			expect(body.error.requestId).toBeDefined();
		});

		it("returns 400 envelope for invalid JSON payload", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerACookie,
				},
				body: "{ invalid json payload",
			});

			expect(res.status).toBe(400);
			const body = await res.json() as { error: { code: string } };
			expect(body.error.code).toBe("BAD_REQUEST");
		});
	});
});
