# Security, Privacy and Operations — Rangkai

Version: 0.1.0
Status: Draft

## 1. Security Principles

- Least privilege.
- Deny access by default.
- Validate at server boundaries.
- Separate public and private data.
- Keep secrets outside source code.
- Maintain traceability for critical changes.

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

## 3. Authentication

Use Better Auth with secure cookie sessions.

Requirements:

- HTTPS in production.
- HttpOnly session cookies.
- Secure cookie attributes.
- Appropriate SameSite policy.
- CSRF protection for cookie-based mutations.
- Session expiration and revocation.
- No shared banjar-wide PIN for privileged actions.

Invitation-based onboarding is preferred for MVP.

## 4. Multi-Tenant Isolation

Every private event belongs to an organization.

Protected queries must verify:

- Current authenticated user.
- Organization membership.
- Role or event assignment.
- Requested resource ownership.

Do not trust organizationId supplied by the browser.

## 5. File Security

Documents and cleanup photos are private R2 objects.

Upload controls:

- MIME/type validation.
- File-size limit.
- Safe object naming.
- Access checks.
- Rate limits.
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

- Event publication and cancellation.
- Road-status changes.
- Role assignment changes.
- Cleanup verification.
- Important edits after publication.

Protect logs from ordinary user modification.

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
