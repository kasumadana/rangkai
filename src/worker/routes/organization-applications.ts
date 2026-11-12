import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { user } from "../../db/auth-schema";
import { organizationApplications, platformGrants } from "../../db/schema";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";

export const applicationsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();
applicationsRouter.use("/me/organization-applications", requireAuth);
applicationsRouter.use("/admin/organization-applications", requireAuth);
applicationsRouter.use("/admin/organization-applications/*", requireAuth);
const limitBody = bodyLimit({ maxSize: 4096, onError: c => sendError(c, "VALIDATION_FAILED", "Permintaan terlalu besar.", 422) });
applicationsRouter.use("/me/organization-applications", limitBody);
applicationsRouter.use("/me/organization-applications", rateLimit({ windowMs: 60000, max: 30, keyPrefix: "org-applications" }));
applicationsRouter.use("/admin/organization-applications/*", limitBody);
const applicationInput = z.object({ name: z.string().trim().min(3).max(150), village: z.string().trim().min(2).max(100), district: z.string().trim().min(2).max(100) }).strict();
const decisionInput = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(1000).optional() }).strict().refine(x => x.decision !== "reject" || Boolean(x.reason?.trim()), { message: "Alasan penolakan wajib diisi." });
const idSchema = z.uuid();
async function isAdmin(c: { get(key: "db"): AppVariables["db"]; get(key: "user"): AppVariables["user"] }) {
 const db = c.get("db"), user = c.get("user");
 if (!user) return false;
 const rows = await db.select({ id: platformGrants.id }).from(platformGrants).where(and(eq(platformGrants.userId, user.id), eq(platformGrants.role, "superadmin"), eq(platformGrants.status, "active"))).limit(1);
 return rows.length === 1;
}
applicationsRouter.get("/me/organization-applications", async c => {
 const rows = await c.get("db").select().from(organizationApplications).where(eq(organizationApplications.applicantId, c.get("user")!.id)).orderBy(desc(organizationApplications.createdAt));
 return c.json({ applications: rows });
});
applicationsRouter.post("/me/organization-applications", async c => {
 let body: unknown; try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Data tidak valid.", 400); }
 const input = applicationInput.safeParse(body); if (!input.success) return sendError(c, "VALIDATION_FAILED", "Periksa nama, desa dan kabupaten.", 422);
 const id = crypto.randomUUID(), actor = c.get("user")!.id, requestId = c.get("requestId");
 try {
  const res = await c.get("db").execute(sql`WITH application AS (
   INSERT INTO organization_applications (id, applicant_id, name, village, district) VALUES (${id}, ${actor}, ${input.data.name}, ${input.data.village}, ${input.data.district}) RETURNING *
  ), audit AS (INSERT INTO platform_audit (actor_id, action, application_id, request_id) SELECT ${actor}, 'organization_application.submitted', id, ${requestId} FROM application RETURNING id)
  SELECT application.* FROM application CROSS JOIN audit`);
  return c.json({ application: res.rows[0] }, 201);
 } catch {
  try { const pending = await c.get("db").select({ id: organizationApplications.id }).from(organizationApplications).where(and(eq(organizationApplications.applicantId, actor), eq(organizationApplications.status, "pending"))).limit(1);
   if (pending.length) return sendError(c, "CONFLICT", "Masih ada pengajuan yang menunggu tinjauan.", 409);
  } catch { /* Return a dependency error below. */ }
  return sendError(c, "DEPENDENCY_UNAVAILABLE", "Pengajuan belum dapat disimpan. Coba lagi.", 503);
 }
});
applicationsRouter.get("/admin/organization-applications", async c => {
 if (!await isAdmin(c)) return sendError(c, "FORBIDDEN", "Akses administrator diperlukan.", 403);
 const page = z.coerce.number().int().min(1).max(10000).safeParse(c.req.query("page") ?? "1");
 if (!page.success) return sendError(c, "VALIDATION_FAILED", "Halaman tidak valid.", 422);
 const rows = await c.get("db").select({ id: organizationApplications.id, name: organizationApplications.name, village: organizationApplications.village, district: organizationApplications.district, status: organizationApplications.status, decisionReason: organizationApplications.decisionReason, applicantId: organizationApplications.applicantId, applicantName: user.name, applicantEmail: user.email }).from(organizationApplications).innerJoin(user, eq(user.id, organizationApplications.applicantId)).orderBy(desc(organizationApplications.createdAt), desc(organizationApplications.id)).limit(51).offset((page.data - 1) * 50);
 return c.json({ applications: rows.slice(0, 50), page: page.data, hasMore: rows.length > 50 });
});
applicationsRouter.post("/admin/organization-applications/:id/decision", async c => {
 if (!await isAdmin(c)) return sendError(c, "FORBIDDEN", "Akses administrator diperlukan.", 403);
 const id = c.req.param("id"); if (!idSchema.safeParse(id).success) return sendError(c, "VALIDATION_FAILED", "Pengajuan tidak valid.", 422);
 let body: unknown; try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Data tidak valid.", 400); }
 const input = decisionInput.safeParse(body); if (!input.success) return sendError(c, "VALIDATION_FAILED", "Pilih keputusan dan isi alasan penolakan.", 422);
 const actor = c.get("user")!.id, requestId = c.get("requestId"), orgId = crypto.randomUUID(), reason = input.data.reason || null;
 try {
  const query = input.data.decision === "approve" ? sql`
   WITH authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor} AND role='superadmin' AND status='active' FOR SHARE), claimed AS (UPDATE organization_applications SET status='approved', organization_id=${orgId}, decided_by=${actor}, decided_at=now(), decision_reason=${reason}
    WHERE id=${id} AND status='pending' AND EXISTS (SELECT 1 FROM authorized) RETURNING *),
   org AS (INSERT INTO organizations (id,name,village,district,has_operational_authority) SELECT ${orgId},name,village,district,false FROM claimed RETURNING id),
   member AS (INSERT INTO memberships (organization_id,user_id,role) SELECT org.id,claimed.applicant_id,'organizer' FROM org CROSS JOIN claimed RETURNING id),
   audit AS (INSERT INTO platform_audit (actor_id,action,application_id,reason,request_id) SELECT ${actor},'organization_application.approved',claimed.id,${reason},${requestId} FROM claimed CROSS JOIN member RETURNING id)
   SELECT claimed.id, claimed.status, claimed.organization_id AS "organizationId" FROM claimed CROSS JOIN audit`
  : sql`WITH authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor} AND role='superadmin' AND status='active' FOR SHARE), claimed AS (UPDATE organization_applications SET status='rejected', decided_by=${actor}, decided_at=now(), decision_reason=${reason}
    WHERE id=${id} AND status='pending' AND EXISTS (SELECT 1 FROM authorized) RETURNING *),
   audit AS (INSERT INTO platform_audit (actor_id,action,application_id,reason,request_id) SELECT ${actor},'organization_application.rejected',id,${reason},${requestId} FROM claimed RETURNING id)
   SELECT claimed.id, claimed.status, claimed.organization_id AS "organizationId" FROM claimed CROSS JOIN audit`;
  const res = await c.get("db").execute(query);
  if (res.rows.length) return c.json({ application: res.rows[0] });
  if (!await isAdmin(c)) return sendError(c, "FORBIDDEN", "Akses administrator diperlukan.", 403);
  const existing = await c.get("db").select().from(organizationApplications).where(eq(organizationApplications.id, id)).limit(1);
  if (existing[0]?.status === (input.data.decision === "approve" ? "approved" : "rejected") && existing[0].decisionReason === reason) return c.json({ application: existing[0] });
  return sendError(c, "CONFLICT", "Pengajuan tidak tersedia atau sudah diputuskan.", 409);
 } catch { return sendError(c, "INTERNAL_SERVER_ERROR", "Keputusan belum dapat disimpan. Coba lagi.", 500); }
});
