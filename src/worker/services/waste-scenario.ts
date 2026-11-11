import { z } from "zod";

const fraction = z.number().finite().min(0).max(1);
export const scenarioSchema = z.object({
 coefficientKgPerParticipantDay: z.object({ min: z.number().finite().min(0).max(10), max: z.number().finite().min(0).max(10), provenance: z.string().trim().min(1).max(300) }).strict().refine(v => v.min <= v.max, "Coefficient minimum must not exceed maximum"),
 categoryShares: z.object({ organic: fraction, recyclable: fraction, residual: fraction }).strict().refine(v => Math.abs(v.organic + v.recyclable + v.residual - 1) < 0.000001, "Shares must sum to one").optional(),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;
const round = (n: number) => Math.round(n * 10) / 10;
export function calculateScenario(participants: number, durationHours: number, scenario: Scenario) {
 const calculate = (rate: number) => {
  const totalKg = round(participants * durationHours / 24 * rate);
  const shares = scenario.categoryShares;
  if (!shares) return { totalKg, categoriesKg: null };
  const organic = round(totalKg * shares.organic);
  const recyclable = Math.min(round(totalKg * shares.recyclable), round(totalKg - organic));
  return { totalKg, categoriesKg: { organic, recyclable, residual: round(totalKg - organic - recyclable) } };
 };
 return { version: 2 as const, method: "user_assumption_range" as const, formula: "participants × (durationHours / 24) × coefficientKgPerParticipantDay", assumptions: scenario, low: calculate(scenario.coefficientKgPerParticipantDay.min), high: calculate(scenario.coefficientKgPerParticipantDay.max), measuredKg: null, forecastKg: null };
}
export const wasteHandlingAdvice = [
 { category: "organic", action: "Pisahkan bahan organik dan konfirmasi penerimaan pengomposan dengan pengelola setempat.", source: "https://www.unep.org/ietc/resources/publication/ccet-guideline-series-intermediate-municipal-solid-waste-treatment" },
 { category: "recyclable", action: "Pisahkan bahan yang dapat didaur ulang dan konfirmasi jenis yang diterima bank sampah setempat.", source: "https://tnujungkulon.menlhk.go.id/berita/detail/244" },
 { category: "residual", action: "Pisahkan sisa yang tidak dapat dimanfaatkan dan koordinasikan pengangkutan dengan pengelola setempat.", source: "https://sipsn.menlhk.go.id/sipsn/upload/produkhukum/ph_81Tahun2012_file_1605942047065.pdf" },
] as const;
