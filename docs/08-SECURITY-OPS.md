# Security, Privacy and Operations — Rangkai

Version: 0.1.0
Status: Draft

## 1. Security Principles

- Least privilege.
- Deny access by default.
- Validate at server boundaries.
- Separate public and private data.
- Keep secrets outside source code.
- Maintain traceability for critical changes via atomic append-only audit logging.

## 2. Role Permission Matrix

| Action                | Organizer | Traffic Officer | Cleanup Officer | Public |
| --------------------- | --------- | --------------- | --------------- | ------ |
| Create event          | Yes       | No              | No              | No     |
| Upload event document | Yes       | No              | No              | No     |
| Review AI output      | Yes       | No              | No              | No     |
| Publish event         | Yes       | No              | No              | No     |
| Manage assignments    | Yes       | No              | No              | No     |
| Update road status    | Yes       | Assigned        | No              | No     |
| Update cleanup task   | Yes       | No              | Assigned        | No     |
| Verify cleanup        | Yes       | No              | No              | No     |
| Read public event     | Yes       | Yes             | Yes             | Yes    |
| Read private document | Yes       | No              | No              | No     |

All permissions are checked on the server.
Assignments must match the requested event.

## 3. Authentication & CSRF Protection

Use Better Auth with secure cookie sessions.

Requirements:

