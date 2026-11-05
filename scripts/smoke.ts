/**
 * Rangkai Release Smoke Verification Procedure
 *
 * Validates process health, asset routing, Better Auth, RBAC,
 * document/photo validation, cleanup workflow, waste records, and public aggregates.
 *
 * Architecture:
 * - Part 1: Isolated In-Process Boundary Checks (Hono app.request in Node with in-memory mock R2)
 *   Verifies route matching, public anonymity, authentication rejection, and dependency degradation.
 * - Part 2: Guarded Workerd Runtime Integration Suite (Vite Preview Server + workerd + local R2)
 *   Reuses tests/integration/health.test.ts to verify real workerd execution: SPA HTML fallback,
 *   transport header preservation, HttpOnly session cookies, CSRF protection, real R2 upload/download,
 *   unverified road rejection, cleanup task lifecycle, evidence photos, waste records, and public summary.
 *
 * Safe-by-design:
 * - Fails closed if executed against unconfirmed environments (requires authorized dev Neon branch).
 * - No arbitrary production mutation target. No fake SMOKE_BASE_URL claims.
 * - Exits nonzero on any assertion failure.
 */

import cp from "node:child_process";
import * as dotenv from "dotenv";
import { assertDevBranch, AUTHORIZED_DEV_BRANCH } from "../src/db/guard";
import app from "../src/worker/index";
import type { Env } from "../src/worker/types";

dotenv.config({ path: ".dev.vars" });

