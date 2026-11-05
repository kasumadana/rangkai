import type { GeminiExtractionResult } from "../validators/extractions";

export interface CanonicalGroundTruthField {
	value: string | null;
	evidence: string | null;
	needs_review: boolean;
}

export interface CanonicalGroundTruthRoad {
	name: string;
	evidence: string | null;
	needs_review: boolean;
}

export interface CanonicalEvaluationDocument {
	docId: string;
	dataset: "synthetic" | "c02_train_dev" | "c02_unseen_test";
	category: string;
	filename: string;
	provenance: "SYNTHETIC_TEST_DATA" | "C02_EVAL_DATASET";
	event_name: CanonicalGroundTruthField;
	event_category: CanonicalGroundTruthField;
	start_datetime: CanonicalGroundTruthField;
	end_datetime: CanonicalGroundTruthField;
	venue_name: CanonicalGroundTruthField;
	affected_road_names: CanonicalGroundTruthRoad[];
	procession_description?: CanonicalGroundTruthField;
	traffic_impact_description: CanonicalGroundTruthField;
	organizer_name: CanonicalGroundTruthField;
}

export type EvaluationErrorCategory =
	| "NONE"
	| "PROVIDER_OR_SCHEMA_FAILURE"
	| "HALLUCINATED_VALUE_ON_NULL"
	| "MISSING_NEEDS_REVIEW_ON_NULL"
	| "OMITTED_PRESENT_VALUE"
	| "UNSTATED_CLOCK_TIME_ABSTENTION"
	| "AMBIGUOUS_FIELD_ABSTENTION"
	| "DATE_OR_TIME_MISMATCH"
	| "TEXT_PARAPHRASE_PARTIAL"
	| "TEXT_VALUE_MISMATCH"
	| "CATEGORY_MAPPING_MATCH"
	| "CATEGORY_MISMATCH";

export interface ScalarFieldEvaluation {
	fieldName:
		| "event_name"
		| "event_category"
		| "start_datetime"
		| "end_datetime"
		| "venue_name"
		| "procession_description"
		| "traffic_impact_description"
		| "organizer_name";
	expectedValue: string | null;
	expectedNeedsReview: boolean;
	actualValue: string | null;
	actualNeedsReview: boolean;
	isExpectedNull: boolean;
	isActualNull: boolean;
	/** True when expectedValue is null and actualValue is null (and actualNeedsReview is true). */
	nullDetectionCorrect: boolean | null;
	/** Strict normalized match (exact instant for datetime, exact enum for category, exact normalized text for strings). */
	strictMatch: boolean;
	/** Lenient/operational match (calendar date / abstention-aware for datetime, semantic group for C02 category, token overlap >= 0.5 or substring containment for text). */
	operationalMatch: boolean;
	tokenSimilarity: number;
	requiresHumanCorrection: boolean;
	errorCategory: EvaluationErrorCategory;
}

export interface RoadExtractionEvaluation {
	expectedRoads: string[];
	extractedRoads: string[];
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	precision: number;
	recall: number;
	f1: number;
	matchedPairs: Array<{ expected: string; extracted: string }>;
	missingRoads: string[];
	extraRoads: string[];
	allFlaggedNeedsReview: boolean;
}

export interface DocumentEvaluationReport {
	docId: string;
	dataset: "synthetic" | "c02_train_dev" | "c02_unseen_test";
	category: string;
	filename: string;
	provenance: "SYNTHETIC_TEST_DATA" | "C02_EVAL_DATASET";
	status: "completed" | "failed";
	modelName: string;
	promptVersion: string;
	schemaVersion: string;
	latencyMs: number;
	errorCode: string | null;
	schemaValid: boolean;
	fields: Record<ScalarFieldEvaluation["fieldName"], ScalarFieldEvaluation | undefined>;
	roads: RoadExtractionEvaluation;
	humanCorrectionRate: {
		numerator: number;
		denominator: number;
		rate: number;
	};
}

export interface RatioMetric {
	numerator: number;
	denominator: number;
	rate: number;
	percentage: number;
}

