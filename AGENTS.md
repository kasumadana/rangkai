# Rangkai — AI Coding Agent Instructions

> AI-Assisted Cultural Event Coordination for Bali.
> This file defines mandatory rules for all coding agents working
> on Rangkai.

## 1. Project Identity

Rangkai is a web application that helps authorized organizers
coordinate Balinese cultural events affecting public spaces.

It supports three phases:

1. Pre-event: upload announcements, extract information with AI,
   review details, map affected roads, and publish information.
2. Live event: authorized field officers update road status.
3. Post-event: cleanup officers document tasks, evidence, and
   waste handling.

Rangkai is an operational coordination tool.

It is NOT:

- An official road-closure permit system.
- A replacement for police, Dishub, or pecalang authority.
- A real-time traffic monitoring service.
- A guarantee that alternative routes are safe.
- A religious compliance certification system.
- An automated road-reopening decision system.

Never represent simulated information as real operational data.

## 2. Mandatory Documentation

Read `docs/00-README.md` before starting development.

Documentation structure:

| File                     | Responsibility                             |
| ------------------------ | ------------------------------------------ |
| docs/00-README.md        | Documentation index and conventions        |
| docs/01-PRD.md           | Product goals, users, scope, priorities    |
| docs/02-SRS.md           | Functional and non-functional requirements |
| docs/03-ARCHITECTURE.md  | Architecture and technology decisions      |
| docs/04-ERD.md           | Database entities and relationships        |
| docs/05-AI-SPEC.md       | AI extraction and evaluation               |
| docs/06-API-CONTRACT.md  | API endpoints and response contracts       |
| docs/07-UX-FLOWS.md      | Information architecture and UX            |
| docs/08-SECURITY-OPS.md  | Security, privacy, operations              |
| docs/09-TEST-PLAN.md     | Testing and acceptance criteria            |
| docs/10-DELIVERY-PLAN.md | Sprints and competition deliverables       |

Read only the documents relevant to the current task,
plus the architecture and security specifications when needed.

Do not assume the documents perfectly match existing code.
Inspect the repository before modifying implementation.

If documentation conflicts with implementation:

1. Identify the discrepancy.
2. Determine the intended behavior.
3. Ask for clarification when the decision changes product scope.
4. Update documentation and implementation consistently.

## 3. Source of Truth

Product scope:
`docs/01-PRD.md`

Functional behavior:
`docs/02-SRS.md`

Architecture:
`docs/03-ARCHITECTURE.md`

Database:
`docs/04-ERD.md`

AI behavior:
`docs/05-AI-SPEC.md`

HTTP contracts:
`docs/06-API-CONTRACT.md`

Security:
`docs/08-SECURITY-OPS.md`

Tests:
`docs/09-TEST-PLAN.md`

Never invent missing requirements.

Classify claims as:

- FACT: Supported by evidence.
- ASSUMPTION: Requires validation.
- TARGET: Planned performance or outcome.
- DECISION: Approved implementation choice.

Never present assumptions or targets as measured results.

## 4. Mandatory Technology Stack

### Frontend

- React
- Vite
- TypeScript
- React Router
- TanStack Query
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- React Hook Form
- Zod
- MapLibre GL JS

### Backend

- Cloudflare Workers
- Hono
- TypeScript
- Zod
- Better Auth

### Database

- Neon PostgreSQL
- PostGIS
- Drizzle ORM
- Drizzle Kit

### Storage

- Cloudflare R2

### Artificial Intelligence

- Google Gemini multimodal API
- Structured JSON extraction
- Zod validation
- Human-in-the-loop verification

### Testing

- Vitest
- Playwright
- TypeScript type checking

### Package Manager

Use pnpm.

Do not introduce alternative package managers without approval.

### Deployment

- Cloudflare Workers
- Cloudflare Static Assets through the Vite plugin
- Neon production database
- Cloudflare R2 production bucket

Do NOT introduce:

- Supabase
- Vercel
- Firebase
- A second backend framework
- A separate application server without justification

Prefer one Cloudflare deployment for the React SPA and Hono API.

Do not add new infrastructure merely for convenience.

