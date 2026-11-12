# REST API Contract — Rangkai

Version: v1
Base URL: /api
Transport: HTTPS
Format: JSON unless multipart upload

## 1. Conventions

- IDs are UUIDs unless noted.
- Times use ISO 8601 with explicit timezone information (e.g. `2026-11-10T08:00:00Z` or `2026-11-10T08:00:00+08:00`). Date-only and offsetless timestamps are rejected.
- Database stores timestamps in UTC.
- All protected routes require a valid session cookie.
- Server strictly validates organization membership, event assignments, and roles server-side.
- Input validation uses Zod.
- All mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) enforce CSRF defense:
  - If `Origin` header is present (mandatory for browsers), it must match the canonical configured base URL or request origin.
  - `Sec-Fetch-Site: cross-site` requests are rejected (403 Forbidden).
  - Unsafe form content types (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) are rejected on JSON endpoints (400 Bad Request). Non-browser API requests omitting Origin are permitted provided they supply valid authentication and do not use unsafe form content types.
- Errors use a consistent response envelope.

## 2. Error Format

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You cannot update this road status.",
    "requestId": "req_example"
  }
}
```

HTTP codes:

- 400: Invalid request / Unsupported Content-Type
- 401: Unauthenticated (missing, expired, or revoked session)
- 403: Insufficient permission / Untrusted origin (CSRF) / Unassigned resource access
- 404: Resource not found or not visible
- 409: State conflict (invalid lifecycle transition or concurrency conflict)
- 413: File too large
- 422: Validation failed (Zod schema violations or missing required prerequisites)
- 429: Rate limited
- 503: Dependency unavailable (database or authentication configuration missing or unreachable)

Do not return stack traces or connection secrets to clients.

## 3. Authentication

Better Auth owns:

- /api/auth/*

Organizer and officer sessions are cookie-based (`HttpOnly`, `SameSite=Lax`, `Secure` in production) using cookie prefix `rangkai` (`rangkai.session_token`).
Missing or invalid authentication configuration (`BETTER_AUTH_SECRET` < 32 chars, missing `BETTER_AUTH_URL`) fails closed with HTTP 503.
Public endpoints never require a session.

## 4. Organizations & Onboarding

### POST /api/organizations
Permission: authenticated user  
Requires: `Content-Type: application/json`

Request:
```json
{
  "name": "Banjar Kaja Sesetan",
  "village": "Sesetan",
  "district": "Denpasar Selatan"
}
```

Behavior:
- Atomically creates organization, assigns caller as `organizer` member, and writes initial audit log in a single CTE.
- Idempotent: If caller already created an organization with identical name, returns existing organization (200 OK) without error or duplicates.
- Default authority: `hasOperationalAuthority` defaults to `false`. Operational authority can only be granted by external authority.
- Sanitized errors: Database constraint errors are mapped into standardized error envelopes without exposing internal table or SQL details.

Response: 201 Created (or 200 OK if existing):
```json
{
  "organization": {
    "id": "uuid",
    "name": "Banjar Kaja Sesetan",
    "village": "Sesetan",
    "district": "Denpasar Selatan",
    "hasOperationalAuthority": false,
    "createdAt": "2026-11-08T10:00:00Z"
  }
}
```

### GET /api/organizations/my
Permission: authenticated user  
Returns organizations where the caller has active membership.

---

## 5. Invitations & Officer Onboarding

### POST /api/invitations
Permission: organizer of the organization  
Requires: `Content-Type: application/json`

Request:
```json
{
  "organizationId": "uuid",
  "eventId": "uuid (optional)",
  "role": "officer" | "organizer",
  "recipientEmail": "pecalang@desaadat.id",
  "canUpdateTraffic": true,
  "canUpdateCleanup": false,
  "expiresInDays": 7
}
```

Behavior:
- Generates cryptographically secure token and stores only its SHA-256 hash (`token_hash`).
- `recipientEmail` is required; missing or invalid values return 422. Binding is enforced at acceptance time (case-insensitive, trimmed).
- Atomically creates invitation and audit log.

Response: 201 Created:
```json
{
  "invitation": {
    "id": "uuid",
    "token": "raw-ephemeral-token-64-hex",
    "inviteUrl": "https://rangkai.id/invite/raw-ephemeral-token-64-hex",
    "role": "officer",
    "status": "pending",
    "recipientEmail": "pecalang@desaadat.id",
    "expiresAt": "2026-11-15T10:00:00Z"
  }
}
```

### GET /api/invitations/:token
Permission: public (no auth required)  
Returns public invitation details (organization name, event title, permissions, recipient email) without revealing token hash or private document data. Returns 404/410 if expired or revoked.

### POST /api/invitations/:token/accept
Permission: authenticated user  
Behavior:
- Enforces recipient email match.
- Re-verifies creator's current active organizer authority in the organization.
- Atomically executes single-consumption compare-and-swap (CAS) via SQL CTE (`UPDATE invitations SET status = 'accepted' WHERE status = 'pending'`).
- Grants membership and event assignments atomically with audit log. Concurrent double-acceptance by competing callers yields exactly one 200 OK and one 409 Conflict. Same-user repeat acceptance of their own already-accepted invitation returns 200 OK idempotently without duplicate grants.

Response: 200 OK:
```json
{
  "success": true,
  "role": "officer",
  "organizationId": "uuid",
  "eventId": "uuid"
}
```

### DELETE /api/invitations/:id
Permission: organizer of the organization  
Atomically revokes pending invitation via CAS (`UPDATE ... WHERE status = 'pending'`). Subsequent acceptance attempts return 410 Gone / 404.

---

## 6. Field Operations

### GET /api/field/tasks
Permission: authenticated user  
Returns active event assignments for the authenticated officer:
- Assigned officers receive ONLY events they are assigned to with scoped permissions (`canUpdateTraffic`, `canUpdateCleanup`).
- Unassigned officers receive an empty array (`{ "assignments": [] }`).
- Organizers receive oversight entries for all active events in their organization.

### GET /api/field/events/:id
Permission: assigned officer or organizer  
Behavior:
- Returns scoped operational detail for the event, including verified road impacts, active statuses, and cleanup tasks.
- If caller is an unassigned officer, returns HTTP 403 Forbidden with standard access denied error.

---

## 7. Events

POST /api/events
Permission: organizer
Requires: Content-Type: application/json

Request:

```json
{
  "organizationId": "uuid",
  "title": "Kegiatan Contoh",
  "startsAt": "2026-11-10T08:00:00Z",
  "endsAt": "2026-11-10T14:00:00Z",
  "venueName": "Balai Banjar",
  "venueLocation": { "type": "Point", "coordinates": [115.21, -8.65] },
  "category": "upacara",
  "description": "Deskripsi opsional",
  "permitReference": "SURAT/2026/01"
}
```

Response: 201 Created with event object in status "draft". Atomic audit log recorded.

`venueLocation` is optional and nullable. When present it must be a GeoJSON Point in `[longitude, latitude]` order within the configured Bali bounds. It is chosen and reviewed by the organizer; it is never inferred from a road or district. Existing events can remain without a point.

GET /api/events
Permission: authenticated organization member
Query parameters:
- `page` (integer, default 1, min 1)
- `limit` (integer, default 20, min 1, max 100)
- `status` (optional enum: draft, review, published, active, completed, cancelled, archived)
- `organizationId` (optional uuid, must match caller membership)

Scoping & Visibility:
- Organizers receive all events within their organizations.
- Field officers receive ONLY events they are assigned to via `event_assignments`. Unassigned officers receive zero private event records.

Response: 200 OK

```json
{
  "events": [
    {
      "id": "uuid",
      "organizationId": "uuid",
      "createdBy": "user-id",
      "title": "Kegiatan Contoh",
      "status": "draft",
      "startsAt": "2026-11-10T08:00:00.000Z",
      "endsAt": "2026-11-10T14:00:00.000Z",
      "venueName": "Balai Banjar",
      "createdAt": "2026-11-01T00:00:00.000Z",
      "updatedAt": "2026-11-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

GET /api/events/:eventId
Permission: authorized organization member (organizer or assigned field officer)
Response: 200 OK with event detail. Returns 403/404 if caller is unassigned or outside the organization.
The detail includes `venueLocation` as a GeoJSON Point or `null`.

PATCH /api/events/:eventId
Permission: organizer
Constraints:
- Terminal states (`completed`, `cancelled`) cannot be modified (409 Conflict).
- Published and active events cannot be edited via PATCH (409 Conflict); edits must occur prior to publication while in `draft` or `review` status (FR-011).
- In `review` status, modifying any organizer-editable field (`title`, `category`, `description`, `venueName`, `venueLocation`, `startsAt`, `endsAt`, `permitReference`) invalidates previous human review verification and resets status to `draft`.
Response: 200 OK with updated event. Atomic audit log recorded. Zero-row concurrent conflicts return 409 Conflict without creating false audit records.

POST /api/events/:eventId/review
Permission: organizer
Transitions: draft -> review.
Prerequisites: core fields (`title`, `startsAt`, `endsAt`, `venueName`) must be present and valid.
Constraints: cannot review from completed, cancelled, published, or active (409 Conflict). Idempotent if already in review.
Response: 200 OK with verifiedBy, verifiedAt, status "review". Atomic audit log recorded.

POST /api/events/:eventId/publish
Permission: organizer
Transitions: review -> published.
Prerequisites:
- Event must be in `review` status (publishing from draft rejected with 409 Conflict).
- Event must have explicit human review verification (`verifiedBy` and `verifiedAt` non-null).
- Confirmed core fields (`title`, `startsAt`, `endsAt`, `venueName`).
- At least one road impact referencing a verified road segment (`road_segments.verified_by` and `verified_at` non-null) with `plannedTo > plannedFrom`.
- Operational Authority Gate (AGENTS §1): If publishing an operational event (`isSimulation: false`), the host organization must have `hasOperationalAuthority: true`. Otherwise, returns 403 Forbidden (`OPERATIONAL_AUTHORITY_REQUIRED`). Simulation events (`isSimulation: true`) may be published by any verified organization and are publicly tagged with `[SIMULATED]`.
Idempotency:
- If event is already published, returns 200 OK immediately without generating duplicate slugs or audit rows.
Response: 200 OK with publicSlug, publishedAt, isSimulation, status "published". Atomic audit log recorded.

POST /api/events/:eventId/cancel
Permission: organizer
Request:
```json
{
  "reason": "Alasan pembatalan kegiatan"
}
```
Constraints: cannot cancel completed or already cancelled events (409 Conflict). Zero-row concurrent conflicts or intervening state transitions return 409 Conflict without creating false audit records.
Response: 200 OK with status "cancelled" and reason. Atomic audit log recorded.

POST /api/events/:eventId/complete
Permission: organizer
Transitions: active -> completed.
Constraints: cannot complete draft, review, or published events (409 Conflict; AGENTS §13 lifecycle requires ACTIVE -> COMPLETED).
Response: 200 OK with status "completed". Atomic audit log recorded. Zero-row concurrent conflicts return 409 Conflict without creating false audit records.

## 5. Documents and AI

POST /api/events/:eventId/documents
Permission: organizer
Content-Type: multipart/form-data (`file` or `document`, optional `processingConsent`: `"true"` | `"false"`, JPEG, PNG, PDF up to 8 MB)
Returns `document` (`id`, `eventId`, `originalName`, `mimeType`, `sizeBytes`, `visibility`, `uploadedBy`, `aiConsentGranted`, `aiConsentAt`, `createdAt`). Private R2 storage (`r2Key` is never exposed). Enforces:
- Narrow multipart CSRF validation (`Sec-Fetch-Site: cross-site` rejected with 403; `Origin` verified when present).
- Bounded stream reading before multipart parsing (`MAX_DOCUMENT_SIZE_BYTES`: 8 MB + 64 KB multipart envelope overhead; 413 Payload Too Large on overflow).
- Exactly one file part (`file` or `document`), non-empty bytes, and strict agreement between filename extension, claimed `Content-Type`, magic bytes, and binary format structure (`IHDR`+`IEND` with dimensions >= 2x2 for PNG, `SOI`+`SOF`+`EOI` with dimensions >= 2x2 for JPEG, `%PDF-`+`%%EOF` for PDF).
- Atomic database insert + audit log with row-level lock on the event (`draft` or `review`; uploading to a `review` event resets status to `draft` and clears verification).
- R2 rollback compensation on database failure, logging only sanitized identifiers (`eventId`, `documentId`) without exposing `r2Key` if R2 delete also fails.

GET /api/events/:eventId/documents
Permission: organizer
Returns list of private documents for the event (`id`, `eventId`, `originalName`, `mimeType`, `sizeBytes`, `visibility`, `uploadedBy`, `aiConsentGranted`, `aiConsentAt`, `createdAt`).

GET /api/events/:eventId/documents/:documentId
Permission: organizer
Returns private document binary stream with `Cache-Control: private, no-store, no-cache, must-revalidate` and `X-Content-Type-Options: nosniff`.

POST /api/events/:eventId/extractions
Permission: organizer

Request:

```json
{
  "documentId": "uuid",
  "processingConsent": true
}
```

Validation & Safeguards:
- Explicit organizer processing authorization/consent (`processingConsent: true` in request or granted at document upload) is required before sending private documents to external AI processing (422 Unprocessable Entity if missing or false).
- Event-level concurrency lock: atomically locks the event and document rows (`FOR UPDATE OF e, d`) and reserves an extraction slot in `ai_extractions` (`status = 'processing'`). Returns 409 Conflict if any extraction is already `pending` or `processing` across any document of the event.
- Rate limit: maximum 5 extraction requests per 10-minute sliding window per organization (429 Too Many Requests).
- Completion lifecycle guard: re-locks the event row on completion; if the event transitioned out of `draft`/`review` while Gemini was in flight, rejects completion with 409 Conflict (`EVENT_STATE_CONFLICT`) and does not persist output JSON.

Response (200 OK):
- Returns `{ extraction, manualFallbackAvailable: true }`.
- When `extraction.status === "completed"`, `outputJson` (and alias `extractedJson`) conforms strictly to `docs/05-AI-SPEC.md` §3 (`schema_version`, `event_name`, `event_category`, `start_datetime`, `end_datetime`, `venue_name`, `procession_description`, `affected_road_names`, `traffic_impact_description`, `organizer_name`, `cleanup_location_notes`, `contact_information`, `issues`), with all present datetime strings validated for calendar accuracy and normalized to UTC ISO 8601.
- When Gemini fails, times out, or returns schema-invalid JSON (such as `{}` or impossible calendar dates), records `status: "failed"` with sanitized `errorCode` (`PROVIDER_ERROR`, `PROVIDER_TIMEOUT`, `SCHEMA_VALIDATION_FAILED`, etc.) and returns 200 OK with `manualFallbackAvailable: true` so the organizer can proceed with manual entry.

GET /api/extractions/:extractionId
Permission: organizer of owning event

PATCH /api/events/:eventId/extracted-fields
Permission: organizer
Request (accepts flat fields or `{ "corrections": { ... } }` wrapper):
```json
{
  "title": "Karya Melasti Sanur",
  "category": "upacara_adat",
  "description": "Prosesi adat melasti menuju segara",
  "venueName": "Pantai Matahari Terbit Sanur",
  "startsAt": "2026-11-20T08:00:00+08:00",
  "endsAt": "2026-11-20T16:00:00+08:00",
  "permitReference": "SURAT/2026/099",
  "processionDescription": "Berjalan kaki menuju Pantai Matahari Terbit",
  "trafficImpactDescription": "Penutupan satu lajur selama iring-iringan",
  "organizerName": "Prajuru Desa Adat Intaran",
  "cleanupLocationNotes": "Titik kumpul karung sampah di parkir utara pantai",
  "contactInformation": "I Made Surya (0812-0000-0101)"
}
```
Persists reviewed/corrected fields, including optional `venueLocation`, on `events` atomically under `FOR UPDATE OF e`, resets `review` status to `draft` (clearing `verifiedBy`/`verifiedAt`) when any field changes, and records `before_json` and `after_json` from the locked row (`hasContactInformation` boolean is logged in audit JSON rather than raw private contact strings; `contactInformation` is returned only to organizers and stripped from officer and public responses).

## 6. Road Segments

GET /api/road-segments?bbox=minLng,minLat,maxLng,maxLat
Permission: organizer

Returns reviewed road-segment candidates.

POST /api/road-segments
Global road verification is not available through this endpoint; it returns 403. Existing verified catalog rows require an independently authorized provenance process.

POST /api/events/:eventId/simulation-road-impacts
Permission: current organizer of the event's organization; event must be a simulation in draft or review. Creates and attaches an organization-scoped training line atomically. This line is not globally verified or eligible for operational publication. Repeating the same payload and `mutationId` returns the existing result; changing a payload for an existing ID returns 409.

Request:

```json
{
  "displayName": "Jl. Raya Ubud — Depan Puri Saren",
  "coverageArea": "Ubud, Gianyar",
  "coordinates": [
    [115.2612, -8.5068],
    [115.2645, -8.5069]
  ],
  "humanVerified": true,
  "mutationId": "uuid",
  "plannedFrom": "2026-11-10T00:00:00Z",
  "plannedTo": "2026-11-10T02:00:00Z",
  "impactType": "closure"
}
```

GET /api/events/:eventId/road-impacts
Permission: organizer or assigned officer

Returns road impacts attached to the event along with `operationalStatus` (`effectiveStatus`, `rawStatus`, `isStale`, `observedAt`, `expiresAt`).

POST /api/events/:eventId/road-impacts
Permission: organizer

Request:

```json
{
  "roadSegmentId": "uuid",
  "plannedFrom": "2026-11-10T00:00:00Z",
  "plannedTo": "2026-11-10T02:00:00Z",
  "impactType": "closure",
  "diversionNote": null
}
```

PATCH /api/events/:eventId/road-impacts/:impactId
Permission: organizer

DELETE /api/events/:eventId/road-impacts/:impactId
Permission: organizer

## 7. Live Road Status

POST /api/road-impacts/:impactId/status
Permission: assigned traffic officer or organizer

Request:

```json
{
  "status": "closed",
  "observedAt": "2026-11-10T00:05:00Z",
  "mutationId": "uuid",
  "note": "Portal ditutup oleh petugas"
}
```

Validation:
- `status`: "open" | "intermittent" | "closed"
- `observedAt`: ISO 8601 UTC timestamp. Must not be more than 5 minutes in the future relative to server time (422 Unprocessable Entity).

Response (200 OK):

```json
{
  "impact": {
    "status": "closed",
    "observedAt": "2026-11-10T00:05:00.000Z",
    "expiresAt": "2026-11-10T00:35:00.000Z",
    "updatedBy": "authorized-officer-id"
  },
  "roadImpact": {
    "status": "closed",
    "observedAt": "2026-11-10T00:05:00.000Z",
    "expiresAt": "2026-11-10T00:35:00.000Z",
    "updatedBy": "authorized-officer-id"
  }
}
```

The server determines expiry policy (30 minutes default).
The client cannot extend validity arbitrarily.

Idempotency and Concurrency:
- Use `mutationId` for idempotent retries.
- If `mutationId` was already processed, the server performs a 5-field normalized comparison (`roadImpactId`, `updatedBy`, `status`, `observedAt` within 1 second, `note`).
- If all 5 fields match, returns 200 OK (`{ impact, roadImpact, duplicate: true }`) without appending duplicate history.
- If any field conflicts (e.g. status or timestamp mismatch with an existing mutationId), returns 409 Conflict.

## 8. Cleanup

GET /api/events/:eventId/cleanup-tasks
Permission: organizer or assigned cleanup officer

POST /api/events/:eventId/cleanup-tasks
Permission: organizer

PATCH /api/cleanup-tasks/:taskId
Permission: organizer or assigned cleanup officer
- Officer Task Ownership: If an assigned officer attempts to update a task assigned to a different officer, returns 403 Forbidden.
- State Lock: Once a task is `verified`, direct PATCH modifications return 409 Conflict (must be reopened first).

POST /api/cleanup-tasks/:taskId/evidence
Permission: assigned cleanup officer or organizer
Content-Type: multipart/form-data (file field: `photo` or `file`; stage field: `evidenceType` or `stage`: "before" | "after")
- Response: 201 Created with `{ "evidence": { "id": "uuid", "taskId": "uuid", "stage": "before" | "after", "uploadedBy": "user-id", "createdAt": "iso-timestamp" } }`.
- Single-file validation with stream-bounded size check (`MAX_PHOTO_SIZE_BYTES`: 5 MB) and JPEG/PNG magic byte verification.
- Officer Task Ownership: Officers can only upload evidence to their own assigned task (403 Forbidden).

POST /api/cleanup-tasks/:taskId/submit
Permission: assigned cleanup officer or organizer
- Officer Task Ownership: Officers can only submit their own assigned task (403 Forbidden).
- Prerequisite: Requires at least one "after" evidence photo uploaded prior to submission (409 Conflict if missing).
- Transitions status from `in_progress` to `submitted`.

POST /api/cleanup-tasks/:taskId/verify
Permission: organizer
Verifies submitted cleanup task. Invariant: Does not alter road status. Sets `verifiedBy`, `verifiedAt`, and status `verified`.

POST /api/cleanup-tasks/:taskId/reopen
Permission: organizer
Reopens submitted or verified task to `reopened`, clearing verification fields (`verifiedBy = null`, `verifiedAt = null`).

GET /api/cleanup-tasks/:taskId/evidence/:evidenceId
Permission: organizer or assigned cleanup officer
Controlled retrieval of private photo evidence with Cache-Control: private, no-cache.

GET /api/events/:eventId/waste-records
Permission: organizer or assigned cleanup officer
Returns list of waste records for the event.

POST /api/events/:eventId/waste-records
Permission: organizer or assigned cleanup officer
Records waste quantity by category (`organic`, `recyclable`, `residual`). Distinguishes measured `weighedKg` from `estimatedKg` and `sackCount`. Never silently converts estimated quantities into measured facts.
Request body: `{ "category": "organic" | "recyclable" | "residual", "quantityKg"?: number, "sackCount"?: number, "measurementMethod": "weighed" | "estimated", "destination"?: string, "taskId"?: "uuid" }` (at least one of `quantityKg` or `sackCount` required).
Response: 201 Created with `{ "wasteRecord": { "id": "uuid", "eventId": "uuid", "taskId": "uuid" | null, "category": string, "quantityKg": number | null, "sackCount": number | null, "measurementMethod": "weighed" | "estimated", "destination": string | null, "recordedBy": string, "recordedAt": "iso-timestamp", "createdAt": "iso-timestamp" } }`.

## 9. Assignments

GET /api/events/:eventId/assignments
Permission: organizer
Response: 200 OK with list of assigned officers (`id`, `userId`, `userName`, `userEmail`, `canUpdateTraffic`, `canUpdateCleanup`, `createdAt`).

POST /api/events/:eventId/assignments
Permission: organizer
Request:
```json
{
  "userId": "uuid-or-id",
  "canUpdateTraffic": true,
  "canUpdateCleanup": false
}
```
Target user must be a member of the event's organization.
Response: 201 Created with assignment object and target user details (or 200 OK if updating existing assignment, or idempotent 200 OK if concurrent request established identical permissions). Atomic audit log recorded for actual mutations. Concurrent conflicts with mismatched permissions return 409 Conflict without creating false audit records.

DELETE /api/events/:eventId/assignments/:assignmentId
Permission: organizer
Response: 200 OK `{ "success": true, "revokedId": "uuid" }`. Atomic audit log recorded.

## 10. Public API

GET /api/public/events
Query: from, to, optional bbox
Returns only published/active public information.

GET /api/public/events/:slug
Returns public event summary including organizer-selected `venueLocation` as a GeoJSON Point or `null`; the same field is included in the public event list. Normal publication and authority filters apply.

GET /api/public/events/:slug/roads
Returns planned road impacts and effective status.

GET /api/public/events/:slug/cleanup-summary
Returns explicitly public, aggregated cleanup information.
Response (200 OK):
```json
{
  "event": {
    "title": "Piodalan Pura Jagatnatha",
    "status": "published"
  },
  "summary": {
    "totalTasks": 2,
    "completedTasks": 1,
    "verifiedTasks": 1
  },
  "wasteTotals": {
    "weighedKg": 45.5,
    "estimatedKg": 10.0,
    "totalSacks": 8
  },
  "byCategory": {
    "organic": {
      "weighedKg": 25.5,
      "estimatedKg": 0,
      "sackCount": 4
    },
    "recyclable": {
      "weighedKg": 20.0,
      "estimatedKg": 10.0,
      "sackCount": 3
    },
    "residual": {
      "weighedKg": 0,
      "estimatedKg": 0,
      "sackCount": 1
    }
  }
}
```
Strictly separates measured `weighedKg` and unverified `estimatedKg` per FR-055.

Public responses must exclude:

- Private documents
- User email addresses
- Internal audit records
- Authentication tokens
- Private officer notes
- Unverified AI output

## 11. Health and Liveness

GET /api/health
Permission: Public (unauthenticated)
Inputs: None (GET only)

Response: 200 OK
Content-Type: application/json

```json
{
  "status": "ok",
  "service": "rangkai"
}
```

Semantics:
Process liveness check only. Deterministic response identifying the service.
Never asserts external dependency readiness (Neon, R2, Gemini) or operational readiness.
Enforced via Worker-first asset routing (run_worker_first: ["/api/*"]) to ensure API responses are never intercepted by SPA fallback routing regardless of request navigation headers.

## 12. API State Rules

- Draft events are never public.
- Published events require organizer confirmation and verified road impact prerequisites.
- Traffic updates require event-scoped authorization.
- Expired road statuses are displayed as unconfirmed.
- Cleanup completion does not open roads.
- Cancelled events are not shown as active closures.
- All important mutations create audit entries atomically with database changes.

## 13. API Testing

Every endpoint needs:

- Valid request test
- Invalid input test
- Unauthorized request test
- Wrong organization test
- State conflict test where applicable
- Database failure test where applicable

## 14. Public Road Geometry & Alternative Routes (P0 & P1)

### GET /api/public/road-impacts
Read-only anonymous list of operational road impacts across all published events.
- **Query parameters:**
  - `status` or `operationalStatus`: Optional filter (`open`, `intermittent`, `closed`, `unknown`, `unconfirmed`).
  - `eventStatus`: Optional filter for event lifecycle status (`published`, `active`, `completed`). Defaults to published or active events.
  - `from`: Optional ISO 8601 start window timestamp.
  - `to`: Optional ISO 8601 end window timestamp.
  - `bbox`: Optional Bali bounding box `minLng,minLat,maxLng,maxLat`.
  - `page`: Optional integer page number (default 1).
  - `limit`: Optional pagination limit (default 100, max 300).
- **TTL Semantics:**
  - Evaluates operational status dynamically against `ROAD_STATUS_TTL_MS` (30 minutes).
  - Statuses older than 30 minutes return `effectiveStatus: "unconfirmed"`.
  - Never silently coerces unconfirmed status to `open`.
- **Response:**
  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "id": "imp_01",
        "geometry": { "type": "LineString", "coordinates": [[115.258, -8.691], [115.260, -8.695]] },
        "properties": {
          "impactId": "imp_01",
          "roadSegmentId": "seg_01",
          "eventId": "evt_01",
          "eventSlug": "melasti-sanur-2026",
          "eventTitle": "Karya Melasti Desa Adat Sanur Kauh",
          "displayName": "Jl. Danau Tamblingan",
          "coverageArea": "Kawasan Pesisir Sanur",
          "impactType": "full_closure",
          "plannedFrom": "2026-11-12T08:00:00Z",
          "plannedTo": "2026-11-12T12:00:00Z",
          "diversionNote": "Gunakan jalur bypass timur",
          "rawStatus": "closed",
          "effectiveStatus": "closed",
          "isStale": false,
          "observedAt": "2026-11-12T08:15:00Z",
          "expiresAt": "2026-11-12T08:45:00Z",
          "isSimulation": false
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 100,
      "total": 1,
      "totalPages": 1,
      "truncated": false
    }
  }
  ```

### GET /api/public/events/:slug/alternative-routes
Anonymous list of organizer-approved manual alternative routes for a published event.
- **Eligibility:** Restricted to `published` and `active` events with active impacts. Unapproved, revoked, or expired alternative routes are never exposed.
- **Response:**
  ```json
  {
    "eventSlug": "melasti-sanur-2026",
    "isSimulation": false,
    "alternativeRoutes": [
      {
        "id": "alt_01",
        "name": "Jalur Pengalihan Jl. Danau Poso",
        "description": "Pengalihan kendaraan roda dua dan empat ringan.",
        "provenance": "organizer_approved_manual_simulation",
        "approvedAt": "2026-11-10T10:00:00Z",
        "expiresAt": "2026-11-12T12:00:00Z",
        "geometry": { "type": "LineString", "coordinates": [[115.258, -8.691], [115.260, -8.695]] }
      }
    ]
  }
  ```

### POST /api/public/routes/alternatives
Conditional network routing candidate avoiding road closures.
- **Gate:** Unconditionally returns `HTTP 503 SERVICE_UNAVAILABLE` (Ticket 07 deferred). Real road-network avoidance routing is not active, preventing any unsafe fallback paths, external network calls, or pretend geometry. Points caller to verified manual alternative routes.

## 15. Road Candidate Matching (Ticket 04)

### GET /api/events/:eventId/road-candidates
Ranked road candidates from the verified catalog matching user search terms.
- **Permission:** Organizer only.
- **Query:** `query` string (min 2 chars).
- **Matching Methods:** `exact_normalized` (1.0), `substring` (0.8), `token_overlap` (0.5..0.7). Regional priority boosts candidates located in the event organization's village or district. Quarantined roads are excluded.
- **Response:**
  ```json
  {
    "query": "Gajah Mada",
    "candidates": [
      {
        "candidateId": "seg_01",
        "displayName": "Jl. Gajah Mada",
        "coverageArea": "Denpasar Barat",
        "matchScore": 1.0,
        "matchMethod": "exact_normalized",
        "reviewRequired": true,
        "explanation": "Nama ruas jalan cocok persis dengan katalog resmi terverifikasi.",
        "geometry": { "type": "LineString", "coordinates": [...] }
      }
    ]
  }
  ```

## 16. Reviewed Manual Alternative Routes (Ticket 06)

- `POST /api/events/:eventId/alternative-routes`: Create draft alternative route (Organizer only).
- `GET /api/events/:eventId/alternative-routes`: List all alternative routes (draft, approved, revoked) for event organizers.
- `POST /api/events/:eventId/alternative-routes/:routeId/approve`: Approve draft route with atomic membership and road impact snapshot binding (`sourceSnapshotHash`, `expiresAt`), recording append-only audit and history.
- `POST /api/events/:eventId/alternative-routes/:routeId/revoke`: Revoke approved route with atomic organizer membership check and audit logging.
- `DELETE /api/events/:eventId/alternative-routes/:routeId`: Delete draft route (Organizer only).

## 17. AI Advisory Operations (Tickets 05, 08, 09)

Shared advisory runs are stored in `advisory_runs` with an immutable snapshot hash of material inputs (`input_snapshot_hash`).
Organizer decisions (`approved`, `dismissed`) are recorded in `advisory_decisions`.
Advisory decisions NEVER directly mutate domain operational state (events, road statuses, cleanup tasks, or permissions).

- `POST /api/events/:eventId/impact-analysis`: Runs grounded impact analysis using configured Gemini model or honest `rule_based_fallback`. Cross-org conflict analysis strictly respects organization privacy (no simulation leaks, only operational authority events).
- `GET /api/events/:eventId/impact-analysis/latest`: Retrieves latest analysis with dynamic staleness evaluation against current event snapshot hash.
- `POST /api/events/:eventId/impact-analysis/:runId/decision`: Records organizer review decision with atomic membership validation and 409 conflict on stale snapshot.
- `POST /api/events/:eventId/public-notice-draft`: Generates public notice drafts adhering to word (<= 120 words) and character (<= 600 characters for WhatsApp) limits, with server-enforced simulation notices and verified facts only.
- `GET /api/events/:eventId/public-notice-draft/latest`: Retrieves latest notice draft and approval status.
- `POST /api/events/:eventId/public-notice-draft/:runId/decision`: Records approval/rejection or validated human correction. Validates length limits, rejects unsupported safety/authority claims (e.g., "dijamin aman", "resmi oleh polisi") or unlisted road names, and forces simulation tag.
- `POST /api/events/:eventId/waste-plan`: Calculates scenario waste logistics. Supports user-specified generation rates (`wastePerPersonDayKg`) and fractions (`organicFraction`, `recyclableFraction`, `residualFraction`). If omitted or 0, returns `forecastKg: null`, `method: "operational_checklist"`, and checklist only without fabricated numeric assumptions.

### Public assistant and waste scenarios (candidate implementation)

`POST /api/public/assistant/questions` is anonymous and enabled only when `PUBLIC_ASSISTANT_ENABLED=true` and Gemini is configured. It accepts `question` (1�500 characters), optional exact `eventSlug`, `location` (venue, village or district), and optional ISO `from`/`to`. A request body is limited to 4096 bytes and the existing isolate-local rate limiter applies (10/minute per IP; distributed edge protection remains an operations requirement). Retrieval includes published and active events; an exact `eventSlug` also permits completed public events, subject to the same operational-authority or simulation filter. Gemini receives only the question and up to ten publicly visible event titles and IDs; it selects an intent and IDs under a structured schema. The server validates identifiers and produces all returned text, URLs and facts itself. It reuses public road and cleanup handlers, preserves simulation labels and marks expired road observations unconfirmed. Route-help extracts origin and destination from text actually present in the question; missing, invented or non-unique locations do not yield a route claim. When NETWORK_ROUTING_ENABLED=true and ORS_API_KEY is configured, the server sends the extracted names to the fixed OpenRouteService geocoder, restricts candidates to Bali, requires a unique match, and requests one driving route. The full validated route is checked with PostGIS ST_Intersects against eligible public road geometry; at most 100 matching roads are returned with event links, schedules, simulation labels and observation timestamps, with truncation disclosed. A /peta link is returned. No intersection does not mean clear roads; route geometry is not a verified navigation or closure-avoidance recommendation. Provider, configuration, ambiguous location or database failure abstains. This operation sends user-supplied place names and coordinates to OpenRouteService; no private documents or internal accounts are sent. Missing data and out-of-scope requests abstain. Public venue/village/district labels accompany source titles for provider selection; no private documents are sent. Disabled/unconfigured/provider failure returns 503 and the existing error envelope; invalid input returns 422. This feature is not a safety guarantee and cannot provide closure bypass directions.

`POST /api/events/:eventId/waste-plan` retains its organizer-only authorization, `forecastKg:null`, and `insufficient_historical_data`. Optional `scenario` contains `coefficientKgPerParticipantDay:{min,max,provenance}` and optional complete `categoryShares:{organic,recyclable,residual}` summing to one. `scenarioRange` reports low/high estimated weights and assumptions, not measured weight. Totals are rounded to tenths of a kilogram. Category shares are normalized within the accepted sum tolerance; the rounded low total and the difference between rounded totals are allocated separately by largest remainder in tenths, with ties resolved organic, recyclable, residual. This preserves category ordering and endpoint totals, but a category can differ from independently rounded shares by a tenth or more. Optional `facilityLocation:{latitude,longitude}` produces straight-line distances to historical directory candidates; `suitableMatches` is empty until acceptance and service restrictions are supported. Candidates have unknown current operation and acceptance and require confirmation. Legacy exact scenario values remain available; legacy implicit fractions and sack capacity are labeled assumptions. Supplying only some legacy category fractions, or fractions not summing to one, now returns 422.

### Private cleanup photo-quality assessment

`POST /api/cleanup-tasks/:taskId/photo-quality` accepts JSON `{ "beforeEvidenceId": "uuid", "afterEvidenceId": "uuid" }`. Both private evidence records must belong to the task and match their respective stages. Access requires an organizer in the owning organization or the task-assigned officer with event cleanup permission. Cancelled events cannot be assessed. The feature is disabled unless `AI_PHOTO_ASSESSMENT_ENABLED` is exactly `true` and a Gemini key and private R2 binding are configured.

On success, `data` contains `beforeReadable`, `afterReadable`, `sameAreaLikely` (`yes`, `no`, or `uncertain`), `issues`, `observations`, `taskId`, `wasteWeightKg: null`, `automaticallyVerified: false`, `requiresOrganizerReview: true`, `model`, `promptVersion`, and `schemaVersion`. It changes no cleanup or road state. Error envelopes include request IDs: 401 unauthenticated, 403 forbidden, 404 missing or inaccessible task/pair, 409 cancelled event, 413 oversized request, 422 invalid input, 429 rate limited, and 503 unavailable storage, disabled feature, invalid photo, or provider failure.

## Authenticated read-only assistant

`POST /api/assistant/questions` requires a Better Auth session and accepts a JSON object with `question` (1–500 characters), optional UUID `organizationId` and `eventId`, or a separate `helpTopic` (`event`, `traffic`, `cleanup`). Help cannot be combined with selected context. Without both context IDs the response asks for selection and searches no events; if an organization was supplied its membership is checked. The server checks membership, event ownership and officer assignment and category permissions. The provider selects only the selected event ID and receives only its title and the user's question. The server checks the session and permissions again after the provider, retrieves bounded facts, checks permissions again before returning them, and recomputes road expiry. No mutations are available. Questions and event titles are processed externally when the provider is called.

Successful responses contain `status` (`answered`, `abstained`, `selection_required`), `scope` (`internal`, `help`), `intent`, `answer`, `sources`, and `searchUrl`. Each source has `sourceId`, server-authored `url`, `kind`, `title`, and typed `facts`: event `{status, startsAt, endsAt, isSimulation}`; road `{status, observedAt, expiresAt, isSimulation}`; cleanup `{status, dueAt, isSimulation}`; waste `{category, measurementMethod, quantityKg, sackCount, isSimulation}`; help `{}`. Quantity is a decimal string or null, sack count an integer or null, and timestamps ISO strings or null. Help is labeled `Panduan penggunaan` and is reviewed application text. Status values are stored lowercase; expired or absent road observations are `unconfirmed`.

Errors use the existing request-ID envelope: 401 session absent, 403 organization or assignment/permission denied, 404 missing or foreign event, 422 invalid body, 429 isolate-local rate limit, and 503 disabled, missing provider configuration, changed context, or invalid/provider failure. `PUBLIC_ASSISTANT_ENABLED=true` and a configured Gemini key are required for provider-backed requests; help and context selection do not call the provider. This flag does not provide distributed cost protection or prove production readiness.
