# Rangkai — Documentation Index

Version: 0.1.0
Status: Draft for development
Product: AI-Assisted Cultural Event Coordination
Timezone: Asia/Makassar (WITA)

## Product Definition

Rangkai is a web application for coordinating Balinese cultural
events that affect public spaces.

It supports three operational phases:

1. Pre-event: document extraction, review, and publication.
2. Live event: verified road status updates.
3. Post-event: cleanup tasks and waste documentation.

The application does not issue legal road-closure permits,
guarantee safe routes, or certify environmental compliance.

## Documentation Map

| Document            | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| 01-PRD.md           | Product goals, users, scope, priorities             |
| 02-SRS.md           | Testable functional and non-functional requirements |
| 03-ARCHITECTURE.md  | Stack, components, deployment, data flow            |
| 04-ERD.md           | Database schema, relationships, constraints         |
| 05-AI-SPEC.md       | AI pipeline, schemas, evaluation, fallback          |
| 06-API-CONTRACT.md  | HTTP API, authorization, errors                     |
| 07-UX-FLOWS.md      | Screens, user journeys, UX states                   |
| DESIGN.md           | Visual design system, Tri Datu tokens, typography   |
| 08-SECURITY-OPS.md  | Security, privacy, operational policies             |
| RELEASE-RUNBOOK.md  | Production release gate, migrations, rollback, DR   |
| 09-TEST-PLAN.md     | QA, AI evaluation, acceptance testing               |
| 10-DELIVERY-PLAN.md | Sprints, milestones, demo, competition              |
| ../AGENTS.md        | Rules for coding agents                             |

## Source of Truth

- Product decisions: 01-PRD.md
- Testable requirements: 02-SRS.md
- Database: 04-ERD.md
- HTTP contracts: 06-API-CONTRACT.md
- AI behavior: 05-AI-SPEC.md

If documents conflict, stop and reconcile the conflict
before implementation. Record changes in the PRD changelog.

## Evidence Classification

FACT: Supported by a cited official or credible source.
ASSUMPTION: Requires field validation.
TARGET: Planned result, not achieved performance.
DECISION: Agreed product or technical choice.

Never present a TARGET or ASSUMPTION as a verified FACT.

## Scope Rule

Build the smallest complete workflow:
Create event -> Upload document -> Extract with AI ->
Review -> Map road impacts -> Publish -> Update status ->
Complete cleanup -> Close event.

Do not build speculative features before this flow works.

## External Dependencies

- Cloudflare account and deployment
- Neon PostgreSQL project with PostGIS
- Gemini API credentials
- Map tiles provider
- A small, verified road-segment dataset
- Authorized pilot organizer or test fixtures

## Validation Before Public Pilot

- Confirm applicable road-closure permissions.
- Confirm event information may be published.
- Confirm organizer and field-officer identities.
- Verify affected road segments manually.
- Obtain permission to use event documents and photos.

## References to Maintain

- Bali DigiFest 2026 AI Web Innovation Challenge guidebook.
- Pramana SKILL.md.
- UU No. 22 Tahun 2009, especially Pasal 128.
- SE Gubernur Bali No. 09 Tahun 2025.
- Official Bali transport and waste-management publications.
- Competitor review: ASIK MELALI, SIMPADU BALI,
  SIPADAS, SIDARLING, SNOWI.

Reference URLs, retrieval dates, and exact legal provisions
must be recorded before submission.
