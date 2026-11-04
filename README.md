# Rangkai

AI-Assisted Cultural Event Coordination for Bali.

Rangkai is a web application for coordinating Balinese cultural
events that affect public roads and shared public spaces.

It helps organizers turn event announcements into verified
information, coordinate field operations, and document
post-event cleanup.

Built for the Bali DigiFest 2026 AI Web Innovation Challenge.

## Project Status

Development baseline / MVP in progress.

The architecture and product specifications are documented.
Features listed below are planned requirements and must not
be considered implemented until verified in the codebase.

## The Problem

Cultural events in Bali may involve:

- Temporary road closures.
- Processions affecting public traffic.
- Roadside parking arrangements.
- Cleanup of shared public spaces.

Information may be distributed through physical letters,
posters, and messaging groups.

Rangkai aims to make this information easier to prepare,
verify, update, and access.

The application is intended for events with actual
public-space impact, not every religious ceremony.

## Core Features

### 1. AI Document Extraction

Organizers upload event announcements as images or PDFs.

Gemini extracts candidate information such as:

- Event name.
- Date and time.
- Location.
- Affected roads.
- Procession details.
- Operational notes.

The extracted data is editable.

An organizer must verify information before publication.

### 2. Road Operations

Organizers select verified road segments and define
planned road impacts.

Assigned field officers can update operational status:

- Open.
- Intermittent access.
- Closed.
- Unconfirmed.

The public can view published updates without logging in.

Road status includes observation and expiry information.

### 3. Cleanup Coordination

Organizers create cleanup tasks.

Assigned officers can:

- Update task progress.
- Upload before/after evidence.
- Record waste quantities.
- Submit tasks for verification.

Organizers verify completed cleanup work.

Road reopening remains independent of cleanup verification.

## Product Boundaries

Rangkai does not:

- Issue official road-closure permits.
- Replace authorized traffic personnel.
- Guarantee traffic conditions or route safety.
- Automatically reopen roads.
- Certify religious or environmental compliance.
- Publish unverified AI results.

Information displayed in demo mode must be clearly
identified as simulated.

## Technology Stack

| Layer          | Technology                      |
| -------------- | ------------------------------- |
| Frontend       | React, Vite, TypeScript         |
| UI             | Tailwind CSS, shadcn/ui, Lucide |
| Routing        | React Router                    |
| Data fetching  | TanStack Query                  |
| Forms          | React Hook Form, Zod            |
| Backend        | Hono, Cloudflare Workers        |
| Authentication | Better Auth                     |
| Database       | Neon PostgreSQL                 |
| Geospatial     | PostGIS                         |
| ORM            | Drizzle ORM                     |
| File storage   | Cloudflare R2                   |
| Maps           | MapLibre GL JS                  |
| Map tiles      | MapTiler or approved provider   |
| AI             | Google Gemini multimodal API    |
| Testing        | Vitest, Playwright              |
| Deployment     | Cloudflare Workers              |

No Supabase or Vercel.

## Architecture

```mermaid
flowchart TD
    A[React + Vite Frontend]
    B[Hono API on Cloudflare Workers]
    C[Better Auth]
    D[Neon PostgreSQL + PostGIS]
    E[Cloudflare R2]
    F[Google Gemini API]
    G[MapLibre + Map Tiles]

    A --> B
    A --> G
    B --> C
    B --> D
    B --> E
    B --> F
```

The frontend and backend share one Cloudflare deployment.

Neon stores structured application data.

R2 stores private documents and photo evidence.

Gemini processes documents through the server-side API.

## Repository Structure

