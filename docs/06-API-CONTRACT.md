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
Constraints: cannot cancel completed or already cancelled events (409 Conflict).
Response: 200 OK with status "cancelled" and reason. Atomic audit log recorded.

POST /api/events/:eventId/complete
Permission: organizer
Transitions: active -> completed.
Constraints: cannot complete draft, review, or published events (409 Conflict; AGENTS §13 lifecycle requires ACTIVE -> COMPLETED).
Response: 200 OK with status "completed". Atomic audit log recorded. Zero-row concurrent conflicts return 409 Conflict without creating false audit records.

## 5. Documents and AI

POST /api/events/:eventId/documents
Permission: organizer
Content-Type: multipart/form-data
Returns documentId.

POST /api/events/:eventId/extractions
Permission: organizer

Request:

```json
{
  "documentId": "uuid"
}
```

Response:

- 200 with completed extraction, or
- 202 with processing job ID.

GET /api/extractions/:extractionId
Permission: organizer of owning event

PATCH /api/events/:eventId/extracted-fields
Permission: organizer
Stores corrected fields for review.

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

Response:

```json
{
  "status": "closed",
  "observedAt": "2026-11-10T00:05:00Z",
  "expiresAt": "2026-11-10T00:35:00Z",
  "updatedBy": "authorized-officer-id"
}
```

The server determines expiry policy.
The client cannot extend validity arbitrarily.

Use mutationId for idempotent retries.
A repeated mutationId must not create duplicate updates.

## 8. Cleanup

GET /api/events/:eventId/cleanup-tasks
Permission: organizer or assigned cleanup officer

POST /api/events/:eventId/cleanup-tasks
Permission: organizer

PATCH /api/cleanup-tasks/:taskId
Permission: organizer or assigned cleanup officer
Allowed fields depend on permission.

POST /api/cleanup-tasks/:taskId/evidence
Permission: assigned cleanup officer or organizer
Content-Type: multipart/form-data

POST /api/cleanup-tasks/:taskId/submit
Permission: assigned cleanup officer or organizer

POST /api/cleanup-tasks/:taskId/verify
Permission: organizer

POST /api/events/:eventId/waste-records
Permission: organizer or assigned cleanup officer

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
Response: 201 Created with assignment object and target user details. Atomic audit log recorded.

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
Returns only explicitly public, aggregated information.

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
