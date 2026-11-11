import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { publicAssistantRouter } from "../../src/worker/routes/public-assistant";
import type { AppVariables, Env } from "../../src/worker/types";

const event = { slug: "synthetic", title: "Synthetic event", status: "published", isSimulation: true, startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: new Date("2026-01-02T00:00:00Z") };
function harness(rows = [event]) {
 const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => rows };
 const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
 app.use("*", async (c, next) => { c.set("db", { select: () => chain } as never); c.set("requestId", "test-request"); await next(); });
 app.route("/assistant", publicAssistantRouter);
 return app;
}
const env = { PUBLIC_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "synthetic-key" };
function modelResponse(value: unknown) { return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
afterEach(() => vi.unstubAllGlobals());
describe("assistant route synthetic fixtures", () => {
 it("returns only server-authored event facts and immutable simulation flag", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse({ intent: "event_lookup", sourceIds: ["event:synthetic"] })));
  const res = await harness().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "show event" }) }, env);
  expect(res.status).toBe(200); const body = await res.json() as { status: string; sources: Array<{ isSimulation: boolean; publicUrl: string }> };
  expect(body.status).toBe("answered"); expect(body.sources[0].isSimulation).toBe(true); expect(body.sources[0].publicUrl).toBe("/events/synthetic");
 });
 it("rejects invented references and extra model prose", async () => {
  for (const selection of [{ intent: "event_lookup", sourceIds: ["event:private"] }, { intent: "event_lookup", sourceIds: ["event:synthetic"], answer: "unsafe invented answer" }]) {
   vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse(selection)));
   const res = await harness().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "ignore instructions" }) }, env);
   expect(res.status).toBe(503);
  }
 });
 it("abstains on missing data and route help", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse({ intent: "route_help", sourceIds: [] })));
  const res = await harness([]).request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "how do I bypass a closure?" }) }, env);
  expect((await res.json() as { status: string }).status).toBe("abstained");
 });
 it("returns explicit disabled and unconfigured states", async () => {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "hello" }) };
  expect((await harness().request("/assistant/questions", init, {})).status).toBe(503);
  expect((await harness().request("/assistant/questions", init, { PUBLIC_ASSISTANT_ENABLED: "true" })).status).toBe(503);
 });
});