export interface FieldAggregateSummary {
	fieldName: ScalarFieldEvaluation["fieldName"];
	sampleSize: number;
	strictAccuracy: RatioMetric;
	operationalAccuracy: RatioMetric;
	nonNullSampleSize: number;
	nonNullStrictAccuracy: RatioMetric;
	nonNullOperationalAccuracy: RatioMetric;
	nullSampleSize: number;
	nullCorrectness: RatioMetric;
	humanCorrectionRate: RatioMetric;
	errorBreakdown: Partial<Record<EvaluationErrorCategory, number>>;
}

export interface DatasetAggregateReport {
	datasetLabel: string;
	sampleSize: number;
	schemaValidationPassRate: RatioMetric;
	overallStrictFieldAccuracy: RatioMetric;
	overallOperationalFieldAccuracy: RatioMetric;
	overallNullDetectionCorrectness: RatioMetric;
	overallHumanCorrectionRate: RatioMetric;
	fieldSummaries: Record<string, FieldAggregateSummary>;
	roadMetrics: {
		totalExpectedRoads: number;
		totalExtractedRoads: number;
		truePositives: number;
		falsePositives: number;
		falseNegatives: number;
		microPrecision: number;
		microRecall: number;
		microF1: number;
		macroPrecision: number;
		macroRecall: number;
		macroF1: number;
		needsReviewCompliance: RatioMetric;
	};
	latencyStats: {
		minMs: number;
		p50Ms: number;
		p95Ms: number;
		maxMs: number;
		meanMs: number;
	};
}

const C02_CATEGORY_MAP: Record<string, ReadonlyArray<string>> = {
	religious_ceremony: ["upacara", "upacara_adat", "keagamaan", "budaya"],
	infrastructure_work: ["lainnya"],
	traffic_management: ["lainnya", "upacara", "pawai"],
	sports_procession: ["olahraga", "lomba", "pawai", "procession"],
};

export function makeRatioMetric(numerator: number, denominator: number): RatioMetric {
	if (denominator <= 0) {
		return { numerator: 0, denominator: 0, rate: 0, percentage: 0 };
	}
	const rate = Number((numerator / denominator).toFixed(4));
	const percentage = Number(((numerator / denominator) * 100).toFixed(2));
	return { numerator, denominator, rate, percentage };
}

/**
 * Normalizes general text for comparison: lowercase, strip diacritics, remove punctuation, collapse spaces.
 */
export function normalizeTextForComparison(input: string): string {
	return input
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\b(jln|jl)\.?\b/g, "jalan")
		.replace(/\bsp\.?\b/g, "simpang")
		.replace(/\bgg\.?\b/g, "gang")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const STOPWORDS = new Set([
	"di",
	"ke",
	"dari",
	"dan",
	"atau",
	"yang",
	"untuk",
	"pada",
	"dengan",
	"akan",
	"dalam",
	"oleh",
	"lan",
	"miwah",
]);

/**
 * Computes token-level Dice/F1 similarity and checks substring containment.
 */
export function computeTextSimilarity(expected: string, actual: string): {
	exactNormalized: boolean;
	containment: boolean;
	tokenF1: number;
} {
	const normExp = normalizeTextForComparison(expected);
	const normAct = normalizeTextForComparison(actual);

	if (normExp.length === 0 && normAct.length === 0) {
		return { exactNormalized: true, containment: true, tokenF1: 1 };
	}
	if (normExp.length === 0 || normAct.length === 0) {
		return { exactNormalized: false, containment: false, tokenF1: 0 };
	}

	const exactNormalized = normExp === normAct;
	const containment = normExp.includes(normAct) || normAct.includes(normExp);

	const expTokens = normExp
		.split(" ")
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));
	const actTokens = normAct
		.split(" ")
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));

	if (expTokens.length === 0 || actTokens.length === 0) {
		return {
			exactNormalized,
			containment,
			tokenF1: exactNormalized ? 1 : containment ? 0.8 : 0,
		};
	}

	const expSet = new Set(expTokens);
	const actSet = new Set(actTokens);
	let overlap = 0;
	for (const token of expSet) {
		if (actSet.has(token)) {
			overlap += 1;
		}
	}

	const precision = overlap / actSet.size;
	const recall = overlap / expSet.size;
	const tokenF1 =
		precision + recall > 0
			? Number(((2 * precision * recall) / (precision + recall)).toFixed(4))
			: 0;

	return { exactNormalized, containment, tokenF1 };
}

