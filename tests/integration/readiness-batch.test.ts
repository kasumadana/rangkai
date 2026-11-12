import crypto from "node:crypto";
import * as dotenv from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { assertDevBranch, AUTHORIZED_DEV_BRANCH } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db/index";
import { account, session, user } from "../../src/db/auth-schema";
import {
	auditLogs,
	cleanupTasks,
	eventAssignments,
	events,
	invitations,
	memberships,
	organizations,
	organizationApplications,
	platformAudit,
	platformGrants,
	roadImpacts,
	roadSegments,
} from "../../src/db/schema";
import app from "../../src/worker/index";

dotenv.config({ path: ".dev.vars" });

describe("Production Readiness Integration Suite (Tickets 01 - 04)", () => {
	let db: DbClient;
	let pinnedUrl: string;

	const runKey = crypto.randomUUID().slice(0, 8);
	const testPassword = "SecureBatchPass123!";

	// Fixture Users
	const organizerUser = {
		id: `usr_batch_org_${runKey}`,
		name: `Batch Organizer ${runKey}`,
		email: `batch.organizer.${runKey}@test.local`,
		emailVerified: true,
	};

	const officerUserA = {
		id: `usr_batch_off_a_${runKey}`,
		name: `Batch Officer A ${runKey}`,
		email: `batch.officer.a.${runKey}@test.local`,
		emailVerified: true,
	};

	const officerUserB = {
		id: `usr_batch_off_b_${runKey}`,
		name: `Batch Officer B ${runKey}`,
		email: `batch.officer.b.${runKey}@test.local`,
		emailVerified: true,
	};

	const unassignedOfficer = {
		id: `usr_batch_unassigned_${runKey}`,
		name: `Batch Unassigned ${runKey}`,
		email: `batch.unassigned.${runKey}@test.local`,
		emailVerified: true,
	};

	// Fixture Organizations
	const simOrg = {
		id: crypto.randomUUID(),
		name: `Desa Adat Simulasi (${runKey})`,
		village: "Desa Uji",
		district: "Kecamatan Uji",
		hasOperationalAuthority: false,
	};

	const operationalOrg = {
		id: crypto.randomUUID(),
		name: `Desa Adat Berwenang (${runKey})`,
		village: "Desa Resmi",
		district: "Kecamatan Resmi",
		hasOperationalAuthority: true,
		operationalAuthorityGrantedAt: new Date(),
		operationalAuthorityGrantedBy: "synthetic-test-actor",
		operationalAuthorityProvenance: "Synthetic integration test fixture",
	};

	const roadSegment = {
		id: crypto.randomUUID(),
		displayName: `[TEST] Ruas Terverifikasi (${runKey})`,
		geom: "SRID=4326;LINESTRING(115.2166 -8.6500, 115.2170 -8.6510)",
		coverageArea: "Koridor Uji",
		verifiedBy: "system_verifier",
		verifiedAt: new Date("2026-11-01T00:00:00Z"),
	};

	const simEventForInvites = {
		id: crypto.randomUUID(),
		organizationId: simOrg.id,
		createdBy: organizerUser.id,
		title: `Upacara Acuan Undangan (${runKey})`,
		status: "draft" as const,
		isSimulation: true,
		startsAt: new Date("2026-11-20T08:00:00Z"),
		endsAt: new Date("2026-11-20T14:00:00Z"),
		venueName: "Balai Desa",
	};

	let organizerCookie = "";
	let officerACookie = "";
	let officerBCookie = "";
	let unassignedCookie = "";

	beforeAll(async () => {
		const preflight = await assertDevBranch();
		expect(preflight.branchId).toBe(AUTHORIZED_DEV_BRANCH);
		pinnedUrl = preflight.pinnedUrl;
		db = getDb(pinnedUrl);

		// Seed organizations
		await db.insert(organizations).values([simOrg, operationalOrg]);

		// Seed verified road segment
		await db.insert(roadSegments).values([roadSegment]);

		// Seed users
		await db.insert(user).values([
			organizerUser,
			officerUserA,
			officerUserB,
			unassignedOfficer,
		]);

		const hashedPw = await hashPassword(testPassword);
		await db.insert(account).values([
			{
				id: `acc_org_${runKey}`,
				accountId: organizerUser.id,
				providerId: "credential",
				userId: organizerUser.id,
				password: hashedPw,
			},
			{
				id: `acc_off_a_${runKey}`,
				accountId: officerUserA.id,
				providerId: "credential",
				userId: officerUserA.id,
				password: hashedPw,
			},
			{
				id: `acc_off_b_${runKey}`,
				accountId: officerUserB.id,
				providerId: "credential",
				userId: officerUserB.id,
				password: hashedPw,
			},
			{
				id: `acc_unassigned_${runKey}`,
				accountId: unassignedOfficer.id,
				providerId: "credential",
				userId: unassignedOfficer.id,
				password: hashedPw,
			},
		]);

		// Seed base event for invites
		await db.insert(events).values([simEventForInvites]);

		// Seed memberships
		await db.insert(memberships).values([
			{
				organizationId: simOrg.id,
				userId: organizerUser.id,
				role: "organizer",
			},
			{
				organizationId: operationalOrg.id,
				userId: organizerUser.id,
				role: "organizer",
			},
			{
				organizationId: simOrg.id,
				userId: unassignedOfficer.id,
				role: "officer",
			},
		]);

		// Obtain session cookies
		const signInUser = async (email: string) => {
			const res = await app.request("http://localhost:5173/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, password: testPassword }),
			});
			expect(res.status).toBe(200);
			return (res.headers.get("set-cookie") || "").split(";")[0];
		};

		organizerCookie = await signInUser(organizerUser.email);
		officerACookie = await signInUser(officerUserA.email);
		officerBCookie = await signInUser(officerUserB.email);
		unassignedCookie = await signInUser(unassignedOfficer.email);
	});

	afterAll(async () => {
		try {
			const orgIds = [simOrg.id, operationalOrg.id];
			const userIds = [
				organizerUser.id,
				officerUserA.id,
				officerUserB.id,
				unassignedOfficer.id,
			];

			// Clean up invitations
			await db.delete(invitations).where(inArray(invitations.organizationId, orgIds));

			// Clean up events and road impacts
			const eventRows = await db
				.select({ id: events.id })
				.from(events)
				.where(inArray(events.organizationId, orgIds));
			const eventIds = eventRows.map((e) => e.id);

			if (eventIds.length > 0) {
				await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
				await db.delete(cleanupTasks).where(inArray(cleanupTasks.eventId, eventIds));
				await db.delete(eventAssignments).where(inArray(eventAssignments.eventId, eventIds));
				await db.delete(auditLogs).where(inArray(auditLogs.organizationId, orgIds));
				await db.delete(events).where(inArray(events.id, eventIds));
			}

			await db.delete(memberships).where(inArray(memberships.organizationId, orgIds));
			await db.delete(roadSegments).where(inArray(roadSegments.organizationId, orgIds));
			await db.delete(roadSegments).where(eq(roadSegments.id, roadSegment.id));
			await db.delete(session).where(inArray(session.userId, userIds));
			await db.delete(account).where(inArray(account.userId, userIds));
			await db.delete(user).where(inArray(user.id, userIds));
			await db.delete(organizations).where(inArray(organizations.id, orgIds));
		} catch (err) {
			console.error("Cleanup error in afterAll:", err);
		}
	});

	// =========================================================================
	// TICKET 01: Safe Onboarding & Atomic Creation
	// =========================================================================
	describe("Ticket 01: Reviewed Organization Applications", () => {
        const orgName = `Desa Baru Atomik (${runKey})`;
        let applicationId = "";
        let createdOrgId = "";
        const headers = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });
        beforeAll(async () => { await db.insert(platformGrants).values({ userId: officerUserB.id, role: "superadmin", status: "active" }); });
        afterAll(async () => {
            const applications = await db.select().from(organizationApplications).where(and(eq(organizationApplications.applicantId, organizerUser.id), eq(organizationApplications.name, orgName)));
            for (const application of applications) {
                await db.delete(platformAudit).where(eq(platformAudit.applicationId, application.id));
                await db.delete(organizationApplications).where(eq(organizationApplications.id, application.id));
                if (application.organizationId) { await db.delete(memberships).where(eq(memberships.organizationId, application.organizationId)); await db.delete(organizations).where(eq(organizations.id, application.organizationId)); }
            }
            await db.delete(platformGrants).where(eq(platformGrants.userId, officerUserB.id));
        });
        it("requires approval and atomically creates organization, membership and audit", async () => {
            const data = { name: orgName, village: "Desa Baru", district: "Kecamatan Baru" };
            const legacy = await app.request("http://localhost:5173/api/organizations", { method: "POST", headers: headers(organizerCookie), body: JSON.stringify(data) });
            expect(legacy.status).toBe(403);
            const submitted = await app.request("http://localhost:5173/api/me/organization-applications", { method: "POST", headers: headers(organizerCookie), body: JSON.stringify(data) });
            expect(submitted.status).toBe(201);
            applicationId = ((await submitted.json()) as { application: { id: string } }).application.id;
            const denied = await app.request(`http://localhost:5173/api/admin/organization-applications/${applicationId}/decision`, { method: "POST", headers: headers(organizerCookie), body: JSON.stringify({ decision: "approve" }) });
            expect(denied.status).toBe(403);
            const approved = await app.request(`http://localhost:5173/api/admin/organization-applications/${applicationId}/decision`, { method: "POST", headers: headers(officerBCookie), body: JSON.stringify({ decision: "approve" }) });
            expect(approved.status).toBe(200);
            createdOrgId = ((await approved.json()) as { application: { organizationId: string } }).application.organizationId;
            const org = await db.select().from(organizations).where(eq(organizations.id, createdOrgId));
            const member = await db.select().from(memberships).where(and(eq(memberships.organizationId, createdOrgId), eq(memberships.userId, organizerUser.id)));
            const audit = await db.select().from(platformAudit).where(and(eq(platformAudit.applicationId, applicationId), eq(platformAudit.action, "organization_application.approved")));
            expect(org[0].hasOperationalAuthority).toBe(false); expect(member[0].role).toBe("organizer"); expect(audit).toHaveLength(1);
        });
        it("returns the existing decision on repeated approval", async () => {
            const res = await app.request(`http://localhost:5173/api/admin/organization-applications/${applicationId}/decision`, { method: "POST", headers: headers(officerBCookie), body: JSON.stringify({ decision: "approve" }) });
            expect(res.status).toBe(200); expect(((await res.json()) as { application: { organizationId: string } }).application.organizationId).toBe(createdOrgId);
            const audit = await db.select().from(platformAudit).where(and(eq(platformAudit.applicationId, applicationId), eq(platformAudit.action, "organization_application.approved"))); expect(audit).toHaveLength(1);
        });
        it("returns a sanitized validation error for invalid application data", async () => {
            const res = await app.request("http://localhost:5173/api/me/organization-applications", { method: "POST", headers: headers(organizerCookie), body: JSON.stringify({ name: "" }) });
            expect(res.status).toBe(422); const data = await res.json() as { error: { code: string; message: string; requestId: string } };
            expect(data.error.code).toBe("VALIDATION_FAILED"); expect(data.error.requestId).toBeDefined(); expect(data.error.message).not.toContain("SQL"); expect(data.error.message).not.toContain("SELECT");
        });
    });

	// =========================================================================
	// TICKET 02: Secure Token Hashing, Atomic CAS Acceptance, Recipient Binding
	// =========================================================================
	describe("Ticket 02: Invitations, Token Hashing & CAS Acceptance", () => {
		let sharedInviteToken = "";
		let sharedInviteId = "";
		let boundInviteToken = "";

		it("creates invitation with SHA-256 token hash and audit log", async () => {
			const res = await app.request("http://localhost:5173/api/invitations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					organizationId: simOrg.id,
					eventId: simEventForInvites.id,
					role: "officer",
					recipientEmail: officerUserB.email,
					canUpdateTraffic: true,
					canUpdateCleanup: true,
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as {
				invitation: { id: string; token: string; inviteUrl: string };
			};
			expect(data.invitation.token).toBeDefined();
			expect(data.invitation.inviteUrl).toContain(data.invitation.token);

			sharedInviteToken = data.invitation.token;
			sharedInviteId = data.invitation.id;

			// Verify tokenHash in DB is 64 hex characters (SHA-256) and does not store raw token
			const [row] = await db
				.select()
				.from(invitations)
				.where(eq(invitations.id, sharedInviteId));
			expect(row).toBeDefined();
			expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
			expect(row.tokenHash).not.toBe(sharedInviteToken);

			// Verify audit log for creation
			const [audit] = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.organizationId, simOrg.id),
						eq(auditLogs.action, "invitation.created"),
						eq(auditLogs.entityId, sharedInviteId),
					),
				);
			expect(audit).toBeDefined();
		});

		it("creates recipient-bound invitation and rejects acceptance from mismatched email", async () => {
			const res = await app.request("http://localhost:5173/api/invitations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					organizationId: simOrg.id,
					eventId: simEventForInvites.id,
					role: "officer",
					recipientEmail: officerUserA.email, // Bound specifically to Officer A
					canUpdateTraffic: true,
					canUpdateCleanup: false,
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as { invitation: { token: string } };
			boundInviteToken = data.invitation.token;

			// Officer B tries to accept Officer A's bound invite -> 403 Forbidden!
			const rejectRes = await app.request(
				`http://localhost:5173/api/invitations/${encodeURIComponent(boundInviteToken)}/accept`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: officerBCookie,
					},
					body: JSON.stringify({}),
				},
			);

			expect(rejectRes.status).toBe(403);
			const err = (await rejectRes.json()) as { error: { code: string; message: string } };
			expect(err.error.code).toBe("FORBIDDEN");
			expect(err.error.message).toContain("tidak cocok dengan email tujuan undangan");
		});

		it("allows matching recipient to accept bound invitation and grants membership/audit", async () => {
			// Officer A accepts their bound invite -> 200 OK!
			const acceptRes = await app.request(
				`http://localhost:5173/api/invitations/${encodeURIComponent(boundInviteToken)}/accept`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: officerACookie,
					},
					body: JSON.stringify({}),
				},
			);

			expect(acceptRes.status).toBe(200);
			const data = (await acceptRes.json()) as { success: boolean; role: string };
			expect(data.success).toBe(true);
			expect(data.role).toBe("officer");

			// Verify invitation status became accepted
			const [invRow] = await db
				.select()
				.from(invitations)
				.where(eq(invitations.recipientEmail, officerUserA.email));
			expect(invRow.status).toBe("accepted");
			expect(invRow.acceptedBy).toBe(officerUserA.id);

			// Verify audit log for acceptance
			const [audit] = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.organizationId, simOrg.id),
						eq(auditLogs.action, "invitation.accepted"),
					),
				);
			expect(audit).toBeDefined();
		});

		it("PROBE: CAS race probe ensures concurrent double-accept yields exactly one 200 and one 409", async () => {
			// Create a fresh open invitation for the race probe
			const createRes = await app.request("http://localhost:5173/api/invitations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					organizationId: simOrg.id,
					eventId: simEventForInvites.id,
					role: "officer",
					recipientEmail: officerUserB.email,
					canUpdateTraffic: true,
					canUpdateCleanup: true,
				}),
			});
			expect(createRes.status).toBe(201);
			const { invitation } = (await createRes.json()) as { invitation: { token: string } };

			// Fire two concurrent acceptance requests simultaneously
			const [res1, res2] = await Promise.all([
				app.request(
					`http://localhost:5173/api/invitations/${encodeURIComponent(invitation.token)}/accept`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Cookie: officerBCookie,
						},
						body: JSON.stringify({}),
					},
				),
				app.request(
					`http://localhost:5173/api/invitations/${encodeURIComponent(invitation.token)}/accept`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Cookie: officerBCookie,
						},
						body: JSON.stringify({}),
					},
				),
			]);

			const statuses = [res1.status, res2.status].sort();
			// Exactly one must succeed (200) and the other must fail closed (409)
			expect(statuses).toEqual([200, 409]);
		});

		it("revoking invitation prevents any subsequent acceptance", async () => {
			// Create invitation
			const createRes = await app.request("http://localhost:5173/api/invitations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					organizationId: simOrg.id,
					eventId: simEventForInvites.id,
					role: "officer",
					recipientEmail: officerUserB.email,
					canUpdateTraffic: true,
					canUpdateCleanup: true,
				}),
			});
			const { invitation } = (await createRes.json()) as { invitation: { id: string; token: string } };

			// Revoke it
			const revokeRes = await app.request(
				`http://localhost:5173/api/invitations/${encodeURIComponent(invitation.id)}`,
				{
					method: "DELETE",
					headers: {
						Cookie: organizerCookie,
					},
				},
			);
			expect(revokeRes.status).toBe(200);

			// Try to accept -> 409 Conflict
			const acceptRes = await app.request(
				`http://localhost:5173/api/invitations/${encodeURIComponent(invitation.token)}/accept`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: officerBCookie,
					},
					body: JSON.stringify({}),
				},
			);
			expect(acceptRes.status).toBe(409);
		});

		it("rejects missing recipient email at the API boundary", async () => {
			const response = await app.request("http://localhost:5173/api/invitations", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, role: "organizer" }),
			});
			expect(response.status).toBe(422);
		});

		it("allows anonymous recipients to inspect an organizer invitation", async () => {
			const created = await app.request("http://localhost:5173/api/invitations", {
				method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, role: "organizer", recipientEmail: officerUserB.email }),
			});
			expect(created.status).toBe(201);
			const { invitation } = await created.json() as { invitation: { token: string } };
			const inspected = await app.request(`http://localhost:5173/api/invitations/${invitation.token}`);
			expect(inspected.status).toBe(200);
			const body = await inspected.json() as { invitationRole: string; event: unknown };
			expect(body.invitationRole).toBe("organizer");
			expect(body.event).toBeNull();
		});

		it("does not consume a field invitation after its event is cancelled", async () => {
			const created = await app.request("http://localhost:5173/api/invitations", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, eventId: simEventForInvites.id, role: "officer", recipientEmail: officerUserB.email, canUpdateTraffic: true }),
			});
			expect(created.status).toBe(201);
			const { invitation } = await created.json() as { invitation: { id: string; token: string } };
			try {
				await db.update(events).set({ status: "cancelled" }).where(eq(events.id, simEventForInvites.id));
				const accepted = await app.request(`http://localhost:5173/api/invitations/${invitation.token}/accept`, {
					method: "POST", headers: { "Content-Type": "application/json", Cookie: officerBCookie }, body: "{}",
				});
				expect(accepted.status).toBe(409);
				const [stored] = await db.select().from(invitations).where(eq(invitations.id, invitation.id));
				expect(stored.status).toBe("pending");
			} finally {
				await db.update(events).set({ status: "draft" }).where(eq(events.id, simEventForInvites.id));
			}
		});

		it("does not consume an invitation after its creator loses organizer membership", async () => {
			const created = await app.request("http://localhost:5173/api/invitations", {
				method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, role: "organizer", recipientEmail: officerUserB.email }),
			});
			expect(created.status).toBe(201);
			const { invitation } = await created.json() as { invitation: { id: string; token: string } };
			try {
				await db.update(memberships).set({ role: "officer" }).where(and(eq(memberships.organizationId, simOrg.id), eq(memberships.userId, organizerUser.id)));
				const accepted = await app.request(`http://localhost:5173/api/invitations/${invitation.token}/accept`, {
					method: "POST", headers: { "Content-Type": "application/json", Cookie: officerBCookie }, body: "{}",
				});
				expect(accepted.status).toBe(403);
				const [stored] = await db.select().from(invitations).where(eq(invitations.id, invitation.id));
				expect(stored.status).toBe("pending");
			} finally {
				await db.update(memberships).set({ role: "organizer" }).where(and(eq(memberships.organizationId, simOrg.id), eq(memberships.userId, organizerUser.id)));
			}
		});

		it("preserves prior assignment grants and audits actual before and after values", async () => {
			await db.insert(eventAssignments).values({ eventId: simEventForInvites.id, userId: officerUserB.id, canUpdateTraffic: true, canUpdateCleanup: false }).onConflictDoUpdate({ target: [eventAssignments.eventId, eventAssignments.userId], set: { canUpdateTraffic: true, canUpdateCleanup: false } });
			const created = await app.request("http://localhost:5173/api/invitations", {
				method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, eventId: simEventForInvites.id, role: "officer", recipientEmail: officerUserB.email, canUpdateCleanup: true }),
			});
			expect(created.status).toBe(201);
			const { invitation } = await created.json() as { invitation: { id: string; token: string } };
			const accepted = await app.request(`http://localhost:5173/api/invitations/${invitation.token}/accept`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: officerBCookie }, body: "{}" });
			expect(accepted.status).toBe(200);
			const [assignment] = await db.select().from(eventAssignments).where(and(eq(eventAssignments.eventId, simEventForInvites.id), eq(eventAssignments.userId, officerUserB.id)));
			expect([assignment.canUpdateTraffic, assignment.canUpdateCleanup]).toEqual([true, true]);
			const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, invitation.id), eq(auditLogs.action, "invitation.accepted")));
			expect(audit.actorId).toBe(officerUserB.id);
			expect(audit.beforeJson).toMatchObject({ assignment: { can_update_traffic: true, can_update_cleanup: false } });
			expect(audit.afterJson).toMatchObject({ assignment: { can_update_traffic: true, can_update_cleanup: true } });
		});

		it("serializes acceptance against revocation", async () => {
			const created = await app.request("http://localhost:5173/api/invitations", {
				method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, eventId: simEventForInvites.id, role: "officer", recipientEmail: officerUserB.email, canUpdateTraffic: true }),
			});
			expect(created.status).toBe(201);
			const { invitation } = await created.json() as { invitation: { id: string; token: string } };
			const [accept, revoke] = await Promise.all([
				app.request(`http://localhost:5173/api/invitations/${invitation.token}/accept`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: officerBCookie }, body: "{}" }),
				app.request(`http://localhost:5173/api/invitations/${invitation.id}`, { method: "DELETE", headers: { Cookie: organizerCookie } }),
			]);
			expect([accept.status, revoke.status].sort()).toEqual([200, 409]);
			const [stored] = await db.select().from(invitations).where(eq(invitations.id, invitation.id));
			expect(stored.status).toBe(accept.status === 200 ? "accepted" : "revoked");
		});

		it("does not grant a concurrent wrong-email actor", async () => {
			const created = await app.request("http://localhost:5173/api/invitations", {
				method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, eventId: simEventForInvites.id, role: "officer", recipientEmail: officerUserB.email, canUpdateTraffic: true }),
			});
			expect(created.status).toBe(201);
			const { invitation } = await created.json() as { invitation: { id: string; token: string } };
			const accept = (cookie: string) => app.request(`http://localhost:5173/api/invitations/${invitation.token}/accept`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
			const [right, wrong] = await Promise.all([accept(officerBCookie), accept(officerACookie)]);
			expect(right.status).toBe(200);
			expect([403, 409]).toContain(wrong.status);
			const [stored] = await db.select().from(invitations).where(eq(invitations.id, invitation.id));
			expect(stored.acceptedBy).toBe(officerUserB.id);
		});

		it("rolls back consumption and membership when audit insertion fails", async () => {
			const created = await app.request("http://localhost:5173/api/invitations", {
				method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ organizationId: simOrg.id, role: "organizer", recipientEmail: officerUserB.email }),
			});
			expect(created.status).toBe(201);
			const { invitation } = await created.json() as { invitation: { id: string; token: string } };
			const [before] = await db.select().from(memberships).where(and(eq(memberships.organizationId, simOrg.id), eq(memberships.userId, officerUserB.id)));
			const name = `test_inv_audit_${runKey.replaceAll("-", "")}`;
			try {
				await db.execute(sql.raw(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = '${invitation.id}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`));
				await db.execute(sql.raw(`CREATE TRIGGER "${name}" BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION "${name}"()`));
				const accepted = await app.request(`http://localhost:5173/api/invitations/${invitation.token}/accept`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: officerBCookie }, body: "{}" });
				expect(accepted.status).toBe(500);
				const [stored] = await db.select().from(invitations).where(eq(invitations.id, invitation.id));
				const [after] = await db.select().from(memberships).where(and(eq(memberships.organizationId, simOrg.id), eq(memberships.userId, officerUserB.id)));
				expect(stored.status).toBe("pending");
				expect(after?.role).toBe(before?.role);
			} finally {
				await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${name}" ON audit_logs`));
				await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${name}"()`));
			}
		});
	});

	// =========================================================================
	// TICKET 03: Simulation vs Operational Authority Gate
	// =========================================================================
	describe("Ticket 03: Operational Authority Gate & Simulation Publication", () => {
		let simDraftEventId = "";
		let opDraftEventId = "";
		let drawnRoadId = "";

		it("creates draft event with isSimulation: true by default", async () => {
			const res = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					organizationId: simOrg.id,
					title: `Upacara Simulasi Default (${runKey})`,
					startsAt: "2026-11-20T08:00:00+08:00",
					endsAt: "2026-11-20T14:00:00+08:00",
					category: "upacara",
					venueName: "Pura Desa Simulasi",
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as { event: { id: string; isSimulation: boolean } };
			expect(data.event.isSimulation).toBe(true);
			simDraftEventId = data.event.id;
		});

		it("creates a tenant-scoped simulation road and safely retries the same request", async () => {
			drawnRoadId = crypto.randomUUID();
			const payload = { mutationId: drawnRoadId, displayName: `[TEST] ${runKey}`, coverageArea: "Lokasi uji", coordinates: [[115.2166, -8.65], [115.217, -8.651]], humanVerified: true, plannedFrom: "2026-11-20T00:00:00Z", plannedTo: "2026-11-20T06:00:00Z", impactType: "closure" };
			const request = () => app.request(`http://localhost:5173/api/events/${simDraftEventId}/simulation-road-impacts`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie }, body: JSON.stringify(payload) });
			expect((await request()).status).toBe(201);
			expect((await request()).status).toBe(200);
			const [segment] = await db.select().from(roadSegments).where(eq(roadSegments.id, drawnRoadId));
			expect(segment.sourceType).toBe("simulation_draft");
			expect(segment.organizationId).toBe(simOrg.id);
			expect(segment.verifiedBy).toBeNull();
			const catalog = await app.request("http://localhost:5173/api/road-segments?bbox=115.2,-8.7,115.3,-8.6", { headers: { Cookie: organizerCookie } });
			expect(catalog.status).toBe(200);
			const data = await catalog.json() as { segments: Array<{ id: string }> };
			expect(data.segments.some((item) => item.id === drawnRoadId)).toBe(false);
		});

		it("rejects drawing if organizer membership is revoked before the atomic write", async () => {
			const realFetch = globalThis.fetch;
			let intercepted = false;
			const id = crypto.randomUUID();
			try {
				globalThis.fetch = async (input, init) => {
					let query = "";
					try { query = JSON.parse(String(init?.body)).query ?? ""; } catch { /* non-database request */ }
					if (!intercepted && query.includes("INSERT INTO road_segments")) {
						intercepted = true;
						await db.update(memberships).set({ role: "officer" }).where(and(eq(memberships.organizationId, simOrg.id), eq(memberships.userId, organizerUser.id)));
					}
					return realFetch(input, init);
				};
				const response = await app.request(`http://localhost:5173/api/events/${simDraftEventId}/simulation-road-impacts`, {
					method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
					body: JSON.stringify({ mutationId: id, displayName: `[TEST] ${runKey}`, coverageArea: "Lokasi uji", coordinates: [[115.2166, -8.65], [115.217, -8.651]], humanVerified: true, plannedFrom: "2026-11-20T00:00:00Z", plannedTo: "2026-11-20T06:00:00Z", impactType: "closure" }),
				});
				expect(intercepted).toBe(true);
				expect(response.status).toBe(403);
				expect(await db.select().from(roadSegments).where(eq(roadSegments.id, id))).toHaveLength(0);
			} finally {
				globalThis.fetch = realFetch;
				await db.update(memberships).set({ role: "organizer" }).where(and(eq(memberships.organizationId, simOrg.id), eq(memberships.userId, organizerUser.id)));
			}
		});

		it("rejects operational publication (isSimulation: false) when organization lacks operational authority (403)", async () => {
			// Attach verified road impact first
			const impactRes = await app.request(`http://localhost:5173/api/events/${simDraftEventId}/road-impacts`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					roadSegmentId: roadSegment.id,
					plannedFrom: "2026-11-20T08:00:00+08:00",
					plannedTo: "2026-11-20T14:00:00+08:00",
					impactType: "closure",
				}),
			});
			expect(impactRes.status).toBe(201);

			// Transition to review
			const reviewRes = await app.request(`http://localhost:5173/api/events/${simDraftEventId}/review`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
			});
			expect(reviewRes.status).toBe(200);

			// Attempt publish with isSimulation: false -> 403 Forbidden!
			const pubRes = await app.request(`http://localhost:5173/api/events/${simDraftEventId}/publish`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					isSimulation: false,
				}),
			});

			expect(pubRes.status).toBe(403);
			const err = (await pubRes.json()) as { error: { code: string; message: string } };
			expect(err.error.code).toBe("FORBIDDEN");
			expect(err.error.message).toContain("belum memiliki hak publikasi operasional resmi");
		});

		it("allows simulation publication (isSimulation: true) and labels public event as simulation", async () => {
			const pubRes = await app.request(`http://localhost:5173/api/events/${simDraftEventId}/publish`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					isSimulation: true,
				}),
			});

			expect(pubRes.status).toBe(200);
			const data = (await pubRes.json()) as { event: { status: string; isSimulation: boolean; publicSlug: string } };
			expect(data.event.status).toBe("published");
			expect(data.event.isSimulation).toBe(true);

			// Query public event endpoint anonymously
			const publicRes = await app.request(`http://localhost:5173/api/public/events/${data.event.publicSlug}`);
			expect(publicRes.status).toBe(200);
			const publicData = (await publicRes.json()) as { event: { isSimulation: boolean } };
			expect(publicData.event.isSimulation).toBe(true);
			const list = await app.request("http://localhost:5173/api/public/events?limit=100");
			const listing = await list.json() as { events: Array<{ id: string; isSimulation: boolean }> };
			expect(listing.events.find((item) => item.id === simDraftEventId)?.isSimulation).toBe(true);
			for (const suffix of ["roads", "cleanup-summary"]) {
				const response = await app.request(`http://localhost:5173/api/public/events/${data.event.publicSlug}/${suffix}`);
				expect(response.status).toBe(200);
				expect((await response.json() as { isSimulation: boolean }).isSimulation).toBe(true);
			}
			const roads = await app.request(`http://localhost:5173/api/public/events/${data.event.publicSlug}/roads`);
			expect((await roads.json() as { roads: Array<{ id: string }> }).roads.some((road) => road.id === drawnRoadId)).toBe(true);
		});

		it("allows operational publication (isSimulation: false) when organization has operational authority", async () => {
			// Create event in operationalOrg
			const createRes = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: organizerCookie,
				},
				body: JSON.stringify({
					organizationId: operationalOrg.id,
					title: `Kegiatan operasional sintetis (${runKey})`,
					startsAt: "2026-11-21T08:00:00+08:00",
					endsAt: "2026-11-21T14:00:00+08:00",
					category: "upacara",
					venueName: "Pura Resmi",
				}),
			});
			expect(createRes.status).toBe(201);
			const { event } = (await createRes.json()) as { event: { id: string } };
			opDraftEventId = event.id;
			const foreignDraft = await app.request(`http://localhost:5173/api/events/${opDraftEventId}/road-impacts`, {
				method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ roadSegmentId: drawnRoadId, plannedFrom: "2026-11-21T00:00:00Z", plannedTo: "2026-11-21T06:00:00Z", impactType: "closure" }),
			});
			expect(foreignDraft.status).toBe(422);

			// Attach road impact & transition to review
			const impactRes = await app.request(`http://localhost:5173/api/events/${opDraftEventId}/road-impacts`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({
					roadSegmentId: roadSegment.id,
					plannedFrom: "2026-11-21T08:00:00+08:00",
					plannedTo: "2026-11-21T14:00:00+08:00",
					impactType: "intermittent",
				}),
			});
			expect(impactRes.status).toBe(201);
			const operationalImpact = await impactRes.json() as { roadImpact: { id: string } };

			const reviewRes = await app.request(`http://localhost:5173/api/events/${opDraftEventId}/review`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: organizerCookie },
			});
			expect(reviewRes.status).toBe(200);

			// Publish with isSimulation: false
			const pubRes = await app.request(`http://localhost:5173/api/events/${opDraftEventId}/publish`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({ isSimulation: false }),
			});

			expect(pubRes.status).toBe(200);
			const pubData = (await pubRes.json()) as { event: { isSimulation: boolean; publicSlug: string } };
			expect(pubData.event.isSimulation).toBe(false);
			try {
				await db.update(organizations).set({ hasOperationalAuthority: false }).where(eq(organizations.id, operationalOrg.id));
				for (const suffix of ["", "/roads", "/cleanup-summary"]) {
					const response = await app.request(`http://localhost:5173/api/public/events/${pubData.event.publicSlug}${suffix}`);
					expect(response.status).toBe(404);
				}
				const list = await app.request("http://localhost:5173/api/public/events?limit=100");
				const listing = await list.json() as { events: Array<{ id: string }> };
				expect(listing.events.some((item) => item.id === opDraftEventId)).toBe(false);
				const write = await app.request(`http://localhost:5173/api/road-impacts/${operationalImpact.roadImpact.id}/status`, {
					method: "POST", headers: { "Content-Type": "application/json", Cookie: organizerCookie },
					body: JSON.stringify({ status: "closed", observedAt: new Date().toISOString(), mutationId: crypto.randomUUID() }),
				});
				expect(write.status).toBe(403);
			} finally {
				await db.update(organizations).set({ hasOperationalAuthority: true }).where(eq(organizations.id, operationalOrg.id));
			}
		});
	});

	// =========================================================================
	// TICKET 04: Field Tasks API & Access Scoping
	// =========================================================================
	describe("Ticket 04: Field Tasks API & Permission Scoping", () => {
		let testEventId = "";

		beforeAll(async () => {
			// Ensure Officer A is a member of simOrg with role officer
			await db
				.insert(memberships)
				.values({
					organizationId: simOrg.id,
					userId: officerUserA.id,
					role: "officer",
				})
				.onConflictDoNothing();

			// Create an event and assign Officer A to it
			const createRes = await app.request("http://localhost:5173/api/events", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({
					organizationId: simOrg.id,
					title: `Kegiatan Tugas Lapangan (${runKey})`,
					startsAt: "2026-11-22T08:00:00+08:00",
					endsAt: "2026-11-22T14:00:00+08:00",
				}),
			});
			const { event } = (await createRes.json()) as { event: { id: string } };
			testEventId = event.id;

			// Assign Officer A with traffic=true, cleanup=true
			const assignRes = await app.request(`http://localhost:5173/api/events/${testEventId}/assignments`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: organizerCookie },
				body: JSON.stringify({
					userId: officerUserA.id,
					canUpdateTraffic: true,
					canUpdateCleanup: true,
				}),
			});
			expect(assignRes.status).toBe(201);
		});

		it("GET /api/field/tasks returns assigned events with permissions for assigned officer", async () => {
			const res = await app.request("http://localhost:5173/api/field/tasks", {
				method: "GET",
				headers: { Cookie: officerACookie },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				assignments: Array<{
					eventId: string;
					canUpdateTraffic: boolean;
					canUpdateCleanup: boolean;
				}>;
			};
			const found = data.assignments.find((a) => a.eventId === testEventId);
			expect(found).toBeDefined();
			expect(found?.canUpdateTraffic).toBe(true);
			expect(found?.canUpdateCleanup).toBe(true);
		});

		it("GET /api/field/tasks returns empty assignments for unassigned officer", async () => {
			const res = await app.request("http://localhost:5173/api/field/tasks", {
				method: "GET",
				headers: { Cookie: unassignedCookie },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as { assignments: Array<unknown> };
			expect(data.assignments.length).toBe(0);
		});

		it("GET /api/field/events/:id returns 403 Forbidden for unassigned officer", async () => {
			const res = await app.request(`http://localhost:5173/api/field/events/${testEventId}`, {
				method: "GET",
				headers: { Cookie: unassignedCookie },
			});

			expect(res.status).toBe(403);
			const err = (await res.json()) as { error: { code: string; message: string } };
			expect(err.error.code).toBe("FORBIDDEN");
		});

		it("GET /api/field/events/:id returns 200 with scoped detail and permissions for assigned officer", async () => {
			const res = await app.request(`http://localhost:5173/api/field/events/${testEventId}`, {
				method: "GET",
				headers: { Cookie: officerACookie },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				event: { id: string; title: string };
				permissions: { canUpdateTraffic: boolean; canUpdateCleanup: boolean };
				roadImpacts: Array<unknown>;
				cleanupTasks: Array<unknown>;
			};
			expect(data.event.id).toBe(testEventId);
			expect(data.permissions.canUpdateTraffic).toBe(true);
			expect(data.permissions.canUpdateCleanup).toBe(true);
		});
	});
});
