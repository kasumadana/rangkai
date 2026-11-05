/**
 * Rangkai Release Preparation & Manifest Validator
 *
 * Implements fail-closed validation of:
 * 1. Generated build artifacts (Worker name, R2 bucket, targetEnvironment) to prevent
 *    accidentally packaging or deploying development configurations to production.
 * 2. Release manifests (unresolved production account, domain, Neon database branch,
 *    R2 bucket provisioning, secret readiness, backup checkpoints, and authorization).
 * 3. Independent candidate commit and expected resource identity binding (verifying
 *    candidate SHA against an independently supplied approved pin and explicit expected
 *    identities; never inferring approval from the manifest being validated itself).
 *
 * Security:
 * - Rejects any manifest containing secret tokens or credentials.
 * - Non-mutating: does not provision resources or execute migrations.
 * - Enforcing exits: fails closed (exit code 1) by default on missing/development artifacts,
 *   absent manifests, unresolved prerequisites, or candidate/resource mismatches.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AUTHORIZED_DEV_BRANCH } from "../src/db/guard";

export class ArtifactValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArtifactValidationError";
	}
}

export class SecurityValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecurityValidationError";
	}
}

export interface GeneratedWranglerConfig {
	name?: string;
	targetEnvironment?: string;
	r2_buckets?: Array<{
		bucket_name: string;
		binding: string;
	}>;
	[key: string]: unknown;
}

export interface ExpectedReleaseResources {
	accountId?: string | null;
	workerName?: string | null;
	productionDomain?: string | null;
	r2Bucket?: string | null;
	targetBranch?: string | null;
}

export interface ReleaseValidationOptions {
	approvedCommitPin?: string | null;
	expectedResources?: ExpectedReleaseResources | null;
	artifactSummary?: {
		name: string;
		targetEnvironment: string;
		r2Bucket: string;
	} | null;
}

/**
 * Validates that the generated dist/rangkai/wrangler.json matches the requested environment.
 * Ensures that a default development build is not falsely accepted as a production artifact.
 */
export function validateArtifactConfig(options: {
	env: "production" | "development";
	configPath?: string;
}): {
	valid: boolean;
	summary: {
		name: string;
		targetEnvironment: string;
		r2Bucket: string;
	};
} {
	const configPath =
		options.configPath ??
		path.resolve(process.cwd(), "dist/rangkai/wrangler.json");

	if (!fs.existsSync(configPath)) {
		throw new ArtifactValidationError(
			`Artifact config not found at: ${configPath}. Run build first.`,
		);
	}

	const raw = fs.readFileSync(configPath, "utf8");
	const config = JSON.parse(raw) as GeneratedWranglerConfig;

	const name = config.name ?? "unknown";
	const targetEnvironment = config.targetEnvironment ?? "default";
	const r2Bucket =
		config.r2_buckets?.find((b) => b.binding === "rangkai_documents_dev")
			?.bucket_name ?? "none";

	const summary = { name, targetEnvironment, r2Bucket };

	if (options.env === "production") {
		if (targetEnvironment !== "production") {
			throw new ArtifactValidationError(
				`Artifact mismatch: dist/rangkai/wrangler.json was built for environment '${targetEnvironment}' (Worker name: '${name}', R2 bucket: '${r2Bucket}'), NOT 'production'. Ensure CLOUDFLARE_ENV=production was passed during Vite build.`,
			);
		}

		if (name !== "rangkai-production") {
			throw new ArtifactValidationError(
				`Artifact mismatch: Expected Worker name 'rangkai-production', found '${name}'.`,
			);
		}

		if (r2Bucket !== "rangkai-documents-prod") {
			throw new ArtifactValidationError(
				`Artifact mismatch: Expected production R2 bucket 'rangkai-documents-prod', found '${r2Bucket}'. Development bucket must not be selected for production artifact.`,
			);
		}
	} else if (options.env === "development") {
		if (name !== "rangkai") {
			throw new ArtifactValidationError(
				`Artifact mismatch: Expected development Worker name 'rangkai', found '${name}'.`,
			);
		}
		if (r2Bucket !== "rangkai-documents-dev") {
			throw new ArtifactValidationError(
				`Artifact mismatch: Expected development R2 bucket 'rangkai-documents-dev', found '${r2Bucket}'.`,
			);
		}
	}

	return { valid: true, summary };
}

