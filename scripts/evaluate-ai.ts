import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
	aggregateDocumentEvaluations,
	evaluateSingleDocument,
	type CanonicalEvaluationDocument,
	type DatasetAggregateReport,
	type DocumentEvaluationReport,
} from "../src/worker/services/ai-evaluation";
import {
	extractDocumentWithGemini,
	type ExtractionServiceOutcome,
} from "../src/worker/services/gemini";
import { detectMimeFromMagicBytes } from "../src/worker/validators/documents";
import {
	GEMINI_MODEL_NAME,
	GEMINI_PROMPT_VERSION,
	GEMINI_SCHEMA_VERSION,
	geminiExtractionResultSchema,
} from "../src/worker/validators/extractions";
import { loadSyntheticAiFixtures } from "../tests/fixtures/ai/dev/loader";
import {
	EVALUATION_DATASET,
	type GroundTruthDocument,
} from "../tests/fixtures/eval-dataset/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Load environment variables from .dev.vars and .env.local without logging secrets
dotenv.config({ path: path.join(ROOT_DIR, ".dev.vars") });
dotenv.config({ path: path.join(ROOT_DIR, ".env.local") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

interface DeliverableDocumentItem {
	canonical: CanonicalEvaluationDocument;
	mimeType: string;
	fileBytes: Uint8Array;
}

function loadDeliverableSyntheticDocs(): DeliverableDocumentItem[] {
	const fixtures = loadSyntheticAiFixtures();
	return fixtures.map((f) => ({
		canonical: {
			docId: f.id,
			dataset: "synthetic",
			category: f.scenario,
			filename: f.sourceFile,
			provenance: "SYNTHETIC_TEST_DATA",
			event_name: f.groundTruth.event_name,
			event_category: f.groundTruth.event_category,
			start_datetime: f.groundTruth.start_datetime,
			end_datetime: f.groundTruth.end_datetime,
			venue_name: f.groundTruth.venue_name,
			affected_road_names: f.groundTruth.affected_road_names,
			procession_description: f.groundTruth.procession_description,
			traffic_impact_description: f.groundTruth.traffic_impact_description,
			organizer_name: f.groundTruth.organizer_name,
		},
		mimeType: f.sourceMime,
		fileBytes: f.sourceBytes,
	}));
}

function convertC02Doc(doc: GroundTruthDocument): DeliverableDocumentItem {
	const imgPath = path.join(
		ROOT_DIR,
		"tests/fixtures/eval-dataset/images",
		doc.filename,
	);
	if (!fs.existsSync(imgPath)) {
		throw new Error(`Missing C02 evaluation image: ${imgPath}`);
	}
	const buf = fs.readFileSync(imgPath);
	const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	const detectedMime = detectMimeFromMagicBytes(bytes);
	if (!detectedMime) {
		throw new Error(`Failed magic-byte MIME detection for C02 image: ${doc.filename}`);
	}

	return {
		canonical: {
			docId: doc.doc_id,
			dataset: doc.split === "unseen_test" ? "c02_unseen_test" : "c02_train_dev",
			category: doc.category,
			filename: doc.filename,
			provenance: "C02_EVAL_DATASET",
			event_name: doc.event_name,
			event_category: {
				value: doc.event_category,
				evidence: doc.event_category,
				needs_review: false,
			},
			start_datetime: doc.start_datetime,
			end_datetime: doc.end_datetime,
			venue_name: doc.venue_name,
			affected_road_names: doc.affected_road_names,
			traffic_impact_description: doc.traffic_impact_description,
			organizer_name: doc.organizer_name,
		},
		mimeType: detectedMime,
		fileBytes: bytes,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiWithRetry(params: {
	docId: string;
	apiKey: string;
	modelName: string;
	mimeType: string;
	fileBytes: Uint8Array;
}): Promise<ExtractionServiceOutcome> {
	const maxAttempts = 15;
	let attempt = 0;
	while (attempt < maxAttempts) {
		attempt += 1;
		const res = await extractDocumentWithGemini({
			apiKey: params.apiKey,
			modelName: params.modelName,
			mimeType: params.mimeType,
			fileBytes: params.fileBytes,
			timeoutMs: 45_000,
		});
		if (res.ok) {
			return res;
		}
		if (
			attempt < maxAttempts &&
			(res.errorCode === "PROVIDER_ERROR" || res.errorCode === "PROVIDER_TIMEOUT")
		) {
			const delayMs = 2500 + Math.floor(Math.random() * 2500);
			console.log(
				`      [${params.docId} Retry ${attempt}/${maxAttempts - 1}] Transient ${res.errorCode} (${res.errorMessage}). Waiting ${delayMs}ms...`,
			);
			await sleep(delayMs);
			continue;
		}
		return res;
	}
	throw new Error("Unreachable");
}

function formatMarkdownSummary(agg: DatasetAggregateReport): string {
	const lines: string[] = [];
	lines.push(`### Dataset: ${agg.datasetLabel} (N = ${agg.sampleSize})`);
	lines.push(
		`- **Schema Validation Pass Rate:** ${agg.schemaValidationPassRate.numerator}/${agg.schemaValidationPassRate.denominator} (${agg.schemaValidationPassRate.percentage}%)`,
	);
	lines.push(
		`- **Overall Strict Field Accuracy:** ${agg.overallStrictFieldAccuracy.numerator}/${agg.overallStrictFieldAccuracy.denominator} (${agg.overallStrictFieldAccuracy.percentage}%)`,
	);
	lines.push(
		`- **Overall Operational Field Accuracy:** ${agg.overallOperationalFieldAccuracy.numerator}/${agg.overallOperationalFieldAccuracy.denominator} (${agg.overallOperationalFieldAccuracy.percentage}%)`,
	);
	lines.push(
		`- **Missing/Null Field Detection Correctness:** ${agg.overallNullDetectionCorrectness.numerator}/${agg.overallNullDetectionCorrectness.denominator} (${agg.overallNullDetectionCorrectness.percentage}%)`,
	);
	lines.push(
		`- **Human Review / Correction Rate:** ${agg.overallHumanCorrectionRate.numerator}/${agg.overallHumanCorrectionRate.denominator} (${agg.overallHumanCorrectionRate.percentage}%)`,
	);
	lines.push(
		`- **Road Extraction (Micro P / R / F1):** P=${(agg.roadMetrics.microPrecision * 100).toFixed(1)}% | R=${(agg.roadMetrics.microRecall * 100).toFixed(1)}% | F1=${(agg.roadMetrics.microF1 * 100).toFixed(1)}% (TP=${agg.roadMetrics.truePositives}, FP=${agg.roadMetrics.falsePositives}, FN=${agg.roadMetrics.falseNegatives})`,
	);
	lines.push(
		`- **Road Extraction (Macro P / R / F1):** P=${(agg.roadMetrics.macroPrecision * 100).toFixed(1)}% | R=${(agg.roadMetrics.macroRecall * 100).toFixed(1)}% | F1=${(agg.roadMetrics.macroF1 * 100).toFixed(1)}%`,
	);
	lines.push(
		`- **Latency (ms):** min=${agg.latencyStats.minMs}ms | p50=${agg.latencyStats.p50Ms}ms | p95=${agg.latencyStats.p95Ms}ms | mean=${agg.latencyStats.meanMs}ms`,
	);
	lines.push("");
	lines.push(
		"| Field | Sample (N) | Strict Match (n/N) | Operational Match (n/N) | Null Detection (n/N_null) | Human Correction Rate |",
	);
	lines.push("| :--- | :---: | :---: | :---: | :---: | :---: |");

	for (const [fieldName, f] of Object.entries(agg.fieldSummaries)) {
		const nullStr =
			f.nullSampleSize > 0
				? `${f.nullCorrectness.numerator}/${f.nullCorrectness.denominator} (${f.nullCorrectness.percentage}%)`
				: "N/A (0 null)";
		lines.push(
			`| \`${fieldName}\` | ${f.sampleSize} | ${f.strictAccuracy.numerator}/${f.strictAccuracy.denominator} (${f.strictAccuracy.percentage}%) | ${f.operationalAccuracy.numerator}/${f.operationalAccuracy.denominator} (${f.operationalAccuracy.percentage}%) | ${nullStr} | ${f.humanCorrectionRate.numerator}/${f.humanCorrectionRate.denominator} (${f.humanCorrectionRate.percentage}%) |`,
		);
	}
	lines.push("");
	return lines.join("\n");
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const datasetArg =
		args.find((a) => a.startsWith("--dataset="))?.split("=")[1] ?? "all";
	const forceRun = args.includes("--force");
	const outputArg =
		args.find((a) => a.startsWith("--output="))?.split("=")[1] ??
		path.join(ROOT_DIR, "tests/fixtures/eval-dataset/evaluation-results.json");

	let cachedRawOutputs: Record<string, unknown> = {};
	const cachedLatencies: Record<string, number> = {};
	if (!forceRun && fs.existsSync(outputArg)) {
		try {
			const prev = JSON.parse(fs.readFileSync(outputArg, "utf8")) as {
				rawModelOutputs?: Record<string, unknown>;
				documentReports?: Array<{ docId: string; status: string; latencyMs: number }>;
			};
			if (prev.rawModelOutputs) {
				cachedRawOutputs = prev.rawModelOutputs;
			}
			if (Array.isArray(prev.documentReports)) {
				for (const r of prev.documentReports) {
					if (r.status === "completed" && r.latencyMs > 0) {
						cachedLatencies[r.docId] = r.latencyMs;
					}
				}
			}
		} catch {
			// Ignore malformed cache
		}
	}

	const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
	if (!apiKey) {
		console.error(
			"ERROR: GEMINI_API_KEY is not set in .dev.vars or .env.local. Cannot run live Gemini evaluation.",
		);
		process.exit(1);
	}

	const modelName = process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_NAME;

	const itemsToRun: DeliverableDocumentItem[] = [];
	if (datasetArg === "all" || datasetArg === "synthetic") {
		itemsToRun.push(...loadDeliverableSyntheticDocs());
	}
	if (datasetArg === "all" || datasetArg === "c02") {
		itemsToRun.push(...EVALUATION_DATASET.map(convertC02Doc));
	} else if (datasetArg === "unseen") {
		itemsToRun.push(
			...EVALUATION_DATASET.filter((d) => d.split === "unseen_test").map(
				convertC02Doc,
			),
		);
	}

	console.log(
		`Starting Rangkai AI Evaluation Benchmark (Roadmap C07) — Model: ${modelName}, Prompt: ${GEMINI_PROMPT_VERSION}, Schema: ${GEMINI_SCHEMA_VERSION}, Documents: ${itemsToRun.length}`,
	);

	const docReportsByIndex: Array<DocumentEvaluationReport | undefined> = new Array(
		itemsToRun.length,
	);
	const rawOutputs: Record<string, unknown> = { ...cachedRawOutputs };

	const concurrency = 3;
	let cursor = 0;

	async function worker(workerId: number): Promise<void> {
		await sleep(workerId * 600);
		while (cursor < itemsToRun.length) {
			const idx = cursor;
			cursor += 1;
			const item = itemsToRun[idx];
			const docId = item.canonical.docId;
			const cachedRaw = cachedRawOutputs[docId];
			const parsedCached = cachedRaw
				? geminiExtractionResultSchema.safeParse(cachedRaw)
				: null;

			let outcome: ExtractionServiceOutcome;
			if (parsedCached && parsedCached.success) {
				console.log(
					`[${idx + 1}/${itemsToRun.length}] Reusing completed extraction for ${docId} (${item.canonical.dataset}, ${item.canonical.filename})`,
				);
				outcome = {
					ok: true,
					modelName,
					promptVersion: GEMINI_PROMPT_VERSION,
					schemaVersion: GEMINI_SCHEMA_VERSION,
					latencyMs: cachedLatencies[docId] ?? 15000,
					data: parsedCached.data,
				};
			} else {
				console.log(
					`[${idx + 1}/${itemsToRun.length}] Extracting ${docId} (${item.canonical.dataset}, ${item.canonical.filename})...`,
				);

				outcome = await callGeminiWithRetry({
					docId,
					apiKey,
					modelName,
					mimeType: item.mimeType,
					fileBytes: item.fileBytes,
				});
			}

			const report = evaluateSingleDocument(item.canonical, outcome);
			docReportsByIndex[idx] = report;
			rawOutputs[docId] = outcome.ok
				? outcome.data
				: { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };

			console.log(
				`   -> [${docId}] status=${report.status} latency=${report.latencyMs}ms roads_F1=${(report.roads.f1 * 100).toFixed(1)}% (TP=${report.roads.truePositives}/${report.roads.expectedRoads.length})`,
			);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, itemsToRun.length) }, (_, i) =>
			worker(i),
		),
	);

	const docReports = docReportsByIndex.filter(
		(r): r is DocumentEvaluationReport => r !== undefined,
	);

	const syntheticReports = docReports.filter((r) => r.dataset === "synthetic");
	const c02TrainReports = docReports.filter((r) => r.dataset === "c02_train_dev");
	const c02UnseenReports = docReports.filter((r) => r.dataset === "c02_unseen_test");
	const c02CombinedReports = docReports.filter(
		(r) => r.dataset === "c02_train_dev" || r.dataset === "c02_unseen_test",
	);

	const summaries: Record<string, DatasetAggregateReport> = {};
	if (syntheticReports.length > 0) {
		summaries.synthetic = aggregateDocumentEvaluations(
			"Synthetic Verification Suite (SYNTH_AI_001–005)",
			syntheticReports,
		);
	}
	if (c02TrainReports.length > 0) {
		summaries.c02_train_dev = aggregateDocumentEvaluations(
			"C02 Train/Dev Split (DOC-01, 02, 03, 05, 08, 10)",
			c02TrainReports,
		);
	}
	if (c02UnseenReports.length > 0) {
		summaries.c02_unseen_test = aggregateDocumentEvaluations(
			"C02 Unseen Test Split (DOC-04, 06, 07, 09)",
			c02UnseenReports,
		);
	}
	if (c02CombinedReports.length > 0) {
		summaries.c02_combined = aggregateDocumentEvaluations(
			"C02 Full Dataset Combined (DOC-01–DOC-10)",
			c02CombinedReports,
		);
	}

	const fullArtifact = {
		executedAt: new Date().toISOString(),
		modelName,
		promptVersion: GEMINI_PROMPT_VERSION,
		schemaVersion: GEMINI_SCHEMA_VERSION,
		totalDocumentsEvaluated: docReports.length,
		summaries,
		documentReports: docReports,
		rawModelOutputs: rawOutputs,
	};

	fs.writeFileSync(outputArg, JSON.stringify(fullArtifact, null, 2), "utf8");
	console.log(`\nSaved structured evaluation artifact to: ${outputArg}\n`);

	for (const agg of Object.values(summaries)) {
		console.log(formatMarkdownSummary(agg));
	}
}

main().catch((err) => {
	console.error("Evaluation benchmark failed:", err instanceof Error ? err.message : err);
	process.exit(1);
});
