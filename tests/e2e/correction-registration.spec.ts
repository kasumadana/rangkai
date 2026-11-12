import { approveSyntheticOrganization } from "./approval-fixture";
import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import { auditLogs, memberships, organizations, organizationApplications, platformAudit } from "../../src/db/schema";

test("registration creates an identity and an organization with a persistent session", async ({ page, browser, baseURL }) => {
	test.setTimeout(120_000);
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
		await page.getByRole("link", { name: "Ajukan Organisasi Desa Adat" }).click();
		await page.getByLabel("Nama organisasi").fill(orgName);
        await page.getByLabel("Desa / wilayah").fill("Wilayah uji");
        await page.getByLabel("Kabupaten / kota").fill("Gianyar");
        const create = page.waitForResponse(r => r.url().endsWith("/api/me/organization-applications") && r.request().method() === "POST");
        await page.getByRole("button", { name: "Kirim pengajuan" }).click();
        const response = await create; expect(response.status()).toBe(201);
        const application = (await response.json()) as { application: { id: string } };
        await expect(page).toHaveURL(/\/onboarding\/status/); await page.reload();
        await expect(page.getByText(/Menunggu tinjauan/)).toBeVisible();
        const before = await page.request.get("/api/organizations/my");
        expect((await before.json() as { organizations: unknown[] }).organizations).toHaveLength(0);
        const approved = await approveSyntheticOrganization(browser, page.request, baseURL, { name: orgName, village: "Wilayah uji", district: "Gianyar" }, application.application.id);
        const membershipsResponse = await page.request.get("/api/organizations/my"); expect(membershipsResponse.status()).toBe(200);
        const membershipsData = await membershipsResponse.json() as { organizations: Array<{ name: string; role: string }> };
        expect(membershipsData.organizations).toContainEqual(expect.objectContaining({ name: orgName, role: "organizer" }));
        await page.goto("/settings"); await page.getByLabel("Organisasi aktif").selectOption(approved.organization.id);
        await expect(page.locator("dd").filter({ hasText: "Panitia" })).toBeVisible();
        await page.reload(); await expect(page.locator("dd").filter({ hasText: "Panitia" })).toBeVisible();
		await expect(page.getByText("Sedang memuat dan memvalidasi data terverifikasi dari server.").first()).toBeHidden();
		await page.screenshot({ path: "./.scratch/production-readiness/correction-evidence/registration-settled.png", fullPage: true });
	} finally {
		const [testUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
		const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
		if (testUser) {
            const applications = await db.select({ id: organizationApplications.id }).from(organizationApplications).where(eq(organizationApplications.applicantId, testUser.id));
            for (const application of applications) await db.delete(platformAudit).where(eq(platformAudit.applicationId, application.id));
            await db.delete(organizationApplications).where(eq(organizationApplications.applicantId, testUser.id));
        }
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