```text
rangkai/
├── AGENTS.md
├── README.md
├── docs/
│   ├── 00-README.md
│   ├── 01-PRD.md
│   ├── 02-SRS.md
│   ├── 03-ARCHITECTURE.md
│   ├── 04-ERD.md
│   ├── 05-AI-SPEC.md
│   ├── 06-API-CONTRACT.md
│   ├── 07-UX-FLOWS.md
│   ├── 08-SECURITY-OPS.md
│   ├── 09-TEST-PLAN.md
│   └── 10-DELIVERY-PLAN.md
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

This is the intended structure. Some directories may be
created progressively during implementation.

## Getting Started

### Prerequisites

Install:

- Node.js LTS compatible with the project toolchain.
- pnpm.
- Git.

Required accounts:

- Cloudflare.
- Neon.
- Google AI Studio.
- A map tile provider, if using hosted map tiles.

Check your environment:

```bash
node --version
pnpm --version
git --version
```

### 1. Clone the Repository

```bash
git clone <REPOSITORY_URL>
cd rangkai
```

Replace `<REPOSITORY_URL>` with the actual GitHub URL.

### 2. Install Dependencies

```bash
pnpm install
```

If the application has not been scaffolded, initialize
the Cloudflare React + Hono template first.

Official template:

```bash
pnpm create cloudflare@latest rangkai-starter \
  --template=cloudflare/templates/vite-react-template
```

Transfer the generated application files into the repository
without overwriting existing documentation or Git history.

### 3. Configure Environment Variables

Create `.dev.vars` in the project root.

Example:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"

BETTER_AUTH_SECRET="REPLACE_WITH_A_SECURE_RANDOM_SECRET"
BETTER_AUTH_URL="http://localhost:5173"

GEMINI_API_KEY="REPLACE_WITH_GEMINI_API_KEY"
```

Generate a random authentication secret using a suitable
cryptographic random generator.

For example:

```bash
openssl rand -base64 32
```

If using MapTiler, configure its browser key using the
frontend environment convention:

```dotenv
VITE_MAPTILER_KEY="REPLACE_WITH_PUBLIC_MAPTILER_KEY"
```

Vite exposes variables prefixed with `VITE_` to the browser.

Never place database credentials, Gemini API keys, or
authentication secrets in `VITE_` variables.

Restrict browser map keys by domain and usage quota.

Do not commit `.dev.vars` or production secrets.

### 4. Set Up Neon PostgreSQL

Create a Neon project.

Copy its connection string into `DATABASE_URL`.

Enable PostGIS in the Neon SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Verify:

```sql
SELECT PostGIS_Version();
```

Use a development database or Neon branch for local work.

### 5. Set Up Drizzle and Database

Ensure `drizzle.config.ts` is configured to read the
development database connection from `.dev.vars` (unpooled).

Generate and apply migrations, verify constraints, and seed development fixtures:

```bash
# Generate migrations from schemas
pnpm db:generate

# Apply migrations to development database
pnpm db:migrate

# Verify target Neon branch, PostGIS, tables, and constraints
pnpm db:verify

# Seed safe simulated development fixtures
pnpm db:seed
```

The schema is defined by `docs/04-ERD.md` and includes all domain tables
plus Better Auth authentication tables (`user`, `session`, `account`, `verification`).

### 6. Set Up Cloudflare R2

Authenticate with Cloudflare:

```bash
pnpm exec wrangler login
```

Create a development bucket:

```bash
pnpm exec wrangler r2 bucket create \
  rangkai-documents-dev
```

