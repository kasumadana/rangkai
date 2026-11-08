import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import {
	events,
	organizations,
	roadImpacts,
	roadSegments,
	cleanupTasks,
	wasteRecords,
	eventAssignments,
	invitations,
} from "../../src/db/schema";
import { eq, inArray } from "drizzle-orm";

const EVIDENCE_DIR = "D:/Development/Lomba/rangkai/.scratch/production-readiness/ui-polish-evidence";

const getScrollWidth = () =>
	(globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document
		.documentElement.scrollWidth;

test.describe("Rangkai UI/UX Audit & Polish Verification Suite", () => {
	test("verifies simplified layouts, removes clutter, checks responsive viewports, and captures settled evidence", async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(90_000);
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.polish.${key}@test.local`;
		const officerEmail = `officer.polish.${key}@test.local`;
		const orgName = `Desa Adat Teduh ${key}`;
		const eventTitle = `Upacara Tawur Labuh Gentuh ${key}`;
		const roadName = `Jalan Raya Suweta Simpang Puri ${key}`;

		// Setup Contexts for Desktop, Tablet, and 390px Mobile
		const desktopContext = await browser.newContext({
			viewport: { width: 1280, height: 800 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		const tabletContext = await browser.newContext({
			viewport: { width: 768, height: 1024 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		const mobileContext = await browser.newContext({
			viewport: { width: 390, height: 844 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});

		const desktopPage = await desktopContext.newPage();
		const tabletPage = await tabletContext.newPage();
		const mobilePage = await mobileContext.newPage();

		try {
			// -------------------------------------------------------------------
			// 1. PUBLIC SURFACES AUDIT & POLISH VERIFICATION
			// -------------------------------------------------------------------

			// 1.A Landing Page (/)
			await desktopPage.goto("/");
			await expect(desktopPage.locator("body")).toBeVisible();
			// Redundant text "Sistem Koordinasi Upacara Adat Bali" must be removed
			const redundantEyebrow = desktopPage.locator(".hero-label");
			await expect(redundantEyebrow).toHaveCount(0);
			// H1 is present and clean
			await expect(desktopPage.getByRole("heading", { level: 1 })).toBeVisible();

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/landing-1280px-desktop.png`,
				fullPage: true,
			});

			// Tablet Landing
			await tabletPage.goto("/");
			await tabletPage.waitForTimeout(500);
			await tabletPage.screenshot({
				path: `${EVIDENCE_DIR}/landing-768px-tablet.png`,
				fullPage: true,
			});

			// Mobile Landing (390px)
			await mobilePage.goto("/");
			await mobilePage.waitForTimeout(500);
			const mobileScrollWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileScrollWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/landing-390px-mobile.png`,
				fullPage: true,
			});

			// 1.B Public Events List (/events)
			await desktopPage.goto("/events");
			await expect(desktopPage.getByText(/Jadwal Upacara & Rekayasa Jalur Bali/i)).toBeVisible();
			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/events-list-1280px-desktop.png`,
				fullPage: true,
			});

			// Empty search state on /events
			const searchInput = desktopPage.locator('input[aria-label="Cari jadwal upacara"]');
			await searchInput.fill("NONEXISTENT_KEYWORD_XYZ_9999");
			await expect(desktopPage.getByText(/Tidak ditemukan jadwal yang sesuai/i)).toBeVisible();
			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/events-empty-state-search.png`,
			});
			await searchInput.clear();

			await mobilePage.goto("/events");
			const mobileEventsWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileEventsWidth).toBeLessThanOrEqual(390);
			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/events-list-390px-mobile.png`,
				fullPage: true,
			});

			// 1.C Public Map View (/peta)
			await desktopPage.goto("/peta");
			await desktopPage.waitForTimeout(1000);
			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/map-1280px-desktop.png`,
			});

			await mobilePage.goto("/peta");
			await mobilePage.waitForTimeout(1000);
			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/map-390px-mobile.png`,
			});

			// -------------------------------------------------------------------
			// 2. AUTHENTICATION PAGES AUDIT
			// -------------------------------------------------------------------
			await desktopPage.goto("/login");
			await expect(desktopPage.getByRole("heading", { name: "Masuk Petugas Desa" })).toBeVisible();
			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/login-1280px-desktop.png`,
			});

			await mobilePage.goto("/login");
			const mobileLoginWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileLoginWidth).toBeLessThanOrEqual(390);
			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/login-390px-mobile.png`,
			});

			await desktopPage.goto("/register");
			await expect(desktopPage.getByRole("heading", { name: "Daftar Akun Petugas" })).toBeVisible();
			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/register-1280px-desktop.png`,
			});

			await mobilePage.goto("/register");
			const mobileRegisterWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileRegisterWidth).toBeLessThanOrEqual(390);
			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/register-390px-mobile.png`,
			});

			// -------------------------------------------------------------------
			// 3. ORGANIZER DASHBOARD & WORKSPACE AUDIT
			// -------------------------------------------------------------------

			// Create Organizer user & organization via API
			const orgSignup = await desktopContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Prajuru ${key}`, email: orgEmail, password: "SyntheticBrowserPass123!" },
			});
			expect(orgSignup.ok()).toBe(true);

			const orgRes = await desktopContext.request.post(`${baseURL}/api/organizations`, {
				data: { name: orgName, village: "Ubud", district: "Gianyar" },
			});
			expect(orgRes.status()).toBe(201);
			const orgData = (await orgRes.json()) as { organization: { id: string } };
			const orgId = orgData.organization.id;

			// Create a test event and road
			const createEventRes = await desktopContext.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: orgId,
					title: eventTitle,
					category: "karya",
					venueName: "Puri Agung Ubud",
					startsAt: new Date(Date.now() + 3600000).toISOString(),
					endsAt: new Date(Date.now() + 18000000).toISOString(),
					isSimulation: true,
				},
			});
			expect(createEventRes.status()).toBe(201);
			const eventJson = (await createEventRes.json()) as { event: { id: string } };
			const eventId = eventJson.event.id;

			const addRoadRes = await desktopContext.request.post(`${baseURL}/api/events/${eventId}/simulation-road-impacts`, {
				data: {
					mutationId: randomUUID(),
					displayName: roadName,
					coverageArea: "Ubud",
					humanVerified: true,
					impactType: "closure",
					plannedFrom: new Date(Date.now() + 3600000).toISOString(),
					plannedTo: new Date(Date.now() + 18000000).toISOString(),
					coordinates: [
						[115.263, -8.506],
						[115.264, -8.507],
					],
				},
			});
			expect(addRoadRes.status()).toBe(201);

			// Synchronize cookies to tablet and mobile contexts
			const authCookies = await desktopContext.cookies();
			await tabletContext.addCookies(authCookies);
			await mobileContext.addCookies(authCookies);

			// Visit Dashboard on Desktop
			await desktopPage.goto("/dashboard");
			await expect(desktopPage.getByText(eventTitle).first()).toBeVisible();

			// Verify removal of "Inspektur Spasial Kegiatan" decorative eyebrow and verify "Peta kegiatan" heading
			await expect(desktopPage.getByText("Inspektur Spasial Kegiatan")).toHaveCount(0);
			await expect(desktopPage.getByText(/Peta kegiatan/i).first()).toBeVisible();

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-1280px-desktop.png`,
				fullPage: true,
			});

			// Tablet Dashboard
			await tabletPage.goto("/dashboard");
			await expect(tabletPage.getByText(eventTitle).first()).toBeVisible();
			await tabletPage.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-768px-tablet.png`,
				fullPage: true,
			});

			// Mobile Dashboard (390px)
			await mobilePage.goto("/dashboard");
			await expect(mobilePage.getByText(eventTitle).first()).toBeVisible();
			const mobileDashWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileDashWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-390px-mobile.png`,
				fullPage: true,
			});

			// -------------------------------------------------------------------
			// 4. ROAD EDITOR & CATALOG 503 RECOVERY
			// -------------------------------------------------------------------
			await desktopPage.goto(`/dashboard/events/${eventId}/roads`);
			await expect(desktopPage.getByText(roadName).first()).toBeVisible();

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/roads-editor-1280px-desktop.png`,
				fullPage: true,
			});

			await mobilePage.goto(`/dashboard/events/${eventId}/roads`);
			await expect(mobilePage.getByText(roadName).first()).toBeVisible();
			const mobileRoadsWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileRoadsWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/roads-editor-390px-mobile.png`,
				fullPage: true,
			});

			// -------------------------------------------------------------------
			// 5. SETTINGS PAGE AUDIT & POLISH
			// -------------------------------------------------------------------
			await desktopPage.goto("/settings");
			await expect(desktopPage.getByText(/Pengaturan Akun & Desa Adat/i)).toBeVisible();
			await expect(desktopPage.getByText(/Profil Petugas & Sesi Otentikasi/i)).toBeVisible();

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/settings-1280px-desktop.png`,
				fullPage: true,
			});

			await mobilePage.goto("/settings");
			const mobileSettingsWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileSettingsWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/settings-390px-mobile.png`,
				fullPage: true,
			});

			// -------------------------------------------------------------------
			// 6. FIELD TASKS WORKSPACE AUDIT & POLISH
			// -------------------------------------------------------------------

			// Create Officer and invite
			const inviteRes = await desktopContext.request.post(`${baseURL}/api/invitations`, {
				data: {
					organizationId: orgId,
					eventId,
					recipientEmail: officerEmail,
					role: "officer",
					canUpdateTraffic: true,
					canUpdateCleanup: true,
				},
			});
			expect(inviteRes.status()).toBe(201);
			const inviteData = (await inviteRes.json()) as { invitation: { token: string } };

			const officerContext = await browser.newContext({
				viewport: { width: 1280, height: 800 },
				extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
			});
			const officerPage = await officerContext.newPage();

			const officerSignup = await officerContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Petugas Lapangan ${key}`, email: officerEmail, password: "SyntheticBrowserPass123!" },
			});
			expect(officerSignup.ok()).toBe(true);

			const acceptRes = await officerContext.request.post(
				`${baseURL}/api/invitations/${inviteData.invitation.token}/accept`,
			);
			expect(acceptRes.status()).toBe(200);

			// Navigate to /field
			await officerPage.goto("/field");
			await expect(officerPage.getByText(eventTitle).first()).toBeVisible();

			await officerPage.screenshot({
				path: `${EVIDENCE_DIR}/field-tasks-1280px-desktop.png`,
				fullPage: true,
			});

			// Mobile Field Tasks (390px)
			const officerMobileContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
				extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
			});
			const officerCookies = await officerContext.cookies();
			await officerMobileContext.addCookies(officerCookies);
			const officerMobilePage = await officerMobileContext.newPage();

			await officerMobilePage.goto("/field");
			await expect(officerMobilePage.getByText(eventTitle).first()).toBeVisible();
			const mobileFieldWidth = await officerMobilePage.evaluate(getScrollWidth);
			expect(mobileFieldWidth).toBeLessThanOrEqual(390);

			await officerMobilePage.screenshot({
				path: `${EVIDENCE_DIR}/field-tasks-390px-mobile.png`,
				fullPage: true,
			});

			await officerMobileContext.close();
			await officerContext.close();

		} finally {
			await desktopContext.close();
			await tabletContext.close();
			await mobileContext.close();

			// Database cleanup
			const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
			if (org) {
				const owned = await db.select({ id: events.id }).from(events).where(eq(events.organizationId, org.id));
				if (owned.length) {
					const eventIds = owned.map((e) => e.id);
					await db.delete(cleanupTasks).where(inArray(cleanupTasks.eventId, eventIds));
					await db.delete(wasteRecords).where(inArray(wasteRecords.eventId, eventIds));

					const impacts = await db.select({ id: roadImpacts.id }).from(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					if (impacts.length) {
						await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					}
					await db.delete(eventAssignments).where(inArray(eventAssignments.eventId, eventIds));
				}
				await db.delete(roadSegments).where(eq(roadSegments.organizationId, org.id));
				await db.delete(invitations).where(eq(invitations.organizationId, org.id));
				await db.delete(organizations).where(eq(organizations.id, org.id));
			}
		}
	});
});
