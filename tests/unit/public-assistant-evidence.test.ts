import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import type { AppVariables, Env } from "../../src/worker/types";
vi.mock("../../src/worker/routes/public", async () => {
 const { Hono: Router } = await import("hono"); const router = new Router();
 router.get("/events/:slug/roads", c => c.json({ isSimulation: true, roads: [{ id: "synthetic-road", displayName: "Synthetic road", operationalStatus: { effectiveStatus: "open", observedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T01:00:00.000Z" } }] }));
 router.get("/events/:slug/cleanup-summary", c => c.json({ isSimulation: true, summary: { totalTasks: 1, verifiedTasks: 1, submittedTasks: 0, inProgressTasks: 0, todoTasks: 0, reopenedTasks: 0 } }));
 return { publicRouter: router };
});
import { publicAssistantRouter } from "../../src/worker/routes/public-assistant";
const row = { slug: "synthetic", title: "Synthetic", status: "published", isSimulation: true, startsAt: null, endsAt: null };
function app() { const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [row] }; const server = new Hono<{ Bindings: Env; Variables: AppVariables }>(); server.use("*", async (c, next) => { c.set("db", { select: () => chain } as never); c.set("requestId", "test"); await next(); }); server.route("/assistant", publicAssistantRouter); return server; }
async function ask(intent: string) {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intent, sourceIds: ["event:synthetic"] }) }] } }] }))));
 return app().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "synthetic test" }) }, { PUBLIC_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "synthetic" });
}
async function askWithStatus(status: string, exact: boolean, authorized = true) {
 const queries: Array<{ sql: string; params: unknown[] }> = [];
 const dialect = new PgDialect();
 const chain = {
  from: () => chain, innerJoin: () => chain,
  where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => { queries.push(dialect.sqlToQuery(condition)); return chain; },
  orderBy: () => chain,
  limit: async () => {
   const query = queries[queries.length - 1];
   return query.params.includes(status) && authorized ? [{ ...row, status }] : [];
  },
 };
 const server = new Hono<{ Bindings: Env; Variables: AppVariables }>();
 server.use("*", async (c, next) => { c.set("db", { select: () => chain } as never); c.set("requestId", "test"); await next(); });
 server.route("/assistant", publicAssistantRouter);
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intent: "cleanup_summary", sourceIds: ["event:synthetic"] }) }] } }] }))));
 const response = await server.request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Ringkasan kebersihan kegiatan", ...(exact ? { eventSlug: "synthetic" } : {}) }) }, { PUBLIC_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "synthetic" });
 return { response, queries };
}
afterEach(() => vi.unstubAllGlobals());
describe("assistant public evidence", () => {
 it("converts expired open to unconfirmed and keeps simulation label", async () => { const response = await ask("road_status"); const data = await response.json() as { status: string; answer: string; sources: Array<{ status: string; isSimulation: boolean; expiresAt: string; summary: { verifiedTasks: number } }> }; expect(data.status).toBe("answered"); expect(data.sources[0].status).toBe("unconfirmed"); expect(data.sources[0].isSimulation).toBe(true); expect(data.sources[0].expiresAt).toBe("2020-01-01T01:00:00.000Z"); });
 it("returns public cleanup counts without road transition", async () => { const response = await ask("cleanup_summary"); const data = await response.json() as { status: string; answer: string; sources: Array<{ status: string; isSimulation: boolean; expiresAt: string; summary: { verifiedTasks: number } }> }; expect(data.sources[0].summary.verifiedTasks).toBe(1); expect(data.answer).toContain("tidak membuka jalan"); });
 it("answers completed cleanup for an exact public slug", async () => {
  const { response, queries } = await askWithStatus("completed", true);
  const data = await response.json() as { status: string; sources: Array<{ status: string; summary: { verifiedTasks: number } }> };
  expect(data.status).toBe("answered");
  expect(data.sources[0].status).toBe("completed");
  expect(data.sources[0].summary.verifiedTasks).toBe(1);
  expect(queries).toHaveLength(2);
  expect(queries[0].params).toContain("synthetic");
  expect(queries[0].sql).toContain("has_operational_authority");
 });
 it.each(["draft", "review", "cancelled", "archived"])("excludes %s events", async status => {
  const { queries } = await askWithStatus(status, true);
  expect(queries[0].params).not.toContain(status);
 });
 it("does not include completed events in broad searches", async () => {
  const { queries } = await askWithStatus("completed", false);
  expect(queries[0].params).not.toContain("completed");
 });
 it("retains the authority predicate for real events", async () => {
  const { queries } = await askWithStatus("completed", true, false);
  expect(queries[0].sql).toMatch(/is_simulation.*IS DISTINCT FROM FALSE.*has_operational_authority = TRUE/);
 });
});

it("route help abstains when origin and destination are missing", async () => {
 const response = await ask("route_help");
 const data = await response.json() as { status: string; answer: string; sources: Array<{ status: string }> };
 expect(data.status).toBe("abstained");
 expect(data.sources).toHaveLength(0);
 expect(data.answer).toContain("asal dan tujuan");
});
