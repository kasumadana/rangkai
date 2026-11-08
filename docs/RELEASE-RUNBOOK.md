# Production Release & Deployment Runbook — Rangkai

> Version: 1.0.0-rc  
> Status: Release Candidate Gate (Pending External Resource Provisioning & Final Audit)  
> Target Commit Binding: Exact approved candidate SHA required  

---

## 1. Scope and Authority

This runbook establishes the fail-closed operational procedure for provisioning, validating, migrating, and deploying Rangkai to production environments.

> [!IMPORTANT]
> **Production Resource Gate:**  
> Neither production Cloudflare credentials, production Neon connection strings, nor official government/dishub operational authority IDs are bundled into this codebase. All production targets described herein are required operational prerequisites that must be provisioned and approved externally prior to deployment.

---

## 2. Target Resource Architecture

### 2.1 Neon PostgreSQL Production Database
- **Role:** Primary transactional database with PostGIS spatial extensions.
- **Isolation Constraint:** Must be an independent Neon production project or designated protected production branch. Never deploy against the development branch (`br-wandering-paper-aogdxs48`).
- **Connection Mode:** Neon connection pooler URL (`sslmode=require`) with high-entropy role password.
- **Extensions Required:** `postgis` (v3.0+), `uuid-ossp` or native `gen_random_uuid()`.

### 2.2 Cloudflare Infrastructure
- **Worker Service:** `rangkai-production` (configured via `dist/rangkai/wrangler.json`).
- **Static Assets:** React SPA compiled to `dist/client/`, served via Cloudflare Workers Static Assets.
- **R2 Storage Bucket:** `rangkai-documents-prod` (private bucket; public directory listing disabled).
- **Canonical Origin:** Designated production domain (e.g., `https://rangkai.id`).
- **Required Cloudflare Secrets (`wrangler secret put`):**
  - `DATABASE_URL`: Production Neon PostgreSQL connection pooler string.
  - `BETTER_AUTH_SECRET`: Minimum 32-byte cryptographically secure random string.
  - `GEMINI_API_KEY`: Production Google AI Gemini API credential.

---

### 2.3 Workers Builds toolchain

`package.json` pins `pnpm@10.22.0` through `packageManager`, which
[Workers Builds uses to select pnpm](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
Keep `packages: ['.']` in `pnpm-workspace.yaml` for this single-package
repository. Its `onlyBuiltDependencies` list approves the required install
scripts using the configuration supported by the pinned pnpm version.

Use these commands in the connected production Worker's build settings:

- Dependency installation: `pnpm install --frozen-lockfile` (automatic).
- Build: `pnpm run build:prod`.
- Deploy: `pnpm exec wrangler deploy --config dist/rangkai/wrangler.json`.

Confirm the install step uses pnpm 10.22.0 when investigating a failed build.
Changing the build command cannot fix failures in the earlier dependency
installation step. A successful install does not satisfy the production
resource and approval gates below.

---

## 3. Pre-Deployment Validation & Gate Checks

Before executing any migration or deployment, run the fail-closed release validation checks:

```bash
# 1. Verify clean TypeScript compilation across client, worker, and schema
pnpm exec tsc -b

# 2. Verify code quality and styling standards
pnpm run lint

# 3. Execute full regression test suite (deterministic, offline Gemini provider)
pnpm exec vitest run

# 4. Execute end-to-end browser test suite (Playwright: Desktop & Mobile Chromium)
pnpm exec playwright test

# 5. Build production bundle (targetEnvironment: production)
pnpm run build:prod

# 6. Verify production artifact integrity
pnpm exec tsx scripts/release-validator.ts --check-artifact production

# 7. Execute Cloudflare deployment dry-run
pnpm exec wrangler deploy --dry-run --config dist/rangkai/wrangler.json
```

---

## 4. Production Database Migration Runbook

### 4.1 Migration Roles & Responsibilities
- **Migration Owner:** Release Operations Lead / Authorized Database Administrator.
- **Backup Verification Owner:** Infrastructure Engineer.
- **Rollback Decision Authority:** Technical Coordinator.

### 4.2 Backup & Checkpoint Procedure (Pre-Migration)
1. **Create Neon Branch Snapshot / Restore Point:**
   ```bash
   neonctl branches create --project-id <production-project-id> --name pre-deploy-snapshot-$(date +%Y%m%d%H%M)
   ```
2. Verify the snapshot branch exists and is accessible.
3. Record the exact Neon snapshot LSN / timestamp in the deployment audit record.

### 4.3 Migration Execution
1. Export the production database connection string to a secure, ephemeral session environment:
   ```bash
   # Linux/macOS
   export DATABASE_URL="postgresql://<user>:<secret>@<prod-neon-host>/rangkai?sslmode=require"
   # Windows PowerShell
   $env:DATABASE_URL="postgresql://<user>:<secret>@<prod-neon-host>/rangkai?sslmode=require"
   ```
2. Execute migration with transactional DDL:
   ```bash
   pnpm run db:migrate
   ```
3. Verify post-migration database state and PostGIS schema:
   ```bash
   pnpm run db:verify
   ```

### 4.4 Rollback & Disaster Recovery Procedure
If `db:migrate` fails or schema corruption occurs:
1. Immediately abort deployment.
2. Direct Worker traffic away or maintain maintenance mode.
3. Restore Neon database from the pre-deployment snapshot branch:
   ```bash
   neonctl endpoints update <production-endpoint-id> --branch pre-deploy-snapshot-<timestamp>
   ```
4. Verify application connectivity against the restored snapshot:
   ```bash
   pnpm run db:verify
   ```
5. File an incident report documenting the migration statement failure and diagnostic logs.

---

## 5. Candidate-Bound Release Manifest

Every production deployment requires an explicitly signed `release-manifest.json` binding the target resources to the approved Git commit pin:

```json
{
  "candidateCommit": "<EXACT_APPROVED_COMMIT_SHA>",
  "targetEnvironment": "production",
  "approvedCommitPin": "<EXACT_APPROVED_COMMIT_SHA>",
  "expectedResources": {
    "accountId": "<CLOUDFLARE_ACCOUNT_ID>",
    "workerName": "rangkai-production",
    "productionDomain": "rangkai.id",
    "r2Bucket": "rangkai-documents-prod",
    "targetBranch": "main"
  },
  "prerequisites": {
    "neonDatabaseProvisioned": true,
    "r2BucketProvisioned": true,
    "secretsConfigured": true,
    "backupCheckpointCreated": true,
    "pilotAuthorityApproved": true
  }
}
```

Validate the manifest against the release gate:
```bash
pnpm exec tsx scripts/release-validator.ts --approved-pin <EXACT_APPROVED_COMMIT_SHA>
```

---

## 6. Deployment Execution (Post-Approval Only)

Only after the release manifest passes validation and external approval is granted:

```bash
# Deploy compiled Worker and static assets to Cloudflare Production
pnpm exec wrangler deploy --config dist/rangkai/wrangler.json
```

Verify post-deployment liveness and health:
```bash
curl -f https://rangkai.id/api/health
```
Ensure HTTP 200 OK is returned with healthy database, R2, and runtime checks.
