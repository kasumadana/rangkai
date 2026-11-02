# Product Requirements Document — Rangkai

Version: 0.1.0
Status: Draft
Product owner: TBD
Target platform: Responsive web / PWA-ready

## 1. Product Summary

Rangkai helps organizers coordinate cultural events in Bali
that affect public roads and require post-event cleanup.

The product transforms event announcements into structured,
human-verified operational information.

Primary value:

- Faster preparation of public event information.
- Clearer coordination of temporary road restrictions.
- Traceable cleanup tasks after events.

## 2. Problem Statement

Information about temporary road restrictions may be
distributed through letters, posters, and messaging groups.

This creates possible problems:

- Information is difficult to find or interpret.
- Updates from the field may not reach road users promptly.
- Cleanup responsibilities may not be documented consistently.

These are problem hypotheses for the target pilot.
Validate them through interviews and observation.

## 3. Product Principles

1. Respect local cultural practices and authority.
2. Publish verified information, not AI guesses.
3. Keep human operators in control.
4. Support low-end mobile devices.
5. Make uncertainty and stale information visible.
6. Separate road safety from cleanliness verification.
7. Never fabricate impact metrics or AI accuracy.

## 4. Purpose Gate

An event qualifies when it has at least one:

- Temporary use or closure of public roads.
- Significant roadside parking impact.
- Public procession affecting traffic.
- Cleanup requirements in shared public spaces.

Private ceremonies without public-space impact are
outside the primary use case.

## 5. Target Users

### Organizer

Prajuru, banjar committee, or authorized event coordinator.

JTBD:
"When organizing an event, I need to publish accurate
operational information without repeatedly entering
the same details."

### Field Officer

Assigned pecalang or cleanup coordinator.

JTBD:
"When conditions change, I need to report the current
status quickly and leave a traceable record."

### Public

Commuters, delivery drivers, local residents, visitors.

JTBD:
"Before traveling, I need to know which roads are
affected, when, and when the information was updated."

## 6. Product Goals

G1. Convert event documents into editable structured data.
G2. Publish verified road-impact information.
G3. Allow assigned officers to update road status.
G4. Track cleanup tasks and supporting evidence.
G5. Provide public access without authentication.

## 7. Non-Goals for MVP

- Official permit issuance.
- Full-island live traffic monitoring.
- Guaranteed navigation or travel-time prediction.
- Automatic road reopening based on photos.
- XGBoost waste prediction without training data.
- Automatic religious compliance classification.
- Payments, marketplaces, and tourism booking.
- Government dashboard integration.

## 8. MVP Features

### P0 — Required

P0-01. Organizer authentication and event management.
P0-02. Document upload to private storage.
P0-03. Multimodal AI structured extraction.
P0-04. Human review and correction.
P0-05. Manual selection of verified road segments.
P0-06. Publication workflow.
P0-07. Public event page and road-impact map.
P0-08. Assigned officer road-status updates.
P0-09. Cleanup tasks and photo evidence.
P0-10. Waste records with measurement method.
P0-11. Audit logs and stale-status handling.

### P1 — After Stable MVP

P1-01. Deterministic overlapping-closure warnings.
P1-02. Verified alternative-route suggestions.
P1-03. Optional push notifications.
P1-04. Offline-friendly draft updates.
P1-05. Multi-organization onboarding.

### P2 — Research Backlog

P2-01. Waste-volume regression model.
P2-02. Computer Vision cleanup assistance.
P2-03. Moving procession / rolling closure tracking.
P2-04. Government data integrations.

## 9. Core User Journey

### Pre-event

1. Organizer creates a draft event.
2. Organizer uploads a document.
3. AI extracts candidate fields.
4. Organizer reviews and edits fields.
5. Organizer selects affected road segments.
6. Organizer checks authorization information.
7. Organizer publishes the event.

### Live event

1. Officer opens assigned event.
2. Officer selects a road impact.
3. Officer sets open, intermittent, or closed.
4. System records identity, timestamp, and expiry.
5. Public map reflects the verified update.

### Post-event

1. Cleanup officer opens assigned tasks.
2. Officer records work and uploads evidence.
3. Organizer verifies completion.
4. Waste measurements are recorded.
5. Event is closed.

## 10. Success Metrics

All values below are TARGETS, not achieved results.

- Field-level extraction accuracy measured on unseen documents.
- Time to prepare an event announcement versus manual entry.
- Number and percentage of AI fields corrected by humans.
- Time from field status submission to public visibility.
- Percentage of cleanup tasks verified.
- Percentage of waste records with a stated measurement method.

Set numerical thresholds after a baseline study.

## 11. Pilot Definition

Initial scope:

- One authorized organizer or pilot team.
- One neighborhood or limited road corridor.
- One real event if permission is available.
- Simulated events for repeatable automated tests.

Never publish simulated closures as active real-world events.

## 12. Differentiation Hypothesis

Rangkai focuses on the organizer-to-field-to-public workflow
for cultural events, combining temporary road operations
and cleanup coordination in one event record.

This must be compared against the actual capabilities of
ASIK MELALI, existing Dishub channels, and local waste systems.
Do not claim first-of-its-kind without verification.

## 13. Key Risks

R1. No organizer partner -> use a clearly labeled demo.
R2. Ambiguous road names -> require map confirmation.
R3. Stale status -> expire confidence, display uncertainty.
R4. Incorrect AI extraction -> human review before publishing.
R5. Unauthorized status updates -> event-scoped permissions.
R6. Missing waste measurement -> mark as unmeasured.
R7. Limited road data -> restrict supported geography.

## 14. Release Criteria

MVP may be submitted when:

- One complete end-to-end scenario passes.
- New unseen documents can be tested.
- No unverified AI output is published automatically.
- Public pages work without login.
- Officer permissions are enforced server-side.
- AI failure has a manual fallback.
- Core flows work on mobile.
- Deployment, source code, and disclosure are ready.

## 15. Open Decisions

- Exact pilot organization and neighborhood.
- Document retention duration.
- Whether an approved diversion route is available.
- Which map tile provider and quota to use.
- Whether public publication requires two-person approval.
- Whether real-time updates need polling or SSE.

## 16. Changelog

0.1.0 — Initial development baseline.