## 5. Cloudflare Workers — Mandatory Fresh Documentation

STOP.

Knowledge of Cloudflare Workers APIs, runtime behavior,
compatibility, pricing, and limits may be outdated.

Before implementing, modifying, debugging, or configuring
Cloudflare Workers or related Cloudflare products, retrieve
the current official documentation.

This applies to:

- Workers
- KV
- R2
- D1
- Durable Objects
- Queues
- Vectorize
- Workers AI
- Agents SDK
- Workflows
- Cloudflare Vite plugin
- Wrangler
- Static Assets
- Runtime bindings

Do not rely exclusively on model memory.

### Official Documentation

Workers:
https://developers.cloudflare.com/workers/

Cloudflare MCP:
https://docs.mcp.cloudflare.com/mcp

Workers + Vite:
https://developers.cloudflare.com/workers/vite-plugin/

Workers + React:
https://developers.cloudflare.com/workers/framework-guides/web-apps/react/

Workers + Hono:
https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/

Local Explorer:
https://developers.cloudflare.com/workers/local-development/local-explorer/

### Limits and Quotas

Always retrieve limits from the relevant product's
official `/platform/limits/` documentation page.

Workers:
https://developers.cloudflare.com/workers/platform/limits/

Do not hardcode remembered limits for:

- CPU time
- Memory
- Requests
- Subrequests
- Worker size
- Storage
- R2 operations
- Queues
- Durable Objects
- Other product quotas

Verify the current limits and the account plan before
making architectural decisions.

If documentation cannot be retrieved:

- Do not invent API signatures or limits.
- State what remains unverified.
- Request verification before risky changes.

## 6. Cloudflare Commands

| Command               | Purpose                                |
| --------------------- | -------------------------------------- |
| `pnpm dev`            | Main local development with Vite       |
| `pnpm build`          | Build frontend and Worker              |
| `pnpm deploy`         | Build and deploy using project scripts |
| `npx wrangler dev`    | Direct Worker local development        |
| `npx wrangler deploy` | Deploy Worker/build output             |
| `npx wrangler types`  | Generate TypeScript binding types      |
| `npx wrangler tail`   | Inspect deployed Worker logs           |

For this React + Hono + Vite application, prefer `pnpm dev`
for normal full-stack development.

Use direct Wrangler commands when appropriate for
Worker-specific tasks.

Inspect `package.json` before assuming a script exists.

IMPORTANT:
Run `wrangler types` after changing bindings in
`wrangler.jsonc`.

Never overwrite an existing Wrangler configuration without
preserving its required settings.

## 7. Cloudflare Local Explorer

When running `npx wrangler dev` or a supported Cloudflare
Vite development server, Local Explorer can inspect local
Workers, bindings, storage, logs, and request traces.

The development server prints its local URL.

Browser interface:

`<base>/cdn-cgi/local/explorer`

API base:

`<base>/cdn-cgi/local/explorer/api`

Use the actual URL and port printed by the dev server.

### Useful Endpoints

| Endpoint                                                             | Description                     |
| -------------------------------------------------------------------- | ------------------------------- |
| `GET /cdn-cgi/local/explorer/api/local/workers`                      | List local Workers and bindings |
| `GET /cdn-cgi/local/explorer/api/storage/kv/namespaces`              | List KV namespaces              |
| `GET /cdn-cgi/local/explorer/api/d1/database`                        | List D1 databases               |
| `GET /cdn-cgi/local/explorer/api/r2/buckets`                         | List R2 buckets                 |
| `GET /cdn-cgi/local/explorer/api/workers/durable_objects/namespaces` | List Durable Object namespaces  |
| `GET /cdn-cgi/local/explorer/api/workflows`                          | List Workflows                  |
| `POST /cdn-cgi/local/explorer/api/local/observability/query`         | Query captured traces and logs  |
| `POST /cdn-cgi/local/explorer/api/local/observability/clear`         | Clear captured traces and logs  |

Endpoints can change between versions.

Check the current Local Explorer documentation and
the running server's API schema before using them.

### Observability Query

The observability query endpoint supports read-only SQL
queries, including SELECT and WITH.

Available telemetry tables include:

- `spans`
- `logs`

