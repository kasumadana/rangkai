import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGroundedAssistantAnswer, preserveAssistantCaveats, selectAssistantSources, validateAssistantAnswer, validateSelection, type AssistantAnswerEvidence } from "../../src/worker/services/public-assistant";

const source = { sourceId: "event:synthetic", publicUrl: "/events/synthetic", title: "Synthetic", status: "published", isSimulation: true, startsAt: null, endsAt: null, observedAt: null, expiresAt: null };
const selection = { intent: "event_lookup", sourceIds: [source.sourceId] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Gemini assistant fetch boundary", () => {
 it("selects the final text part rather than a thought part", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "internal", thought: true }, { text: JSON.stringify(selection) }] } }] }));
  vi.stubGlobal("fetch", fetchMock);
  expect(validateSelection(await selectAssistantSources("synthetic", [source], "secret", "model"), [source])).toEqual(selection);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.maxOutputTokens).toBeGreaterThan(256);
 });
 it("rejects truncated output even if its JSON is valid", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: JSON.stringify(selection) }] } }] })));
  expect(await selectAssistantSources("synthetic", [source], "secret", "model")).toBeNull();
 });
 it("reports bounded failure reasons without provider contents", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const [response, reason] of [
   [new Response("secret response body", { status: 400 }), "http"],
   [new Response("not json"), "response_json"],
   [Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json" }] } }] }), "selection_json"],
   [Response.json({ candidates: [] }), "candidate_missing"],
  ] as const) {
   vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
   expect(await selectAssistantSources("private question", [source], "secret key", "model")).toBeNull();
   expect(warning.mock.calls.at(-1)?.[1]).toMatchObject({ reason });
  }
  expect(JSON.stringify(warning.mock.calls)).not.toMatch(/secret|private question/);
 });
 it("rejects unknown and duplicate references and permits empty selection", () => {
  expect(validateSelection({ intent: "event_lookup", sourceIds: ["event:unknown"] }, [source])).toBeNull();
  expect(validateSelection({ intent: "event_lookup", sourceIds: [source.sourceId, source.sourceId] }, [source])).toBeNull();
  expect(validateSelection({ intent: "event_lookup", sourceIds: [] }, [source])).toEqual({ intent: "event_lookup", sourceIds: [] });
 });
});

it("times out stalled requests and rejects thought-only output", async () => {
 vi.useFakeTimers();
 vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))));
 const pending = selectAssistantSources("question", [source], "key", "model");
 await vi.advanceTimersByTimeAsync(20001);
 expect(await pending).toBeNull();
 vi.useRealTimers();
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(selection), thought: true }] } }] })));
 expect(await selectAssistantSources("question", [source], "key", "model")).toBeNull();
});

describe("grounded assistant answers", () => {
 const evidence: AssistantAnswerEvidence[] = [{ sourceId: "road:r1", kind: "road", title: "Jalan Uji", facts: { status: "unconfirmed", observedAt: null, isSimulation: true } }];
 it("generates a direct answer from the exact question and bounded evidence", async () => {
  const result = { disposition: "answered", answer: "Status Jalan Uji belum terkonfirmasi dan datanya merupakan simulasi.", sourceIds: ["road:r1"] };
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(result) }] } }] }));
  vi.stubGlobal("fetch", fetchMock);
  const raw = await generateGroundedAssistantAnswer("Apakah Jalan Uji sekarang ditutup?", "road_status", evidence, "secret", "model");
  expect(validateAssistantAnswer(raw, evidence)).toEqual(result);
  const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(JSON.parse(sent.contents[0].parts[0].text)).toMatchObject({ question: "Apakah Jalan Uji sekarang ditutup?", intent: "road_status", evidence });
  expect(sent.systemInstruction.parts[0].text).toContain("Jawab langsung pertanyaan pengguna");
 });
 it("rejects unsupported source IDs, duplicate citations, empty grounded answers, and model URLs", () => {
  expect(validateAssistantAnswer({ disposition: "answered", answer: "Jawaban.", sourceIds: ["road:other"] }, evidence)).toBeNull();
  expect(validateAssistantAnswer({ disposition: "answered", answer: "Jawaban.", sourceIds: ["road:r1", "road:r1"] }, evidence)).toBeNull();
  expect(validateAssistantAnswer({ disposition: "answered", answer: "Jawaban.", sourceIds: [] }, evidence)).toBeNull();
  expect(validateAssistantAnswer({ disposition: "abstained", answer: "Belum ada data.", sourceIds: ["road:r1"] }, evidence)).toBeNull();
  expect(validateAssistantAnswer({ disposition: "answered", answer: "Buka https://example.com.", sourceIds: ["road:r1"] }, evidence)).toBeNull();
 });
 it("accepts an honest abstention without citing facts", () => {
  expect(validateAssistantAnswer({ disposition: "abstained", answer: "Waktu penutupan belum tercatat.", sourceIds: [] }, evidence)).toEqual({ disposition: "abstained", answer: "Waktu penutupan belum tercatat.", sourceIds: [] });
 });
 it("preserves mandatory simulation, stale-road, and cleanup boundaries", () => {
  expect(preserveAssistantCaveats("Statusnya belum terkonfirmasi.", "road_status", evidence)).toContain("Periksa peta langsung");
  expect(preserveAssistantCaveats("Jalan terbuka.", "road_status", evidence)).toContain("Status jalan belum terkonfirmasi");
  const simulated: AssistantAnswerEvidence[] = [{ ...evidence[0], facts: { status: "closed", isSimulation: true } }];
  expect(preserveAssistantCaveats("Statusnya ditutup.", "road_status", simulated)).toContain("simulasi");
  expect(preserveAssistantCaveats("Dua tugas selesai.", "cleanup_summary", evidence)).toContain("tidak mengubah status jalan");
 });
});