// Security: scan for common credential patterns
const FORBIDDEN_SECRET_PATTERNS = [
	/postgres(ql)?:\/\/[^:]+:[^@]+@/i,
	/sk-[a-zA-Z0-9_.-]{20,}/,
	/ghp_[a-zA-Z0-9]{20,}/,
	/Bearer\s+[a-zA-Z0-9_.-]{20,}/i,
	/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}/, // JWT pattern
];

function assertNoSecrets(value: unknown, fieldPath = "manifest"): void {
	if (typeof value === "string") {
		for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
			if (pattern.test(value)) {
				throw new SecurityValidationError(
					`Forbidden secret pattern detected in ${fieldPath}. Manifests must never contain raw credentials or connection strings.`,
				);
			}
		}
	} else if (typeof value === "object" && value !== null) {
		for (const [k, v] of Object.entries(value)) {
			assertNoSecrets(v, `${fieldPath}.${k}`);
		}
	}
}

const FULL_HEX_SHA_REGEX = /^[0-9a-f]{40}$/i;

export const ReleaseManifestSchema = z.object({
	version: z.string(),
	candidateCommit: z.string().nullable().optional(),
	environment: z.literal("production"),
	cloudflare: z.object({
		accountId: z.string().nullable(),
		workerName: z.string().nullable().optional(),
		productionDomain: z.string().nullable(),
		r2Bucket: z.string().nullable().optional(),
		r2Provisioned: z.boolean(),
	}),
	database: z.object({
		targetBranch: z.string().nullable(),
		postgisEnabled: z.boolean().nullable(),
		migrationPreparation: z.object({
			migrationOwner: z.string().nullable(),
			approvedTargetBranch: z.string().nullable(),
			backupCheckpointCreated: z.boolean(),
			backupCheckpointId: z.string().nullable(),
			recoveryRehearsalCompleted: z.boolean(),
		}),
	}),
	secretsReadiness: z.object({
		DATABASE_URL: z.boolean(),
		BETTER_AUTH_SECRET: z.boolean(),
		GEMINI_API_KEY: z.boolean(),
		BETTER_AUTH_URL: z.boolean(),
	}),
	authorizations: z.object({
		productionMigrationApproved: z.boolean(),
		productionDeploymentApproved: z.boolean(),
		approvedBy: z.string().nullable(),
	}),
	status: z.enum(["BLOCKED", "READY", "DEPLOYED"]),
});

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export interface ManifestValidationResult {
	ready: boolean;
	pendingItems: string[];
	summary: {
		candidateCommit: string;
		status: string;
		unresolvedCount: number;
	};
}

/**
 * Validates a release manifest and determines if production prerequisites are satisfied.
 * Enforces independent binding to an approved commit pin and expected production resources.
 */
