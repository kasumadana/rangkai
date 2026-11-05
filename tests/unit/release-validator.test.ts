import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	ArtifactValidationError,
	SecurityValidationError,
	validateArtifactConfig,
	validateReleaseManifest,
	type ReleaseManifest,
	type ExpectedReleaseResources,
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

	describe("validateReleaseManifest (Finding F3 Prerequisite & Independent Binding Guard)", () => {
		const unresolvedManifest: ReleaseManifest = {
			version: "1.0.0",
			candidateCommit: null,
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

		const syntheticCandidateSha = "1111111111111111111111111111111111111111";

		const approvedSyntheticManifest: ReleaseManifest = {
			version: "1.0.0",
			candidateCommit: syntheticCandidateSha,
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
				approvedBy: "Coordinator (task_3dc92db6bfe3)",
			},
			status: "READY",
		};

		const expectedSyntheticResources: ExpectedReleaseResources = {
			accountId: "synth_cf_account_12345",
			workerName: "rangkai-production",
			productionDomain: "https://rangkai.id",
			r2Bucket: "rangkai-documents-prod",
			targetBranch: "br-production-verified",
		};

		it("marks unresolved manifest as BLOCKED and reports all pending prerequisites", () => {
			const res = validateReleaseManifest(unresolvedManifest);
			expect(res.ready).toBe(false);
			expect(res.summary.status).toBe("BLOCKED");
			expect(res.pendingItems.length).toBeGreaterThan(10);
			expect(res.pendingItems).toContain(
				"Candidate Commit SHA: Unresolved or invalid (must be a valid 40-character hex commit SHA)",
			);
			expect(res.pendingItems).toContain(
				"Approved Commit Pin: No independent approved commit pin supplied to release gate (candidate approval withheld)",
			);
			expect(res.pendingItems).toContain(
				"Expected Production Resources: No independent expected resource identities supplied to release gate",
			);
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

		it("rejects candidate commits that are not valid 40-character hex SHAs", () => {
			const shortShaManifest = {
				...approvedSyntheticManifest,
				candidateCommit: "d68e05d",
			};
			const res = validateReleaseManifest(shortShaManifest, {
				approvedCommitPin: "d68e05d",
				expectedResources: expectedSyntheticResources,
			});
			expect(res.ready).toBe(false);
			expect(
				res.pendingItems.some((item) =>
					item.includes("must be a valid 40-character hex commit SHA"),
				),
			).toBe(true);
		});

		it("rejects an apparently ready manifest when independent approved pin is withheld", () => {
			const res = validateReleaseManifest(approvedSyntheticManifest, {
				expectedResources: expectedSyntheticResources,
			});
			expect(res.ready).toBe(false);
			expect(res.summary.status).toBe("BLOCKED");
			expect(res.pendingItems).toContain(
				"Approved Commit Pin: No independent approved commit pin supplied to release gate (candidate approval withheld)",
			);
		});

		it("rejects candidate commit when independent approved pin mismatches", () => {
			const mismatchedPin = "2222222222222222222222222222222222222222";
			const res = validateReleaseManifest(approvedSyntheticManifest, {
				approvedCommitPin: mismatchedPin,
				expectedResources: expectedSyntheticResources,
			});
			expect(res.ready).toBe(false);
			expect(res.summary.status).toBe("BLOCKED");
			expect(
				res.pendingItems.some((item) =>
					item.includes("does not match independent approved pin"),
				),
			).toBe(true);
		});

		it("rejects manifest when independent expected resources are absent or mismatched", () => {
			// Test 1: absent expected resources
			const resAbsent = validateReleaseManifest(approvedSyntheticManifest, {
				approvedCommitPin: syntheticCandidateSha,
			});
			expect(resAbsent.ready).toBe(false);
			expect(resAbsent.pendingItems).toContain(
				"Expected Production Resources: No independent expected resource identities supplied to release gate",
			);

			// Test 2: mismatched worker name
			const resMismatchWorker = validateReleaseManifest(approvedSyntheticManifest, {
				approvedCommitPin: syntheticCandidateSha,
				expectedResources: {
					...expectedSyntheticResources,
					workerName: "rangkai-wrong-worker",
				},
			});
			expect(resMismatchWorker.ready).toBe(false);
			expect(
				resMismatchWorker.pendingItems.some((item) =>
					item.includes("Worker Name Mismatch"),
				),
			).toBe(true);

			// Test 3: mismatched R2 bucket
			const resMismatchR2 = validateReleaseManifest(approvedSyntheticManifest, {
				approvedCommitPin: syntheticCandidateSha,
				expectedResources: {
					...expectedSyntheticResources,
					r2Bucket: "rangkai-documents-wrong",
				},
			});
			expect(resMismatchR2.ready).toBe(false);
			expect(
				resMismatchR2.pendingItems.some((item) =>
					item.includes("R2 Bucket Mismatch"),
				),
			).toBe(true);
		});

		it("rejects manifest when artifact context summary mismatches production configuration", () => {
			const resMismatchArtifact = validateReleaseManifest(approvedSyntheticManifest, {
				approvedCommitPin: syntheticCandidateSha,
				expectedResources: expectedSyntheticResources,
				artifactSummary: {
					name: "rangkai",
					targetEnvironment: "default",
					r2Bucket: "rangkai-documents-dev",
				},
			});
			expect(resMismatchArtifact.ready).toBe(false);
			expect(
				resMismatchArtifact.pendingItems.some((item) =>
					item.includes("Artifact Environment Mismatch"),
				),
			).toBe(true);
		});

		it("accepts a fully approved synthetic manifest with READY status when pin, expected resources, and prerequisites match", () => {
			const res = validateReleaseManifest(approvedSyntheticManifest, {
				approvedCommitPin: syntheticCandidateSha,
				expectedResources: expectedSyntheticResources,
				artifactSummary: {
					name: "rangkai-production",
					targetEnvironment: "production",
					r2Bucket: "rangkai-documents-prod",
				},
			});
			expect(res.ready).toBe(true);
			expect(res.pendingItems).toHaveLength(0);
			expect(res.summary.status).toBe("READY");
		});
	});

	describe("CLI executable behavior and exit codes (Finding F1/F3 Enforcing Exits)", () => {
		const tsxPath = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
		const validatorScript = path.resolve(process.cwd(), "scripts/release-validator.ts");

		function runValidatorCLI(args: string[]): { exitCode: number; stdout: string; stderr: string } {
			try {
				const stdout = execFileSync(process.execPath, [tsxPath, validatorScript, ...args], {
					encoding: "utf8",
					env: { ...process.env, CI: "true" },
					stdio: ["ignore", "pipe", "pipe"],
				});
				return { exitCode: 0, stdout, stderr: "" };
			} catch (err: unknown) {
				const execErr = err as { status?: number; stdout?: string; stderr?: string };
				return {
					exitCode: execErr.status ?? 1,
					stdout: execErr.stdout ?? "",
					stderr: execErr.stderr ?? "",
				};
			}
		}

		it("fails closed (exit code 1) when checking non-existent artifact", () => {
			const res = runValidatorCLI([
				"--check-artifact",
				"production",
				"--artifact-config",
				"/non/existent/wrangler.json",
			]);
			expect(res.exitCode).toBe(1);
			expect(res.stdout + res.stderr).toContain("Artifact validation error");
		});

		it("fails closed (exit code 1) when checking missing manifest", () => {
			const res = runValidatorCLI([
				"--check-manifest",
				"/non/existent/release-manifest.json",
			]);
			expect(res.exitCode).toBe(1);
			expect(res.stdout + res.stderr).toContain("Release manifest file not found");
		});

		it("fails closed (exit code 1) by default on unresolved manifest template", () => {
			const res = runValidatorCLI([
				"--check-manifest",
				"release-manifest.template.json",
			]);
			expect(res.exitCode).toBe(1);
			expect(res.stdout + res.stderr).toContain("Release readiness: BLOCKED");
			expect(res.stdout + res.stderr).not.toContain("Software preparation verified");
		});

		it("exits with 0 in report-only mode on unresolved manifest template while reporting pending items", () => {
			const res = runValidatorCLI([
				"--check-manifest",
				"release-manifest.template.json",
				"--report-only",
			]);
			expect(res.exitCode).toBe(0);
			expect(res.stdout + res.stderr).toContain("Release readiness: BLOCKED");
			expect(res.stdout + res.stderr).toContain("[REPORT-ONLY]");
		});

		it("fails closed (exit code 1) even with --report-only if artifact check fails", () => {
			const res = runValidatorCLI([
				"--check-artifact",
				"production",
				"--artifact-config",
				"/non/existent/wrangler.json",
				"--report-only",
			]);
			expect(res.exitCode).toBe(1);
			expect(res.stdout + res.stderr).toContain("Artifact check failed");
		});
	});
});
