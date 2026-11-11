import { afterEach, describe, expect, it, vi } from "vitest";
import { selectAssistantSources, validateSelection } from "../../src/worker/services/public-assistant";

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