Inspect structured attributes using `json(attributes)`.

Example:

```bash
curl -X POST \
  "http://localhost:5173/cdn-cgi/local/explorer/api/local/observability/query" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT service, name, outcome, duration_ms FROM spans WHERE parent_id IS NULL LIMIT 20"
  }'
```

Replace the base URL with the active development URL.

Use Local Explorer to:

- Inspect Worker bindings.
- Verify local R2 objects.
- Debug failed API requests.
- Inspect traces and logs.
- Diagnose binding configuration issues.
- Verify local storage state.

Local Explorer does not replace direct inspection of Neon,
which is an external PostgreSQL service.

Do not expose Local Explorer to public networks.

### Full OpenAPI Schema

If the documented endpoints are insufficient:

`GET /cdn-cgi/local/explorer/api`

Fetch the full schema only as a last resort because it
may be large.

## 8. Cloudflare Node.js Compatibility

Official documentation:

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

Cloudflare Workers is not a traditional Node.js server.

Before using Node.js-specific APIs or dependencies:

1. Check current Workers runtime support.
2. Check compatibility flags.
3. Confirm the library works inside workerd.
4. Test the actual feature in the Workers runtime.
5. Avoid unsupported filesystem or TCP assumptions.

Do not assume a package works merely because it works
under Node.js locally.

Prefer Web Standard APIs when practical.

## 9. Cloudflare Errors

Error 1102:
CPU or memory limits may have been exceeded.

Check:
https://developers.cloudflare.com/workers/platform/limits/

All Workers errors:
https://developers.cloudflare.com/workers/observability/errors/

When debugging:

1. Reproduce the issue.
2. Inspect Worker logs and traces.
3. Inspect relevant bindings.
4. Retrieve current documentation.
5. Identify the root cause.
6. Apply the smallest safe fix.
7. Run regression tests.

Do not blindly increase retries or hide errors.

## 10. Cloudflare Product References

Retrieve current API references from:

- https://developers.cloudflare.com/kv/
- https://developers.cloudflare.com/r2/
- https://developers.cloudflare.com/d1/
- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/queues/
- https://developers.cloudflare.com/vectorize/
- https://developers.cloudflare.com/workers-ai/
- https://developers.cloudflare.com/agents/
- https://developers.cloudflare.com/workflows/

### Conditional Best Practices

If Durable Objects are introduced, read:

https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

If Workflows are introduced, read:

https://developers.cloudflare.com/workflows/build/rules-of-workflows/

Do not introduce Durable Objects, Workflows, KV, D1,
Vectorize, or Workers AI into Rangkai without a documented
product need and an architecture decision.

Neon remains the primary database.

## 11. Repository Structure

Follow the Cloudflare React + Hono template structure.

Expected structure:

```text
rangkai/
├── AGENTS.md
├── README.md
├── docs/
├── src/
│   ├── react-app/
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       ├── features/
│   │       ├── lib/
│   │       └── pages/
│   ├── worker/
│   │   ├── index.ts
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── services/
│   │   └── validators/
│   └── db/
│       ├── schema/
│       └── auth-schema.ts
├── drizzle/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── wrangler.jsonc
├── drizzle.config.ts
├── vite.config.ts
└── package.json
```

This is the target structure, not proof that every file
already exists.

Preserve the generated template structure when possible.

Group frontend code by product feature rather than
creating unnecessary abstraction layers.

## 12. Product Scope and Priorities

### P0 — Required MVP

- Authentication and organization membership.
- Event creation and management.
- Private document upload to R2.
- Gemini structured document extraction.
- Human review and correction.
- Verified road-segment selection.
- Event publication.
- Public event information and map.
- Assigned field officer road-status updates.
- Cleanup tasks and photo evidence.
- Waste quantity records.
- Audit logs.
- Error handling and manual fallback.

### P1 — After Stable MVP

- Overlapping closure detection.
- Validated route suggestions.
- Notifications.
- Better road-name matching.
- Offline-friendly draft updates.

### P2 — Research Backlog

- Waste prediction with historical labeled data.
- Computer vision cleanup assistance.
- Advanced procession tracking.
- Government system integrations.

