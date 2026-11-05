/**
 * Production build script for Cloudflare Workers + React SPA.
 *
 * Enforces CLOUDFLARE_ENV=production at build time, ensuring that the
 * Cloudflare Vite plugin flattens the production environment configuration
 * (e.g. Worker name 'rangkai-production', R2 bucket 'rangkai-documents-prod')
 * into dist/rangkai/wrangler.json.
 */

import cp from "node:child_process";

process.env.CLOUDFLARE_ENV = "production";
const npmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

console.log("[build:prod] Building production bundle with CLOUDFLARE_ENV=production...");
const res = cp.spawnSync(npmCmd, ["exec", "vite", "build"], {
	stdio: "inherit",
	env: { ...process.env, CLOUDFLARE_ENV: "production" },
	shell: true,
});

if (res.status !== 0) {
	console.error(`[build:prod] Production build failed with exit code ${res.status}`);
	process.exit(res.status ?? 1);
}

console.log("[build:prod] Production bundle built successfully.");
