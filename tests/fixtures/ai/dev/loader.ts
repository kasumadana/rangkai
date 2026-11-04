import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectMimeFromMagicBytes,
	doesExtensionMatchMime,
	validateBinaryFormatStructure,
} from "../../../../src/worker/validators/documents";
import {
	geminiExtractionResultSchema,
	type GeminiExtractionResult,
} from "../../../../src/worker/validators/extractions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SyntheticAiFixtureItem {
	id: string;
	name: string;
	scenario: string;
	provenance: "SYNTHETIC_TEST_DATA";
	isRealEvaluation: false;
	sourceFile: string;
	sourceBytes: Uint8Array;
	sourceBuffer: Buffer;
	sourceMime: "application/pdf" | "image/jpeg" | "image/png";
	imageDimensions?: { width: number; height: number };
	groundTruth: GeminiExtractionResult;
}

function readImageDimensions(
	bytes: Uint8Array,
	mime: "image/png" | "image/jpeg",
): { width: number; height: number } {
	if (mime === "image/png") {
		const view = new DataView(
			bytes.buffer,
			bytes.byteOffset,
			bytes.byteLength,
		);
		return {
			width: view.getUint32(16, false),
			height: view.getUint32(20, false),
		};
	}
	for (let i = 2; i < bytes.byteLength - 8; i++) {
		if (
			bytes[i] === 0xff &&
			(bytes[i + 1] === 0xc0 ||
				bytes[i + 1] === 0xc1 ||
				bytes[i + 1] === 0xc2)
		) {
			return {
				height: (bytes[i + 5] << 8) | bytes[i + 6],
				width: (bytes[i + 7] << 8) | bytes[i + 8],
			};
		}
	}
	return { width: 0, height: 0 };
}

/**
 * Loads and validates the 5 synthetic AI extraction fixture pairs.
 * Verifies:
 * 1. Provenance is strictly SYNTHETIC_TEST_DATA and isRealEvaluation is false.
 * 2. Source binary exists, passes magic-byte & structural validation, and matches extension.
 * 3. PNG/JPEG fixtures have readable multi-hundred-pixel dimensions (>= 600x400) and non-blank size.
 * 4. Source binary contains the SYNTHETIC_TEST_DATA label and every declared ground-truth evidence string.
 * 5. Ground truth JSON passes geminiExtractionResultSchema.
 */
export function loadSyntheticAiFixtures(): SyntheticAiFixtureItem[] {
	const jsonPath = path.join(__dirname, "synthetic-documents.json");
	const raw = fs.readFileSync(jsonPath, "utf8");
	const docs = JSON.parse(raw) as Array<{
		id: string;
		name: string;
		scenario: string;
		provenance: string;
		isRealEvaluation: boolean;
		sourceFile: string;
		groundTruth: unknown;
	}>;

	if (!Array.isArray(docs) || docs.length !== 5) {
		throw new Error(
			"Expected exactly 5 synthetic AI document fixtures in synthetic-documents.json",
		);
	}

	return docs.map((doc) => {
		if (
			doc.provenance !== "SYNTHETIC_TEST_DATA" ||
			doc.isRealEvaluation !== false
		) {
			throw new Error(
				`Synthetic AI fixture '${doc.id}' must explicitly declare provenance='SYNTHETIC_TEST_DATA' and isRealEvaluation=false`,
			);
		}

		const sourcePath = path.join(__dirname, doc.sourceFile);
		if (!fs.existsSync(sourcePath)) {
			throw new Error(
				`Missing synthetic source binary '${doc.sourceFile}' for fixture '${doc.id}'`,
			);
		}

		// Also verify the standalone per-sample JSON file matches
		const baseName = doc.sourceFile.replace(/\.(png|jpg|jpeg|pdf)$/i, ".json");
		const singleJsonPath = path.join(__dirname, baseName);
		if (fs.existsSync(singleJsonPath)) {
			const singleDoc = JSON.parse(
				fs.readFileSync(singleJsonPath, "utf8"),
			) as { id: string; groundTruth: unknown };
			if (singleDoc.id !== doc.id) {
				throw new Error(
					`Mismatched id in '${baseName}': expected '${doc.id}', found '${singleDoc.id}'`,
				);
			}
			const singleParsed = geminiExtractionResultSchema.safeParse(
				singleDoc.groundTruth,
			);
			if (!singleParsed.success) {
				throw new Error(
					`Standalone ground truth in '${baseName}' failed Zod validation: ${singleParsed.error.message}`,
				);
			}
		}

		const buf = fs.readFileSync(sourcePath);
		const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		const detectedMime = detectMimeFromMagicBytes(bytes);

		if (!detectedMime) {
			throw new Error(
				`Synthetic source '${doc.sourceFile}' failed magic-byte validation`,
			);
		}

		if (
			!validateBinaryFormatStructure(bytes, detectedMime) ||
			!doesExtensionMatchMime(doc.sourceFile, detectedMime)
		) {
			throw new Error(
				`Synthetic source '${doc.sourceFile}' failed format structure or extension agreement check`,
			);
		}

		let imageDimensions: { width: number; height: number } | undefined;
		if (detectedMime === "image/png" || detectedMime === "image/jpeg") {
			imageDimensions = readImageDimensions(bytes, detectedMime);
			if (
				imageDimensions.width < 600 ||
				imageDimensions.height < 400 ||
				bytes.byteLength < 5000
			) {
				throw new Error(
					`Synthetic image '${doc.sourceFile}' must be a readable multi-hundred-pixel rendered document (found ${imageDimensions.width}x${imageDimensions.height}, ${bytes.byteLength} bytes)`,
				);
			}
		}

		const parsedGt = geminiExtractionResultSchema.safeParse(doc.groundTruth);
		if (!parsedGt.success) {
			throw new Error(
				`Synthetic ground truth for '${doc.id}' failed Zod validation: ${parsedGt.error.message}`,
			);
		}

		const decodedText = new TextDecoder("utf8", {
			fatal: false,
			ignoreBOM: false,
		}).decode(bytes);
		if (!decodedText.includes("SYNTHETIC_TEST_DATA")) {
			throw new Error(
				`Synthetic source '${doc.sourceFile}' is missing embedded SYNTHETIC_TEST_DATA marker`,
			);
		}

		const gt = parsedGt.data;
		const candidateEvidences = [
			gt.event_name.evidence,
			gt.event_category.evidence,
			gt.start_datetime.evidence,
			gt.end_datetime.evidence,
			gt.venue_name.evidence,
			gt.procession_description.evidence,
			gt.traffic_impact_description.evidence,
			gt.organizer_name.evidence,
			...gt.affected_road_names.map((r) => r.evidence),
		].filter((e): e is string => typeof e === "string" && e.length > 0);

		for (const ev of candidateEvidences) {
			if (!decodedText.includes(ev)) {
				throw new Error(
					`Synthetic source '${doc.sourceFile}' is missing declared ground-truth evidence text: '${ev}'`,
				);
			}
		}

		return {
			id: doc.id,
			name: doc.name,
			scenario: doc.scenario,
			provenance: "SYNTHETIC_TEST_DATA",
			isRealEvaluation: false,
			sourceFile: doc.sourceFile,
			sourceBytes: bytes,
			sourceBuffer: Buffer.from(bytes),
			sourceMime: detectedMime,
			imageDimensions,
			groundTruth: parsedGt.data,
		};
	});
}