- HTTPS in production.
- HttpOnly session cookies with `cookiePrefix: "rangkai"`.
- Secure cookie attributes (`Secure: true` in production; explicitly allowed loopback HTTP in development).
- `SameSite=Lax` cookie policy.
- Origin & CSRF defense on all state-mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`):
  - Request `Origin` header (when present, mandatory in browsers) must match trusted canonical base URL or request origin.
  - `Sec-Fetch-Site: cross-site` requests are rejected (403 Forbidden).
  - Form-compatible simple request Content-Types (`text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`) are rejected for JSON mutation endpoints (400 Bad Request). Non-browser API callers omitting Origin are permitted provided they supply valid authentication and do not use unsafe form content types.
- Session expiration and revocation.
- Fail-closed authentication configuration: `BETTER_AUTH_SECRET` must have high entropy (min 32 chars); missing auth or database configuration returns 503 Dependency Unavailable without starting or serving authenticated requests.
- No shared banjar-wide PIN or committed shared passwords.
- Seed credentials: use caller-supplied (`SEED_ORGANIZER_PASSWORD`, `SEED_OFFICER_PASSWORD`) or ephemeral cryptographically secure generated passwords; never commit or log credentials; repeated seeds preserve existing credentials without resetting passwords.

## 4. Multi-Tenant Isolation

Every private event belongs to an organization.

Protected queries must verify:

- Current authenticated user.
- Organization membership.
- Role or event assignment.
- Officers only receive events they are assigned to via `event_assignments` (both in detail views and in event listings).
- Requested resource ownership.

Do not trust organizationId supplied by the browser.

## 5. File Security

Documents and cleanup photos are private R2 objects.

Upload controls:

- MIME/type and magic-byte validation (PDF, PNG, JPEG).
- Bounded stream parsing: file-size limits (8 MB for announcements, 5 MB for cleanup photos) checked incrementally via chunk streaming before buffering to prevent memory exhaustion DoS.
- Safe object naming and R2 rollback compensation on DB insert failures.
- Access checks with strict officer task ownership and verified state locking.
- Rate limits (5 AI extraction requests per 10 minutes sliding window per organization) and atomic concurrency reservation locks.
- No public bucket listing.

Do not expose:

- Original private document URLs.
- R2 credentials.
- Personal contact information.
- Unredacted permit documents.

Public media requires a separate explicit publication rule.

## 6. AI Data Handling

Documents may contain personal or sensitive information.

Before external AI processing:

- Inform the uploader that a third-party AI processes
  the document.
- Obtain required consent or authorization.
- Minimize unnecessary data.
- Do not place raw documents in application logs.
- Do not use uploaded documents for unrelated purposes.

Review provider retention and data-processing terms
before enabling production uploads.

## 7. Road Status Integrity

Only assigned traffic officers or organizers may update
a road-impact status.

Every update records:

- Actor
- Event
- Segment
- Status
- Observation time
- Server receipt time
- Expiry time

Validate client-supplied observation timestamps.
Reject unreasonable future timestamps.

Use server time for authoritative receipt and expiry.

Do not equate:

- "OPEN" with "traffic is clear".
- "CLOSED" with an official police order.
- "Verified by organizer" with legal certification.

## 8. Audit Logs

Audit:

- Event creation, review, publication, completion, and cancellation.
- Road-status changes.
- Role assignment changes (grant and revoke).
- Cleanup verification.
- Important edits after publication.

Every audit entry is committed atomically in the same database batch/transaction as the underlying mutation. Protect logs from ordinary user modification.

## 9. Secrets

Store in Cloudflare Workers secrets:

- DATABASE_URL
- GEMINI_API_KEY
- BETTER_AUTH_SECRET
- Other private integration keys

Use environment bindings for R2.

Never commit .env files or production credentials.

## 10. Operational Safeguards

- Rate-limit authentication and AI extraction.
- Authentication's application limiter uses fixed windows local to each Worker isolate (10 sign-ups or 20 sign-ins per minute per observed address). Counters are not shared across isolates or locations and reset on isolate eviction; they do not provide a distributed guarantee. It uses `CF-Connecting-IP` only on traffic entering through Cloudflare, with a shared unknown-address bucket when absent. Direct or untrusted proxy access must not be treated as a trusted source of this header. Configure and verify an appropriate Cloudflare edge rate-limiting rule for production protection.
- Limit uploads per user.
- Apply AI request timeouts.
- Avoid duplicate extraction requests.
- Use database constraints for integrity.
- Provide explicit retry behavior.
- Keep a tested migration and rollback process.

## 11. Backup and Recovery

- Enable suitable Neon backup/recovery features.
- Test restoration in a non-production environment.
- Keep migration history in Git.
- Define a recovery owner.
- Verify R2 retention and deletion behavior.

## 12. Data Retention Proposal

Initial policy for pilot discussion:

- Private event documents: 180 days after event.
- Cleanup evidence: 180 days after event.
- Audit records: 365 days.
- Public event metadata: until archived or removed.

These are proposed product settings, not legal requirements.
Confirm with the pilot organizer and applicable rules.

## 13. Incident Response

For incorrect public road information:

1. Mark affected status unconfirmed.
2. Notify responsible organizer.
3. Correct or withdraw the publication.
4. Preserve the audit trail.
5. Record the cause and corrective action.

For credential exposure:

1. Revoke the affected credential.
2. Rotate secrets.
3. Review access logs.
4. Redeploy and verify.

## 14. Operational Monitoring

Track:

- API error rate.
- AI extraction failures.
- Upload failures.
- Database availability.
- Public status age.
- Unauthorized mutation attempts.

Do not log sensitive document contents.

## 15. Production Release & Deployment Runbook

Detailed fail-closed operational runbook for production release gating, migration backup/recovery, and candidate commit binding is maintained in `docs/RELEASE-RUNBOOK.md`.

Key gates:
- Target Cloudflare Worker `rangkai-production` and R2 `rangkai-documents-prod`.
- Target Neon production database with PostGIS (separate from development branch).
- Strict release validator checking candidate commit pin and pre-deployment backups.
- No production migrations or deployments without external approval and verified pilot authority.


### Public assistant operational limits

The assistant sends questions and at most ten public event titles/IDs to the configured Gemini provider; do not include personal or confidential information in questions. It never loads private documents or arbitrary URLs. The local per-isolate rate limiter is not a distributed quota: configure and verify an edge rate limit before public enablement. Provider output is schema checked, restricted to retrieved identifiers, and never rendered as prose or URLs. Gemini availability and classification quality must be validated before enabling the feature. Location submitted for organizer waste planning remains private and is used only in the scoped request; facility distance is straight-line and does not imply route safety or acceptance.

### Cleanup photo-quality privacy

Assessment uses only task-scoped, authorized private evidence records; clients cannot supply object keys or URLs. Images go to Gemini only when the feature is explicitly enabled and an authorized user requests assessment. Object keys, raw image data and provider output are not logged or returned as source content. Photo uploads can contain metadata; operational use requires appropriate consent and review of the external provider data handling before enabling the feature.

The authenticated assistant is read-only and scopes event facts to current membership and assigned officer permissions. It sends only a question and selected event ID/title to the provider and does not expose documents, photos, contact lists, invitation tokens, secrets, or audit payloads. Permission is checked again after provider processing and before response. The isolate-local limiter is not a distributed cost guard; production enablement requires separate edge/cost controls and authorized provider verification.
