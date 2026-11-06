import { describe, expect, it } from "vitest";
import {
	aggregateDocumentEvaluations,
	computeTextSimilarity,
	doRoadNamesMatch,
	evaluateCategoryField,
	evaluateDatetimeField,
	evaluateRoadExtraction,
	evaluateSingleDocument,
	evaluateTextField,
	normalizeRoadNameForMatching,
	toWitaCalendarDate,
	type CanonicalEvaluationDocument,
} from "../../src/worker/services/ai-evaluation";
import type { GeminiExtractionResult } from "../../src/worker/validators/extractions";

describe("AI Evaluation Metrics Engine (Roadmap C07)", () => {
	describe("Road name normalization and entity matching", () => {
		it("normalizes Indonesian/Balinese road abbreviations (Jl., Sp., ST., SE., Gg., P., Gn.)", () => {
			expect(normalizeRoadNameForMatching("JL. P. MOYO")).toBe("jalan pulau moyo");
			expect(normalizeRoadNameForMatching("jln. Pulau roti")).toBe("jalan pulau roti");
			expect(normalizeRoadNameForMatching("Sp. Petitenget")).toBe("simpang petitenget");
			expect(normalizeRoadNameForMatching("ST. BELANCAN")).toBe("pertigaan belancan");
			expect(normalizeRoadNameForMatching("SE. PELUDU")).toBe("perempatan peludu");
			expect(normalizeRoadNameForMatching("Gg. Babakan Sari VII E")).toBe(
				"gang babakan sari vii e",
			);
			expect(normalizeRoadNameForMatching("Jl. Gn. Tangkuban Perahu")).toBe(
				"jalan gunung tangkuban perahu",
			);
		});

		it("matches road names across abbreviations and parenthetical annotations", () => {
			expect(doRoadNamesMatch("Jalan Pulau Moyo", "JL. P. MOYO")).toBe(true);
			expect(doRoadNamesMatch("Simpang Petitenget", "Sp. Petitenget")).toBe(true);
			expect(
				doRoadNamesMatch(
					"Jalan Umalas 1",
					"Jl. Umalas 1 (Gang Nook)",
				),
			).toBe(true);
			expect(
				doRoadNamesMatch(
					"Jalan Bypass I.B. Mantra",
					"Jl. Bypass I.B. Mantra (Sp. Ketewel - Sp. Selukat)",
				),
			).toBe(true);
			expect(doRoadNamesMatch("Jalan Pulau Moyo", "Jalan Pulau Roti")).toBe(false);
		});

		it("calculates precision, recall, F1, and needs_review compliance accurately", () => {
			const expected = [
				{ name: "Jalan Pulau Moyo", evidence: "JL. P. MOYO", needs_review: true },
				{ name: "Jalan Pulau Roti", evidence: "JL. P. ROTI", needs_review: true },
				{ name: "Jalan Raya Sesetan", evidence: "JL. RAYA SESETAN", needs_review: true },
			];
			const extracted = [
				{ name: "Jl. P. Moyo", needs_review: true },
				{ name: "Jl. Pulau Roti", needs_review: true },
				{ name: "Jl. Gurita I", needs_review: true },
			];

			const res = evaluateRoadExtraction(expected, extracted);
			expect(res.truePositives).toBe(2);
			expect(res.falsePositives).toBe(1);
			expect(res.falseNegatives).toBe(1);
			expect(res.precision).toBeCloseTo(0.6667, 3);
			expect(res.recall).toBeCloseTo(0.6667, 3);
			expect(res.f1).toBeCloseTo(0.6667, 3);
			expect(res.missingRoads).toEqual(["Jalan Raya Sesetan"]);
			expect(res.extraRoads).toEqual(["Jl. Gurita I"]);
			expect(res.allFlaggedNeedsReview).toBe(true);
		});
	});

	describe("Datetime evaluation & Null detection (TC-005 / QA Gate T10)", () => {
		it("rewards null + needs_review: true when end_datetime is missing in ground truth", () => {
			const res = evaluateDatetimeField(
				"end_datetime",
				{ value: null, evidence: "s/d selesai", needs_review: true },
				{ value: null, needs_review: true },
			);
			expect(res.isExpectedNull).toBe(true);
			expect(res.isActualNull).toBe(true);
			expect(res.nullDetectionCorrect).toBe(true);
			expect(res.strictMatch).toBe(true);
			expect(res.operationalMatch).toBe(true);
			expect(res.errorCategory).toBe("NONE");
		});

		it("flags hallucinated datetime when ground truth is null", () => {
			const res = evaluateDatetimeField(
				"end_datetime",
				{ value: null, evidence: "s/d selesai", needs_review: true },
				{ value: "2026-11-01T23:00:00.000Z", needs_review: false },
			);
			expect(res.nullDetectionCorrect).toBe(false);
			expect(res.strictMatch).toBe(false);
			expect(res.operationalMatch).toBe(false);
			expect(res.errorCategory).toBe("HALLUCINATED_VALUE_ON_NULL");
		});

		it("matches equivalent timestamps across WITA (+08:00) and UTC (Z)", () => {
			const res = evaluateDatetimeField(
				"start_datetime",
				{ value: "2026-03-25T06:00:00+08:00", evidence: "06.00 WITA", needs_review: false },
				{ value: "2026-03-24T22:00:00.000Z", needs_review: false },
			);
			expect(res.strictMatch).toBe(true);
			expect(res.operationalMatch).toBe(true);
			expect(toWitaCalendarDate("2026-03-24T22:00:00.000Z")).toBe("2026-03-25");
		});

		it("recognizes model abstention on date-only ground truth boundary (00:00:00+08:00)", () => {
			const res = evaluateDatetimeField(
				"start_datetime",
				{ value: "2026-10-14T00:00:00+08:00", evidence: "14 Oktober 2026", needs_review: false },
				{ value: null, needs_review: true },
			);
			expect(res.strictMatch).toBe(false);
			expect(res.operationalMatch).toBe(true);
			expect(res.errorCategory).toBe("UNSTATED_CLOCK_TIME_ABSTENTION");
		});
	});

	describe("Category & Text evaluation", () => {
		it("evaluates direct enum match and C02 English category mapping", () => {
			const direct = evaluateCategoryField(
				{ value: "upacara", evidence: "upacara", needs_review: false },
				{ value: "upacara", needs_review: false },
			);
			expect(direct.strictMatch).toBe(true);
			expect(direct.operationalMatch).toBe(true);

			const mapped = evaluateCategoryField(
				{ value: "religious_ceremony", evidence: "karya", needs_review: false },
				{ value: "upacara_adat", needs_review: false },
			);
			expect(mapped.strictMatch).toBe(false);
			expect(mapped.operationalMatch).toBe(true);
			expect(mapped.errorCategory).toBe("CATEGORY_MAPPING_MATCH");
		});

		it("computes token similarity and operational match for paraphrased Indonesian event text", () => {
			const sim = computeTextSimilarity(
				"Penutupan bertahap sepanjang rute prosesi",
				"Penutupan berkala sepanjang rute prosesi adat",
			);
			expect(sim.tokenF1).toBeGreaterThanOrEqual(0.5);

			const evalRes = evaluateTextField(
				"traffic_impact_description",
				{
					value: "Penutupan bertahap sepanjang rute prosesi",
					evidence: "penutupan berkala",
					needs_review: true,
				},
				{
					value: "Penutupan berkala sepanjang rute prosesi adat",
					needs_review: true,
				},
			);
			expect(evalRes.strictMatch).toBe(false);
			expect(evalRes.operationalMatch).toBe(true);
			expect(evalRes.errorCategory).toBe("TEXT_PARAPHRASE_PARTIAL");
		});
	});

	describe("Document and dataset aggregation", () => {
		it("aggregates numerator, denominator, percentages, and road micro/macro F1", () => {
			const sampleDoc: CanonicalEvaluationDocument = {
				docId: "SYNTH_AI_001",
				dataset: "synthetic",
				category: "complete_announcement",
				filename: "sample-01-complete.png",
				provenance: "SYNTHETIC_TEST_DATA",
				event_name: { value: "Upacara Melasti Segara Sanur", evidence: "Melasti", needs_review: false },
				event_category: { value: "upacara", evidence: "upacara", needs_review: false },
				start_datetime: {
					value: "2026-03-25T06:00:00+08:00",
					evidence: "06.00 WITA",
					needs_review: false,
				},
				end_datetime: { value: null, evidence: null, needs_review: true },
				venue_name: { value: "Pantai Matahari Terbit Sanur", evidence: "Pantai", needs_review: false },
				affected_road_names: [
					{ name: "Jalan Hang Tuah", evidence: "Jl. Hang Tuah", needs_review: true },
				],
				procession_description: { value: null, evidence: null, needs_review: true },
				traffic_impact_description: {
					value: "Penutupan bertahap sepanjang rute prosesi",
					evidence: "penutupan",
					needs_review: true,
				},
				organizer_name: { value: "Desa Adat Sanur", evidence: "Desa Adat Sanur", needs_review: false },
			};

			const mockOutput: GeminiExtractionResult = {
				schema_version: "1.0",
				event_name: { value: "Upacara Melasti Segara Sanur", evidence: "Melasti", needs_review: false },
				event_category: { value: "upacara", evidence: "upacara", needs_review: false },
				start_datetime: {
					value: "2026-03-24T22:00:00.000Z",
					evidence: "06.00 WITA",
					needs_review: false,
				},
				end_datetime: { value: null, evidence: null, needs_review: true },
				venue_name: { value: "Pantai Matahari Terbit Sanur", evidence: "Pantai", needs_review: false },
				affected_road_names: [
					{ name: "Jl. Hang Tuah", evidence: "Jl. Hang Tuah", needs_review: true },
				],
				procession_description: { value: null, evidence: null, needs_review: true },
				traffic_impact_description: {
					value: "Penutupan bertahap sepanjang rute prosesi",
					evidence: "penutupan",
					needs_review: true,
				},
				organizer_name: { value: "Desa Adat Sanur", evidence: "Desa Adat Sanur", needs_review: false },
				issues: [],
			};

			const docReport = evaluateSingleDocument(sampleDoc, {
				ok: true,
				modelName: "gemini-3.5-flash-lite",
				promptVersion: "v1.1",
				schemaVersion: "1.0",
				latencyMs: 1450,
				data: mockOutput,
			});

			const agg = aggregateDocumentEvaluations("synthetic", [docReport]);
			expect(agg.sampleSize).toBe(1);
			expect(agg.schemaValidationPassRate.percentage).toBe(100);
			expect(agg.overallStrictFieldAccuracy.numerator).toBe(8);
			expect(agg.overallStrictFieldAccuracy.denominator).toBe(8);
			expect(agg.overallNullDetectionCorrectness.numerator).toBe(2);
			expect(agg.overallNullDetectionCorrectness.denominator).toBe(2);
			expect(agg.roadMetrics.microF1).toBe(1);
			expect(agg.latencyStats.p50Ms).toBe(1450);
		});
	});
});
