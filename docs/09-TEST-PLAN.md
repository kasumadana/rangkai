# Quality Assurance and Validation Plan — Rangkai

Version: 0.1.0
Status: Planned, not executed

## 1. Testing Objectives

Verify that Rangkai:

- Works end-to-end.
- Handles unseen documents.
- Enforces permissions.
- Does not publish guessed information.
- Recovers from external service failures.
- Remains usable on mobile devices.

## 2. Test Layers

Unit:

- Zod schemas.
- Date/time normalization.
- State transitions.
- Permission helpers.
- Road-status expiry logic.
- Waste quantity validation.

Integration:

- Hono endpoints.
- Deterministic health check endpoint (/api/health).
- Neon database queries and PostGIS verification (tests/integration/db.test.ts).
- Better Auth session and authentication endpoints (tests/integration/auth-events.test.ts).
- Origin and CSRF defense on application mutating requests (rejection of untrusted origins and simple form types).
- Fail-closed authentication configuration (high-entropy secrets, HTTPS URL requirement in production, 503 dependency errors).
- Strict ISO 8601 timestamp parsing with explicit timezone offset verification.
- Organization membership and RBAC authorization.
- Event assignment scoping and revocation (officers only receive assigned events in detail and listings).
- Event CRUD, bounded pagination, review state transition, road-impact publication gating (verified road segments requirement), and lifecycle cancellation with reason.
- Stale verification reset to draft on core field modification during review.
- Terminal state modification prevention (completed/cancelled).
- Idempotent publication retries without duplicate slug creation or audit duplication.
- Atomic database mutation + audit log batching with rollback verification.
- R2 upload lifecycle, stream-bounded size limits (8 MB documents, 5 MB photos), and rollback compensation.
- A05-A08 operational implementation integration suite (tests/integration/operations-a05-a08.test.ts) covering preflight Neon dev branch guard (`br-wandering-paper-aogdxs48`), synthetic fixture loaders (strictly unverified synthetic test data), document uploads, Gemini AI extraction with schema validation and rate limits, human field corrections, live road status idempotency and future timestamp rejection, cleanup lifecycle with officer task ownership and evidence prerequisites, and public API waste separation (`weighedKg` vs `estimatedKg`).

E2E:

- Playwright browser flows.
- Organizer workflow.
- Officer workflow.
- Anonymous public workflow.

AI evaluation:

- Unseen document dataset.
- Field-level metrics.
- Error categorization.

## 3. Critical Test Cases

TC-000: Health check endpoint returns 200 with service liveness payload (verified for direct invocations and browser navigation requests via workerd preview).
TC-001: Create and save draft event.
TC-002: Upload valid image.
TC-003: Reject oversized file.
TC-004: Extract structured fields from document.
TC-005: Handle missing event end time.
TC-006: Handle ambiguous road name.
TC-007: Correct AI output before publication.
TC-008: Prevent publication without required review.
TC-009: Publish event and access public page.
TC-010: Block anonymous access to private documents.
TC-011: Allow assigned officer traffic update.
TC-012: Reject unassigned officer traffic update.
TC-013: Mark expired road status unconfirmed.
TC-014: Submit cleanup evidence.
TC-015: Verify or reopen cleanup task.
TC-016: Keep cleanup state independent from road state.
TC-017: Handle Gemini timeout.
TC-018: Handle map tile failure.
TC-019: Handle database write failure.
TC-020: Prevent cross-organization data access.

## 4. AI Evaluation Protocol

Prepare an initial target of at least 20 permitted
documents with manually reviewed ground truth.

Include:

- Clean scans.
- Blurry photos.
- Missing dates.
- Multiple roads.
- Multiple event times.
- Similar road names.
- Conflicting or incomplete announcements.

Do not use all evaluation samples in prompt examples.

For each field, record:

- Ground truth.
- AI output.
- Exact match or error.
- Human correction.
- Error category.

For road names, calculate precision, recall, and F1.
For dates, evaluate exact normalized datetime match.

Do not claim a performance threshold is achieved
before measuring it.

## 5. Usability Validation

Target participants:

- 2 organizers or committee members.
- 2 field officers.
- 2 public road users.
- Additional participants if available.

Tasks:

- Create an event.
- Correct an AI field.
- Select an affected road.
- Update road status.
- Find a road closure.
- Complete a cleanup task.

Measure:

- Task completion.
- Time on task.
- Errors.
- Clarification requests.
- Observed usability problems.

These are recruitment targets, not completed interviews.

## 6. Performance Testing

Initial targets:

- Public page initial load < 3 seconds.
- Non-AI API p95 < 800 ms.
- Public status polling <= 30 seconds.
- No blocking UI during extraction.
- No unhandled errors on low-end mobile devices.

Test using realistic network throttling.
Report actual results separately from targets.

## 7. Security Testing

- Authentication bypass.
- Cross-tenant access.
- Unauthorized role escalation.
- Direct access to private R2 objects.
- Invalid MIME upload.
- Oversized upload.
- Duplicate status mutation.
- CSRF protection.
- Injection and malformed input.
- Sensitive data leakage in public APIs.

## 8. Accessibility Testing

- Keyboard-only navigation.
- Screen-reader labels.
- Focus visibility.
- Color contrast.
- Mobile zoom.
- Error-message association.
- Map alternatives.
- Status text without color dependence.

Target: WCAG 2.2 AA.

## 9. Field Pilot

Use one real event only with appropriate permission.

Before:

- Observe announcement preparation.
- Record baseline process and time.
- Verify road and cleanup responsibilities.

During:

- Record actual status updates.
- Compare system status with field observations.

After:

- Verify task completion.
- Record measured waste quantities if available.
- Interview operators.

Do not use a simulated event to claim real impact.

## 10. Release Gate

PASS requires:

- All P0 user journeys complete.
- All critical authorization tests pass.
- No public exposure of private documents.
- Manual fallback works when AI fails.
- Status expiry works.
- No false success after failed writes.
- Production URL loads.
- Test evidence is documented.

Any failed critical security or integrity test blocks release.