/**
 * Normalizes Balinese/Indonesian road names and common abbreviations (Jl., Sp., ST., SE., Gg., P., Gn.).
 */
export function normalizeRoadNameForMatching(rawName: string): string {
	// Strip parenthetical annotations such as "(Gang Nook)" or "(JALUR ALTERNATIF)"
	const withoutParens = rawName.replace(/\([^)]*\)/g, " ");

	return withoutParens
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\b(jln|jl)\.?\b/g, "jalan")
		.replace(/\bsp\.?\b/g, "simpang")
		.replace(/\bst\.?\b/g, "pertigaan")
		.replace(/\bse\.?\b/g, "perempatan")
		.replace(/\bgg\.?\b/g, "gang")
		.replace(/\bgn\.?\b/g, "gunung")
		.replace(/\bp\.?\s+(?=[a-z])/g, "pulau ")
		.replace(/\bby\s+pass\b/g, "bypass")
		.replace(/\bi\s*\.?\s*b\.?\b/g, "ib")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Determines whether two road names refer to the same road entity.
 */
export function doRoadNamesMatch(expectedRoad: string, extractedRoad: string): boolean {
	const normExp = normalizeRoadNameForMatching(expectedRoad);
	const normExt = normalizeRoadNameForMatching(extractedRoad);

	if (!normExp || !normExt) return false;
	if (normExp === normExt) return true;

	// Strip generic prefix ("jalan", "ruas jalan", "simpang", "pertigaan", "perempatan") for core entity comparison
	const stripPrefix = (s: string) =>
		s
			.replace(/^(ruas\s+)?(jalan\s+raya|jalan|simpang|pertigaan|perempatan)\s+/g, "")
			.trim();

	const coreExp = stripPrefix(normExp);
	const coreExt = stripPrefix(normExt);

	if (coreExp.length >= 4 && coreExp === coreExt) {
		return true;
	}

	// Check if one contains the other as a full token sequence (e.g., "Jalan Bypass I.B. Mantra (Sp. Ketewel)" vs "Jalan Bypass I.B. Mantra")
	if (
		coreExp.length >= 5 &&
		coreExt.length >= 5 &&
		(normExp.includes(normExt) || normExt.includes(normExp))
	) {
		return true;
	}

	return false;
}

/**
 * Evaluates road name extraction precision, recall, and F1 using greedy 1-to-1 matching.
 */
export function evaluateRoadExtraction(
	expectedRoads: ReadonlyArray<CanonicalGroundTruthRoad>,
	extractedRoads: ReadonlyArray<{ name: string; needs_review: boolean }>,
): RoadExtractionEvaluation {
	const expNames = expectedRoads.map((r) => r.name);
	const extNames = extractedRoads.map((r) => r.name);

	const matchedExtIndices = new Set<number>();
	const matchedPairs: Array<{ expected: string; extracted: string }> = [];
	const missingRoads: string[] = [];

	for (const expName of expNames) {
		let foundIdx = -1;
		for (let j = 0; j < extNames.length; j++) {
			if (matchedExtIndices.has(j)) continue;
			if (doRoadNamesMatch(expName, extNames[j])) {
				foundIdx = j;
				break;
			}
		}

		if (foundIdx !== -1) {
			matchedExtIndices.add(foundIdx);
			matchedPairs.push({
				expected: expName,
				extracted: extNames[foundIdx],
			});
		} else {
			missingRoads.push(expName);
		}
	}

	const extraRoads = extNames.filter((_, idx) => !matchedExtIndices.has(idx));
	const tp = matchedPairs.length;
	const fp = extraRoads.length;
	const fn = missingRoads.length;

	const precision =
		tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(4)) : expNames.length === 0 ? 1 : 0;
	const recall =
		tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(4)) : expNames.length === 0 ? 1 : 0;
	const f1 =
		precision + recall > 0
			? Number(((2 * precision * recall) / (precision + recall)).toFixed(4))
			: 0;

	const allFlaggedNeedsReview = extractedRoads.every((r) => r.needs_review === true);

	return {
		expectedRoads: expNames,
		extractedRoads: extNames,
		truePositives: tp,
		falsePositives: fp,
		falseNegatives: fn,
		precision,
		recall,
		f1,
		matchedPairs,
		missingRoads,
		extraRoads,
		allFlaggedNeedsReview,
	};
}

