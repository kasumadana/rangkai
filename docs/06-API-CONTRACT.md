# REST API Contract — Rangkai

Version: v1
Base URL: /api
Transport: HTTPS
Format: JSON unless multipart upload

## 1. Conventions

- IDs are UUIDs unless noted.
- Times use ISO 8601 with timezone information.
- Database stores timestamps in UTC.
- All protected routes require a valid session.
- Server checks organization and event permissions.
- Input validation uses Zod.
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

- 400: Invalid request
- 401: Unauthenticated
- 403: Insufficient permission
- 404: Resource not found or not visible
- 409: State conflict
- 413: File too large
- 422: Validation failed
- 429: Rate limited
- 503: Dependency unavailable

Do not return stack traces to clients.

## 3. Authentication

Better Auth owns:

- /api/auth/\*

Organizer and officer sessions are cookie-based.

Public endpoints never require a session.

## 4. Events

POST /api/events
Permission: organizer

Request:

```json
{
  "organizationId": "uuid",
  "title": "Kegiatan Contoh",
  "startsAt": "2026-11-10T00:00:00Z",
  "endsAt": "2026-11-10T04:00:00Z"
}
```

Response: 201, event with status "draft".

GET /api/events
Permission: authenticated organization member
Returns paginated accessible events.

GET /api/events/:eventId
Permission: authorized organization member

PATCH /api/events/:eventId
Permission: organizer

POST /api/events/:eventId/review
Permission: organizer
Moves draft -> review.

POST /api/events/:eventId/publish
Permission: organizer
Requires confirmed core fields and road impacts.

POST /api/events/:eventId/cancel
Permission: organizer
Requires cancellation reason.

POST /api/events/:eventId/complete
Permission: organizer
Closes operational event lifecycle.

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

POST /api/events/:eventId/assignments
Permission: organizer

DELETE /api/events/:eventId/assignments/:assignmentId
Permission: organizer

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
- Published events require organizer confirmation.
- Traffic updates require event-scoped authorization.
- Expired road statuses are displayed as unconfirmed.
- Cleanup completion does not open roads.
- Cancelled events are not shown as active closures.
- All important mutations create audit entries.

## 13. API Testing

Every endpoint needs:

- Valid request test
- Invalid input test
- Unauthorized request test
- Wrong organization test
- State conflict test where applicable
- Database failure test where applicable