export function validateReleaseManifest(
	manifestData: unknown,
	options?: ReleaseValidationOptions,
): ManifestValidationResult {
	assertNoSecrets(manifestData);

	const parsed = ReleaseManifestSchema.safeParse(manifestData);
	if (!parsed.success) {
		throw new ArtifactValidationError(
			`Invalid release manifest schema: ${parsed.error.message}`,
		);
	}

	const manifest = parsed.data;
	const pendingItems: string[] = [];

	// 1. Candidate Commit Identity & Independent Pin Binding
	const hasValidCandidateSha =
		typeof manifest.candidateCommit === "string" &&
		FULL_HEX_SHA_REGEX.test(manifest.candidateCommit);

	if (!hasValidCandidateSha) {
		pendingItems.push(
			"Candidate Commit SHA: Unresolved or invalid (must be a valid 40-character hex commit SHA)",
		);
	}

	if (!options?.approvedCommitPin) {
		pendingItems.push(
			"Approved Commit Pin: No independent approved commit pin supplied to release gate (candidate approval withheld)",
		);
	} else if (!FULL_HEX_SHA_REGEX.test(options.approvedCommitPin)) {
		pendingItems.push(
			`Approved Commit Pin: Invalid format for supplied pin '${options.approvedCommitPin}' (must be a valid 40-character hex commit SHA)`,
		);
	} else if (
		!hasValidCandidateSha ||
		manifest.candidateCommit!.toLowerCase() !== options.approvedCommitPin.toLowerCase()
	) {
		pendingItems.push(
			`Approved Commit Pin Mismatch: manifest candidate '${manifest.candidateCommit ?? "unresolved"}' does not match independent approved pin '${options.approvedCommitPin}'`,
		);
	}

	// 2. Expected Production Resources Binding
	if (!options?.expectedResources) {
		pendingItems.push(
			"Expected Production Resources: No independent expected resource identities supplied to release gate",
		);
	} else {
		const exp = options.expectedResources;
		if (!exp.accountId) {
			pendingItems.push("Expected Cloudflare Account: Absent from expected resource specification");
		} else if (manifest.cloudflare.accountId !== exp.accountId) {
			pendingItems.push(
				`Cloudflare Account Mismatch: manifest has '${manifest.cloudflare.accountId ?? "unresolved"}', expected '${exp.accountId}'`,
			);
		}

		if (!exp.workerName) {
			pendingItems.push("Expected Worker Name: Absent from expected resource specification");
		} else if (manifest.cloudflare.workerName !== exp.workerName) {
			pendingItems.push(
				`Worker Name Mismatch: manifest has '${manifest.cloudflare.workerName ?? "unresolved"}', expected '${exp.workerName}'`,
			);
		}

		if (!exp.productionDomain) {
			pendingItems.push("Expected Production Domain: Absent from expected resource specification");
		} else if (manifest.cloudflare.productionDomain !== exp.productionDomain) {
			pendingItems.push(
				`Production Domain Mismatch: manifest has '${manifest.cloudflare.productionDomain ?? "unresolved"}', expected '${exp.productionDomain}'`,
			);
		}

		if (!exp.r2Bucket) {
			pendingItems.push("Expected R2 Bucket: Absent from expected resource specification");
		} else if (manifest.cloudflare.r2Bucket !== exp.r2Bucket) {
			pendingItems.push(
				`R2 Bucket Mismatch: manifest has '${manifest.cloudflare.r2Bucket ?? "unresolved"}', expected '${exp.r2Bucket}'`,
			);
		}

		if (!exp.targetBranch) {
			pendingItems.push("Expected Database Branch: Absent from expected resource specification");
		} else if (manifest.database.targetBranch !== exp.targetBranch) {
			pendingItems.push(
				`Database Branch Mismatch: manifest has '${manifest.database.targetBranch ?? "unresolved"}', expected '${exp.targetBranch}'`,
			);
		}
	}

	// 3. Cloudflare Account & Domain Identity Validation
	if (!manifest.cloudflare.accountId || manifest.cloudflare.accountId.trim() === "") {
		pendingItems.push(
			"Cloudflare Account ID: Unresolved (no production Cloudflare account provisioned)",
		);
	}
	if (manifest.cloudflare.workerName !== "rangkai-production") {
		pendingItems.push(
			`Production Worker Name: Expected 'rangkai-production', found '${manifest.cloudflare.workerName ?? "unresolved"}'`,
		);
	}
	if (!manifest.cloudflare.productionDomain || !manifest.cloudflare.productionDomain.startsWith("https://")) {
		pendingItems.push(
			"Production Domain: Unresolved (canonical HTTPS domain e.g. https://rangkai.id required)",
		);
	}
	if (manifest.cloudflare.r2Bucket !== "rangkai-documents-prod") {
		pendingItems.push(
			`Production R2 Bucket: Expected 'rangkai-documents-prod', found '${manifest.cloudflare.r2Bucket ?? "unresolved"}'`,
		);
	}
	if (!manifest.cloudflare.r2Provisioned) {
		pendingItems.push(
			"Production R2: Unprovisioned (bucket 'rangkai-documents-prod' has not been created)",
		);
	}

	// 4. Database & Migration Preparation
	if (!manifest.database.targetBranch || manifest.database.targetBranch.trim() === "") {
		pendingItems.push("Production Neon Branch: Unresolved (dedicated production branch required)");
	} else if (manifest.database.targetBranch === AUTHORIZED_DEV_BRANCH) {
		pendingItems.push(
			`Production Neon Branch: Invalid (must not use development branch '${AUTHORIZED_DEV_BRANCH}')`,
		);
	}

	if (manifest.database.postgisEnabled !== true) {
		pendingItems.push("PostGIS Extension: Unverified on production database branch");
	}

	const mig = manifest.database.migrationPreparation;
	if (!mig.migrationOwner || mig.migrationOwner.trim() === "") {
		pendingItems.push("Migration Owner: Unassigned");
	}
	if (!mig.approvedTargetBranch || mig.approvedTargetBranch !== manifest.database.targetBranch) {
		pendingItems.push("Migration Target Branch: Unmatched or unapproved");
	}
	if (!mig.backupCheckpointCreated || !mig.backupCheckpointId) {
		pendingItems.push("Database Backup Checkpoint: Missing pre-migration Neon snapshot/checkpoint ID");
	}
	if (!mig.recoveryRehearsalCompleted) {
		pendingItems.push("Database Recovery Rehearsal: Incomplete (checkpoint restore not verified)");
	}

	// 5. Secrets Readiness
	const secrets = manifest.secretsReadiness;
	if (!secrets.DATABASE_URL) pendingItems.push("Secret DATABASE_URL: Unconfigured in production");
	if (!secrets.BETTER_AUTH_SECRET) pendingItems.push("Secret BETTER_AUTH_SECRET: Unconfigured in production");
	if (!secrets.GEMINI_API_KEY) pendingItems.push("Secret GEMINI_API_KEY: Unconfigured in production");
	if (!secrets.BETTER_AUTH_URL) pendingItems.push("Secret BETTER_AUTH_URL: Unconfigured in production");

	// 6. Authorizations
	if (!manifest.authorizations.productionMigrationApproved) {
		pendingItems.push("Authorization: Production migration approval withheld");
	}
	if (!manifest.authorizations.productionDeploymentApproved) {
		pendingItems.push("Authorization: Production deployment approval withheld");
	}
	if (!manifest.authorizations.approvedBy || manifest.authorizations.approvedBy.trim() === "") {
		pendingItems.push("Approver: No formal approver recorded");
	}

	// 7. Context Binding to Generated Build Artifact (if present in options)
	if (options?.artifactSummary) {
		if (options.artifactSummary.targetEnvironment !== "production") {
			pendingItems.push(
				`Artifact Environment Mismatch: generated artifact was built for environment '${options.artifactSummary.targetEnvironment}', NOT 'production'`,
			);
		}
		if (options.artifactSummary.name !== (manifest.cloudflare.workerName ?? "rangkai-production")) {
			pendingItems.push(
				`Artifact Worker Mismatch: generated artifact Worker is '${options.artifactSummary.name}', expected '${manifest.cloudflare.workerName}'`,
			);
		}
		if (options.artifactSummary.r2Bucket !== (manifest.cloudflare.r2Bucket ?? "rangkai-documents-prod")) {
			pendingItems.push(
				`Artifact R2 Mismatch: generated artifact R2 bucket is '${options.artifactSummary.r2Bucket}', expected '${manifest.cloudflare.r2Bucket}'`,
			);
		}
	}

	const ready = pendingItems.length === 0 && manifest.status === "READY";

	return {
		ready,
		pendingItems,
		summary: {
			candidateCommit: manifest.candidateCommit ?? "unresolved",
			status: ready ? "READY" : "BLOCKED",
			unresolvedCount: pendingItems.length,
		},
	};
}

