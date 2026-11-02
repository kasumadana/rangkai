# Development and Competition Delivery Plan — Rangkai

Version: 0.1.0
Status: Planning baseline
Team size: 3

## 1. Delivery Objective

Deliver a deployed, functional AI-powered web MVP
that can be tested using unseen event documents.

The goal is a complete workflow, not maximum feature count.

## 2. Team Responsibilities

### Member A — Backend and AI

- Hono API
- Gemini integration
- Database and migrations
- RBAC
- Audit logs
- AI evaluation

### Member B — Frontend and Maps

- React application
- Organizer dashboard
- Public pages
- MapLibre integration
- Field officer UI
- API integration

### Member C — UX, QA and Product

- User interviews
- UX flows and design system
- Test fixtures
- Accessibility testing
- E2E tests
- Proposal and demo preparation

All members review critical functionality.

## 3. Sprint 1 — Foundation

Deliverables:

- Cloudflare project.
- Neon database.
- Drizzle schema and migrations.
- Better Auth.
- Organization membership.
- Event CRUD.
- Basic responsive dashboard.

Exit criteria:

- Organizer can sign in.
- Organizer can create a draft.
- Unauthorized users cannot modify events.
- Staging deployment works.

## 4. Sprint 2 — AI Workflow

Deliverables:

- R2 upload.
- Gemini extraction.
- Zod output validation.
- Editable AI review screen.
- Manual-entry fallback.
- AI evaluation fixtures.

Exit criteria:

- A new document can be uploaded.
- AI returns editable fields.
- Missing values remain unknown.
- Organizer can correct and save the result.
- AI failure does not block event creation.

## 5. Sprint 3 — Operations

Deliverables:

- Verified road-segment dataset.
- MapLibre event map.
- Road-impact editor.
- Publication workflow.
- Field officer assignments.
- Road-status updates.
- Public event page.

Exit criteria:

- Organizer publishes a verified event.
- Public can read it without login.
- Assigned officer updates status.
- Unauthorized officer is rejected.
- Stale status is marked unconfirmed.

## 6. Sprint 4 — Cleanup and Release

Deliverables:

- Cleanup task management.
- Before/after evidence.
- Waste records.
- Audit log.
- Automated critical tests.
- Mobile accessibility review.
- Final deployment.
- Competition materials.

Exit criteria:

- Cleanup workflow is functional.
- End-to-end scenario passes.
- No critical security defects.
- Source code and deployment are accessible.
- AI evaluation results are documented.

## 7. P1 After MVP

Only if all P0 requirements pass:

- Conflict warnings for overlapping road impacts.
- Validated route suggestions.
- Better road matching.
- Optional notifications.
- Multi-organization pilot support.

Do not start P2 models without real training data.

## 8. Competition Rubric Mapping

### Stage 1

| Criterion                       | Weight | Evidence                            |
| ------------------------------- | -----: | ----------------------------------- |
| AI relevance and implementation |    25% | Extraction, validation, evaluation  |
| Problem relevance and impact    |    20% | Local evidence, interviews, pilot   |
| MVP functionality               |    20% | Complete end-to-end demo            |
| Innovation                      |    15% | Cultural event operational workflow |
| Technical feasibility and repo  |    15% | Architecture, tests, GitHub         |
| Compliance and documentation    |     5% | Proposal, disclosure, live URL      |

### Final

| Criterion                     | Weight | Evidence                               |
| ----------------------------- | -----: | -------------------------------------- |
| AI technical depth            |    25% | Structured extraction and evaluation   |
| Functionality and reliability |    25% | E2E, failure handling, RBAC            |
| Problem-solution fit          |    15% | Pilot and measured outcomes            |
| Innovation                    |    15% | Verified organizer-to-public workflow  |
| UX/UI and accessibility       |    10% | Mobile usability and WCAG testing      |
| Scalability                   |     5% | Cloudflare, Neon, modular architecture |
| Demo and communication        |     5% | Reproducible live demonstration        |

Weights are based on the previously discussed
Bali DigiFest 2026 participant guidebook.
Verify against the final official guidebook.

## 9. Five-Minute Demo Script

0:00–0:30

- Explain one concrete Bali event coordination problem.

0:30–1:30

- Upload a previously unseen announcement.
- Show Gemini extracting structured fields.

1:30–2:10

- Correct ambiguous data.
- Select road segments.
- Publish event.

2:10–3:00

- Open public page on another browser.
- Update road status as an assigned officer.
- Show public status change.

3:00–3:40

- Complete cleanup task.
- Upload evidence.
- Verify completion.

3:40–4:20

- Demonstrate AI failure/manual fallback
  or stale-status behavior.

4:20–5:00

- Show measured test results, limitations,
  and product impact.

## 10. Proposal Structure

Maximum five content pages, subject to official rules.

Page 1:

- Problem and supporting evidence.

Page 2:

- Target users and solution workflow.

Page 3:

- AI implementation and technical architecture.

Page 4:

- MVP functionality and innovation.

Page 5:

- Validation, expected impact, roadmap, and references.

Do not claim pilot results before the pilot occurs.

## 11. AI & Technology Disclosure

Disclose:

- Gemini model and provider.
- Use of AI for extraction.
- Human review requirements.
- Training datasets, if any.
- Map data and map tile providers.
- Third-party libraries.
- Existing code reused from prior projects.
- Known model limitations.

Keep API keys out of the repository.

## 12. Submission Checklist

[ ] GitHub repository accessible.
[ ] Live Cloudflare URL accessible.
[ ] Functional AI feature demonstrated.
[ ] Core workflows work end-to-end.
[ ] README includes setup instructions.
[ ] Environment variables documented.
[ ] Database migrations included.
[ ] No secrets committed.
[ ] Proposal complies with page limit.
[ ] AI & Technology Disclosure complete.
[ ] Real metrics separated from targets.
[ ] Demo works with unseen inputs.
[ ] Mobile layout tested.
[ ] AI failure path tested.
[ ] Permissions tested.

## 13. Definition of Done

A feature is done only when:

- Its requirement ID is documented.
- Backend permission checks exist.
- Inputs are validated.
- Loading, empty, success, and error states work.
- At least one test verifies the main behavior.
- The feature works in deployed staging.
- Documentation is updated.

## 14. Product Decision Log

DEC-001: Use Cloudflare Workers, not Vercel.
DEC-002: Use Neon PostgreSQL, not Supabase.
DEC-003: Use Gemini for structured document extraction.
DEC-004: Require human review before publication.
DEC-005: Restrict MVP to verified road segments.
DEC-006: Keep traffic and cleanup states independent.
DEC-007: Use polling before adding realtime infrastructure.
DEC-008: Defer waste prediction and cleanup CV to P2.
DEC-009: Treat stale road statuses as unconfirmed.
DEC-010: Keep public access read-only and login-free.

Update this log when architectural decisions change.
