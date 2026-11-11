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
try {
	cp.execSync(`${npmCmd} exec vite build`, {
		stdio: "inherit",
		env: { ...process.env, CLOUDFLARE_ENV: "production" },
	});
	console.log("[build:prod] Production bundle built successfully.");
} catch (err: unknown) {
	const status =
		typeof err === "object" && err !== null && "status" in err
			? (err as { status?: number }).status
			: 1;
	console.error(`[build:prod] Production build failed with exit code ${status}`);
	process.exit(status ?? 1);
}
