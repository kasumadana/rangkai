# Software Requirements Specification — Rangkai

Version: 0.1.0
Status: Draft
Related: 01-PRD.md, 06-API-CONTRACT.md

## 1. Actors

ORG: Organizer
OFF-TRAFFIC: Assigned traffic officer
OFF-CLEANUP: Assigned cleanup officer
PUBLIC: Anonymous public visitor
SYSTEM: Backend and scheduled processes

An officer may hold both field permissions.

## 2. Functional Requirements

### Authentication & Authorization

FR-001: Organizers and officers must authenticate.
FR-002: Public information must be readable without login.
FR-003: Every protected mutation must check permissions
on the server.
FR-004: Officer access must be scoped to assigned events.
FR-005: Organizer must be able to revoke assignments.

### Event Management

FR-010: Organizer can create a draft event.
FR-011: Organizer can edit event details before publication.
FR-012: Organizer can cancel an event.
FR-013: Organizer can review event information.
FR-014: Only an authorized organizer can publish an event.
FR-015: Every published event has a public slug.
FR-016: Event times are stored in UTC and displayed in WITA.
FR-017: Published changes must be logged.

### Document & AI

FR-020: Organizer can upload JPEG, PNG, or PDF.
FR-021: Upload must enforce size and type limits.
FR-022: AI extracts candidate event fields.
FR-023: AI must distinguish missing fields from known values.
FR-024: Extracted values remain drafts until reviewed.
FR-025: Organizer can correct every extracted field.
FR-026: AI failure must allow manual data entry.
FR-027: System records model and prompt version.
FR-028: Document source must remain private by default.

### Road Operations

FR-030: Organizer can select road segments from a
verified coverage dataset.
FR-031: Organizer can define planned impact intervals.
FR-032: System must not invent road geometries from AI text.
FR-033: Assigned traffic officer can update current status.
FR-034: Allowed operational statuses:
OPEN, INTERMITTENT, CLOSED, UNKNOWN.
FR-035: Each update records actor and observation time.
FR-036: Updates have an expiry time.
FR-037: Expired status displays as unconfirmed.
FR-038: An open road must not be labeled traffic-free.
FR-039: Public must see the last confirmed update time.
FR-040: No automated route is published without
validated road-network data.

### Cleanup Operations

FR-050: Organizer can create cleanup tasks.
FR-051: Assigned cleanup officer can update task progress.
FR-052: Officer can upload before/after evidence.
FR-053: Organizer can verify or reopen submitted tasks.
FR-054: Officer can record waste category and quantity.
FR-055: Quantity must distinguish weighed from estimated.
FR-056: Cleanup verification must not automatically
authorize road reopening.

### Public Access

FR-060: Public can list published events.
FR-061: Public can view an event's affected roads.
FR-062: Public can see current status and update time.
FR-063: Public must see unavailable or expired data clearly.
FR-064: Draft, cancelled, and private data must not leak.
FR-065: Public pages must work on mobile screens.

### Auditability

FR-070: Record actor, action, entity, and timestamp.
FR-071: Record status transitions and important corrections.
FR-072: Unauthorized mutations must be rejected.
FR-073: Public-facing data must be traceable to an
organizer-approved event.

## 3. Acceptance Criteria

### AC-01: AI Extraction

Given an authenticated organizer and a supported document,
When the organizer requests extraction,
Then the system returns editable structured fields,
And unknown fields remain empty or explicitly unknown,
And nothing is published automatically.

### AC-02: Ambiguous Road Name

Given a document mentioning a road name shared by
multiple segments,
When candidate road matching runs,
Then the system displays possible matches,
And requires the organizer to choose a segment,
And does not auto-publish a guessed geometry.

### AC-03: Officer Permissions

Given an officer assigned cleanup permission only,
When the officer requests a traffic-status update,
Then the server responds with 403,
And no road status changes.

### AC-04: Stale Status

Given a road update whose expiry has passed,
When a public visitor opens the map,
Then the status is shown as unconfirmed,
And the last known update time remains visible,
And the system does not assume the road is open.

### AC-05: Cleanup Evidence

Given an assigned cleanup officer,
When the officer submits a task with an after-photo,
Then the task becomes SUBMITTED,
And remains unverified until organizer approval.

### AC-06: AI Provider Failure

Given the AI provider is unavailable,
When extraction is requested,
Then the user receives a recoverable error,
And can enter event details manually,
And the original uploaded document is preserved.

### AC-07: Publication

Given a verified event with valid time and road-impact data,
When an authorized organizer publishes it,
Then a public page becomes available,
And the publication is recorded in the audit log.

### AC-08: Public Privacy

Given an anonymous visitor,
When the visitor opens a public event,
Then private documents, internal notes, and user contact
details are not returned by the API.

## 4. Non-Functional Requirements

All numerical values are initial engineering TARGETS.

NFR-001: Mobile-first, responsive layout.
NFR-002: WCAG 2.2 AA accessibility target.
NFR-003: Keyboard-operable primary workflows.
NFR-004: Public status refresh target <= 30 seconds
while connected and actively viewing.
NFR-005: Non-AI API p95 target < 800 ms under pilot load.
NFR-006: Public page initial load target < 3 seconds
on a representative mobile 4G test profile.
NFR-007: AI extraction timeout and retry behavior defined.
NFR-008: No secrets in browser bundles.
NFR-009: Input validation on all API boundaries.
NFR-010: Audit log for critical write operations.
NFR-011: Public views remain readable if map tiles fail.
NFR-012: Errors must not expose internal stack traces.
NFR-013: No false success state after a failed mutation.
NFR-014: All date/time storage uses UTC.
NFR-015: Displayed local times use Asia/Makassar.

## 5. System Boundaries

The system provides information and operational coordination.
It does not:

- Grant permission to close public roads.
- Replace pecalang, police, or transport authorities.
- Guarantee route safety.
- Determine ritual requirements.
- Certify waste processing or disposal.

## 6. Requirement Traceability

FR-010..017 -> Event module -> Event CRUD tests
FR-020..028 -> AI module -> Extraction evaluation
FR-030..040 -> Traffic module -> Status/RBAC tests
FR-050..056 -> Cleanup module -> Workflow tests
FR-060..065 -> Public module -> Anonymous E2E tests
FR-070..073 -> Audit module -> Audit integration tests

Every P0 requirement must have at least one automated
or documented manual acceptance test before release.
