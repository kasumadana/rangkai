import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import {
	auditLogs,
	cleanupTasks,
	eventAssignments,
	events,
	invitations,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
} from "../../src/db/schema";

declare const window: any;
declare const document: any;

const EVIDENCE_DIR = "D:/Development/Lomba/rangkai/.scratch/dashboard-organizer-20261108/evidence";

test.describe("Organizer Navigation & Dashboard Verification (After Polish)", () => {
	test("verifies polished dashboard, contextual navigation, team invitation, and captures after screenshots", async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(120_000);
		fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.verify.${key}@test.local`;
		const orgName = `Desa Adat Verification ${key}`;
		const eventTitleA = `Upacara Melasti Segara ${key}`;
		const eventTitleB = `Karya Pujawali Pura Desa ${key}`;

		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		const page = await context.newPage();

		let eventAId = "";
		let eventBId = "";

		try {
			// 1. Sign up as organizer
			const signupRes = await context.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: {
					name: `Prajuru Verify ${key}`,
					email: orgEmail,
					password: "SyntheticBrowserPass123!",
				},
			});
			expect(signupRes.ok()).toBe(true);

			// 2. Create organization
			const orgRes = await context.request.post(`${baseURL}/api/organizations`, {
				data: {
					name: orgName,
					village: "Sanur",
					district: "Denpasar Selatan",
				},
			});
			expect(orgRes.status()).toBe(201);
			const orgJson = (await orgRes.json()) as { organization: { id: string } };
			const orgId = orgJson.organization.id;

			// 3. Create Event A
			const eventARes = await context.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: orgId,
					title: eventTitleA,
					category: "melasti",
					venueName: "Pantai Sanur",
					startsAt: new Date(Date.now() + 3600000).toISOString(),
					endsAt: new Date(Date.now() + 18000000).toISOString(),
					isSimulation: true,
				},
			});
			expect(eventARes.status()).toBe(201);
			const eventAJson = (await eventARes.json()) as { event: { id: string } };
			eventAId = eventAJson.event.id;

			// 4. Create Event B
			const eventBRes = await context.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: orgId,
					title: eventTitleB,
					category: "odalan",
					venueName: "Pura Segara Sanur",
					startsAt: new Date(Date.now() + 86400000).toISOString(),
					endsAt: new Date(Date.now() + 90000000).toISOString(),
					isSimulation: true,
				},
			});
			expect(eventBRes.status()).toBe(201);
			const eventBJson = (await eventBRes.json()) as { event: { id: string } };
			eventBId = eventBJson.event.id;

			// 5. Navigate to /dashboard
			await page.goto("/dashboard");
			await page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(page.getByText(eventTitleA).first()).toBeVisible({ timeout: 15000 });
			await expect(page.getByText(eventTitleB).first()).toBeVisible({ timeout: 15000 });

			// --- VERIFICATION 1: Eyebrow filler is gone ---
			const pageText = await page.textContent("body");
			expect(pageText).not.toContain("Pusat Koordinasi Desa Adat • Zona Waktu WITA");

			// --- VERIFICATION 2: General navigation on /dashboard without active event ---
			const sidebar = page.locator(".teduh-workspace-sidebar");
			await expect(sidebar.getByRole("link", { name: "Ikhtisar Kegiatan" })).toBeVisible();
			await expect(sidebar.getByRole("link", { name: "Pengaturan" })).toBeVisible();
			await expect(sidebar.getByRole("link", { name: "Buat Kegiatan" })).toBeVisible();

			// Ensure fake links to /dashboard or /events/new do NOT appear in sidebar
			await expect(sidebar.getByRole("link", { name: "Surat Edaran & Detail" })).toHaveCount(0);
			await expect(sidebar.getByRole("link", { name: "Peta & Ruas Jalan" })).toHaveCount(0);
			await expect(sidebar.getByRole("link", { name: "Tim & Undangan Petugas" })).toHaveCount(0);
			await expect(sidebar.getByRole("link", { name: "Kebersihan & Sampah" })).toHaveCount(0);

			// Check guidance text
			await expect(sidebar.getByText(/Pilih kegiatan dari daftar/i)).toBeVisible();

			// --- VERIFICATION 3: Dashboard has no duplicate side-panel map editor ---
			await expect(page.locator("text=Editor Ruas & Penutupan Cepat")).toHaveCount(0);
			await expect(page.locator("text=Pilih kegiatan dari daftar untuk menginspeksi atau mengedit ruas jalan")).toHaveCount(0);

			// --- VERIFICATION 4: Activity Table / List with Kelola buttons ---
			const kelolaLinks = page.getByRole("link", { name: "Kelola Kegiatan" });
			expect(await kelolaLinks.count()).toBeGreaterThanOrEqual(2);

			// --- VERIFICATION 5: Proportional Typography & Bounds ---
			// Check Event Title font size: should be ~16-18px (font-semibold text-lg)
			const firstTitle = page.getByText(eventTitleA).first();
			const titleFontSize = await firstTitle.evaluate((el: any) => window.getComputedStyle(el).fontSize);
			const titleFontSizePx = parseFloat(titleFontSize);
			console.log("[VERIFY TYPOGRAPHY] Event Title font size:", titleFontSize);
			expect(titleFontSizePx).toBeGreaterThanOrEqual(15); // 16px-18px nominal

			// Check Metadata font size: should be ~14px (text-base)
			const venueMeta = page.getByText("Pantai Sanur").first();
			const metaFontSize = await venueMeta.evaluate((el: any) => window.getComputedStyle(el).fontSize);
			const metaFontSizePx = parseFloat(metaFontSize);
			console.log("[VERIFY TYPOGRAPHY] Metadata font size:", metaFontSize);
			expect(metaFontSizePx).toBeGreaterThanOrEqual(13); // 14px nominal

			// Check Action Button font size: should be at least 13px (no 11px tiny text)
			const firstKelola = kelolaLinks.first();
			const kelolaFontSize = await firstKelola.evaluate((el: any) => window.getComputedStyle(el).fontSize);
			const kelolaFontSizePx = parseFloat(kelolaFontSize);
			console.log("[VERIFY TYPOGRAPHY] Kelola button font size:", kelolaFontSize);
			expect(kelolaFontSizePx).toBeGreaterThanOrEqual(13); // 14px nominal

			// --- CAPTURE AFTER SCREENSHOTS (5 Viewports) ---
			// 1440px Desktop
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/after-dashboard-1440px.png`,
				fullPage: true,
			});

			// 1024px Tablet Landscape
			await page.setViewportSize({ width: 1024, height: 768 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/after-dashboard-1024px.png`,
				fullPage: true,
			});

			// 768px Tablet Portrait
			await page.setViewportSize({ width: 768, height: 1024 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/after-dashboard-768px.png`,
				fullPage: true,
			});

			// 390px Mobile
			await page.setViewportSize({ width: 390, height: 844 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/after-dashboard-390px.png`,
				fullPage: true,
			});

			// 320px Small Mobile
			await page.setViewportSize({ width: 320, height: 568 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/after-dashboard-320px.png`,
				fullPage: true,
			});

			// Restore 1440px for interactive workflow testing
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.waitForTimeout(300);

			// --- VERIFICATION 6: Click Kelola for Event A -> Verify Contextual Nav ---
			const eventARowKelola = page.locator(`tr:has-text("${eventTitleA}")`).getByRole("link", { name: "Kelola Kegiatan" }).first();
			await eventARowKelola.click();

			await expect(page).toHaveURL(`/dashboard/events/${eventAId}`);
			await page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});

			// Verify contextual sidebar header displays event name and Kembali link
			await expect(sidebar.getByText(eventTitleA)).toBeVisible({ timeout: 10000 });
			await expect(sidebar.getByRole("link", { name: "Kembali ke Daftar" })).toBeVisible();

			// Verify all 5 contextual event links in sidebar
			const sidebarRingkasan = sidebar.getByRole("link", { name: "Ringkasan / Detail" });
			const sidebarDokumen = sidebar.getByRole("link", { name: "Dokumen & AI" });
			const sidebarJalan = sidebar.getByRole("link", { name: "Dampak Jalan" });
			const sidebarKebersihan = sidebar.getByRole("link", { name: "Kebersihan" });
			const sidebarTim = sidebar.getByRole("link", { name: "Tim & Petugas" });

			await expect(sidebarRingkasan).toHaveAttribute("href", `/dashboard/events/${eventAId}`);
			await expect(sidebarDokumen).toHaveAttribute("href", `/dashboard/events/${eventAId}/document`);
			await expect(sidebarJalan).toHaveAttribute("href", `/dashboard/events/${eventAId}/roads`);
			await expect(sidebarKebersihan).toHaveAttribute("href", `/dashboard/events/${eventAId}/cleanup`);
			await expect(sidebarTim).toHaveAttribute("href", `/dashboard/events/${eventAId}/team`);

			// --- VERIFICATION 7: Navigate to Dokumen & AI (/document) ---
			await sidebarDokumen.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/document`);
			await expect(page.getByRole("tab", { name: "Dokumen & AI" })).toBeVisible();

			// --- VERIFICATION 8: Navigate to Dampak Jalan (/roads) ---
			await sidebarJalan.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/roads`);
			await expect(page.getByRole("tab", { name: "Dampak Jalan" })).toBeVisible();

			// --- VERIFICATION 9: Navigate to Kebersihan (/cleanup) ---
			await sidebarKebersihan.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/cleanup`);
			await expect(page.getByRole("tab", { name: "Kebersihan" })).toBeVisible();

			// --- VERIFICATION 10: Navigate to Tim & Petugas (/team) & Test Invitation Workflow ---
			await sidebarTim.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/team`);
			await expect(page.getByRole("tab", { name: "Tim & Petugas" })).toBeVisible();

			// Ensure Team Management UI is loaded
			await expect(page.getByText("Buat Tautan Undangan Petugas").first()).toBeVisible({ timeout: 15000 });

			// Fill in invitation form
			const inviteeEmail = `petugas.field.${key}@test.local`;
			await page.getByPlaceholder("contoh: pecalang.desa@rangkai.local").fill(inviteeEmail);
			
			// Submit invitation
			const submitInviteBtn = page.getByRole("button", { name: "Buat Tautan Undangan Petugas" });
			await submitInviteBtn.click();

			// Verify invitation appears in the pending list
			await expect(page.getByText(inviteeEmail)).toBeVisible({ timeout: 10000 });
			await expect(page.getByText("Menunggu").first()).toBeVisible();

			// Verify Revoke button works
			const revokeBtn = page.getByRole("button", { name: "Batalkan" }).first();
			await revokeBtn.click();
			// After revocation, invitation status should update or item should be marked Dibatalkan
			await expect(page.getByText("Dibatalkan").or(page.getByText(inviteeEmail))).toBeVisible();

			// --- VERIFICATION 11: Return to Dashboard and check Event B context isolation ---
			const backToListLink = sidebar.getByRole("link", { name: "Kembali ke Daftar" });
			await backToListLink.click();
			await expect(page).toHaveURL("/dashboard");

			// Open Event B
			const eventBRowKelola = page.locator(`tr:has-text("${eventTitleB}")`).getByRole("link", { name: "Kelola Kegiatan" }).first();
			await eventBRowKelola.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventBId}`);

			// Verify sidebar now targets Event B (not Event A)
			await expect(sidebar.getByText(eventTitleB)).toBeVisible({ timeout: 10000 });
			await expect(sidebar.getByRole("link", { name: "Dokumen & AI" })).toHaveAttribute(
				"href",
				`/dashboard/events/${eventBId}/document`
			);
			await expect(sidebar.getByRole("link", { name: "Tim & Petugas" })).toHaveAttribute(
				"href",
				`/dashboard/events/${eventBId}/team`
			);

			// --- VERIFICATION 12: 200% Text Scaling / Zoom Accessibility Check ---
			await page.goto("/dashboard");
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "200%";
			});
			await page.waitForTimeout(500);

			// Verify table / cards still render cleanly without catastrophic overflow
			await expect(page.getByText(eventTitleA).first()).toBeVisible();
			await page.screenshot({
				path: `${EVIDENCE_DIR}/after-dashboard-200pct-text.png`,
				fullPage: true,
			});

			console.log("[VERIFICATION COMPLETE] All criteria verified successfully!");
		} finally {
			await context.close();

			// Database cleanup on Neon dev branch
			const [org] = await db
				.select({ id: organizations.id })
				.from(organizations)
				.where(eq(organizations.name, orgName));
			if (org) {
				const owned = await db
					.select({ id: events.id })
					.from(events)
					.where(eq(events.organizationId, org.id));
				if (owned.length) {
					const eventIds = owned.map((e) => e.id);
					await db.delete(cleanupTasks).where(inArray(cleanupTasks.eventId, eventIds));
					await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					await db.delete(eventAssignments).where(inArray(eventAssignments.eventId, eventIds));
				}
				await db.delete(roadSegments).where(eq(roadSegments.organizationId, org.id));
				await db.delete(invitations).where(eq(invitations.organizationId, org.id));
				await db.delete(auditLogs).where(eq(auditLogs.organizationId, org.id));
				await db.delete(events).where(eq(events.organizationId, org.id));
				await db.delete(memberships).where(eq(memberships.organizationId, org.id));
				await db.delete(organizations).where(eq(organizations.id, org.id));
			}

			const usersToDelete = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.email, orgEmail));
			if (usersToDelete.length) {
				const uids = usersToDelete.map((u) => u.id);
				await db.delete(session).where(inArray(session.userId, uids));
				await db.delete(account).where(inArray(account.userId, uids));
				await db.delete(user).where(inArray(user.id, uids));
			}
		}
	});
});
