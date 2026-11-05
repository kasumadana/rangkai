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

## 4. Events

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
  "category": "upacara",
  "description": "Deskripsi opsional",
  "permitReference": "SURAT/2026/01"
}
```

Response: 201 Created with event object in status "draft". Atomic audit log recorded.

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

PATCH /api/events/:eventId
Permission: organizer
Constraints:
- Terminal states (`completed`, `cancelled`) cannot be modified (409 Conflict).
- Published and active events cannot be edited via PATCH (409 Conflict); edits must occur prior to publication while in `draft` or `review` status (FR-011).
- In `review` status, modifying any organizer-editable field (`title`, `category`, `description`, `venueName`, `startsAt`, `endsAt`, `permitReference`) invalidates previous human review verification and resets status to `draft`.
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
Idempotency:
- If event is already published, returns 200 OK immediately without generating duplicate slugs or audit rows.
Response: 200 OK with publicSlug, publishedAt, status "published". Atomic audit log recorded.

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
Persists all 12 reviewed/corrected fields on `events` atomically under `FOR UPDATE OF e`, resets `review` status to `draft` (clearing `verifiedBy`/`verifiedAt`) when any field changes, and records `before_json` and `after_json` from the locked row (`hasContactInformation` boolean is logged in audit JSON rather than raw private contact strings; `contactInformation` is returned only to organizers and stripped from officer and public responses).

## 6. Road Segments

GET /api/road-segments?bbox=minLng,minLat,maxLng,maxLat
Permission: organizer

Returns reviewed road-segment candidates.

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
Returns public event summary.

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
