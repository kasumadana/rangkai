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

## 15. Release Runbook & Operational Verification (ROADMAP A10)

### 15.1 Release Prerequisites & Pending Production Inputs
Production deployment requires explicitly provisioned remote Cloudflare and Neon resources, accompanied by verified secret readiness and formal authorization.
Never commit secrets to git or pass secret values directly in CLI flags.

| Resource / Setting | Requirement | Status | Supply Mechanism |
|---|---|---|---|
| Cloudflare Account ID | Dedicated production Cloudflare account | **UNRESOLVED** | Account provisioned in Cloudflare dashboard |
| Production Worker | Worker `rangkai-production` configured | **PREPARED** | Defined in `wrangler.json` (`env.production`) |
| Production Domain (`BETTER_AUTH_URL`) | Canonical HTTPS custom domain (e.g. `https://rangkai.id`) | **UNRESOLVED** | DNS & custom domain configured in Cloudflare |
| Production R2 Bucket | Bucket `rangkai-documents-prod` created in Cloudflare R2 | **UNPROVISIONED** | `pnpm exec wrangler r2 bucket create rangkai-documents-prod` |
| Production Neon Database | Dedicated production database branch (separate from `br-wandering-paper-aogdxs48`) | **UNRESOLVED** | Created in Neon console; PostGIS enabled |
| `DATABASE_URL` Secret | Production Neon PostgreSQL connection string (unpooled, with PostGIS) | **PENDING** | `pnpm exec wrangler secret put DATABASE_URL --env production` |
| `BETTER_AUTH_SECRET` Secret | Cryptographically secure random secret (>= 32 characters) | **PENDING** | `pnpm exec wrangler secret put BETTER_AUTH_SECRET --env production` |
| `GEMINI_API_KEY` Secret | Google Gemini API key with access to `gemini-3.5-flash-lite` | **PENDING** | `pnpm exec wrangler secret put GEMINI_API_KEY --env production` |
| Production Migration Authorization | Formal approval with assigned migration owner and backup checkpoint | **WITHHELD** | Coordinator approval; see Section 15.3 |
| Production Deployment Authorization | Formal authorization to execute live production deployment | **WITHHELD** | Coordinator approval |

### 15.2 Environment Isolation, Build-Time Selection & Artifact Inspection (Finding F1)
Cloudflare Workers Vite plugin requires environment selection at **build time** (`CLOUDFLARE_ENV=production`) so that environment-specific names and bindings (Worker name `rangkai-production`, R2 bucket `rangkai-documents-prod`) are correctly flattened into `dist/rangkai/wrangler.json`.

> [!WARNING]
> Running `wrangler deploy --dry-run --env production` against a default development build is a dangerous anti-pattern: the deploy-time `--env` flag **cannot** alter the already flattened Vite configuration, resulting in packaging and deploying the development artifact (`rangkai-documents-dev`). Build-time environment selection must be asserted before packaging.

**Build and Packaging Commands:**
1. **Development Build (Default):**
   ```bash
   pnpm build
   ```
   *Generates development artifact with Worker `rangkai` and R2 bucket `rangkai-documents-dev`.*

2. **Production Build (Build-Time Selection):**
   - Cross-platform npm script:
     ```bash
     pnpm run build:prod
     ```
   - Valid PowerShell syntax:
     ```powershell
     $env:CLOUDFLARE_ENV = "production"
     pnpm build
     Remove-Item Env:\CLOUDFLARE_ENV
     ```
   - Valid POSIX / Bash syntax:
     ```bash
     CLOUDFLARE_ENV=production pnpm build
     ```

3. **Artifact Configuration Inspection (Fail-Closed Gate):**
   ```bash
   pnpm exec tsx scripts/release-validator.ts --check-artifact production
   ```
   *Inspects `dist/rangkai/wrangler.json` and asserts `name === "rangkai-production"` and `r2_buckets` contains `rangkai-documents-prod`. Fails closed with exit code 1 independently of readiness flags if a development artifact is detected or if artifact config is missing.*

4. **Safe Packaging Dry-Run:**
   ```bash
   pnpm exec wrangler deploy --dry-run --env production
   ```
   *Validates bundle packaging and verifies access to `env.rangkai_documents_dev (rangkai-documents-prod)` without provisioning or deploying resources.*

### 15.3 Database Migration Preparation, Backup Checkpoint & Disaster Recovery (Finding F3)
Database migrations and application deployments must be decoupled. The application runtime guard (`src/db/guard.ts`) intentionally restricts local migration commands (`pnpm db:migrate`) and local verification (`pnpm db:verify`) to the development Neon branch `br-wandering-paper-aogdxs48` to prevent accidental developer runs against production.

**Production Migration Prerequisites & Independent Binding:**
1. **Designated Migration Owner:** A named release engineer/DBA responsible for the migration run.
2. **Pre-Migration Neon Backup Checkpoint:**
   - Before executing any DDL schema change on production, create a Neon point-in-time snapshot / restore branch.
   - Record the snapshot ID (`backupCheckpointId`) and timestamp in the release audit ledger.
