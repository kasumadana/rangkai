import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { publicAssistantRouter } from "../../src/worker/routes/public-assistant";
import type { AppVariables, Env } from "../../src/worker/types";

const env = { PUBLIC_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "synthetic", NETWORK_ROUTING_ENABLED: "true", ORS_API_KEY: "synthetic" };
const question = "Saya mau ke Sanur, berangkat dari Ubung. Apakah ada jalan yang ditutup?";
function harness(rows: unknown[]) {
 const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [] };
 const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
 app.use("*", async (c, next) => { c.set("db", { select: () => chain, execute: async () => ({ rows }) } as never); c.set("requestId", "test"); await next(); });
 app.route("/assistant", publicAssistantRouter); return app;
}
function model(value: unknown) { return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }); }
function mockProvider(selection: unknown, noGeocode = false) {
 vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("generativelanguage")) return model(selection);
  if (url.includes("geocode")) {
   if (noGeocode) return Response.json({ features: [] });
   const ubung = url.includes("Ubung"); return Response.json({ features: [{ geometry: { type: "Point", coordinates: ubung ? [115.216, -8.65] : [115.26, -8.69] }, properties: { label: ubung ? "Ubung, Bali" : "Sanur, Bali" } }] });
  }
  return Response.json({ features: [{ geometry: { type: "LineString", coordinates: [[115.216, -8.65], [115.26, -8.69]] } }] });
 }));
}
afterEach(() => vi.unstubAllGlobals());
it("answers only intersecting public evidence and includes map link", async () => {
 mockProvider({ intent: "route_help", sourceIds: [], origin: "Ubung", destination: "Sanur" });
 const app = harness([{ id: "synthetic", title: "Jalan uji", slug: "uji", eventStatus: "active", isSimulation: true, startsAt: "2030-01-01T00:00:00Z", endsAt: "2030-01-01T01:00:00Z", status: "closed", observedAt: "2020-01-01T00:00:00Z", expiresAt: "2020-01-01T01:00:00Z" }]);
 const response = await app.request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) }, env);
 expect(response.status).toBe(200); const body = await response.json() as { status: string; mapUrl: string; answer: string; sources: unknown[] };
 expect(body).toMatchObject({ status: "answered", mapUrl: "/peta", sources: [{ title: "Jalan uji", status: "unconfirmed", isSimulation: true }] }); expect(body.answer).toContain("bukan navigasi aman");
});
it("abstains when no intersection or location is ambiguous", async () => {
 mockProvider({ intent: "route_help", sourceIds: [], origin: "Ubung", destination: "Sanur" });
 const app = harness([]); const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) };
 const response = await app.request("/assistant/questions", init, env); expect(await response.json()).toMatchObject({ status: "abstained", sources: [], mapUrl: "/peta" });
 mockProvider({ intent: "route_help", sourceIds: [], origin: "Ubung", destination: "Sanur" }, true);
 const missing = await app.request("/assistant/questions", init, env); expect(await missing.json()).toMatchObject({ status: "abstained", sources: [] });
});
it("rejects invented model locations before provider use", async () => {
 mockProvider({ intent: "route_help", sourceIds: [], origin: "Kuta", destination: "Sanur" });
 const response = await harness([]).request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) }, env); expect(response.status).toBe(503); expect(fetch).toHaveBeenCalledTimes(1);
});
