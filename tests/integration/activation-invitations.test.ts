import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { assertDevBranch } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db";
import { adminAccountsRouter, activationRouter } from "../../src/worker/routes/admin-accounts";
import type { AppVariables, Env } from "../../src/worker/types";

const suffix = crypto.randomUUID();
const adminId = `activation-admin-${suffix}`;
const recipientId = `activation-recipient-${suffix}`;
const otherId = `activation-other-${suffix}`;
const orgId = crypto.randomUUID();
const eventId = crypto.randomUUID();
const email = `recipient-${suffix}@test.invalid`;
let db: DbClient;

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", async (c, next) => {
	const actorId = c.req.header("x-test-user");
	c.set("db", db);
	c.set("requestId", "synthetic-activation-test");
	c.set("auth", { api: { getSession: async () => actorId ? { user: { id: actorId, email: actorId === recipientId ? email : `${actorId}@test.invalid` }, session: { id: "test-session", userId: actorId } } : null } } as never);
	await next();
});
app.route("/api/admin", adminAccountsRouter);
app.route("/api/activation-invitations", activationRouter);


const request = (path: string, actor?: string, body?: unknown, method?: string, extraHeaders: Record<string, string> = {}) => app.request(path, {
	method: method || (body === undefined ? "GET" : "POST"),
	headers: { ...(actor ? { "x-test-user": actor } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
	...(body === undefined ? {} : { body: JSON.stringify(body) }),
}, { BETTER_AUTH_URL: "https://rangkai.test" });

async function createInvitation(input: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
	const response = await request("/api/admin/users/activation-invitations", adminId, { recipientEmail: email, role: "officer", organizationId: orgId, eventId, canUpdateCleanup: true, ...input }, undefined, extraHeaders);
	expect(response.status).toBe(201);
	return (await response.json() as { invitation: { id: string; inviteUrl: string; expiresAt: string } }).invitation;
}

beforeAll(async () => {
	const guarded = await assertDevBranch();
	db = getDb(guarded.pinnedUrl);
	await db.execute(sql`INSERT INTO "user" (id,name,email) VALUES (${adminId},'Synthetic admin',${adminId + "@test.invalid"}),(${recipientId},'Synthetic recipient',${email}),(${otherId},'Synthetic other',${otherId + "@test.invalid"})`);
	await db.execute(sql`INSERT INTO platform_grants(user_id,role,status) VALUES (${adminId},'superadmin','active')`);
	await db.execute(sql`INSERT INTO organizations(id,name,village,district) VALUES (${orgId},${"SYNTHETIC_TEST_DATA Organization " + suffix},'Uji','Denpasar')`);
	await db.execute(sql`INSERT INTO events(id,organization_id,created_by,title,status,is_simulation) VALUES (${eventId},${orgId},${adminId},${"SYNTHETIC_TEST_DATA Event " + suffix},'draft',true)`);
	await db.execute(sql`INSERT INTO account(id,account_id,provider_id,user_id,password) VALUES (${"credential-" + suffix},${recipientId},'credential',${recipientId},'synthetic-existing-password-hash')`);
});

afterAll(async () => {
	if (!db) return;
	await db.execute(sql`DELETE FROM platform_audit WHERE actor_id IN (${adminId},${recipientId},${otherId}) OR entity_id IN (SELECT id::text FROM activation_invitations WHERE recipient_email=${email})`);
	await db.execute(sql`DELETE FROM activation_invitations WHERE recipient_email=${email}`);
	await db.execute(sql`DELETE FROM event_assignments WHERE event_id=${eventId} OR user_id IN (${adminId},${recipientId},${otherId})`);
	await db.execute(sql`DELETE FROM memberships WHERE organization_id=${orgId} OR user_id IN (${adminId},${recipientId},${otherId})`);
	await db.execute(sql`DELETE FROM platform_grants WHERE user_id IN (${adminId},${recipientId},${otherId})`);
	await db.execute(sql`DELETE FROM events WHERE id=${eventId}`);
	await db.execute(sql`DELETE FROM organizations WHERE id=${orgId}`);
	await db.execute(sql`DELETE FROM account WHERE user_id IN (${adminId},${recipientId},${otherId})`);
	await db.execute(sql`DELETE FROM session WHERE user_id IN (${adminId},${recipientId},${otherId})`);
	await db.execute(sql`DELETE FROM "user" WHERE id IN (${adminId},${recipientId},${otherId})`);
});

describe("admin activation invitations", () => {
	it("requires superadmin and validates role scopes", async () => {
		expect((await request("/api/admin/users/activation-invitations", undefined, { recipientEmail: email, role: "organizer", organizationId: orgId })).status).toBe(401);
		expect((await request("/api/admin/users/organizations", otherId)).status).toBe(403);
		expect((await request("/api/admin/users/activation-invitations", adminId, { recipientEmail: email, role: "government_reviewer", organizationId: orgId })).status).toBe(422);
		expect((await request("/api/admin/users/activation-invitations", adminId, { recipientEmail: email, role: "officer", organizationId: orgId, eventId })).status).toBe(422);
	});

	it("hashes the secret, binds activation to the invited identity, and preserves an existing password", async () => {
		const invitation = await createInvitation({}, { host: "attacker.example" });
		expect(new URL(invitation.inviteUrl).origin).toBe("https://rangkai.test");
		const token = new URL(invitation.inviteUrl).pathname.split("/").at(-1)!;
		const rows = await db.execute(sql`SELECT token_hash, status FROM activation_invitations WHERE id=${invitation.id}`);
		expect(rows.rows[0].token_hash).not.toBe(token);
		expect(rows.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
		const publicDetails = await (await request(`/api/activation-invitations/${token}`)).json() as { invitation: Record<string, unknown> };
		const detailsResponse = await request(`/api/activation-invitations/${token}`);
		expect(detailsResponse.headers.get("cache-control")).toBe("no-store");
		expect(detailsResponse.headers.get("referrer-policy")).toBe("no-referrer");
		expect(publicDetails.invitation).toMatchObject({ recipientEmail: email, role: "officer", eventTitle: "SYNTHETIC_TEST_DATA Event " + suffix, canUpdateCleanup: true });
		expect(publicDetails.invitation).not.toHaveProperty("tokenHash");
		expect((await request(`/api/activation-invitations/${token}/accept`, otherId, {})).status).toBe(403);
		const results = await Promise.all([request(`/api/activation-invitations/${token}/accept`, recipientId, {}), request(`/api/activation-invitations/${token}/accept`, recipientId, {})]);
		expect(results.map(result => result.status).sort()).toEqual([200, 410]);
		const applied = await db.execute(sql`SELECT m.role, a.can_update_traffic, a.can_update_cleanup, i.status, (SELECT count(*)::int FROM platform_audit WHERE entity_type='activation_invitation' AND entity_id=i.id::text AND action='activation_invitation.accepted') AS audits FROM memberships m JOIN event_assignments a ON a.user_id=m.user_id JOIN activation_invitations i ON i.organization_id=m.organization_id WHERE m.organization_id=${orgId} AND m.user_id=${recipientId} AND i.id=${invitation.id}`);
		expect(applied.rows[0]).toMatchObject({ role: "officer", can_update_traffic: false, can_update_cleanup: true, status: "accepted", audits: 1 });
		const account = await db.execute(sql`SELECT password FROM account WHERE user_id=${recipientId}`);
		expect(account.rows[0].password).toBe("synthetic-existing-password-hash");
	});

	it("revokes, expires, and consumes reviewer grants without an organization membership", async () => {
		const revoked = await createInvitation({ role: "organizer", organizationId: orgId, eventId: null, canUpdateTraffic: false, canUpdateCleanup: false });
		const revokedToken = new URL(revoked.inviteUrl).pathname.split("/").at(-1)!;
		expect((await request(`/api/admin/users/activation-invitations/${revoked.id}`, adminId, undefined, "DELETE")).status).toBe(200);
		expect((await request(`/api/activation-invitations/${revokedToken}/accept`, recipientId, {})).status).toBe(410);
		const expired = await createInvitation({ role: "organizer", organizationId: orgId, eventId: null, canUpdateTraffic: false, canUpdateCleanup: false });
		const expiredToken = new URL(expired.inviteUrl).pathname.split("/").at(-1)!;
		await db.execute(sql`UPDATE activation_invitations SET expires_at=now()-interval '1 minute' WHERE id=${expired.id}`);
		expect((await request(`/api/activation-invitations/${expiredToken}`)).status).toBe(404);
		expect((await request(`/api/activation-invitations/${expiredToken}/accept`, recipientId, {})).status).toBe(410);
		const reviewer = await createInvitation({ role: "government_reviewer", organizationId: null, eventId: null, canUpdateTraffic: false, canUpdateCleanup: false });
		const reviewerToken = new URL(reviewer.inviteUrl).pathname.split("/").at(-1)!;
		expect((await request(`/api/activation-invitations/${reviewerToken}/accept`, recipientId, {})).status).toBe(200);
		const grants = await db.execute(sql`SELECT role,status FROM platform_grants WHERE user_id=${recipientId}`);
		expect(grants.rows).toContainEqual({ role: "government_reviewer", status: "active" });
		const memberships = await db.execute(sql`SELECT count(*)::int AS n FROM memberships WHERE user_id=${recipientId}`);
		expect(memberships.rows[0].n).toBe(1);
	});
});