3. **Recovery Rehearsal & Target-Bound Read-Only Verification:**
   - The local verification command (`pnpm db:verify`) is strictly guarded to the authorized development branch (`br-wandering-paper-aogdxs48`) and must **not** be represented as working on an arbitrary restore branch. The dev guard remains intact and is never bypassed.
   - For production recovery rehearsal, a separately authorized, target-bound read-only procedure must be executed:
     a. An isolated restore branch is created from the pre-migration Neon snapshot.
     b. An authorized migration owner executes direct read-only catalog assertions (querying `information_schema.tables`, column definitions, PostGIS extension status, and the `__drizzle_migrations` schema tracking table) against the restore branch.
     c. Verified catalog assertion output, owner identity, snapshot ID, and timestamp are preserved as recovery evidence.
4. **Distinction Between Worker Rollback and Database Restore:**
   - `wrangler rollback <VERSION_ID>` **only** reverts the Cloudflare Worker script and static client assets.
   - Worker rollback **does not restore database state, tables, or columns**.
   - If a breaking schema issue occurs, database recovery must be executed via Neon point-in-time branch restore.
5. **Release Manifest Validation & Independent Binding Gate:**
   - **Enforcing Release Gate (Fails closed by default with exit code 1):**
     ```bash
     pnpm run validate:release
     ```
     *Evaluates release readiness. Fails closed with exit code 1 if the manifest is missing, invalid, contains unresolved prerequisites, or if candidate SHA / expected resource identities mismatch.*
   - **Optional Report-Only Mode (Exits code 0 while reporting pending items):**
     ```bash
     pnpm run validate:release:report
     # or: pnpm exec tsx scripts/release-validator.ts --check-manifest release-manifest.template.json --report-only
     ```
   - **Candidate & Expected Resource Binding:**
     Candidate commit must be a valid 40-character hex commit SHA. The release validator strictly compares the candidate commit against an independently supplied approved pin (`--approved-pin <SHA>`) and explicit expected production identities (`--expected-account`, `--expected-worker`, `--expected-domain`, `--expected-r2`, `--expected-neon-branch`). Approval is never inferred from the manifest being validated itself.
   - **Template & Circular SHA Elimination:**
     `release-manifest.template.json` is committed as an unresolved template with `candidateCommit: null`. Post-freeze local manifests (`release-manifest.json`) are gitignored to eliminate circular commit SHA changes. Production readiness remains strictly BLOCKED until all external prerequisites are fulfilled.

### 15.4 Guarded Release Smoke Verification (Finding F2)
The release smoke procedure verifies process health, asset routing, authentication, RBAC boundaries, document/photo R2 storage, cleanup workflow, waste records, and public aggregates.

```bash
pnpm smoke
```

The smoke procedure executes two distinct, honestly labelled phases:
1. **Part 1: Isolated In-Process Boundary Probes:**
   - Direct Hono `app.request` invocations in Node with an in-memory mock R2 bucket (9 probes).
   - Verifies `/api/health`, structured error envelopes on unhandled `/api/*`, public event anonymity, 401 unauthenticated rejections, and graceful 503 handling when database configuration is absent.
2. **Part 2: Guarded Workerd Runtime Integration Suite:**
   - Reuses `tests/integration/health.test.ts` (17 tests total: 2 Node helper/liveness tests + 15 workerd preview transport/browser tests) against the actual Vite workerd preview server.
   - Verifies same-origin SPA HTML fallback (`/` and `/dashboard`), transport headers (`Sec-Fetch-Mode: navigate`), HttpOnly session cookies via Better Auth, CSRF protection (403), real workerd local R2 document and cleanup photo upload/download (`rangkai_documents_dev`), unverified road segment attachment/publication rejection (422), cleanup task lifecycle (in_progress -> submitted -> verified), waste recording, public cleanup summary aggregates, session revocation on sign-out, and headless Chrome browser execution via CDP.
   - **Total Smoke Verification:** 26 checks (11 Node checks + 15 workerd runtime checks).
   - **Safety Boundary:** All mutations run in isolated synthetic namespaces on the verified development database branch (`br-wandering-paper-aogdxs48`) and local preview server. No mutation is ever directed at generic or unverified production URLs.

### 15.5 Deployment & Rollback Runbook (Authorized Execution Only)
Execution of deployment commands requires explicit written authorization from the project coordinator following verification of all prerequisites in Sections 15.1–15.4.

- **Deploy:** `pnpm exec wrangler deploy --env production` (requires explicit production authorization).
- **Inspect Live Logs:** `pnpm exec wrangler tail --env production`.
- **Version List:** `pnpm exec wrangler versions list --env production`.
- **Worker Script Rollback:** `pnpm exec wrangler rollback <VERSION_ID> --env production` *(Note: does not restore database schema or data)*.

### 15.6 Release Gates Status
- **Backend Software Preparation (A10 Backend):** **PASS** — Build-time production environment selection verified, generated artifact validated (`rangkai-production`, `rangkai-documents-prod`), enforcing fail-closed release manifest validator implemented with independent pin/resource binding, guarded workerd runtime smoke suite verified (26 checks), and safe dry-run executable.
- **Production Deployment (A10 Production):** **BLOCKED** — Cloudflare account unresolved, production domain unconfigured, production R2 bucket unprovisioned, dedicated production Neon branch unprovisioned, production secrets unconfigured, and production deployment authorization withheld.
- **Frontend Delivery (B09):** **PENDING** — Remote frontend repository contains only the starter template (Roadmap B01-B03 discrepancy); full browser UI release is blocked pending B09.
- **Teammate Regression (C09):** **PENDING** — Teammate independent QA results remain unexecuted.
