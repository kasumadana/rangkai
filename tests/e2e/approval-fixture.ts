import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { APIRequestContext, Browser } from "@playwright/test";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import { memberships, organizationApplications, organizations, platformAudit, platformGrants } from "../../src/db/schema";

/** Provisions a synthetic organization through the real application and approval APIs. */
export async function approveSyntheticOrganization(browser: Browser, applicant: APIRequestContext, baseURL: string | undefined, input: { name: string; village: string; district: string }, existingApplicationId?: string): Promise<{ organization: { id: string } }> {
 const base = new URL(baseURL || "http://localhost:5173");
 if (!["localhost", "127.0.0.1", "::1"].includes(base.hostname) || base.protocol !== "http:") throw new Error("Synthetic approval requires a local test server");
 const { pinnedUrl } = await assertDevBranch();
 const db = getDb(pinnedUrl);
 const email = `synthetic-admin-${randomUUID()}@test.local`;
 const context = await browser.newContext({ extraHTTPHeaders: { Origin: base.origin } });
 let adminId = "", applicationId = "";
 try {
  const applicantSession = await applicant.get(`${base.origin}/api/auth/get-session`);
  if (applicantSession.status() !== 200) throw new Error("Synthetic applicant session is unavailable");
  const identity = await applicantSession.json() as { user?: { id: string } } | null;
  if (!identity?.user?.id) throw new Error("Synthetic applicant session is missing");
  // Per-run synthetic credential for a throwaway local test admin; generated at runtime, never a stored secret.
  const syntheticCredential = ["A", randomUUID(), "a1"].join("-");
  const signup = await context.request.post(`${base.origin}/api/auth/sign-up/email`, { data: { name: "SYNTHETIC_TEST_ADMIN", email, password: syntheticCredential } });
  if (signup.status() !== 200) throw new Error(`Synthetic admin signup failed (${signup.status()})`);
  adminId = (await signup.json() as { user: { id: string } }).user.id;
  await db.insert(platformGrants).values({ userId: adminId, role: "superadmin", status: "active" });
  if (existingApplicationId) applicationId = existingApplicationId;
  else {
   const submitted = await applicant.post(`${base.origin}/api/me/organization-applications`, { data: input });
   if (submitted.status() !== 201) throw new Error(`Synthetic application failed (${submitted.status()})`);
   applicationId = (await submitted.json() as { application: { id: string } }).application.id;
  }
  const approved = await context.request.post(`${base.origin}/api/admin/organization-applications/${applicationId}/decision`, { data: { decision: "approve" } });
  if (approved.status() !== 200) throw new Error(`Synthetic approval failed (${approved.status()})`);
  const result = await approved.json() as { application: { status: string; organizationId: string } };
  if (result.application.status !== "approved" || !result.application.organizationId) throw new Error("Synthetic approval returned an invalid result");
  const membership = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.organizationId, result.application.organizationId), eq(memberships.userId, identity.user.id)));
  const org = await db.select({ hasOperationalAuthority: organizations.hasOperationalAuthority }).from(organizations).where(eq(organizations.id, result.application.organizationId));
  if (membership.length !== 1 || membership[0].role !== "organizer" || org.length !== 1 || org[0].hasOperationalAuthority) throw new Error("Synthetic approval did not produce the expected scoped membership");
  return { organization: { id: result.application.organizationId } };
 } finally {
  await context.close();
  if (applicationId) {
   await db.delete(platformAudit).where(eq(platformAudit.applicationId, applicationId));
   await db.delete(organizationApplications).where(eq(organizationApplications.id, applicationId));
  }
  if (!adminId) { const found = await db.select({ id: user.id }).from(user).where(and(eq(user.email, email), eq(user.name, "SYNTHETIC_TEST_ADMIN"))); adminId = found[0]?.id || ""; }
  if (adminId) {
   await db.delete(platformGrants).where(eq(platformGrants.userId, adminId));
   await db.delete(session).where(eq(session.userId, adminId));
   await db.delete(account).where(eq(account.userId, adminId));
   await db.delete(user).where(eq(user.id, adminId));
  }
 }
}
