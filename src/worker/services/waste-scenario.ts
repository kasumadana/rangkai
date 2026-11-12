import { z } from "zod";

const fraction = z.number().finite().min(0).max(1);
export const scenarioSchema = z.object({
 coefficientKgPerParticipantDay: z.object({ min: z.number().finite().min(0).max(10), max: z.number().finite().min(0).max(10), provenance: z.string().trim().min(1).max(300) }).strict().refine(v => v.min <= v.max, "Coefficient minimum must not exceed maximum"),
 categoryShares: z.object({ organic: fraction, recyclable: fraction, residual: fraction }).strict().refine(v => Math.abs(v.organic + v.recyclable + v.residual - 1) < 0.000001, "Shares must sum to one").optional(),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export function calculateScenario(participants: number, durationHours: number, scenario: Scenario) {
  const shares = scenario.categoryShares;
  const allocate = (tenths: number): number[] | null => {
    if (!shares) return null;
    const values = [shares.organic, shares.recyclable, shares.residual];
    const sum = values.reduce((total, value) => total + value, 0);
    const raw = values.map(value => tenths * value / sum);
    const result = raw.map(Math.floor);
    const remaining = tenths - result.reduce((total, value) => total + value, 0);
    const order = raw
      .map((value, index) => ({ index, remainder: value - result[index] }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < remaining; i++) result[order[i].index]++;
    return result;
  };
  const lowTenths = Math.round(participants * durationHours / 24 * scenario.coefficientKgPerParticipantDay.min * 10);
  const highTenths = Math.round(participants * durationHours / 24 * scenario.coefficientKgPerParticipantDay.max * 10);
  const lowParts = allocate(lowTenths);
  const increments = allocate(highTenths - lowTenths);
  const categories = (parts: number[] | null) => parts
    ? { organic: parts[0] / 10, recyclable: parts[1] / 10, residual: parts[2] / 10 }
    : null;
  const low = { totalKg: lowTenths / 10, categoriesKg: categories(lowParts) };
  const highParts = lowParts && increments
    ? lowParts.map((value, index) => value + increments[index])
    : null;
  const high = { totalKg: highTenths / 10, categoriesKg: categories(highParts) };
  return {
    version: 2 as const,
    method: "user_assumption_range" as const,
    formula: "participants ? (durationHours / 24) ? coefficientKgPerParticipantDay",
    assumptions: scenario, low, high, measuredKg: null, forecastKg: null,
  };
}
export const wasteHandlingAdvice = [
 { category: "organic", action: "Pisahkan bahan organik dan konfirmasi penerimaan pengomposan dengan pengelola setempat.", source: "https://www.unep.org/ietc/resources/publication/ccet-guideline-series-intermediate-municipal-solid-waste-treatment" },
 { category: "recyclable", action: "Pisahkan bahan yang dapat didaur ulang dan konfirmasi jenis yang diterima bank sampah setempat.", source: "https://tnujungkulon.menlhk.go.id/berita/detail/244" },
 { category: "residual", action: "Pisahkan sisa yang tidak dapat dimanfaatkan dan koordinasikan pengangkutan dengan pengelola setempat.", source: "https://sipsn.menlhk.go.id/sipsn/upload/produkhukum/ph_81Tahun2012_file_1605942047065.pdf" },
] as const;
