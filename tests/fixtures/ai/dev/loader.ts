import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	aiExtractionOutputSchema,
	type AiExtractionOutput,
} from "../../../../src/worker/validators/extractions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SyntheticAiFixture {
	id: string;
	name: string;
	scenario: string;
	provenance: string;
	isRealEvaluation: boolean;
	sourceFile: string;
	sourceBuffer: Buffer;
	sourceMime: string;
	groundTruth: AiExtractionOutput;
}

const MIME_MAP: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".pdf": "application/pdf",
};

/**
 * Loads synthetic AI extraction test fixtures and validates each against
 * the AI-SPEC §4 Zod contract. Also verifies that valid source document
 * files exist on disk with valid magic bytes.
 *
 * This function also serves as the validation loader for future C02 labeled datasets.
 */
export function loadSyntheticAiFixtures(): SyntheticAiFixture[] {
	const jsonPath = path.join(__dirname, "synthetic-documents.json");
	const rawJson = fs.readFileSync(jsonPath, "utf-8");
	const items = JSON.parse(rawJson) as Array<{
		id: string;
		name: string;
		scenario: string;
		provenance: string;
		isRealEvaluation: boolean;
		sourceFile: string;
		groundTruth: unknown;
	}>;

	return items.map((item) => {
		const parsed = aiExtractionOutputSchema.safeParse(item.groundTruth);
		if (!parsed.success) {
			throw new Error(
				`Synthetic fixture ${item.id} failed AI-SPEC schema validation: ${parsed.error.issues[0]?.message}`,
			);
		}

		const filePath = path.join(__dirname, item.sourceFile);
		if (!fs.existsSync(filePath)) {
			throw new Error(
				`Synthetic document source file missing: ${item.sourceFile} for fixture ${item.id}`,
			);
		}

		const buffer = fs.readFileSync(filePath);
		if (buffer.length === 0) {
			throw new Error(
				`Synthetic document source file is empty: ${item.sourceFile}`,
			);
		}

		const ext = path.extname(item.sourceFile).toLowerCase();
		const mime = MIME_MAP[ext] || "application/octet-stream";

		return {
			id: item.id,
			name: item.name,
			scenario: item.scenario,
			provenance: item.provenance,
			isRealEvaluation: item.isRealEvaluation,
			sourceFile: item.sourceFile,
			sourceBuffer: buffer,
			sourceMime: mime,
			groundTruth: parsed.data,
		};
	});
}

/**
 * Load a single fixture by ID or sample file name.
 */
export function loadSyntheticAiFixture(idOrFileName: string): SyntheticAiFixture {
	const all = loadSyntheticAiFixtures();
	const found = all.find(
		(f) => f.id === idOrFileName || f.sourceFile === idOrFileName,
	);
	if (!found) {
		throw new Error(`Synthetic AI fixture not found: ${idOrFileName}`);
	}
	return found;
}
