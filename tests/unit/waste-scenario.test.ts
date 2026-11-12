import { describe, expect, it } from "vitest";
import { calculateScenario } from "../../src/worker/services/waste-scenario";

describe("scenario category allocation", () => {
 it("resolves equal remainders in category order", () => {
  const result = calculateScenario(10, 24, { coefficientKgPerParticipantDay: { min: 0.01, max: 0.02, provenance: "test" }, categoryShares: { organic: 0.25, recyclable: 0.25, residual: 0.5 } });
  expect(result.low.categoriesKg).toEqual({ organic: 0, recyclable: 0, residual: 0.1 });
  expect(result.high.categoriesKg).toEqual({ organic: 0, recyclable: 0, residual: 0.2 });
 });
 it("breaks three-way ties in organic, recyclable, residual order", () => {
  const result = calculateScenario(1, 24, { coefficientKgPerParticipantDay: { min: 0.1, max: 0.2, provenance: "test" }, categoryShares: { organic: 1 / 3, recyclable: 1 / 3, residual: 1 / 3 } });
  expect(result.low.categoriesKg).toEqual({ organic: 0.1, recyclable: 0, residual: 0 });
 });
 it.each([
  [10, 0.01, 0.02, [0.25, 0.25, 0.5]],
  [1, 0, 0.01, [0.25, 0.25, 0.5]],
  [10, 0.1, 0.2, [1, 0, 0]],
  [37, 0.1, 0.7, [0.2, 0.3, 0.5]],
 ])("keeps category ranges ordered and totals consistent", (participants, min, max, shares) => {
  const result = calculateScenario(participants, 24, { coefficientKgPerParticipantDay: { min, max, provenance: "test" }, categoryShares: { organic: shares[0], recyclable: shares[1], residual: shares[2] } });
  const low = Object.values(result.low.categoriesKg!);
  const high = Object.values(result.high.categoriesKg!);
  low.forEach((value, index) => { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(high[index]); });
  expect(low.reduce((a, b) => a + b, 0)).toBeCloseTo(result.low.totalKg);
  expect(high.reduce((a, b) => a + b, 0)).toBeCloseTo(result.high.totalKg);
 });
});