export function loadAndValidateManifest(
	manifestPath?: string,
	options?: ReleaseValidationOptions,
): ManifestValidationResult {
	const resolvedPath =
		manifestPath ?? path.resolve(process.cwd(), "release-manifest.json");
	if (!fs.existsSync(resolvedPath)) {
		throw new ArtifactValidationError(
			`Release manifest file not found at: ${resolvedPath}`,
		);
	}
	const raw = fs.readFileSync(resolvedPath, "utf8");
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (err) {
		throw new ArtifactValidationError(
			`Failed to parse release manifest JSON at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return validateReleaseManifest(data, options);
}

function getArgValue(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
		return args[idx + 1];
	}
	return undefined;
}

// CLI runner
async function main() {
	const args = process.argv.slice(2);
	const checkArtifactIdx = args.indexOf("--check-artifact");
	const checkManifestIdx = args.indexOf("--check-manifest");
	const assertReady = args.includes("--assert-ready");
	const reportOnly = args.includes("--report-only");

	console.log("=== Rangkai Release Preparation & Manifest Validator ===");

	let artifactPassed = true;
	let artifactSummary: { name: string; targetEnvironment: string; r2Bucket: string } | null = null;

	if (checkArtifactIdx !== -1) {
		const envArg = args[checkArtifactIdx + 1];
		const env = (envArg && !envArg.startsWith("--") ? envArg : "production") as
			| "production"
			| "development";
		const customConfigPath = getArgValue(args, "--artifact-config");
		console.log(`\n[1] Checking generated build artifact for environment: '${env}'...`);
		try {
			const res = validateArtifactConfig({ env, configPath: customConfigPath });
			artifactSummary = res.summary;
			console.log(
				`[✓] Artifact verified: Worker '${res.summary.name}', R2 '${res.summary.r2Bucket}', targetEnvironment '${res.summary.targetEnvironment}'`,
			);
		} catch (err) {
			console.error(`[✗] Artifact validation error: ${err instanceof Error ? err.message : String(err)}`);
			artifactPassed = false;
		}
	}

	// Artifact checking errors return nonzero independently of readiness flags
	if (checkArtifactIdx !== -1 && !artifactPassed) {
		console.error("\n[!] Artifact check failed: generated artifact is missing or mismatched.");
		process.exit(1);
	}

	// If only artifact check was requested (documented packaging gate)
	if (checkArtifactIdx !== -1 && checkManifestIdx === -1 && !assertReady) {
		console.log("\n=======================================================");
		console.log("[✓] Artifact verification: PASSED (Worker and R2 build artifact verified).");
		process.exit(0);
	}

	let manifestResult: ManifestValidationResult | null = null;
	const shouldCheckManifest =
		checkManifestIdx !== -1 || checkArtifactIdx === -1 || assertReady || reportOnly;

	if (shouldCheckManifest) {
		const customPath =
			getArgValue(args, "--check-manifest") ??
			(checkManifestIdx !== -1 && args[checkManifestIdx + 1] && !args[checkManifestIdx + 1].startsWith("--")
				? args[checkManifestIdx + 1]
				: undefined);
		const manifestFile = customPath ?? "release-manifest.json";

		const approvedPin =
			getArgValue(args, "--approved-pin") ?? process.env.APPROVED_RELEASE_COMMIT ?? null;
		const expectedAccount = getArgValue(args, "--expected-account") ?? null;
		const expectedWorker = getArgValue(args, "--expected-worker") ?? null;
		const expectedDomain = getArgValue(args, "--expected-domain") ?? null;
		const expectedR2 = getArgValue(args, "--expected-r2") ?? null;
		const expectedNeonBranch = getArgValue(args, "--expected-neon-branch") ?? null;

		const expectedResources: ExpectedReleaseResources | null =
			expectedAccount || expectedWorker || expectedDomain || expectedR2 || expectedNeonBranch
				? {
						accountId: expectedAccount,
						workerName: expectedWorker,
						productionDomain: expectedDomain,
						r2Bucket: expectedR2,
						targetBranch: expectedNeonBranch,
				  }
				: null;

		console.log(`\n[2] Checking release manifest (${manifestFile})...`);
		try {
			manifestResult = loadAndValidateManifest(manifestFile, {
				approvedCommitPin: approvedPin,
				expectedResources,
				artifactSummary,
			});

			console.log(`Manifest Candidate: ${manifestResult.summary.candidateCommit}`);
			console.log(
				`Status: ${manifestResult.summary.status} (${manifestResult.summary.unresolvedCount} unresolved items)`,
			);

			if (manifestResult.pendingItems.length > 0) {
				console.log("\nPending Prerequisites:");
				for (const item of manifestResult.pendingItems) {
					console.log(`  - [PENDING] ${item}`);
				}
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error(`[✗] Manifest error: ${errMsg}`);
			manifestResult = {
				ready: false,
				pendingItems: [errMsg],
				summary: { candidateCommit: "unknown", status: "BLOCKED", unresolvedCount: 1 },
			};
		}
	}

	const overallReady = artifactPassed && (manifestResult?.ready ?? false);

	console.log("\n=======================================================");
	if (overallReady) {
		console.log("[✓] Release readiness: READY for authorized deployment.");
		process.exit(0);
	} else {
		console.log("[!] Release readiness: BLOCKED");
		if (reportOnly) {
			console.log("[REPORT-ONLY] Release readiness report generated. Readiness is BLOCKED.");
			process.exit(0);
		} else {
			console.error("[!] Release gate failed closed: unresolved release prerequisites, unapproved candidate, or missing manifest.");
			process.exit(1);
		}
	}
}

if (process.argv[1] && process.argv[1].includes("release-validator")) {
	main().catch((err) => {
		console.error("[FATAL] Release validator error:", err);
		process.exit(1);
	});
}
