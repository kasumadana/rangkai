# Synthetic AI Evaluation Fixtures (`SYNTHETIC_TEST_DATA`)

> **NOTICE:** This directory contains rendered synthetic test announcements (`900x650` PNG/JPEG and multi-line PDF-1.4) and matching ground truth for software logic, Zod validation, and error recovery verification only.  
> **NEVER** present these synthetic samples or metrics as real AI benchmark accuracy or pilot evaluation results. Real dataset acceptance is deferred pending C02 delivery from Okta/Oktazz.

## Dataset Structure

The synthetic fixtures in this directory cover the test scenarios defined in `docs/05-AI-SPEC.md` and `docs/09-TEST-PLAN.md`:

1. `sample-01-complete.png` + `sample-01-complete.json` (`SYNTH_AI_001`): Complete announcement with all 9 required AI-SPEC fields and explicit WITA timestamps.
2. `sample-02-missing-date.jpg` + `sample-02-missing-date.json` (`SYNTH_AI_002`): Announcement with missing end time (`end_datetime.value: null`, `needs_review: true`).
3. `sample-03-multiple-roads.pdf` + `sample-03-multiple-roads.json` (`SYNTH_AI_003`): Procession route impacting multiple road segments (`Jalan Danau Tamblingan`, `Jalan Danau Poso`, `Jalan Cemara`).
4. `sample-04-ambiguous.png` + `sample-04-ambiguous.json` (`SYNTH_AI_004`): Ambiguous venue and vague timing (`start_datetime.value: null`, `end_datetime.value: null`, `needs_review: true` with verbatim evidence).
5. `sample-05-untrusted-instructions.jpg` + `sample-05-untrusted-instructions.json` (`SYNTH_AI_005`): Announcement containing untrusted prompt-injection text inside the document body.

## Format for Future C02 Import

When C02 (10 labeled documents: 6 train/dev + 4 unseen) is delivered, each document should be stored with:
- `documentId`: UUID or stable slug
- `sourceFile`: Path to permitted image/PDF file
- `groundTruth`: Conforming to `docs/05-AI-SPEC.md §3–§4` JSON output contract
- `provenance`: Organization, collector identity, collection timestamp, permission status