Add the binding to `wrangler.json`:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "rangkai_documents_dev",
      "bucket_name": "rangkai-documents-dev",
    },
  ],
}
```

Merge this section into the existing configuration.
Do not replace the entire file.

Regenerate Worker types:

```bash
pnpm exec wrangler types
```

Use a separate production bucket for deployed data.

### 7. Set Up Gemini

Create an API key:

https://aistudio.google.com/apikey

Save it as `GEMINI_API_KEY` in `.dev.vars`. Optionally set `GEMINI_MODEL` (defaults to `gemini-2.5-flash`).

Gemini must only be called from the backend.

The primary AI workflow is:

1. Upload announcement.
2. Store original document in R2.
3. Extract structured information.
4. Validate output with Zod.
5. Review and correct fields.
6. Publish verified information.

See `docs/05-AI-SPEC.md`.

### 8. Start Development

Run:

```bash
pnpm dev
```

The Cloudflare Vite plugin runs the frontend and Worker
in a local development environment.

Open the URL printed in the terminal.

For the standard Vite setup, this is commonly:

http://localhost:5173

Do not assume a fixed port if the terminal shows another.

### 9. Inspect Local Workers

Open:

http://localhost:5173/cdn-cgi/local/explorer

Replace the port if needed.

Local Explorer can inspect:

- Worker bindings.
- Local R2 objects.
- Request traces.
- Console logs.
- Supported local Cloudflare storage resources.

The API is available at:

`/cdn-cgi/local/explorer/api`

See `AGENTS.md` for debugging instructions.

### 10. Run Checks

Depending on the configured package scripts:

```bash
pnpm exec tsc -b
pnpm test          # vitest integration tests
pnpm lint
pnpm check         # build and dry-run deploy validation
pnpm exec playwright test
pnpm build
```

Install Playwright browser dependencies if required:

```bash
pnpm exec playwright install chromium
```

Tests must be implemented before they can pass.

### 11. Deploy to Cloudflare

Initial production deployment remains pending user authorization and remote resource provisioning.

To validate build and deployment readiness locally without remote deployment, run:

```bash
pnpm check
# or
pnpm exec wrangler deploy --dry-run
```

When authorized for production deployment:

```bash
pnpm deploy
```

Use the deploy script provided by the Cloudflare template.

Configure production:

- Neon database.
- R2 bucket.
- Gemini API key.
- Better Auth secret.
- Better Auth production URL.
- Map tile provider key.

Store sensitive production values using Cloudflare secrets.

Example:

```bash
pnpm exec wrangler secret put DATABASE_URL
pnpm exec wrangler secret put GEMINI_API_KEY
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put BETTER_AUTH_URL
```

Never deploy development credentials to production.

After deployment, verify the application using its
Cloudflare Workers URL or configured custom domain.

## User Roles

### Organizer

Can:

- Create and manage events.
- Upload documents.
- Review AI output.
- Select affected roads.
- Publish event information.
- Assign field officers.
- Verify cleanup tasks.

### Field Officer

Can perform only explicitly assigned actions:

- Update traffic status.
- Update cleanup tasks.
- Upload supporting evidence.
- Record waste quantities.

Permissions are scoped to the assigned event.

### Public

Can:

- Browse published events.
- View affected roads.
- Read current verified operational status.
- See update timestamps.

Public visitors do not need accounts.

## Event Lifecycle

```text
DRAFT
  |
  v
REVIEW
  |
  v
PUBLISHED
  |
  v
ACTIVE
  |
  v
