import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { assertDevBranch } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db";
import { applicationsRouter } from "../../src/worker/routes/organization-applications";
import { organizationsRouter } from "../../src/worker/routes/organizations";
import type { AppVariables, Env } from "../../src/worker/types";

const suffix = crypto.randomUUID(); const applicant = `applicant-${suffix}`; const other = `other-${suffix}`; const admin = `admin-${suffix}`; let db: DbClient;
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", async (c, next) => {
 const id = c.req.header("x-test-user"); c.set("db", db); c.set("requestId", c.req.header("x-fail-audit") ? null as never : "synthetic-test");
 c.set("auth", { api: { getSession: async () => id ? { user: { id }, session: { id: "test", userId: id } } : null } } as never); await next();
});
app.route("/api", applicationsRouter); app.route("/api/organizations", organizationsRouter);
const request = (path: string, actor?: string, body?: unknown, failAudit = false) => app.request(path, { method: body === undefined ? "GET" : "POST", headers: { ...(actor ? { "x-test-user": actor } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(failAudit ? { "x-fail-audit": "1" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const input = { name: "SYNTHETIC_TEST_DATA Desa", village: "Uji", district: "Denpasar" };
beforeAll(async () => { const guarded = await assertDevBranch(); db = getDb(guarded.pinnedUrl); await db.execute(sql`INSERT INTO "user" (id,name,email) VALUES (${applicant},'Test',${applicant + '@test.invalid'}),(${other},'Test',${other + '@test.invalid'}),(${admin},'Test',${admin + '@test.invalid'})`); await db.execute(sql`INSERT INTO platform_grants (user_id,role,status) VALUES (${admin},'superadmin','active')`); });
afterAll(async () => { if (!db) return; await db.execute(sql`DELETE FROM platform_audit WHERE actor_id IN (${applicant},${other},${admin})`); await db.execute(sql`DELETE FROM memberships WHERE user_id IN (${applicant},${other},${admin})`); const orgs = await db.execute(sql`SELECT organization_id FROM organization_applications WHERE applicant_id IN (${applicant},${other}) AND organization_id IS NOT NULL`); await db.execute(sql`DELETE FROM organization_applications WHERE applicant_id IN (${applicant},${other})`); for (const row of orgs.rows) await db.execute(sql`DELETE FROM organizations WHERE id=${row.organization_id}`); await db.execute(sql`DELETE FROM platform_grants WHERE user_id IN (${admin},${other})`); await db.execute(sql`DELETE FROM "user" WHERE id IN (${applicant},${other},${admin})`); });
describe("organization application governance", () => {
 it("denies anonymous and direct organization creation; rejects spoofed fields", async () => {
  expect((await request("/api/me/organization-applications")).status).toBe(401);
  expect((await request("/api/organizations", applicant, input)).status).toBe(403);
  expect((await request("/api/me/organization-applications", applicant, { ...input, applicantId: other, role: "organizer" })).status).toBe(422);
 });
 it("isolates applicants and refuses absent, suspended, and revoked platform grants", async () => {
  const submitted = await request("/api/me/organization-applications", applicant, input); expect(submitted.status).toBe(201);
  expect((await request("/api/me/organization-applications", applicant, input)).status).toBe(409);
  const own = await (await request("/api/me/organization-applications", applicant)).json() as { applications: Array<{ id: string }> };
  const theirs = await (await request("/api/me/organization-applications", other)).json() as { applications: unknown[] }; expect(own.applications).toHaveLength(1); expect(theirs.applications).toHaveLength(0);
  expect((await request("/api/admin/organization-applications", other)).status).toBe(403);
  await db.execute(sql`INSERT INTO platform_grants (user_id,role,status) VALUES (${other},'government_reviewer','active')`);
  expect((await request("/api/admin/organization-applications", other)).status).toBe(403);
  for (const status of ["suspended", "revoked"]) { await db.execute(sql`UPDATE platform_grants SET status=${status} WHERE user_id=${admin}`); expect((await request("/api/admin/organization-applications", admin)).status).toBe(403); }
  await db.execute(sql`UPDATE platform_grants SET status='active' WHERE user_id=${admin}`);
  expect((await request(`/api/admin/organization-applications/${own.applications[0].id}/decision`, other, { decision: "approve" })).status).toBe(403);
 });
 it("rolls back a failed audit and approves concurrently once without operational authority", async () => {
  const own = await (await request("/api/me/organization-applications", applicant)).json() as { applications: Array<{ id: string }> }; const id = own.applications[0].id;
  expect((await request(`/api/admin/organization-applications/${id}/decision`, admin, { decision: "approve" }, true)).status).toBe(500);
  const pending = await db.execute(sql`SELECT status, organization_id FROM organization_applications WHERE id=${id}`); expect(pending.rows[0]).toMatchObject({ status: "pending", organization_id: null });
  const results = await Promise.all([request(`/api/admin/organization-applications/${id}/decision`, admin, { decision: "approve" }), request(`/api/admin/organization-applications/${id}/decision`, admin, { decision: "approve" })]);
  expect(results.map(x => x.status)).toEqual([200,200]);
  const data = await db.execute(sql`SELECT a.status,o.has_operational_authority, (SELECT count(*)::int FROM memberships WHERE organization_id=o.id AND user_id=${applicant} AND role='organizer') AS members, (SELECT count(*)::int FROM platform_audit WHERE application_id=a.id AND action='organization_application.approved') AS audits FROM organization_applications a JOIN organizations o ON o.id=a.organization_id WHERE a.id=${id}`);
  expect(data.rows[0]).toMatchObject({ status: "approved", has_operational_authority: false, members: 1, audits: 1 });
 });
 it("requires rejection reason and retains rejected history on resubmission", async () => {
  expect((await request("/api/me/organization-applications", other, input)).status).toBe(201);
  const own = await (await request("/api/me/organization-applications", other)).json() as { applications: Array<{ id: string }> }; const id = own.applications[0].id;
  expect((await request(`/api/admin/organization-applications/${id}/decision`, admin, { decision: "reject" })).status).toBe(422);
  expect((await request(`/api/admin/organization-applications/${id}/decision`, admin, { decision: "reject", reason: "Perlu data" })).status).toBe(200);
  expect((await request(`/api/admin/organization-applications/${id}/decision`, admin, { decision: "reject", reason: "Berbeda" })).status).toBe(409);
  expect((await request("/api/me/organization-applications", other, input)).status).toBe(201);
  const list = await (await request("/api/me/organization-applications", other)).json() as { applications: Array<{ status: string; decisionReason: string | null }> }; expect(list.applications).toHaveLength(2); expect(list.applications.some(x => x.status === "rejected" && x.decisionReason === "Perlu data")).toBe(true);
 });
});

describe("real Better Auth signup", () => {
 it("creates identity without membership and routes to application submission", async () => {
  const { default: fullApp } = await import("../../src/worker/index");
  const guarded = await assertDevBranch(); const email = `signup-${suffix}@test.invalid`; let userId = "";
  const env = { DATABASE_URL: guarded.pinnedUrl, BETTER_AUTH_URL: "http://localhost:5173", BETTER_AUTH_SECRET: "synthetic-secret-for-tests-only-123456789" };
  const headers = { "content-type": "application/json", origin: "http://localhost:5173" };
  try {
   const signed = await fullApp.request("http://localhost:5173/api/auth/sign-up/email", { method: "POST", headers, body: JSON.stringify({ name: "Synthetic Test", email, password: "Synthetic-password-123" }) }, env);
   expect(signed.status).toBe(200); const payload = await signed.json() as { user: { id: string } }; userId = payload.user.id;
   const cookies = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); expect(cookies).toContain("rangkai.session_token");
   const memberships = await db.execute(sql`SELECT count(*)::int AS n FROM memberships WHERE user_id=${userId}`); expect(memberships.rows[0].n).toBe(0);
   const direct = await fullApp.request("http://localhost:5173/api/organizations", { method: "POST", headers: { ...headers, cookie: cookies }, body: JSON.stringify(input) }, env); expect(direct.status).toBe(403);
   const submitted = await fullApp.request("http://localhost:5173/api/me/organization-applications", { method: "POST", headers: { ...headers, cookie: cookies }, body: JSON.stringify(input) }, env); expect(submitted.status).toBe(201);
  } finally {
   if (userId) { await db.execute(sql`DELETE FROM platform_audit WHERE actor_id=${userId}`); await db.execute(sql`DELETE FROM organization_applications WHERE applicant_id=${userId}`); await db.execute(sql`DELETE FROM "user" WHERE id=${userId}`); }
  }
 });
});