Do not implement P1 or P2 while critical P0 flows
are incomplete.

## 13. Core Domain Invariants

### Events

Event lifecycle:

DRAFT -> REVIEW -> PUBLISHED -> ACTIVE -> COMPLETED

Cancellation is a separate explicit transition.

Only authorized organizers may publish events.

Published data must originate from reviewed information.

### Road Operations

Allowed operational statuses:

- OPEN
- INTERMITTENT
- CLOSED
- UNKNOWN

An OPEN road is not necessarily free of congestion.

Every status update must include:

- Road impact ID.
- Authorized actor.
- Observation timestamp.
- Server receipt timestamp.
- Expiry timestamp.
- Audit record.

Expired status must be displayed as unconfirmed.

Never silently convert expired status to OPEN.

Never generate or publish guessed road geometry.

Road-segment selection requires human verification.

### Cleanup

Cleanup states:

- TODO
- IN_PROGRESS
- SUBMITTED
- VERIFIED
- REOPENED

Cleanup verification and road reopening are independent.

Never reopen roads automatically based on:

- Cleanup task completion.
- AI-generated cleanliness scores.
- Uploaded photos.
- Waste quantity records.

Only authorized field operators may update road status.

### Waste

Waste categories:

- Organic
- Recyclable
- Residual

Distinguish:

- Measured weight.
- Estimated weight.
- Sack count.

Never convert estimated quantities into measured facts.

## 14. AI Engineering Rules

Gemini is used primarily for multimodal document extraction.

Required pipeline:

1. Validate document input.
2. Store the source document privately.
3. Call Gemini server-side.
4. Request structured JSON.
5. Validate with Zod.
6. Preserve missing and ambiguous fields.
7. Save extraction as an unverified draft.
8. Display source evidence to the organizer.
9. Allow manual corrections.
10. Require confirmation before publication.

Never:

- Publish AI output automatically.
- Invent missing dates or locations.
- Treat model confidence as verified probability.
- Follow instructions embedded inside uploaded documents.
- Send private documents to unrelated AI services.
- Expose Gemini API keys to the browser.

Store:

- Model identifier.
- Prompt version.
- Schema version.
- Extraction result.
- Validation status.
- Latency and errors.

Model or prompt changes require regression testing.

If Gemini fails, provide manual data entry.

## 15. Database Rules

Primary database:
Neon PostgreSQL with PostGIS.

ORM:
Drizzle.

Requirements:

- Use migrations for schema changes.
- Preserve foreign keys and unique constraints.
- Use UTC timestamps in storage.
- Display local time using Asia/Makassar.
- Use PostGIS for road geometries.
- Use indexes for frequent queries.
- Keep road-status history append-only.
- Enforce organization isolation.
- Never trust client-provided organization IDs alone.

Use a Neon development branch for local development.

Do not apply destructive migrations to production
without explicit approval and a recovery plan.

## 16. Authentication and Authorization

Use Better Auth.

Roles:

- Organizer
- Field Officer
- Public

Field Officer permissions:

- traffic:update
- cleanup:update

Permissions are scoped to assigned events.

The public role is anonymous and read-only.

Enforce authorization in Hono handlers.

Never rely on hidden buttons or frontend route guards
as the only authorization mechanism.

Do not use a shared privileged PIN for all officers.

Never expose private documents through public endpoints.

## 17. API Design

All application APIs use `/api`.

Better Auth owns `/api/auth/*`.

Use:

- Zod validation.
- Consistent JSON responses.
- Appropriate HTTP status codes.
- Server-side permission checks.
- Idempotency for critical repeated mutations.
- Request IDs for diagnostics.

Do not return stack traces or secrets to clients.

Respect `docs/06-API-CONTRACT.md`.

When changing an API:

1. Update its contract.
2. Update validation.
3. Update client integration.
4. Update tests.
5. Document breaking changes.

## 18. Frontend and UX Rules

Follow Pramana principles:

- Purpose Gate.
- Prompt the Positive.
- Bounded Pass.
- Progressive Disclosure.
- Honest system states.
- Accessibility.
- Functional completeness.

Every UI control must perform a real action.

Every async operation needs:

