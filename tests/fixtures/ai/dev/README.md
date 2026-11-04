# Synthetic AI Evaluation Fixtures (`SYNTHETIC_TEST_DATA`)

> **NOTICE:** This directory contains synthetic test announcements and artificial ground truth for software logic, Zod validation, and error recovery verification only.  
> **NEVER** present these synthetic samples or metrics as real AI benchmark accuracy or pilot evaluation results. Real dataset acceptance is deferred pending C02 delivery from Okta/Oktazz.

## Dataset Structure

The synthetic fixtures in this directory cover the test scenarios defined in `docs/05-AI-SPEC.md` and `docs/09-TEST-PLAN.md`:

1. `sample-01-complete.json`: Complete announcement with all fields and explicit timestamps.
2. `sample-02-missing-date.json`: Announcement with missing end time (`end_datetime: null`, `needs_review: true`).
3. `sample-03-multiple-roads.json`: Procession route impacting multiple road segments (`Jl. Danau Tamblingan`, `Jl. Cemara`, `Jl. Duyung`).
4. `sample-04-ambiguous.json`: Ambiguous venue and timing requiring human review.
5. `sample-05-untrusted-instructions.json`: Announcement containing prompt injection attempt inside document text.

## Format for Future C02 Import

When C02 (10 labeled documents: 6 train/dev + 4 unseen) is delivered, each document should be stored with:
- `documentId`: UUID or stable slug
- `sourceFile`: Path to permitted image/PDF file
- `groundTruth`: Conforming to `docs/05-AI-SPEC.md §4` JSON output contract
- `provenance`: Organization, collector identity, collection timestamp, permission status