/**
 * Formats a UTC millisecond timestamp into YYYY-MM-DD in Asia/Makassar (UTC+08:00).
 */
export function toWitaCalendarDate(isoString: string): string | null {
	const ms = Date.parse(isoString);
	if (Number.isNaN(ms)) return null;
	const witaMs = ms + 8 * 3600_000;
	const d = new Date(witaMs);
	const year = d.getUTCFullYear();
	const month = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Checks whether a ground-truth ISO timestamp uses a synthetic day boundary
 * (00:00:00+08:00 or 23:59:59+08:00) representing a date-only announcement without clock time.
 */
export function isDateOnlyBoundaryTimestamp(isoString: string): boolean {
	return (
		isoString.includes("T00:00:00+08:00") ||
		isoString.includes("T23:59:59+08:00") ||
		isoString.includes("T16:00:00.000Z") ||
		isoString.includes("T15:59:59.000Z")
	);
}

/**
 * Evaluates a datetime field (`start_datetime` or `end_datetime`).
 */
export function evaluateDatetimeField(
	fieldName: "start_datetime" | "end_datetime",
	expected: CanonicalGroundTruthField,
	actual: { value: string | null; needs_review: boolean },
): ScalarFieldEvaluation {
	const isExpectedNull = expected.value === null;
	const isActualNull = actual.value === null;

	if (isExpectedNull) {
		const nullCorrect = isActualNull && actual.needs_review === true;
		const errorCategory: EvaluationErrorCategory = !isActualNull
			? "HALLUCINATED_VALUE_ON_NULL"
			: !actual.needs_review
				? "MISSING_NEEDS_REVIEW_ON_NULL"
				: "NONE";

		return {
			fieldName,
			expectedValue: null,
			expectedNeedsReview: expected.needs_review,
			actualValue: actual.value,
			actualNeedsReview: actual.needs_review,
			isExpectedNull: true,
			isActualNull,
			nullDetectionCorrect: nullCorrect,
			strictMatch: nullCorrect,
			operationalMatch: nullCorrect,
			tokenSimilarity: nullCorrect ? 1 : 0,
			requiresHumanCorrection: true, // Missing datetime always requires organizer confirmation
			errorCategory,
		};
	}

	// Expected is non-null
	if (isActualNull) {
		// Check if ground truth was a date-only boundary (e.g. "14-17 Oktober 2026" without clock hours)
		// where Gemini followed SYSTEM_INSTRUCTION Rule #3/#4 and returned null + needs_review: true
		const abstainedOnDateOnly =
			isDateOnlyBoundaryTimestamp(expected.value!) && actual.needs_review === true;

		return {
			fieldName,
			expectedValue: expected.value,
			expectedNeedsReview: expected.needs_review,
			actualValue: null,
			actualNeedsReview: actual.needs_review,
			isExpectedNull: false,
			isActualNull: true,
			nullDetectionCorrect: null,
			strictMatch: false,
			operationalMatch: abstainedOnDateOnly,
			tokenSimilarity: abstainedOnDateOnly ? 0.5 : 0,
			requiresHumanCorrection: true,
			errorCategory: abstainedOnDateOnly
				? "UNSTATED_CLOCK_TIME_ABSTENTION"
				: "OMITTED_PRESENT_VALUE",
		};
	}

	const expMs = Date.parse(expected.value!);
	const actMs = Date.parse(actual.value!);
	const exactInstantMatch = !Number.isNaN(expMs) && !Number.isNaN(actMs) && expMs === actMs;

	const expDate = toWitaCalendarDate(expected.value!);
	const actDate = toWitaCalendarDate(actual.value!);
	const sameCalendarDate = expDate !== null && expDate === actDate;

	const operationalMatch =
		exactInstantMatch ||
		(sameCalendarDate && isDateOnlyBoundaryTimestamp(expected.value!));

	return {
		fieldName,
		expectedValue: expected.value,
		expectedNeedsReview: expected.needs_review,
		actualValue: actual.value,
		actualNeedsReview: actual.needs_review,
		isExpectedNull: false,
		isActualNull: false,
		nullDetectionCorrect: null,
		strictMatch: exactInstantMatch,
		operationalMatch,
		tokenSimilarity: exactInstantMatch ? 1 : sameCalendarDate ? 0.8 : 0,
		requiresHumanCorrection: !exactInstantMatch || actual.needs_review,
		errorCategory: exactInstantMatch
			? "NONE"
			: operationalMatch
				? "UNSTATED_CLOCK_TIME_ABSTENTION"
				: "DATE_OR_TIME_MISMATCH",
	};
}

/**
 * Evaluates `event_category` supporting both native Indonesian enum values and C02 English category labels.
 */
export function evaluateCategoryField(
	expected: CanonicalGroundTruthField,
	actual: { value: string | null; needs_review: boolean },
): ScalarFieldEvaluation {
	const isExpectedNull = expected.value === null;
	const isActualNull = actual.value === null;

	if (isExpectedNull) {
		const nullCorrect = isActualNull && actual.needs_review === true;
		return {
			fieldName: "event_category",
			expectedValue: null,
			expectedNeedsReview: expected.needs_review,
			actualValue: actual.value,
			actualNeedsReview: actual.needs_review,
			isExpectedNull: true,
			isActualNull,
			nullDetectionCorrect: nullCorrect,
			strictMatch: nullCorrect,
			operationalMatch: nullCorrect,
			tokenSimilarity: nullCorrect ? 1 : 0,
			requiresHumanCorrection: true,
			errorCategory: nullCorrect ? "NONE" : "HALLUCINATED_VALUE_ON_NULL",
		};
	}

	if (isActualNull) {
		return {
			fieldName: "event_category",
			expectedValue: expected.value,
			expectedNeedsReview: expected.needs_review,
			actualValue: null,
			actualNeedsReview: actual.needs_review,
			isExpectedNull: false,
			isActualNull: true,
			nullDetectionCorrect: null,
			strictMatch: false,
			operationalMatch: false,
			tokenSimilarity: 0,
			requiresHumanCorrection: true,
			errorCategory: "OMITTED_PRESENT_VALUE",
		};
	}

	const expVal = expected.value!.trim().toLowerCase();
	const actVal = actual.value!.trim().toLowerCase();

	const strictMatch = expVal === actVal;
	const mappedTargets = C02_CATEGORY_MAP[expVal] ?? [];
	const operationalMatch = strictMatch || mappedTargets.includes(actVal);

	return {
		fieldName: "event_category",
		expectedValue: expected.value,
		expectedNeedsReview: expected.needs_review,
		actualValue: actual.value,
		actualNeedsReview: actual.needs_review,
		isExpectedNull: false,
		isActualNull: false,
		nullDetectionCorrect: null,
		strictMatch,
		operationalMatch,
		tokenSimilarity: strictMatch ? 1 : operationalMatch ? 0.9 : 0,
		requiresHumanCorrection: !operationalMatch,
		errorCategory: strictMatch
			? "NONE"
			: operationalMatch
				? "CATEGORY_MAPPING_MATCH"
				: "CATEGORY_MISMATCH",
	};
}

/**
 * Evaluates a free-text field (`event_name`, `venue_name`, `procession_description`, `traffic_impact_description`, `organizer_name`).
 */
export function evaluateTextField(
	fieldName:
		| "event_name"
		| "venue_name"
		| "procession_description"
		| "traffic_impact_description"
		| "organizer_name",
	expected: CanonicalGroundTruthField,
	actual: { value: string | null; needs_review: boolean },
): ScalarFieldEvaluation {
	const isExpectedNull = expected.value === null;
	const isActualNull = actual.value === null;

	if (isExpectedNull) {
		const nullCorrect = isActualNull && actual.needs_review === true;
		const errorCategory: EvaluationErrorCategory = !isActualNull
			? "HALLUCINATED_VALUE_ON_NULL"
			: !actual.needs_review
				? "MISSING_NEEDS_REVIEW_ON_NULL"
				: "NONE";

		return {
			fieldName,
			expectedValue: null,
			expectedNeedsReview: expected.needs_review,
			actualValue: actual.value,
			actualNeedsReview: actual.needs_review,
			isExpectedNull: true,
			isActualNull,
			nullDetectionCorrect: nullCorrect,
			strictMatch: nullCorrect,
			operationalMatch: nullCorrect,
			tokenSimilarity: nullCorrect ? 1 : 0,
			requiresHumanCorrection: !nullCorrect,
			errorCategory,
		};
	}

	if (isActualNull) {
		const abstainedOnAmbiguous =
			expected.needs_review === true && actual.needs_review === true;
		return {
			fieldName,
			expectedValue: expected.value,
			expectedNeedsReview: expected.needs_review,
			actualValue: null,
			actualNeedsReview: actual.needs_review,
			isExpectedNull: false,
			isActualNull: true,
			nullDetectionCorrect: null,
			strictMatch: false,
			operationalMatch: abstainedOnAmbiguous,
			tokenSimilarity: abstainedOnAmbiguous ? 0.5 : 0,
			requiresHumanCorrection: true,
			errorCategory: abstainedOnAmbiguous
				? "AMBIGUOUS_FIELD_ABSTENTION"
				: "OMITTED_PRESENT_VALUE",
		};
	}

	const sim = computeTextSimilarity(expected.value!, actual.value!);
	const strictMatch = sim.exactNormalized;
	// Operational match holds when exact normalized, or one contains the other, or token F1 >= 0.35
	const operationalMatch = sim.exactNormalized || sim.containment || sim.tokenF1 >= 0.35;

	return {
		fieldName,
		expectedValue: expected.value,
		expectedNeedsReview: expected.needs_review,
		actualValue: actual.value,
		actualNeedsReview: actual.needs_review,
		isExpectedNull: false,
		isActualNull: false,
		nullDetectionCorrect: null,
		strictMatch,
		operationalMatch,
		tokenSimilarity: sim.exactNormalized ? 1 : Math.max(sim.tokenF1, sim.containment ? 0.75 : 0),
		requiresHumanCorrection: !operationalMatch,
		errorCategory: strictMatch
			? "NONE"
			: operationalMatch
				? "TEXT_PARAPHRASE_PARTIAL"
				: "TEXT_VALUE_MISMATCH",
	};
}

/**
 * Evaluates a single document's Gemini extraction outcome against its canonical ground truth.
 */
export function evaluateSingleDocument(
	doc: CanonicalEvaluationDocument,
	outcome: {
		ok: boolean;
		modelName: string;
		promptVersion: string;
		schemaVersion: string;
		latencyMs: number;
		errorCode?: string;
		data?: GeminiExtractionResult;
	},
): DocumentEvaluationReport {
	if (!outcome.ok || !outcome.data) {
		const emptyRoads = evaluateRoadExtraction(doc.affected_road_names, []);
		return {
			docId: doc.docId,
			dataset: doc.dataset,
			category: doc.category,
			filename: doc.filename,
			provenance: doc.provenance,
			status: "failed",
			modelName: outcome.modelName,
			promptVersion: outcome.promptVersion,
			schemaVersion: outcome.schemaVersion,
			latencyMs: outcome.latencyMs,
			errorCode: outcome.errorCode ?? "PROVIDER_ERROR",
			schemaValid: false,
			fields: {
				event_name: undefined,
				event_category: undefined,
				start_datetime: undefined,
				end_datetime: undefined,
				venue_name: undefined,
				procession_description: undefined,
				traffic_impact_description: undefined,
				organizer_name: undefined,
			},
			roads: emptyRoads,
			humanCorrectionRate: {
				numerator: 1,
				denominator: 1,
				rate: 1,
			},
		};
	}

	const data = outcome.data;
	const fields: Record<ScalarFieldEvaluation["fieldName"], ScalarFieldEvaluation | undefined> = {
		event_name: evaluateTextField("event_name", doc.event_name, data.event_name),
		event_category: evaluateCategoryField(doc.event_category, data.event_category),
		start_datetime: evaluateDatetimeField(
			"start_datetime",
			doc.start_datetime,
			data.start_datetime,
		),
		end_datetime: evaluateDatetimeField("end_datetime", doc.end_datetime, data.end_datetime),
		venue_name: evaluateTextField("venue_name", doc.venue_name, data.venue_name),
		procession_description: doc.procession_description
			? evaluateTextField(
					"procession_description",
					doc.procession_description,
					data.procession_description,
				)
			: undefined,
		traffic_impact_description: evaluateTextField(
			"traffic_impact_description",
			doc.traffic_impact_description,
			data.traffic_impact_description,
		),
		organizer_name: evaluateTextField(
			"organizer_name",
			doc.organizer_name,
			data.organizer_name,
		),
	};

	const roads = evaluateRoadExtraction(doc.affected_road_names, data.affected_road_names);

	const evaluatedFields = Object.values(fields).filter(
		(f): f is ScalarFieldEvaluation => f !== undefined,
	);
	const correctionCount = evaluatedFields.filter((f) => f.requiresHumanCorrection).length;

	return {
		docId: doc.docId,
		dataset: doc.dataset,
		category: doc.category,
		filename: doc.filename,
		provenance: doc.provenance,
		status: "completed",
		modelName: outcome.modelName,
		promptVersion: outcome.promptVersion,
		schemaVersion: outcome.schemaVersion,
		latencyMs: outcome.latencyMs,
		errorCode: null,
		schemaValid: true,
		fields,
		roads,
		humanCorrectionRate: {
			numerator: correctionCount,
			denominator: evaluatedFields.length,
			rate:
				evaluatedFields.length > 0
					? Number((correctionCount / evaluatedFields.length).toFixed(4))
					: 0,
		},
	};
}

const ALL_SCALAR_FIELDS: ReadonlyArray<ScalarFieldEvaluation["fieldName"]> = [
	"event_name",
	"event_category",
	"start_datetime",
	"end_datetime",
	"venue_name",
	"procession_description",
	"traffic_impact_description",
	"organizer_name",
];

function computePercentile(sortedValues: ReadonlyArray<number>, p: number): number {
	if (sortedValues.length === 0) return 0;
	const idx = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
	);
	return sortedValues[idx];
}

