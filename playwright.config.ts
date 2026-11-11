import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Rangkai.
 * Follows AGENTS.md conventions: Mobile-first responsive validation,
 * deterministic execution, and seamless Vite + Cloudflare local server testing.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: [["list"]],
	timeout: 30000,
	expect: {
		timeout: 5000,
	},
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 720 },
			},
		},
		{
			name: "mobile-chrome",
			use: {
				...devices["Pixel 7"],
			},
		},
	],
	webServer: {
		command: "pnpm dev",
		url: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173",
		reuseExistingServer: true,
		timeout: 60000,
	},
});
