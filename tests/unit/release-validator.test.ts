import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	ArtifactValidationError,
	SecurityValidationError,
	validateArtifactConfig,
	validateReleaseManifest,
	type ReleaseManifest,
} from "../../scripts/release-validator";
import { AUTHORIZED_DEV_BRANCH } from "../../src/db/guard";

describe("Release Preparation & Manifest Validator (ROADMAP A10 / Findings F1 & F3)", () => {
	describe("validateArtifactConfig (Finding F1 Regression Guard)", () => {
		it("validates a genuine production-selected build artifact", () => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-prod-"));
			const configPath = path.join(tmpDir, "wrangler.json");
			fs.writeFileSync(
				configPath,
				JSON.stringify({
					name: "rangkai-production",
					targetEnvironment: "production",
					r2_buckets: [
						{
							bucket_name: "rangkai-documents-prod",
							binding: "rangkai_documents_dev",
						},
					],
				}),
				"utf8",
			);

			const result = validateArtifactConfig({ env: "production", configPath });
			expect(result.valid).toBe(true);
			expect(result.summary.name).toBe("rangkai-production");
			expect(result.summary.targetEnvironment).toBe("production");
			expect(result.summary.r2Bucket).toBe("rangkai-documents-prod");

			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("fails closed when a development artifact is supplied for production validation (regression test)", () => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-dev-"));
			const configPath = path.join(tmpDir, "wrangler.json");
			fs.writeFileSync(
				configPath,
				JSON.stringify({
					name: "rangkai",
					targetEnvironment: "default",
					r2_buckets: [
						{
							bucket_name: "rangkai-documents-dev",
							binding: "rangkai_documents_dev",
						},
					],
				}),
				"utf8",
			);

			expect(() =>
				validateArtifactConfig({ env: "production", configPath }),
			).toThrow(ArtifactValidationError);

			expect(() =>
				validateArtifactConfig({ env: "production", configPath }),
			).toThrow(/Artifact mismatch/);

			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("validates a development build artifact for development checks", () => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-dev-ok-"));
			const configPath = path.join(tmpDir, "wrangler.json");
			fs.writeFileSync(
				configPath,
				JSON.stringify({
					name: "rangkai",
					r2_buckets: [
						{
							bucket_name: "rangkai-documents-dev",
							binding: "rangkai_documents_dev",
						},
					],
				}),
				"utf8",
			);

			const result = validateArtifactConfig({ env: "development", configPath });
			expect(result.valid).toBe(true);
			expect(result.summary.name).toBe("rangkai");
			expect(result.summary.r2Bucket).toBe("rangkai-documents-dev");

			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("throws ArtifactValidationError if wrangler.json does not exist", () => {
			expect(() =>
				validateArtifactConfig({
					env: "production",
					configPath: "/non/existent/wrangler.json",
				}),
			).toThrow(ArtifactValidationError);
		});
	});

	describe("validateReleaseManifest (Finding F3 Prerequisite Guard)", () => {
		const unresolvedManifest: ReleaseManifest = {
			version: "1.0.0",
			candidateCommit: "d68e05d497c31826c38d553ab146f9941e6a241b",
			environment: "production",
			cloudflare: {
				accountId: null,
				workerName: "rangkai-production",
				productionDomain: null,
				r2Bucket: "rangkai-documents-prod",
				r2Provisioned: false,
			},
			database: {
				targetBranch: null,
				postgisEnabled: null,
				migrationPreparation: {
					migrationOwner: null,
					approvedTargetBranch: null,
					backupCheckpointCreated: false,
					backupCheckpointId: null,
					recoveryRehearsalCompleted: false,
				},
			},
			secretsReadiness: {
				DATABASE_URL: false,
				BETTER_AUTH_SECRET: false,
				GEMINI_API_KEY: false,
				BETTER_AUTH_URL: false,
			},
			authorizations: {
				productionMigrationApproved: false,
				productionDeploymentApproved: false,
				approvedBy: null,
			},
			status: "BLOCKED",
		};

		it("marks unresolved manifest as BLOCKED and reports all pending prerequisites", () => {
			const res = validateReleaseManifest(unresolvedManifest);
			expect(res.ready).toBe(false);
			expect(res.summary.status).toBe("BLOCKED");
			expect(res.pendingItems.length).toBeGreaterThan(10);
			expect(res.pendingItems).toContain(
				"Cloudflare Account ID: Unresolved (no production Cloudflare account provisioned)",
			);
			expect(res.pendingItems).toContain(
				"Production R2: Unprovisioned (bucket 'rangkai-documents-prod' has not been created)",
			);
			expect(res.pendingItems).toContain(
				"Production Neon Branch: Unresolved (dedicated production branch required)",
			);
			expect(res.pendingItems).toContain(
				"Authorization: Production deployment approval withheld",
			);
		});

		it("rejects attempts to use development database branch as production target", () => {
			const invalidDbManifest = {
				...unresolvedManifest,
				database: {
					...unresolvedManifest.database,
					targetBranch: AUTHORIZED_DEV_BRANCH,
				},
			};
			const res = validateReleaseManifest(invalidDbManifest);
			expect(res.ready).toBe(false);
			expect(
				res.pendingItems.some((item) =>
					item.includes(`must not use development branch '${AUTHORIZED_DEV_BRANCH}'`),
				),
			).toBe(true);
		});

		it("rejects manifests containing credential patterns with SecurityValidationError", () => {
			const leakedSecretManifest = {
				...unresolvedManifest,
				cloudflare: {
					...unresolvedManifest.cloudflare,
					accountId: "postgres://user:password123@ep-cool-db.neon.tech/neondb",
				},
			};
			expect(() => validateReleaseManifest(leakedSecretManifest)).toThrow(
				SecurityValidationError,
			);
		});

		it("accepts a fully approved synthetic manifest with READY status", () => {
			const approvedSyntheticManifest: ReleaseManifest = {
				version: "1.0.0",
				candidateCommit: "d68e05d497c31826c38d553ab146f9941e6a241b",
				environment: "production",
				cloudflare: {
					accountId: "synth_cf_account_12345",
					workerName: "rangkai-production",
					productionDomain: "https://rangkai.id",
					r2Bucket: "rangkai-documents-prod",
					r2Provisioned: true,
				},
				database: {
					targetBranch: "br-production-verified",
					postgisEnabled: true,
					migrationPreparation: {
						migrationOwner: "lead-engineer@rangkai.id",
						approvedTargetBranch: "br-production-verified",
						backupCheckpointCreated: true,
						backupCheckpointId: "snap-20261105-pre-migration-01",
						recoveryRehearsalCompleted: true,
					},
				},
				secretsReadiness: {
					DATABASE_URL: true,
					BETTER_AUTH_SECRET: true,
					GEMINI_API_KEY: true,
					BETTER_AUTH_URL: true,
				},
				authorizations: {
					productionMigrationApproved: true,
					productionDeploymentApproved: true,
					approvedBy: "Coordinator (task_a63c2a2f5d97)",
				},
				status: "READY",
			};

			const res = validateReleaseManifest(approvedSyntheticManifest);
			expect(res.ready).toBe(true);
			expect(res.pendingItems).toHaveLength(0);
			expect(res.summary.status).toBe("READY");
		});
	});
});
