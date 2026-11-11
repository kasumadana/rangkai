import { describe, expect, it } from "vitest";
import { assistantInputSchema, freshRoadStatus, validateSelection, type AssistantSource } from "../../src/worker/services/public-assistant";
import { calculateScenario, scenarioSchema } from "../../src/worker/services/waste-scenario";
import { nearbyFacilities } from "../../src/worker/services/waste-facilities";
const source: AssistantSource = { sourceId: "event:synthetic", publicUrl: "/events/synthetic", title: "Synthetic", status: "published", isSimulation: true, startsAt: null, endsAt: null, observedAt: null, expiresAt: null };
describe("public assistant boundaries", () => {
 it("accepts only exact known source IDs", () => {
  expect(validateSelection({ intent: "event_lookup", sourceIds: [source.sourceId] }, [source])).not.toBeNull();
  for (const id of ["event:private", "https://example.com", "event:synthetic#other", ""]) expect(validateSelection({ intent: "event_lookup", sourceIds: [id] }, [source])).toBeNull();
  expect(validateSelection({ intent: "event_lookup", sourceIds: [source.sourceId, source.sourceId] }, [source])).toBeNull();
  expect(validateSelection({ intent: "event_lookup", sourceIds: [], answer: "invented" }, [source])).toBeNull();
 });
 it("bounds untrusted input and rejects arbitrary filters", () => {
  expect(assistantInputSchema.safeParse({ question: "x".repeat(501) }).success).toBe(false);
  expect(assistantInputSchema.safeParse({ question: "hello", url: "http://localhost" }).success).toBe(false);
  expect(assistantInputSchema.safeParse({ question: "hello", from: "2026-01-02T00:00:00Z", to: "2026-01-01T00:00:00Z" }).success).toBe(false);
 });
});
describe("synthetic planning assumptions", () => {
 const scenario = { coefficientKgPerParticipantDay: { min: 0.1, max: 0.2, provenance: "synthetic example" }, categoryShares: { organic: 0.5, recyclable: 0.3, residual: 0.2 } };
 it("calculates a range without claiming measured or forecast weight", () => {
  const result = calculateScenario(100, 24, scenario);
  expect(result.low.totalKg).toBe(10); expect(result.high.totalKg).toBe(20); expect(result.forecastKg).toBeNull(); expect(result.measuredKg).toBeNull();
  expect(Object.values(result.high.categoriesKg!).reduce((a,b) => a+b, 0)).toBe(20);
 });
 it("rejects inverted, nonfinite, and inconsistent assumptions", () => {
  expect(scenarioSchema.safeParse({ ...scenario, coefficientKgPerParticipantDay: { min: 2, max: 1, provenance: "x" } }).success).toBe(false);
  expect(scenarioSchema.safeParse({ ...scenario, coefficientKgPerParticipantDay: { min: 0, max: Infinity, provenance: "x" } }).success).toBe(false);
  expect(scenarioSchema.safeParse({ ...scenario, categoryShares: { organic: 1, recyclable: 1, residual: 0 } }).success).toBe(false);
 });
 it("keeps historical nearby candidates separate from suitable facilities", () => {
  const result = nearbyFacilities({ latitude: -8.63, longitude: 115.21 });
  expect(result.suitableMatches).toEqual([]); expect(result.nearbyCandidates).toHaveLength(3);
  expect(result.nearbyCandidates.every(f => !f.acceptanceConfirmed && f.needsConfirmation && f.distanceMethod === "straight_line")).toBe(true);
  expect(nearbyFacilities().nearbyCandidates).toEqual([]);
 });
});

it("marks expired and invalid road observations unconfirmed", () => {
 expect(freshRoadStatus("open", "2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe("unconfirmed");
 expect(freshRoadStatus("open", null)).toBe("unconfirmed");
 expect(freshRoadStatus("open", "invalid")).toBe("unconfirmed");
 expect(freshRoadStatus("open", "2027-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe("open");
});


describe("curated synthetic source-reference cases", () => {
 it.each([
  "event:private", "event:draft", "event:other-org", "event:", "event:SYNTHETIC", "event:synthetic/../private", "https://evil.example", "//evil.example", "http://127.0.0.1", "file:///secret", "event:synthetic?x=1", "event:synthetic#x", " event:synthetic", "event:synthetic ", "event:synthetic\n", "road:synthetic", "cleanup:synthetic", "null", "<script>", "event:synthetic%00"
 ])("rejects unrecognized reference %s", (id) => {
  expect(validateSelection({ intent: "event_lookup", sourceIds: [id] }, [source])).toBeNull();
 });
});