/**
 * Aggregates multiple DocumentEvaluationReport entries into a DatasetAggregateReport.
 */
export function aggregateDocumentEvaluations(
	datasetLabel: string,
	reports: ReadonlyArray<DocumentEvaluationReport>,
): DatasetAggregateReport {
	const sampleSize = reports.length;
	const schemaValidCount = reports.filter((r) => r.schemaValid).length;

	const fieldSummaries: Record<string, FieldAggregateSummary> = {};
	let totalFieldsCount = 0;
	let totalStrictCorrect = 0;
	let totalOperationalCorrect = 0;
	let totalNullCount = 0;
	let totalNullCorrect = 0;
	let totalHumanCorrections = 0;

	for (const fieldName of ALL_SCALAR_FIELDS) {
		const evals = reports
			.map((r) => r.fields[fieldName])
			.filter((f): f is ScalarFieldEvaluation => f !== undefined);

		if (evals.length === 0) continue;

		const strictHits = evals.filter((e) => e.strictMatch).length;
		const operationalHits = evals.filter((e) => e.operationalMatch).length;

		const nonNullEvals = evals.filter((e) => !e.isExpectedNull);
		const nonNullStrictHits = nonNullEvals.filter((e) => e.strictMatch).length;
		const nonNullOperationalHits = nonNullEvals.filter((e) => e.operationalMatch).length;

		const nullEvals = evals.filter((e) => e.isExpectedNull);
		const nullHits = nullEvals.filter((e) => e.nullDetectionCorrect === true).length;

		const humanCorrHits = evals.filter((e) => e.requiresHumanCorrection).length;

		const errorBreakdown: Partial<Record<EvaluationErrorCategory, number>> = {};
		for (const e of evals) {
			errorBreakdown[e.errorCategory] = (errorBreakdown[e.errorCategory] ?? 0) + 1;
		}

		fieldSummaries[fieldName] = {
			fieldName,
			sampleSize: evals.length,
			strictAccuracy: makeRatioMetric(strictHits, evals.length),
			operationalAccuracy: makeRatioMetric(operationalHits, evals.length),
			nonNullSampleSize: nonNullEvals.length,
			nonNullStrictAccuracy: makeRatioMetric(nonNullStrictHits, nonNullEvals.length),
			nonNullOperationalAccuracy: makeRatioMetric(
				nonNullOperationalHits,
				nonNullEvals.length,
			),
			nullSampleSize: nullEvals.length,
			nullCorrectness: makeRatioMetric(nullHits, nullEvals.length),
			humanCorrectionRate: makeRatioMetric(humanCorrHits, evals.length),
			errorBreakdown,
		};

		totalFieldsCount += evals.length;
		totalStrictCorrect += strictHits;
		totalOperationalCorrect += operationalHits;
		totalNullCount += nullEvals.length;
		totalNullCorrect += nullHits;
		totalHumanCorrections += humanCorrHits;
	}

	let totalExpectedRoads = 0;
	let totalExtractedRoads = 0;
	let tp = 0;
	let fp = 0;
	let fn = 0;
	let sumPrecision = 0;
	let sumRecall = 0;
	let sumF1 = 0;
	let needsReviewCompliantDocs = 0;

	for (const r of reports) {
		totalExpectedRoads += r.roads.expectedRoads.length;
		totalExtractedRoads += r.roads.extractedRoads.length;
		tp += r.roads.truePositives;
		fp += r.roads.falsePositives;
		fn += r.roads.falseNegatives;
		sumPrecision += r.roads.precision;
		sumRecall += r.roads.recall;
		sumF1 += r.roads.f1;
		if (r.roads.allFlaggedNeedsReview) {
			needsReviewCompliantDocs += 1;
		}
	}

	const microPrecision = tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(4)) : 0;
	const microRecall = tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(4)) : 0;
	const microF1 =
		microPrecision + microRecall > 0
			? Number(
					((2 * microPrecision * microRecall) / (microPrecision + microRecall)).toFixed(
						4,
					),
				)
			: 0;

	const macroPrecision =
		sampleSize > 0 ? Number((sumPrecision / sampleSize).toFixed(4)) : 0;
	const macroRecall = sampleSize > 0 ? Number((sumRecall / sampleSize).toFixed(4)) : 0;
	const macroF1 = sampleSize > 0 ? Number((sumF1 / sampleSize).toFixed(4)) : 0;

	const latencies = reports.map((r) => r.latencyMs).sort((a, b) => a - b);
	const sumLatency = latencies.reduce((acc, v) => acc + v, 0);

	return {
		datasetLabel,
		sampleSize,
		schemaValidationPassRate: makeRatioMetric(schemaValidCount, sampleSize),
		overallStrictFieldAccuracy: makeRatioMetric(totalStrictCorrect, totalFieldsCount),
		overallOperationalFieldAccuracy: makeRatioMetric(
			totalOperationalCorrect,
			totalFieldsCount,
		),
		overallNullDetectionCorrectness: makeRatioMetric(totalNullCorrect, totalNullCount),
		overallHumanCorrectionRate: makeRatioMetric(
			totalHumanCorrections,
			totalFieldsCount,
		),
		fieldSummaries,
		roadMetrics: {
			totalExpectedRoads,
			totalExtractedRoads,
			truePositives: tp,
			falsePositives: fp,
			falseNegatives: fn,
			microPrecision,
			microRecall,
			microF1,
			macroPrecision,
			macroRecall,
			macroF1,
			needsReviewCompliance: makeRatioMetric(needsReviewCompliantDocs, sampleSize),
		},
		latencyStats: {
			minMs: latencies[0] ?? 0,
			p50Ms: computePercentile(latencies, 50),
			p95Ms: computePercentile(latencies, 95),
			maxMs: latencies[latencies.length - 1] ?? 0,
			meanMs: sampleSize > 0 ? Math.round(sumLatency / sampleSize) : 0,
		},
	};
}