async function main() {
	console.log("=== Rangkai Guarded Release Smoke Verification ===");

	// 1. Target Environment & Database Preflight
	console.log("\n[Preflight] Verifying environment and database guard...");
	const { branchId, pinnedUrl } = await assertDevBranch();
	if (branchId !== AUTHORIZED_DEV_BRANCH) {
		console.error(`[FATAL] Unauthorized branch: ${branchId}`);
		process.exit(1);
	}
	console.log(`[✓] Target database guard verified: Neon development branch '${branchId}'`);

	// =========================================================================
	// PART 1: Isolated In-Process Boundary Probes (Node + Hono + Mock R2)
	// =========================================================================
	console.log("\n=======================================================");
	console.log("PART 1: Isolated In-Process Boundary Probes (Hono app.request)");
	console.log("=======================================================");

	// In-memory mock R2 bucket for isolated in-process smoke probes
	const storage = new Map<string, { bytes: Uint8Array; contentType?: string }>();
	const smokeR2: R2Bucket = {
		async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
			let bytes: Uint8Array;
			if (value instanceof Uint8Array) bytes = value;
			else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
			else if (typeof value === "string") bytes = new TextEncoder().encode(value);
			else bytes = new Uint8Array();
			storage.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
			return {} as R2Object;
		},
		async get(key: string) {
			const item = storage.get(key);
			if (!item) return null;
			return {
				async arrayBuffer() {
					return item.bytes.buffer;
				},
				httpMetadata: { contentType: item.contentType },
			} as unknown as R2ObjectBody;
		},
		async delete(keys: string | string[]) {
			const arr = Array.isArray(keys) ? keys : [keys];
			for (const k of arr) storage.delete(k);
		},
	} as unknown as R2Bucket;

	const smokeEnv: Env = {
		DATABASE_URL: pinnedUrl,
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "smoke_secret_at_least_32_characters_long",
		BETTER_AUTH_URL: "http://localhost:5173",
		rangkai_documents_dev: smokeR2,
		GEMINI_API_KEY: process.env.GEMINI_API_KEY,
	};

	let inProcessPassed = 0;
	let inProcessFailed = 0;

	async function assertStep(name: string, fn: () => Promise<void>) {
		try {
			await fn();
			console.log(`  [PASS] ${name}`);
			inProcessPassed++;
		} catch (err: unknown) {
			console.error(`  [FAIL] ${name}:`, err instanceof Error ? err.message : String(err));
			inProcessFailed++;
		}
	}

	// 1.1 Process Health and API Routing
	console.log("\n[1.1] Process health and API routing...");
	await assertStep("GET /api/health returns 200 with service: rangkai", async () => {
		const res = await app.request("http://localhost:5173/api/health", { method: "GET" }, smokeEnv);
		if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
		const body = (await res.json()) as { status: string; service: string };
		if (body.status !== "ok" || body.service !== "rangkai") {
			throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
		}
	});

	await assertStep("Unhandled /api/* returns JSON envelope (never falls back to SPA HTML)", async () => {
		const res = await app.request("http://localhost:5173/api/not-a-real-endpoint-1234", { method: "GET" }, smokeEnv);
		const contentType = res.headers.get("content-type") || "";
		if (contentType.includes("text/html")) {
			throw new Error("Unhandled /api/* returned text/html instead of API JSON");
		}
		if (res.status !== 404 && res.status !== 401) {
			throw new Error(`Expected 404 or 401 JSON envelope, got HTTP ${res.status}`);
		}
		const body = (await res.json()) as { error?: { code?: string } };
		if (!body.error?.code) {
			throw new Error(`Expected structured error envelope with error.code, got: ${JSON.stringify(body)}`);
		}
	});

	// 1.2 Anonymous Public API Checks
	console.log("\n[1.2] Anonymous public API and information isolation...");
	await assertStep("GET /api/public/events lists published events without credentials", async () => {
		const res = await app.request("http://localhost:5173/api/public/events", { method: "GET" }, smokeEnv);
		if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
		const body = (await res.json()) as { events: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
		if (!Array.isArray(body.events)) throw new Error("Expected body.events array");
		for (const ev of body.events) {
			if ("r2Key" in ev || "contactInformation" in ev) {
				throw new Error("Private fields leaked in public event listing");
			}
		}
	});

	await assertStep("GET /api/public/events/non-existent-event-slug returns 404", async () => {
		const res = await app.request("http://localhost:5173/api/public/events/non-existent-slug-xyz", { method: "GET" }, smokeEnv);
		if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
	});

	// 1.3 Authentication & Security Bounds
	console.log("\n[1.3] Authentication and RBAC boundaries...");
	await assertStep("POST /api/auth/sign-in/email rejects invalid credentials with 401", async () => {
		const res = await app.request(
			"http://localhost:5173/api/auth/sign-in/email",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: "nonexistent@example.com", password: "wrongpassword123" }),
			},
			smokeEnv,
		);
		if (res.status !== 401 && res.status !== 400) {
			throw new Error(`Expected 401 or 400, got ${res.status}`);
		}
	});

	await assertStep("Unauthenticated access to protected /api/events is rejected (401)", async () => {
		const res = await app.request("http://localhost:5173/api/events", { method: "GET" }, smokeEnv);
		if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
	});

	// 1.4 Cleanup Evidence & Waste Boundary Checks
	console.log("\n[1.4] Upload, cleanup, and waste boundaries...");
	await assertStep("Unauthenticated POST /api/cleanup-tasks/00000000-0000-0000-0000-000000000001/evidence is rejected (401)", async () => {
		const form = new FormData();
		form.append("stage", "before");
		form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "photo.jpg", { type: "image/jpeg" }));
		const res = await app.request(
			"http://localhost:5173/api/cleanup-tasks/00000000-0000-0000-0000-000000000001/evidence",
			{ method: "POST", body: form },
			smokeEnv,
		);
		if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
	});

	await assertStep("Unauthenticated GET /api/events/00000000-0000-0000-0000-000000000001/waste-records is rejected (401)", async () => {
		const res = await app.request(
			"http://localhost:5173/api/events/00000000-0000-0000-0000-000000000001/waste-records",
			{ method: "GET" },
			smokeEnv,
		);
		if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
	});

	// 1.5 Upstream Dependency Handling
	console.log("\n[1.5] Upstream dependency error handling...");
	await assertStep("Service handles missing database configuration gracefully with 503", async () => {
		const degradedEnv: Env = {
			...smokeEnv,
			DATABASE_URL: "",
		};
		const res = await app.request("http://localhost:5173/api/health", { method: "GET" }, degradedEnv);
		if (res.status !== 200) throw new Error(`Expected 200 for health liveness, got ${res.status}`);

		const dbRes = await app.request("http://localhost:5173/api/public/events", { method: "GET" }, degradedEnv);
		if (dbRes.status !== 503) {
			throw new Error(`Expected 503 DEPENDENCY_UNAVAILABLE, got ${dbRes.status}`);
		}
		const body = (await dbRes.json()) as { error?: { code?: string } };
		if (body.error?.code !== "DEPENDENCY_UNAVAILABLE") {
			throw new Error(`Expected DEPENDENCY_UNAVAILABLE error code, got ${JSON.stringify(body)}`);
		}
	});

	console.log(`\nPart 1 In-Process Results: ${inProcessPassed} passed, ${inProcessFailed} failed.`);
	if (inProcessFailed > 0) {
		console.error("[✗] In-process smoke probes failed.");
		process.exit(1);
	}

	// =========================================================================
	// PART 2: Workerd Runtime Integration Suite (Preview Server + Assets + R2)
	// =========================================================================
	console.log("\n=======================================================");
	console.log("PART 2: Workerd Runtime Integration Suite (Preview Server)");
	console.log("=======================================================");
	console.log("Reusing tests/integration/health.test.ts against local workerd preview server...");

	const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const vitestResult = cp.spawnSync(
		pnpmCmd,
		["exec", "vitest", "run", "tests/integration/health.test.ts"],
		{ stdio: "inherit", shell: true },
	);

	if (vitestResult.status !== 0) {
		console.error(`\n[✗] Workerd runtime smoke checks failed with exit code ${vitestResult.status}`);
		process.exit(vitestResult.status ?? 1);
	}

	console.log("\n=======================================================");
	console.log("[✓] All in-process boundary probes and workerd runtime smoke checks passed successfully.");
	console.log("=======================================================");
}

main().catch((err: unknown) => {
	console.error("[FATAL] Smoke script encountered unhandled error:", err);
	process.exit(1);
});
