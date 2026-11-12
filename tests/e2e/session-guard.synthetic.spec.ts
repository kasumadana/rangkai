import { expect, test } from "@playwright/test";

test.use({ video: "off" });

test("anonymous users are redirected from private routes", async ({ page }) => {
	await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
	for (const path of ["/dashboard", "/dashboard/events/new", "/field", "/field/events/123", "/settings", "/onboarding/organization"]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/$/);
	}
});

test("session failure never renders workspace and retry recovers", async ({ page }) => {
	let fail = true;
	await page.route("**/api/auth/get-session", route => fail ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: null }));
	await page.goto("/dashboard");
	await expect(page.getByRole("alert").filter({ hasText: "Sesi belum dapat diperiksa" })).toBeVisible();
	await expect(page.locator(".teduh-workspace-shell")).toHaveCount(0);
	fail = false;
	await page.getByRole("button", { name: "Coba lagi" }).click();
	await expect(page).toHaveURL(/\/$/);
});

test("logout returns to landing and back cannot reopen workspace", async ({ page }) => {
	let loggedIn = true;
	await page.route("**/api/auth/get-session", route => route.fulfill({ json: loggedIn ? { user: { id: "user-1", name: "Pengguna", email: "user@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" } } : null }));
	await page.route("**/api/auth/sign-out", route => { loggedIn = false; return route.fulfill({ json: { success: true } }); });
	await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [] } }));
	await page.goto("/settings");
	await expect(page.locator(".teduh-workspace-shell")).toBeVisible();
	await page.getByRole("button", { name: "Profil" }).click();
	await page.getByRole("button", { name: "Keluar", exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.goBack().catch(() => null);
	await expect(page.locator(".teduh-workspace-shell")).toHaveCount(0);
	await page.goto("/dashboard");
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator(".teduh-workspace-shell")).toHaveCount(0);
});

test("logout in another tab closes the protected workspace", async ({ browser, baseURL }) => {
	const context = await browser.newContext({ baseURL });
	let loggedIn = true;
	await context.route("**/api/auth/get-session", route => route.fulfill({ json: loggedIn ? { user: { id: "user-1", name: "Pengguna", email: "user@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" } } : null }));
	await context.route("**/api/auth/sign-out", route => { loggedIn = false; return route.fulfill({ json: { success: true } }); });
	await context.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [] } }));
	const first = await context.newPage(); const second = await context.newPage();
	await first.goto("/settings"); await second.goto("/settings");
	await expect(first.locator(".teduh-workspace-shell")).toBeVisible();
	await expect(second.locator(".teduh-workspace-shell")).toBeVisible();
	await first.getByRole("button", { name: "Profil" }).click();
	await first.getByRole("button", { name: "Keluar", exact: true }).click();
	await expect(second).toHaveURL(/\/$/);
	await expect(second.locator(".teduh-workspace-shell")).toHaveCount(0);
	await context.close();
});
