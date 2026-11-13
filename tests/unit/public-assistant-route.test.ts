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
function modelResponse(value: unknown) { return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
function modelSequence(selection: unknown, answer = "Informasi yang tersedia sudah dicocokkan dengan pertanyaan.") {
 let calls = 0;
 return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
  if (calls++ === 0) return modelResponse(selection);
  const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
  const request = JSON.parse(body.contents[0].parts[0].text) as { evidence: Array<{ sourceId: string }> };
  return modelResponse({ disposition: "answered", answer, sourceIds: request.evidence.map(item => item.sourceId) });
 });
}
afterEach(() => vi.unstubAllGlobals());
describe("assistant route synthetic fixtures", () => {
 it("answers a selected help question using reviewed public guidance", async () => {
  vi.stubGlobal("fetch", modelSequence({ intent: "help", sourceIds: ["help:location"] }, "Untuk melihat lokasi, tekan tombol lokasi pada peta dan izinkan akses di peramban."));
  const res = await harness().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Bagaimana melihat lokasi saya?" }) }, env);
  const body = await res.json() as { intent: string; answer: string; sources: Array<{ sourceId: string; url: string; answer: string }> };
  expect(res.status).toBe(200); expect(body.intent).toBe("help");
  expect(body.answer).toContain("tombol lokasi");
  expect(body.sources).toEqual([{ sourceId: "help:location", kind: "help", title: "Melihat lokasi Anda", url: "/peta", answer: expect.stringContaining("izinkan akses lokasi") }]);
 });
 it("does not turn an event source into fabricated help", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse({ intent: "help", sourceIds: ["event:synthetic"] })));
  const res = await harness().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "help" }) }, env);
  expect((await res.json() as { status: string }).status).toBe("abstained");
 });
 it("abstains clearly when a question is outside Rangkai", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelResponse({ intent: "out_of_scope", sourceIds: [] })));
  const res = await harness().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Siapa juara liga tahun ini?" }) }, env);
  const body = await res.json() as { status: string; answer: string; sources: unknown[] };
  expect(body.status).toBe("abstained");
  expect(body.answer).toContain("di luar konteks Rangkai");
  expect(body.sources).toHaveLength(0);
 });
 it("returns only server-authored event facts and immutable simulation flag", async () => {
  const fetchMock = modelSequence({ intent: "event_lookup", sourceIds: ["event:synthetic"] }, "Synthetic event berlangsung sesuai jadwal yang tercatat.");
  vi.stubGlobal("fetch", fetchMock);
  const res = await harness().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "show event" }) }, env);
  expect(res.status).toBe(200); const body = await res.json() as { status: string; sources: Array<{ isSimulation: boolean; publicUrl: string }> };
  expect(body.status).toBe("answered"); expect(body.sources[0].isSimulation).toBe(true); expect(body.sources[0].publicUrl).toBe("/events/synthetic");
  const generation = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
  expect(JSON.parse(generation.contents[0].parts[0].text)).toMatchObject({ question: "show event", intent: "event_lookup" });
 });
 it("fails closed when a generated answer cites evidence that was not retrieved", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(modelResponse({ intent: "event_lookup", sourceIds: ["event:synthetic"] })).mockResolvedValueOnce(modelResponse({ disposition: "answered", answer: "Kegiatan dimulai besok.", sourceIds: ["event:private"] })));
  const res = await harness().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Kapan kegiatan dimulai?" }) }, env);
  expect(res.status).toBe(503);
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
