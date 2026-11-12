import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { cleanupTasks, eventAssignments, events, memberships, roadImpacts, roadStatusUpdates, wasteRecords } from "../../src/db/schema";
import { assistantRouter, type AssistantSourceFact } from "../../src/worker/routes/assistant";
import type { AppVariables, Env } from "../../src/worker/types";

type Result = { status: string; sources: AssistantSourceFact[] };
const org = "10000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000002";
const env = { PUBLIC_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "synthetic" };
type State = { member: string | null; event: boolean; assignment: { traffic: boolean; cleanup: boolean } | null; session: boolean };
function harness(state: State) {
 const calls: unknown[] = [];
 const mutations = { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() };
 const db = { ...mutations, select: () => {
  let table: unknown;
  const chain = { from: (v: unknown) => { table = v; calls.push(v); return chain; }, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => {
   if (table === memberships) return state.member ? [{ role: state.member }] : [];
   if (table === events) return state.event ? [{ id: eventId, title: "Simulated ceremony", status: "draft", startsAt: null, endsAt: null, isSimulation: true, contactInformation: "secret" }] : [];
   if (table === eventAssignments) return state.assignment ? [state.assignment] : [];
   if (table === roadImpacts) return [{ id: "r1", title: "Road" }];
   if (table === roadStatusUpdates) return [{ status: "open", observedAt: new Date("2020-01-01Z"), expiresAt: new Date("2020-01-02Z") }];
   if (table === cleanupTasks) return [{ id: "c1", title: "Task", status: "todo", dueAt: null }];
   if (table === wasteRecords) return [{ id: "w1", category: "organic", measurementMethod: "estimated", quantityKg: "5.00", sackCount: 2 }];
   return [];
  } }; return chain;
 } };
 const auth = { api: { getSession: async () => state.session ? { user: { id: "user" }, session: {} } : null } };
 const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
 app.use("*", async (c, next) => { c.set("db", db as never); c.set("auth", auth as never); c.set("requestId", "test"); await next(); });
 app.route("/assistant", assistantRouter);
 const request = (body: unknown, bindings: Env = env) => app.request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, bindings);
 return { request, calls, mutations, app };
}
const input = { question: "show details", organizationId: org, eventId };
function state(): State { return { member: "organizer", event: true, assignment: null, session: true }; }
function provider(intent = "event_lookup", ids = [`event:${eventId}`]) {
 return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intent, sourceIds: ids }) }] } }] }), { status: 200 });
}
afterEach(() => vi.unstubAllGlobals());
describe("authenticated assistant", () => {
 it("denies anonymous, foreign organization, foreign event, and unassigned officer before provider", async () => {
  const fetchMock = vi.fn().mockResolvedValue(provider()); vi.stubGlobal("fetch", fetchMock);
  for (const [s, status] of [[{ ...state(), session: false }, 401], [{ ...state(), member: null }, 403], [{ ...state(), event: false }, 404], [{ ...state(), member: "officer" }, 403]] as const) expect((await harness(s).request(input)).status).toBe(status);
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it("requires explicit selection and returns reviewed help without searching", async () => {
  const h = harness(state()); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(((await (await h.request({ question: "hello" })).json()) as Result).status).toBe("selection_required");
  expect(((await (await h.request({ question: "help", helpTopic: "cleanup" })).json()) as Result).sources[0].title).toBe("Panduan penggunaan");
  expect(h.calls).toHaveLength(0); expect(fetchMock).not.toHaveBeenCalled();
 });
 it("returns only projected event data and never sends private metadata", async () => {
  const fetchMock = vi.fn().mockResolvedValue(provider()); vi.stubGlobal("fetch", fetchMock);
  const h = harness(state()); const response = await h.request(input); const json = await response.json() as Result;
  expect(response.status).toBe(200); expect(json.sources[0]).toMatchObject({ facts: { isSimulation: true } });
  expect(JSON.stringify(json)).not.toContain("secret"); expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("secret");
  for (const mutation of Object.values(h.mutations)) expect(mutation).not.toHaveBeenCalled();
 });
 it("enforces category permissions and allows dual permissions", async () => {
  for (const [intent, assignment, status] of [["road_status", { traffic: false, cleanup: true }, 403], ["cleanup_summary", { traffic: true, cleanup: false }, 403], ["road_status", { traffic: true, cleanup: true }, 200], ["cleanup_summary", { traffic: true, cleanup: true }, 200]] as const) {
   vi.stubGlobal("fetch", vi.fn().mockResolvedValue(provider(intent)));
   const h = harness({ ...state(), member: "officer", assignment }); const response = await h.request(input); expect(response.status).toBe(status);
   if (status === 403) expect(h.calls).not.toContain(intent === "road_status" ? roadImpacts : cleanupTasks);
   if (status === 200) { const json = await response.json() as Result; expect(json.sources.every(s => "isSimulation" in s.facts && s.facts.isSimulation)).toBe(true); if (intent === "road_status") expect(json.sources[0]).toMatchObject({ facts: { status: "unconfirmed" } }); else expect(json.sources.find(s => s.kind === "waste")).toMatchObject({ facts: { measurementMethod: "estimated" } }); }
  }
 });
 it("rechecks revoked membership and assignment after provider await", async () => {
  for (const revoke of ["member", "assignment"] as const) {
   const s = { ...state(), member: "officer", assignment: { traffic: true, cleanup: true } };
   vi.stubGlobal("fetch", vi.fn(async () => { if (revoke === "member") s.member = null as never; else s.assignment = null as never; return provider("road_status"); }));
   expect((await harness(s).request(input)).status).toBe(403);
  }
 });
 it("enforces its isolate-local rate limit", async () => {
  const h = harness(state());
  const init = { method: "POST", headers: { "content-type": "application/json", "x-test-rate-limit": "1", "cf-connecting-ip": "203.0.113.174" }, body: JSON.stringify({ question: "hello" }) };
  for (let i = 0; i < 10; i++) expect((await h.app.request("/assistant/questions", init, env)).status).toBe(200);
  const response = await h.app.request("/assistant/questions", init, env);
  expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ error: { code: "TOO_MANY_REQUESTS", requestId: "test" } });
 });
 it("rejects malformed input and rechecks a revoked session", async () => {
  const h = harness(state());
  expect((await h.app.request("/assistant/questions", { method: "POST", body: "{" }, env)).status).toBe(422);
  expect((await h.request({ ...input, helpTopic: "event" })).status).toBe(422);
  expect((await harness({ ...state(), member: null }).request({ question: "test", organizationId: org })).status).toBe(403);
  const s = state();
  vi.stubGlobal("fetch", vi.fn(async () => { s.session = false; return provider(); }));
  expect((await harness(s).request(input)).status).toBe(401);
 });
 it("rejects forged source, invalid provider output and missing configuration", async () => {
  for (const response of [provider("event_lookup", ["event:forged"]), new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intent: "event_lookup", sourceIds: [`event:${eventId}`], answer: "injected" }) }] } }] })), new Response("not-json"), new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] }))]) {
   vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response)); expect((await harness(state()).request(input)).status).toBe(503);
  }
  const f = vi.fn(); vi.stubGlobal("fetch", f); expect((await harness(state()).request(input, {})).status).toBe(503); expect(f).not.toHaveBeenCalled();
 });
});