- Loading state.
- Success state.
- Error state.
- Retry or recovery path where applicable.

Every data view needs:

- Empty state.
- Missing-data handling.
- Stale-data handling where applicable.

Never show fake success before server confirmation.

Never show mock live closures as real operational data.

Prioritize:

- Mobile usability.
- Readable typography.
- Clear status labels.
- Keyboard navigation.
- WCAG 2.2 AA target.
- Text alternatives to maps.
- Accessible form errors.

Avoid unnecessary animations, dashboard widgets,
or decorative AI interfaces.

## 19. Security and Privacy

Never commit:

- API keys.
- Database credentials.
- Session secrets.
- `.dev.vars`
- `.env`
- Production access tokens.

Use Cloudflare secrets for production.

Use separate development and production resources.

Private documents and cleanup photos belong in R2
with controlled access.

Validate:

- File type.
- File size.
- Resource ownership.
- User permissions.
- Request payloads.

Protect against:

- Cross-organization access.
- Privilege escalation.
- CSRF.
- Unsafe uploads.
- Duplicate mutations.
- Sensitive information leaks.
- Prompt injection through documents.

Do not log private document contents or credentials.

Follow `docs/08-SECURITY-OPS.md`.

## 20. Testing Requirements

Use Vitest for unit and integration tests.

Use Playwright for browser end-to-end tests.

Critical scenarios:

- Organizer creates a draft.
- Document upload succeeds.
- Gemini extraction produces editable fields.
- Ambiguous information requires review.
- Organizer publishes verified information.
- Public views the published event.
- Assigned officer updates road status.
- Unassigned officer receives 403.
- Stale status becomes unconfirmed.
- Cleanup evidence is submitted.
- Organizer verifies cleanup.
- Cleanup does not reopen roads.
- AI failure allows manual entry.
- Private documents remain inaccessible publicly.

Never claim a test passed unless it was executed.

Never fabricate:

- AI accuracy.
- Performance measurements.
- User interviews.
- Pilot results.
- Impact metrics.

## 21. Definition of Done

A feature is complete only when:

- It maps to a documented requirement.
- The main workflow works.
- Inputs are validated.
- Permissions are enforced.
- Loading, empty, and error states work.
- Relevant tests pass.
- No sensitive data is exposed.
- Documentation is updated.
- The implementation works in the intended runtime.

A feature is not complete merely because it renders.

## 22. Required Development Workflow

For every task:

1. Understand the user request.
2. Read relevant project documentation.
3. Inspect existing implementation.
4. Retrieve current external documentation when needed.
5. Identify the smallest coherent change.
6. Implement with existing project conventions.
7. Add or update tests.
8. Run available checks.
9. Review security and error behavior.
10. Update affected documentation.
11. Summarize changes and remaining limitations.

Before coding, answer:

- Which user problem does this solve?
- Which requirement ID supports it?
- What inputs and outputs are expected?
- Who is authorized?
- What happens when data is missing?
- What happens when an external service fails?
- How will the result be verified?

If the answer is unclear, clarify the requirement first.

## 23. Coding Standards

- Use TypeScript strict mode.
- Prefer explicit types at public boundaries.
- Validate untrusted data with Zod.
- Keep functions focused.
- Prefer composition over unnecessary abstraction.
- Reuse existing project conventions.
- Avoid `any` unless justified.
- Do not suppress TypeScript errors without explanation.
- Do not add dependencies without a clear need.
- Do not modify unrelated code.
- Avoid premature optimization.
- Keep database operations predictable.
- Keep secrets server-side.
- Use clear, consistent naming.

Do not implement placeholder features disguised as finished UI.

## 24. Agent Reporting Format

After completing a task, report:

1. What changed.
2. Which files changed.
3. Which requirements were addressed.
4. Which tests or commands were executed.
5. Which tests passed or failed.
6. Any known limitations.
7. The next recommended development step.

Do not claim deployment, tests, or migrations succeeded
without actual execution evidence.

## 25. Final Rule

Build a practical, reliable, testable MVP.

Prioritize verified operational information over
speculative AI capabilities.

When uncertain, preserve human control and make
the uncertainty visible.
