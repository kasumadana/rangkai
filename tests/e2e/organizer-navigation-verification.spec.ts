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

interface BrowserElement {
	getBoundingClientRect(): {
		x: number;
		y: number;
		width: number;
		height: number;
		top: number;
		right: number;
		bottom: number;
		left: number;
	};
	parentElement: BrowserElement | null;
	tagName: string;
	className: string;
	scrollWidth: number;
	clientWidth: number;
}

interface BrowserComputedStyle {
	fontSize: string;
	lineHeight: string;
	overflowX: string;
	outline: string;
	boxShadow: string;
}

declare const window: {
	getComputedStyle(el: unknown): BrowserComputedStyle;
};

declare const document: {
	documentElement: {
		style: {
			fontSize: string;
		};
	};
};

const EVIDENCE_DIR =
	process.env.TEST_ARTIFACT_DIR ||
	process.env.EVIDENCE_DIR ||
	"test-results/organizer-evidence";

test.describe("Organizer Navigation & Dashboard Verification (After Polish)", () => {
	test("verifies polished dashboard, contextual navigation, team invitation, bounds, and mixed-role resolution", async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(180_000);
		fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.verify.${key}@test.local`;
		const officerEmail = `officer.verify.${key}@test.local`;
		const orgNameA = `Desa Adat Verification A ${key}`;
		const orgNameB = `Desa Adat Verification B ${key}`;
		const eventTitleA = `Upacara Melasti Segara ${key}`;
		const eventTitleB = `Karya Pujawali Pura Desa ${key}`;

		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		const page = await context.newPage();

		const officerContext = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});

		let orgIdA = "";
		let orgIdB = "";
		let eventAId = "";
		let eventBId = "";

		try {
			// 1. Sign up as primary organizer
			const signupRes = await context.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: {
					name: `Prajuru Verify ${key}`,
					email: orgEmail,
					password: "SyntheticBrowserPass123!",
				},
			});
			expect(signupRes.ok()).toBe(true);

			// 2. Create organization A
			const orgARes = await context.request.post(`${baseURL}/api/organizations`, {
				data: {
					name: orgNameA,
					village: "Sanur",
					district: "Denpasar Selatan",
				},
			});
			expect(orgARes.status()).toBe(201);
			const orgAJson = (await orgARes.json()) as { organization: { id: string } };
			orgIdA = orgAJson.organization.id;

			// 3. Create organization B (for multi-org and mixed-role verification)
			const orgBRes = await context.request.post(`${baseURL}/api/organizations`, {
				data: {
					name: orgNameB,
					village: "Kuta",
					district: "Badung",
				},
			});
			expect(orgBRes.status()).toBe(201);
			const orgBJson = (await orgBRes.json()) as { organization: { id: string } };
			orgIdB = orgBJson.organization.id;

			// 4. Create Event A in Org A
			const eventARes = await context.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: orgIdA,
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

			// 5. Create Event B in Org A
			const eventBRes = await context.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: orgIdA,
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

			// 6. Navigate to /dashboard
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

			// --- VERIFICATION 5: Proportional Typography & Computed Styles ---
			// Check Event Title font size: ~18px
			const firstTitle = page.getByText(eventTitleA).first();
			const titleFontSize = await firstTitle.evaluate((el: unknown) => window.getComputedStyle(el).fontSize);
			const titleFontSizePx = parseFloat(titleFontSize);
			console.log("[VERIFY TYPOGRAPHY] Event Title font size:", titleFontSize);
			expect(titleFontSizePx).toBeGreaterThanOrEqual(15);

			// Check Metadata font size: ~14px (text-base token)
			const venueMeta = page.getByText("Pantai Sanur").first();
			const metaFontSize = await venueMeta.evaluate((el: unknown) => window.getComputedStyle(el).fontSize);
			const metaFontSizePx = parseFloat(metaFontSize);
			console.log("[VERIFY TYPOGRAPHY] Metadata font size:", metaFontSize);
			expect(metaFontSizePx).toBeGreaterThanOrEqual(13);

			// Check Action Button font size: at least 13px (no 9px or 11px tiny text)
			const firstKelola = kelolaLinks.first();
			const kelolaFontSize = await firstKelola.evaluate((el: unknown) => window.getComputedStyle(el).fontSize);
			const kelolaFontSizePx = parseFloat(kelolaFontSize);
			console.log("[VERIFY TYPOGRAPHY] Kelola button font size:", kelolaFontSize);
			expect(kelolaFontSizePx).toBeGreaterThanOrEqual(13);

			// Check Filter Select font size: at least 13px (no 9px micro text)
			const filterSelect = page.getByRole("combobox", { name: "Filter Desa Adat" });
			const selectFontSize = await filterSelect.evaluate((el: unknown) => window.getComputedStyle(el).fontSize);
			console.log("[VERIFY TYPOGRAPHY] Filter Select font size:", selectFontSize);
			expect(parseFloat(selectFontSize)).toBeGreaterThanOrEqual(13);

			// --- VERIFICATION 6: Bounds & Clipping Verifications across Viewports ---
			// 1024px: Verify Kelola button is NOT clipped inside TD or Table
			await page.setViewportSize({ width: 1024, height: 768 });
			await page.waitForTimeout(400);
			const bounds1024 = await firstKelola.evaluate((e: unknown) => {
				const target = e as BrowserElement;
				const r = target.getBoundingClientRect();
				let p = target.parentElement;
				let tdRight: number | null = null;
				while (p) {
					if (p.tagName === "TD") {
						tdRight = p.getBoundingClientRect().right;
						break;
					}
					p = p.parentElement;
				}
				return { linkRight: r.right, tdRight, clientWidth: target.clientWidth };
			});
			console.log("[VERIFY BOUNDS 1024px]", bounds1024);
			if (bounds1024.tdRight !== null) {
				expect(bounds1024.linkRight).toBeLessThanOrEqual(bounds1024.tdRight + 1);
			}
			await page.screenshot({ path: `${EVIDENCE_DIR}/after-dashboard-1024px.png`, fullPage: true });

			// 768px: Verify Kelola button right edge does NOT exceed viewport 768px
			await page.setViewportSize({ width: 768, height: 1024 });
			await page.waitForTimeout(400);
			const bounds768 = await firstKelola.evaluate((e: unknown) => (e as BrowserElement).getBoundingClientRect().right);
			console.log("[VERIFY BOUNDS 768px] linkRight:", bounds768);
			expect(bounds768).toBeLessThanOrEqual(768);
			await page.screenshot({ path: `${EVIDENCE_DIR}/after-dashboard-768px.png`, fullPage: true });

			// 390px Mobile Viewport
			await page.setViewportSize({ width: 390, height: 844 });
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${EVIDENCE_DIR}/after-dashboard-390px.png`, fullPage: true });

			// 320px Small Mobile: Verify Long-Org Filter Select does NOT overflow 320px
			await page.setViewportSize({ width: 320, height: 568 });
			await page.waitForTimeout(400);
			const selectBounds320 = await filterSelect.evaluate((e: unknown) => {
				const target = e as BrowserElement;
				const r = target.getBoundingClientRect();
				return { right: r.right, width: r.width };
			});
			console.log("[VERIFY BOUNDS 320px] selectBounds:", selectBounds320);
			expect(selectBounds320.right).toBeLessThanOrEqual(320);
			await page.screenshot({ path: `${EVIDENCE_DIR}/after-dashboard-320px.png`, fullPage: true });

			// Restore 1440px for interactive workflow testing
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${EVIDENCE_DIR}/after-dashboard-1440px.png`, fullPage: true });

			// --- VERIFICATION 7: Click Kelola for Event A -> Verify Contextual Nav ---
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

			// --- VERIFICATION 8: Navigate to Dokumen & AI (/document) ---
			await sidebarDokumen.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/document`);
			await expect(page.getByRole("tab", { name: "Dokumen & AI" })).toBeVisible();

			// --- VERIFICATION 9: Navigate to Dampak Jalan (/roads) ---
			await sidebarJalan.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/roads`);
			await expect(page.getByRole("tab", { name: "Dampak Jalan" })).toBeVisible();

			// --- VERIFICATION 10: Navigate to Kebersihan (/cleanup) ---
			await sidebarKebersihan.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/cleanup`);
			await expect(page.getByRole("tab", { name: "Kebersihan" })).toBeVisible();

			// --- VERIFICATION 11: Navigate to Tim & Petugas (/team) & Test Invitation Workflow ---
			await sidebarTim.click();
			await expect(page).toHaveURL(`/dashboard/events/${eventAId}/team`);
			await expect(page.getByRole("tab", { name: "Tim & Petugas" })).toBeVisible();

			// Ensure Team Management UI is loaded
			await expect(page.getByRole("heading", { name: "Buat Tautan Undangan Petugas", exact: true })).toBeVisible({ timeout: 15000 });

			// Verify team form input font size: at least 13px (no 9px)
			const inviteEmailInput = page.getByPlaceholder("contoh: pecalang.desa@rangkai.local");
			const inputFont = await inviteEmailInput.evaluate((el: unknown) => window.getComputedStyle(el).fontSize);
			console.log("[VERIFY TYPOGRAPHY] Team invite input font size:", inputFont);
			expect(parseFloat(inputFont)).toBeGreaterThanOrEqual(13);

			// Test failed creation (invalid email 422) recovers honestly without unhandled promise rejection
			await inviteEmailInput.fill("not-an-email");
			const submitInviteBtn = page.getByRole("button", { name: "Buat Tautan Undangan Petugas" });
			const invalidResPromise = page.waitForResponse((r) => r.url().includes("/api/invitations") && r.request().method() === "POST");
			await submitInviteBtn.click();
			const invalidRes = await invalidResPromise;
			expect(invalidRes.status()).toBe(422);
			await expect(page.getByText(/email/i).first()).toBeVisible({ timeout: 5000 });

			// Fill in valid invitation form
			const inviteeEmail = `pecalang.invite.${key}@test.local`;
			await inviteEmailInput.fill(inviteeEmail);

			// Submit valid invitation
			const createResPromise = page.waitForResponse((r) => r.url().includes("/api/invitations") && r.request().method() === "POST");
			await submitInviteBtn.click();
			const createRes = await createResPromise;
			expect(createRes.status()).toBe(201);
			const createJson = (await createRes.json()) as { invitation: { id: string } };
			const inviteId = createJson.invitation.id;

			// Verify invitation appears in the pending list
			await expect(page.getByText(inviteeEmail)).toBeVisible({ timeout: 10000 });
			await expect(page.getByText("Menunggu").first()).toBeVisible();

			// Capture settled team state screenshot
			await page.waitForTimeout(500);
			await page.screenshot({ path: `${EVIDENCE_DIR}/after-team-settled.png`, fullPage: true });

			// Test exact Revocation (DELETE 200, API revoked, UI Dibatalkan, revoke button removed)
			const revokeBtn = page.getByRole("button", { name: "Batalkan" }).first();
			const deleteResPromise = page.waitForResponse((r) => r.url().includes(`/api/invitations/${inviteId}`) && r.request().method() === "DELETE");
			await revokeBtn.click();
			const deleteRes = await deleteResPromise;
			expect(deleteRes.status()).toBe(200);

			await expect(page.getByText("Dibatalkan", { exact: true })).toBeVisible({ timeout: 10000 });
			await expect(page.getByRole("button", { name: "Batalkan" })).toHaveCount(0);

			// Verify server API confirms exact revoked status
			const apiRes = await context.request.get(`${baseURL}/api/invitations?organizationId=${orgIdA}`);
			expect(apiRes.ok()).toBe(true);
			const apiJson = (await apiRes.json()) as { invitations: Array<{ id: string; status: string }> };
			const revokedInv = apiJson.invitations.find((inv) => inv.id === inviteId);
			expect(revokedInv?.status).toBe("revoked");

			// --- VERIFICATION 12: Return to Dashboard and check Event B context isolation ---
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

			// --- VERIFICATION 13: 200% Text Scaling Bounds Check ---
			await page.goto("/dashboard");
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "200%";
			});
			await page.waitForTimeout(500);

			// Verify Kelola button right edge does NOT exceed viewport 1440px
			const bounds200pct = await firstKelola.evaluate((e: unknown) => (e as BrowserElement).getBoundingClientRect().right);
			console.log("[VERIFY BOUNDS 200pct] linkRight:", bounds200pct);
			expect(bounds200pct).toBeLessThanOrEqual(1440);

			await page.screenshot({ path: `${EVIDENCE_DIR}/after-dashboard-200pct-text.png`, fullPage: true });

			// Reset font size
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "";
			});

			// --- VERIFICATION 14: Mixed-Role Current-Organization Resolution ---
			// Sign up officer account
			const officerPage = await officerContext.newPage();
			await officerContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: {
					name: `Pecalang Verify ${key}`,
					email: officerEmail,
					password: "SyntheticBrowserPass123!",
				},
			});

			// Invite officer to Org A as officer
			const offInviteRes = await context.request.post(`${baseURL}/api/invitations`, {
				data: {
					organizationId: orgIdA,
					eventId: eventAId,
					role: "officer",
					recipientEmail: officerEmail,
					canUpdateTraffic: false,
					canUpdateCleanup: true,
				},
			});
			expect(offInviteRes.status()).toBe(201);
			const offToken = ((await offInviteRes.json()) as { invitation: { token: string } }).invitation.token;
			await officerContext.request.post(`${baseURL}/api/invitations/${offToken}/accept`, { data: {} });

			// Invite officer to Org B as organizer (creating mixed memberships: Org A = officer, Org B = organizer)
			const mixedInviteRes = await context.request.post(`${baseURL}/api/invitations`, {
				data: {
					organizationId: orgIdB,
					role: "organizer",
					recipientEmail: officerEmail,
					canUpdateTraffic: false,
					canUpdateCleanup: false,
				},
			});
			expect(mixedInviteRes.status()).toBe(201);
			const mixedToken = ((await mixedInviteRes.json()) as { invitation: { token: string } }).invitation.token;
			await officerContext.request.post(`${baseURL}/api/invitations/${mixedToken}/accept`, { data: {} });

			// Test Org A selection on officer account: must show Petugas Lapangan and NOT Panitia
			await officerPage.goto("/dashboard");
			await officerPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			const officerOrgFilter = officerPage.getByRole("combobox", { name: "Filter Desa Adat" });
			await officerOrgFilter.selectOption(orgIdA);
			await expect(officerPage.locator(".teduh-workspace-org-badge")).toHaveAttribute("title", orgNameA);
			await expect(officerPage.locator(".teduh-workspace-role-pill")).toHaveText("Petugas Lapangan (Pecalang)");

			// Test Org B selection on officer account: must show Panitia Desa
			await officerOrgFilter.selectOption(orgIdB);
			await expect(officerPage.locator(".teduh-workspace-org-badge")).toHaveAttribute("title", orgNameB);
			await expect(officerPage.locator(".teduh-workspace-role-pill")).toHaveText("Panitia Desa (Organizer)");

			console.log("[VERIFICATION COMPLETE] All criteria verified successfully!");
		} finally {
			await Promise.all([context.close(), officerContext.close()]);

			// Database cleanup on Neon dev branch
			for (const orgName of [orgNameA, orgNameB]) {
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
			}

			for (const email of [orgEmail, officerEmail]) {
				const usersToDelete = await db
					.select({ id: user.id })
					.from(user)
					.where(eq(user.email, email));
				if (usersToDelete.length) {
					const uids = usersToDelete.map((u) => u.id);
					await db.delete(session).where(inArray(session.userId, uids));
					await db.delete(account).where(inArray(account.userId, uids));
					await db.delete(user).where(inArray(user.id, uids));
				}
			}
		}
	});
});
