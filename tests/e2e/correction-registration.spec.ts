import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import { auditLogs, memberships, organizations } from "../../src/db/schema";

test("registration creates an identity and an organization with a persistent session", async ({ page }) => {
	const { pinnedUrl } = await assertDevBranch();
	const db = getDb(pinnedUrl);
	const key = randomUUID().slice(0, 8);
	const email = `correction.${key}@test.local`;
	const orgName = `Synthetic browser organization ${key}`;
	try {
		await page.goto("/register");
		await page.locator("#reg-name").fill(`Browser ${key}`);
		await page.locator("#reg-email").fill(email);
		await page.locator("#reg-password").fill("SyntheticBrowserPass123!");
		await page.locator("#reg-confirm").fill("SyntheticBrowserPass123!");
		const signup = page.waitForResponse((r) => r.url().includes("/api/auth/sign-up/email") && r.request().method() === "POST");
		await page.getByRole("button", { name: "Daftar Akun Baru" }).click();
		expect((await signup).ok()).toBe(true);
		await expect(page.getByRole("heading", { name: "Pendaftaran Akun Berhasil" })).toBeVisible();
		await page.getByRole("link", { name: "Buat Organisasi Desa Adat" }).click();
		await page.locator("#org-name").fill(orgName);
		await page.locator("#org-village").fill("Wilayah uji");
		const create = page.waitForResponse((r) => r.url().endsWith("/api/organizations") && r.request().method() === "POST");
		await page.getByRole("button", { name: "Simpan & Lanjut ke Dashboard" }).click();
		expect((await create).status()).toBe(201);
		await expect(page).toHaveURL(/\/dashboard/);
		await page.reload();
		const membershipsResponse = await page.request.get("/api/organizations/my");
		expect(membershipsResponse.status()).toBe(200);
		const membershipsData = await membershipsResponse.json() as { organizations: Array<{ name: string; role: string }> };
		expect(membershipsData.organizations).toContainEqual(expect.objectContaining({ name: orgName, role: "organizer" }));
		await expect(page.locator("select").filter({ has: page.locator("option", { hasText: orgName }) }).first()).toBeVisible();
		await expect(page.getByText("Panitia Desa (Organizer)")).toBeVisible();
		await expect(page.getByText("Sedang memuat dan memvalidasi data terverifikasi dari server.").first()).toBeHidden();
		await page.screenshot({ path: "D:/Development/Lomba/rangkai/.scratch/production-readiness/correction-evidence/registration-settled.png", fullPage: true });
	} finally {
		const [testUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
		const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
		if (org) {
			await db.delete(auditLogs).where(eq(auditLogs.organizationId, org.id));
			await db.delete(memberships).where(eq(memberships.organizationId, org.id));
			await db.delete(organizations).where(eq(organizations.id, org.id));
		}
		if (testUser) {
			await db.delete(session).where(eq(session.userId, testUser.id));
			await db.delete(account).where(eq(account.userId, testUser.id));
			await db.delete(user).where(eq(user.id, testUser.id));
		}
	}
});
