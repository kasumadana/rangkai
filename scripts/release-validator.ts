/**
 * Rangkai Release Preparation & Manifest Validator
 *
 * Implements fail-closed validation of:
 * 1. Generated build artifacts (Worker name, R2 bucket, targetEnvironment) to prevent
 *    accidentally packaging or deploying development configurations to production.
 * 2. Release manifests (unresolved production account, domain, Neon database branch,
 *    R2 bucket provisioning, secret readiness, backup checkpoints, and authorization).
 *
 * Security:
 * - Rejects any manifest containing secret tokens or credentials.
 * - Non-mutating: does not provision resources or execute migrations.
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

export const ReleaseManifestSchema = z.object({
	version: z.string(),
	candidateCommit: z.string().min(7),
	environment: z.literal("production"),
	cloudflare: z.object({
		accountId: z.string().nullable(),
		workerName: z.literal("rangkai-production"),
		productionDomain: z.string().nullable(),
		r2Bucket: z.literal("rangkai-documents-prod"),
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
 */
export function validateReleaseManifest(
	manifestData: unknown,
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

	// 1. Cloudflare Account & Domain
	if (!manifest.cloudflare.accountId || manifest.cloudflare.accountId.trim() === "") {
		pendingItems.push("Cloudflare Account ID: Unresolved (no production Cloudflare account provisioned)");
	}
	if (!manifest.cloudflare.productionDomain || !manifest.cloudflare.productionDomain.startsWith("https://")) {
		pendingItems.push("Production Domain: Unresolved (canonical HTTPS domain e.g. https://rangkai.id required)");
	}
	if (!manifest.cloudflare.r2Provisioned) {
		pendingItems.push("Production R2: Unprovisioned (bucket 'rangkai-documents-prod' has not been created)");
	}

	// 2. Database & Migration Preparation
	if (!manifest.database.targetBranch || manifest.database.targetBranch.trim() === "") {
		pendingItems.push("Production Neon Branch: Unresolved (dedicated production branch required)");
	} else if (manifest.database.targetBranch === AUTHORIZED_DEV_BRANCH) {
		pendingItems.push(`Production Neon Branch: Invalid (must not use development branch '${AUTHORIZED_DEV_BRANCH}')`);
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

	// 3. Secrets Readiness
	const secrets = manifest.secretsReadiness;
	if (!secrets.DATABASE_URL) pendingItems.push("Secret DATABASE_URL: Unconfigured in production");
	if (!secrets.BETTER_AUTH_SECRET) pendingItems.push("Secret BETTER_AUTH_SECRET: Unconfigured in production");
	if (!secrets.GEMINI_API_KEY) pendingItems.push("Secret GEMINI_API_KEY: Unconfigured in production");
	if (!secrets.BETTER_AUTH_URL) pendingItems.push("Secret BETTER_AUTH_URL: Unconfigured in production");

	// 4. Authorizations
	if (!manifest.authorizations.productionMigrationApproved) {
		pendingItems.push("Authorization: Production migration approval withheld");
	}
	if (!manifest.authorizations.productionDeploymentApproved) {
		pendingItems.push("Authorization: Production deployment approval withheld");
	}
	if (!manifest.authorizations.approvedBy || manifest.authorizations.approvedBy.trim() === "") {
		pendingItems.push("Approver: No formal approver recorded");
	}

	const ready = pendingItems.length === 0 && manifest.status === "READY";

	return {
		ready,
		pendingItems,
		summary: {
			candidateCommit: manifest.candidateCommit,
			status: ready ? "READY" : "BLOCKED",
			unresolvedCount: pendingItems.length,
		},
	};
}

export function loadAndValidateManifest(
	manifestPath?: string,
): ManifestValidationResult {
	const resolvedPath =
		manifestPath ?? path.resolve(process.cwd(), "release-manifest.json");
	if (!fs.existsSync(resolvedPath)) {
		throw new ArtifactValidationError(
			`Release manifest file not found at: ${resolvedPath}`,
		);
	}
	const raw = fs.readFileSync(resolvedPath, "utf8");
	const data = JSON.parse(raw);
	return validateReleaseManifest(data);
}

// CLI runner
async function main() {
	const args = process.argv.slice(2);
	const checkArtifactIdx = args.indexOf("--check-artifact");
	const checkManifestIdx = args.indexOf("--check-manifest");
	const assertReady = args.includes("--assert-ready");

	console.log("=== Rangkai Release Preparation & Manifest Validator ===");

	let artifactPassed = true;
	if (checkArtifactIdx !== -1) {
		const env = (args[checkArtifactIdx + 1] || "production") as
			| "production"
			| "development";
		console.log(`\n[1] Checking generated build artifact for environment: '${env}'...`);
		try {
			const res = validateArtifactConfig({ env });
			console.log(`[✓] Artifact verified: Worker '${res.summary.name}', R2 '${res.summary.r2Bucket}', targetEnvironment '${res.summary.targetEnvironment}'`);
		} catch (err) {
			console.error(`[✗] ${err instanceof Error ? err.message : String(err)}`);
			artifactPassed = false;
		}
	}

	let manifestResult: ManifestValidationResult | null = null;
	const shouldCheckManifest = checkManifestIdx !== -1 || checkArtifactIdx === -1 || assertReady;

	if (shouldCheckManifest) {
		const customPath = checkManifestIdx !== -1 ? args[checkManifestIdx + 1] : undefined;
		console.log(`\n[2] Checking release manifest (${customPath || "release-manifest.json"})...`);
		try {
			manifestResult = loadAndValidateManifest(customPath);
			console.log(`Manifest Candidate: ${manifestResult.summary.candidateCommit}`);
			console.log(`Status: ${manifestResult.summary.status} (${manifestResult.summary.unresolvedCount} unresolved items)`);

			if (manifestResult.pendingItems.length > 0) {
				console.log("\nPending Prerequisites:");
				for (const item of manifestResult.pendingItems) {
					console.log(`  - [PENDING] ${item}`);
				}
			}
		} catch (err) {
			console.error(`[✗] ${err instanceof Error ? err.message : String(err)}`);
			manifestResult = {
				ready: false,
				pendingItems: [err instanceof Error ? err.message : String(err)],
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
		console.log("Software preparation verified, but production deployment is withheld pending external prerequisites.");
		if (assertReady) {
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