COMPLETED
```

Cancellation is handled through an explicit event
cancellation action.

Road and cleanup workflows have independent states.

## API Overview

Planned application endpoints use `/api`.

Main groups:

```text
/api/auth/*
/api/events
/api/events/:eventId
/api/events/:eventId/documents
/api/events/:eventId/extractions
/api/events/:eventId/road-impacts
/api/road-impacts/:impactId/status
/api/events/:eventId/cleanup-tasks
/api/events/:eventId/waste-records
/api/public/events
/api/public/events/:slug
```

These routes describe the intended contract.

Check implementation status before assuming an endpoint exists.

Full specification:
`docs/06-API-CONTRACT.md`

## Development Roadmap

### Sprint 1 — Foundation

- Cloudflare setup.
- Neon and Drizzle.
- Better Auth.
- Organization membership.
- Event CRUD.
- Basic dashboard.

### Sprint 2 — AI Document Workflow

- R2 uploads.
- Gemini extraction.
- Structured JSON validation.
- Editable review interface.
- Manual fallback.

### Sprint 3 — Road Operations

- Verified road-segment dataset.
- PostGIS integration.
- MapLibre map.
- Event publication.
- Officer assignments.
- Live status updates.
- Public event page.

### Sprint 4 — Cleanup and Quality

- Cleanup tasks.
- Photo evidence.
- Waste records.
- Audit logs.
- Automated testing.
- Accessibility review.
- Deployment verification.
- Competition preparation.

## Testing Strategy

Use:

- Vitest for unit tests.
- Integration tests for APIs and database behavior.
- Playwright for browser end-to-end tests.
- An unseen document dataset for AI evaluation.

Critical test scenarios:

- AI returns missing or ambiguous fields.
- Organizer corrects extraction.
- Unauthorized officer attempts an update.
- Road status becomes stale.
- Gemini becomes unavailable.
- R2 upload fails.
- Public requests private documents.
- Cleanup verification does not reopen roads.

Never claim results without actual tests.

See `docs/09-TEST-PLAN.md`.

## Security

Core requirements:

- Server-side authorization.
- Organization and event isolation.
- Private R2 storage.
- HTTPS in production.
- Secure authentication sessions.
- Validated API requests.
- Auditable critical mutations.
- Secret management through Cloudflare.
- No sensitive information in public API responses.

See `docs/08-SECURITY-OPS.md`.

## Documentation

Read the documentation before implementation.

| Document                 | Description             |
| ------------------------ | ----------------------- |
| AGENTS.md                | Coding agent rules      |
| docs/00-README.md        | Documentation index     |
| docs/01-PRD.md           | Product requirements    |
| docs/02-SRS.md           | Software requirements   |
| docs/03-ARCHITECTURE.md  | Technical architecture  |
| docs/04-ERD.md           | Database design         |
| docs/05-AI-SPEC.md       | AI implementation       |
| docs/06-API-CONTRACT.md  | API contract            |
| docs/07-UX-FLOWS.md      | UX and screens          |
| docs/08-SECURITY-OPS.md  | Security and operations |
| docs/09-TEST-PLAN.md     | Testing strategy        |
| docs/10-DELIVERY-PLAN.md | Development roadmap     |

## Working with AI Coding Agents

Before asking an AI agent to implement a feature:

1. Make sure `AGENTS.md` is present.
2. Identify the relevant requirement.
3. Point the agent to the relevant documentation.
4. Define acceptance criteria.
5. Require testing and verification.
6. Review changes before merging.

Example task:

> Implement event creation based on FR-010 through FR-017
> in docs/02-SRS.md. Follow the database design in
> docs/04-ERD.md and API contract in docs/06-API-CONTRACT.md.
> Use the existing Hono, Drizzle, and Better Auth setup.
> Include validation, RBAC, tests, and error states.
> Do not implement unrelated features.

## Competition Deliverables

Bali DigiFest 2026 MVP submission preparation:

- Functional deployed web application.
- Public deployment URL.
- GitHub repository.
- AI implementation evidence.
- Proposal PDF within the official page limit.
- AI & Technology Disclosure.
- Test evidence.
- Demonstration using unseen inputs.

Verify all requirements against the final official
competition guidebook.

## Official Technical References

Cloudflare Workers:
https://developers.cloudflare.com/workers/

Cloudflare Vite Plugin:
https://developers.cloudflare.com/workers/vite-plugin/

Cloudflare R2:
https://developers.cloudflare.com/r2/

Neon:
https://neon.com/docs

Drizzle:
https://orm.drizzle.team/docs/overview

Better Auth:
https://www.better-auth.com/docs

Hono:
https://hono.dev/docs/

Gemini:
https://ai.google.dev/gemini-api/docs

MapLibre:
https://maplibre.org/maplibre-gl-js/docs/

TanStack Query:
https://tanstack.com/query/latest

shadcn/ui:
https://ui.shadcn.com/docs

## License

To be determined by the project team.

## Project Principle

Verified information over automated guesses.

Human control over critical operational decisions.

Practical functionality over unnecessary complexity.
