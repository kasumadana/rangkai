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

const EVIDENCE_DIR = "D:/Development/Lomba/rangkai/.scratch/dashboard-organizer-20261108/evidence";

test.describe("Organizer Navigation & Dashboard Reproduction (Before Baseline)", () => {
	test.skip("reproduces navigation fallbacks and captures settled baseline before state", async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(90_000);
		fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.repro.${key}@test.local`;
		const orgName = `Desa Adat Repro ${key}`;
		const eventTitleA = `Upacara Melasti Segara ${key}`;
		const eventTitleB = `Karya Pujawali Pura Desa ${key}`;

		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		const page = await context.newPage();

		try {
			// 1. Sign up as organizer
			const signupRes = await context.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: {
					name: `Prajuru Repro ${key}`,
					email: orgEmail,
					password: "SyntheticBrowserPass123!",
				},
			});
			expect(signupRes.ok()).toBe(true);

			// 2. Create organization
			const orgRes = await context.request.post(`${baseURL}/api/organizations`, {
				data: {
					name: orgName,
					village: "Ubud",
					district: "Gianyar",
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
					venueName: "Pantai Lembeng",
					startsAt: new Date(Date.now() + 3600000).toISOString(),
					endsAt: new Date(Date.now() + 18000000).toISOString(),
					isSimulation: true,
				},
			});
			expect(eventARes.status()).toBe(201);

			// 4. Create Event B
			const eventBRes = await context.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: orgId,
					title: eventTitleB,
					category: "odalan",
					venueName: "Pura Desa Ubud",
					startsAt: new Date(Date.now() + 86400000).toISOString(),
					endsAt: new Date(Date.now() + 90000000).toISOString(),
					isSimulation: true,
				},
			});
			expect(eventBRes.status()).toBe(201);

			// 5. Navigate to /dashboard
			await page.goto("/dashboard");
			await page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(page.getByText(eventTitleA).first()).toBeVisible({ timeout: 15000 });
			await expect(page.getByText(eventTitleB).first()).toBeVisible({ timeout: 15000 });

			// Record and assert baseline evidence:
			// 5.A: Eyebrow contains filler: "Pusat Koordinasi Desa Adat • Zona Waktu WITA"
			const eyebrow = page.locator(".teduh-workspace-eyebrow");
			const eyebrowText = (await eyebrow.textContent()) || "";
			console.log("[REPRO CONFIRMED] Baseline eyebrow text:", eyebrowText.trim());
			expect(eyebrowText).toContain("Pusat Koordinasi Desa Adat • Zona Waktu WITA");

			// 5.B: Check sidebar links on /dashboard without active event
			const sidebar = page.locator(".teduh-workspace-sidebar");
			const suratEdaranLink = sidebar.getByRole("link", { name: "Surat Edaran & Detail" });
			const suratEdaranHref = await suratEdaranLink.getAttribute("href");
			console.log("[REPRO CONFIRMED] Surat Edaran & Detail href on /dashboard:", suratEdaranHref);
			expect(suratEdaranHref).toBe("/dashboard/events/new");

			const petaRuasJalanLink = sidebar.getByRole("link", { name: "Peta & Ruas Jalan" });
			const petaRuasJalanHref = await petaRuasJalanLink.getAttribute("href");
			console.log("[REPRO CONFIRMED] Peta & Ruas Jalan href on /dashboard:", petaRuasJalanHref);
			expect(petaRuasJalanHref).toBe("/dashboard");

			const timUndanganLink = sidebar.getByRole("link", { name: "Tim & Undangan Petugas" });
			const timUndanganHref = await timUndanganLink.getAttribute("href");
			console.log("[REPRO CONFIRMED] Tim & Undangan href on /dashboard:", timUndanganHref);
			expect(timUndanganHref).toBe("/dashboard");

			const kebersihanLink = sidebar.getByRole("link", { name: "Kebersihan & Sampah" });
			const kebersihanHref = await kebersihanLink.getAttribute("href");
			console.log("[REPRO CONFIRMED] Kebersihan & Sampah href on /dashboard:", kebersihanHref);
			expect(kebersihanHref).toBe("/dashboard");

			// 6. Capture Settled BEFORE screenshots across viewports
			// 1440px Desktop
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/before-dashboard-1440px.png`,
				fullPage: true,
			});

			// 1024px Tablet Landscape
			await page.setViewportSize({ width: 1024, height: 768 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/before-dashboard-1024px.png`,
				fullPage: true,
			});

			// 768px Tablet Portrait
			await page.setViewportSize({ width: 768, height: 1024 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/before-dashboard-768px.png`,
				fullPage: true,
			});

			// 390px Mobile
			await page.setViewportSize({ width: 390, height: 844 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/before-dashboard-390px.png`,
				fullPage: true,
			});

			// 320px Mobile
			await page.setViewportSize({ width: 320, height: 568 });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: `${EVIDENCE_DIR}/before-dashboard-320px.png`,
				fullPage: true,
			});

			console.log("[REPRO CONFIRMED] All BEFORE baseline screenshots captured to", EVIDENCE_DIR);
		} finally {
			await context.close();

			// Database cleanup
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
