import doc01 from "./ground-truth/DOC-01.json";
import doc02 from "./ground-truth/DOC-02.json";
import doc03 from "./ground-truth/DOC-03.json";
import doc04 from "./ground-truth/DOC-04.json";
import doc05 from "./ground-truth/DOC-05.json";
import doc06 from "./ground-truth/DOC-06.json";
import doc07 from "./ground-truth/DOC-07.json";
import doc08 from "./ground-truth/DOC-08.json";
import doc09 from "./ground-truth/DOC-09.json";
import doc10 from "./ground-truth/DOC-10.json";

export interface EvaluatedField<T> {
	value: T;
	evidence: string | null;
	needs_review: boolean;
}

export interface EvaluatedRoad {
	name: string;
	evidence: string;
	needs_review: boolean;
}

export interface GroundTruthDocument {
	doc_id: string;
	split: "train_dev" | "unseen_test";
	category: string;
	filename: string;
	event_name: EvaluatedField<string | null>;
	event_category: string;
	start_datetime: EvaluatedField<string | null>;
	end_datetime: EvaluatedField<string | null>;
	venue_name: EvaluatedField<string | null>;
	affected_road_names: EvaluatedRoad[];
	traffic_impact_description: EvaluatedField<string | null>;
	organizer_name: EvaluatedField<string | null>;
	permit_reference_text?: EvaluatedField<string | null> | null;
	expected_issues: string[];
}

export const EVALUATION_DATASET: GroundTruthDocument[] = [
	doc01 as unknown as GroundTruthDocument,
	doc02 as unknown as GroundTruthDocument,
	doc03 as unknown as GroundTruthDocument,
	doc04 as unknown as GroundTruthDocument,
	doc05 as unknown as GroundTruthDocument,
	doc06 as unknown as GroundTruthDocument,
	doc07 as unknown as GroundTruthDocument,
	doc08 as unknown as GroundTruthDocument,
	doc09 as unknown as GroundTruthDocument,
	doc10 as unknown as GroundTruthDocument,
];

/**
 * 6 Train/Dev Documents used for prompt design and few-shot calibration
 */
export const TRAIN_DEV_DATASET: GroundTruthDocument[] =
	EVALUATION_DATASET.filter((doc) => doc.split === "train_dev");

/**
 * 4 Unseen Test Documents strictly reserved for out-of-sample evaluation
 */
export const UNSEEN_TEST_DATASET: GroundTruthDocument[] =
	EVALUATION_DATASET.filter((doc) => doc.split === "unseen_test");
