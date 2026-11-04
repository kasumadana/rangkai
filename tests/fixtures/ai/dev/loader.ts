import { aiExtractionOutputSchema, type AiExtractionOutput } from "../../../src/worker/validators/extractions";
import syntheticDocuments from "./synthetic-documents.json";

export interface SyntheticAiFixture {
	id: string;
	name: string;
	scenario: string;
	provenance: string;
	isRealEvaluation: boolean;
	groundTruth: AiExtractionOutput;
}

/**
 * Loads synthetic AI extraction test fixtures and validates each against
 * the AI-SPEC §4 Zod contract.
 *
 * This function also serves as the validation loader for future C02 labeled datasets.
 */
export function loadSyntheticAiFixtures(): SyntheticAiFixture[] {
	return syntheticDocuments.map((item) => {
		const parsed = aiExtractionOutputSchema.safeParse(item.groundTruth);
		if (!parsed.success) {
			throw new Error(
				`Synthetic fixture ${item.id} failed AI-SPEC schema validation: ${parsed.error.issues[0]?.message}`,
			);
		}
		return {
			...item,
			groundTruth: parsed.data,
		};
	});
}
