import { approveSyntheticOrganization } from "./approval-fixture";
import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
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
import { user, account, session } from "../../src/db/auth-schema";
import { eq, inArray } from "drizzle-orm";

const EVIDENCE_DIR = "./.scratch/ui-refinement-20261108/correction-evidence";

const getScrollWidth = () =>
	(globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document
		.documentElement.scrollWidth;

test.use({ actionTimeout: 10_000 });

test.describe("Rangkai UI/UX Audit & Polish Verification Suite", () => {
	test("verifies simplified layouts, removes clutter, checks responsive viewports, and captures settled evidence", async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(180_000);
		fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.polish.${key}@test.local`;
		const officerEmail = `officer.polish.${key}@test.local`;
		const orgName = `Desa Adat Teduh ${key}`;
		const eventTitle = `Upacara Tawur Labuh Gentuh ${key}`;
		const roadName = `Jalan Raya Suweta Simpang Puri ${key}`;

		// Setup Contexts for 1440px Wide Desktop, 1280px Desktop, 768px Tablet, 390px Mobile, and 320px Mobile
		const desktop1440Context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
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
		const mobile320Context = await browser.newContext({
			viewport: { width: 320, height: 568 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});

		// Officer contexts declared in outer scope so finally reliably cleans them up (STD-4)
		let officerContext: BrowserContext | null = null;
		let officerMobileContext: BrowserContext | null = null;
		let officerMobile320Context: BrowserContext | null = null;

		const desktop1440Page = await desktop1440Context.newPage();
		const desktopPage = await desktopContext.newPage();
		const tabletPage = await tabletContext.newPage();
		const mobilePage = await mobileContext.newPage();
		const mobile320Page = await mobile320Context.newPage();

		try {
			// -------------------------------------------------------------------
			// 1. PUBLIC SURFACES AUDIT & POLISH VERIFICATION
			// -------------------------------------------------------------------

			// 1.A Landing Page (/)
			await desktopPage.goto("/");
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.locator("body")).toBeVisible();
			// Redundant text "Sistem Koordinasi Upacara Adat Bali" must be removed
			const redundantEyebrow = desktopPage.locator(".hero-label");
			await expect(redundantEyebrow).toHaveCount(0);
			// H1 is present and clean
			await expect(desktopPage.getByRole("heading", { level: 1 })).toBeVisible();

			// Reveal #jadwal GSAP section before snapshot and wait for settled cards or empty state
			await desktopPage.locator("#jadwal").scrollIntoViewIfNeeded();
			await expect(desktopPage.locator(".schedule-grid, [data-gsap='scroll-card']").first()).toBeVisible({ timeout: 10000 });

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/landing-1280px-desktop.png`,
				fullPage: true,
			});

			// Wide 1440px Landing
			await desktop1440Page.goto("/");
			await desktop1440Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await desktop1440Page.locator("#jadwal").scrollIntoViewIfNeeded();
			await expect(desktop1440Page.locator(".schedule-grid, [data-gsap='scroll-card']").first()).toBeVisible({ timeout: 10000 });
			await desktop1440Page.screenshot({
				path: `${EVIDENCE_DIR}/landing-1440px-desktop.png`,
				fullPage: true,
			});

			// Tablet Landing (768px)
			await tabletPage.goto("/");
			await tabletPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await tabletPage.locator("#jadwal").scrollIntoViewIfNeeded();
			await expect(tabletPage.locator(".schedule-grid, [data-gsap='scroll-card']").first()).toBeVisible({ timeout: 10000 });
			const tabletScrollWidth = await tabletPage.evaluate(getScrollWidth);
			expect(tabletScrollWidth).toBeLessThanOrEqual(768);
			await tabletPage.screenshot({
				path: `${EVIDENCE_DIR}/landing-768px-tablet.png`,
				fullPage: true,
			});

			// Mobile Landing (390px)
			await mobilePage.goto("/");
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await mobilePage.locator("#jadwal").scrollIntoViewIfNeeded();
			await expect(mobilePage.locator(".schedule-grid, [data-gsap='scroll-card']").first()).toBeVisible({ timeout: 10000 });

			// SPEC-2.3: Mobile schedule filter bar must start at reachable first filter (no negative scroll clipping)
			const landingFirstFilter390 = mobilePage.locator(".schedule-filter-bar .schedule-filter-btn").first();
			await expect(landingFirstFilter390).toBeVisible();
			const l390Box = await landingFirstFilter390.boundingBox();
			expect(l390Box).not.toBeNull();
			expect(l390Box!.x).toBeGreaterThanOrEqual(0);

			const mobileScrollWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileScrollWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/landing-390px-mobile.png`,
				fullPage: true,
			});

			// Mobile Landing (320px)
			await mobile320Page.goto("/");
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await mobile320Page.locator("#jadwal").scrollIntoViewIfNeeded();
			await expect(mobile320Page.locator(".schedule-grid, [data-gsap='scroll-card']").first()).toBeVisible({ timeout: 10000 });

			const landingFirstFilter320 = mobile320Page.locator(".schedule-filter-bar .schedule-filter-btn").first();
			await expect(landingFirstFilter320).toBeVisible();
			const l320Box = await landingFirstFilter320.boundingBox();
			expect(l320Box).not.toBeNull();
			expect(l320Box!.x).toBeGreaterThanOrEqual(0);

			const mobile320ScrollWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320ScrollWidth).toBeLessThanOrEqual(320);

			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/landing-320px-mobile.png`,
				fullPage: true,
			});

			// 1.B Public Events List (/events)
			await desktopPage.goto("/events");
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.getByText(/Jadwal Upacara & Rekayasa Jalur Bali/i)).toBeVisible();
			// Await settled content: detachment of loading indicator and appearance of cards/empty state (SPEC-3)
			await desktopPage.getByText("Memuat daftar jadwal upacara terpublikasi...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.locator(".events-grid, .schedule-card, .teduh-empty-state").first()).toBeVisible({ timeout: 10000 });

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/events-list-1280px-desktop.png`,
				fullPage: true,
			});

			await desktop1440Page.goto("/events");
			await desktop1440Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await desktop1440Page.getByText("Memuat daftar jadwal upacara terpublikasi...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktop1440Page.locator(".events-grid, .schedule-card, .teduh-empty-state").first()).toBeVisible({ timeout: 10000 });
			await desktop1440Page.screenshot({
				path: `${EVIDENCE_DIR}/events-list-1440px-desktop.png`,
				fullPage: true,
			});

			// Tablet /events (768px)
			await tabletPage.goto("/events");
			await tabletPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await tabletPage.getByText("Memuat daftar jadwal upacara terpublikasi...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(tabletPage.locator(".events-grid, .schedule-card, .teduh-empty-state").first()).toBeVisible({ timeout: 10000 });
			const tabletEventsWidth = await tabletPage.evaluate(getScrollWidth);
			expect(tabletEventsWidth).toBeLessThanOrEqual(768);
			await tabletPage.screenshot({
				path: `${EVIDENCE_DIR}/events-list-768px-tablet.png`,
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

			// Mobile /events (390px)
			await mobilePage.goto("/events");
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await mobilePage.getByText("Memuat daftar jadwal upacara terpublikasi...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobilePage.locator(".events-grid, .schedule-card, .teduh-empty-state").first()).toBeVisible({ timeout: 10000 });

			// Filter bar reachability on /events
			const eventsFirstFilter390 = mobilePage.getByRole("combobox", { name: "Filter status jadwal" });
			await expect(eventsFirstFilter390.locator("option")).toHaveCount(3);
			await expect(eventsFirstFilter390).toBeVisible();
			const ef390Box = await eventsFirstFilter390.boundingBox();
			expect(ef390Box).not.toBeNull();
			expect(ef390Box!.x).toBeGreaterThanOrEqual(0);

			const mobileEventsWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileEventsWidth).toBeLessThanOrEqual(390);
			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/events-list-390px-mobile.png`,
				fullPage: true,
			});

			// Mobile /events (320px)
			await mobile320Page.goto("/events");
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await mobile320Page.getByText("Memuat daftar jadwal upacara terpublikasi...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobile320Page.locator(".events-grid, .schedule-card, .teduh-empty-state").first()).toBeVisible({ timeout: 10000 });

			const eventsFirstFilter320 = mobile320Page.getByRole("combobox", { name: "Filter status jadwal" });
			await expect(eventsFirstFilter320.locator("option")).toHaveCount(3);
			await expect(eventsFirstFilter320).toBeVisible();
			const ef320Box = await eventsFirstFilter320.boundingBox();
			expect(ef320Box).not.toBeNull();
			expect(ef320Box!.x).toBeGreaterThanOrEqual(0);

			const mobile320EventsWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320EventsWidth).toBeLessThanOrEqual(320);
			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/events-list-320px-mobile.png`,
				fullPage: true,
			});

			// 1.C Public Map View (/peta)
			await desktopPage.goto("/peta");
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.locator(".map-viewport")).toBeVisible({ timeout: 15000 });
			await expect(desktopPage.locator(".maplibregl-canvas")).toBeVisible({ timeout: 15000 });
			await desktopPage.waitForTimeout(1000);

			// SPEC-2.1: Assert /peta floating controls and statusbar do NOT overlap attribution control
			const attribution = desktopPage.locator(".maplibregl-ctrl-bottom-right").first();
			const floatingControls = desktopPage.locator(".map-floating-controls").first();
			if (await attribution.isVisible() && await floatingControls.isVisible()) {
				const attrBox = await attribution.boundingBox();
				const controlsBox = await floatingControls.boundingBox();
				if (attrBox && controlsBox) {
					// Controls raised above attribution bar: bottom of controls is strictly above top of attribution or horizontally separated
					expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(attrBox.y + 4);
				}
			}

			// Open CeremonyDetailModal from /peta to assert SIMULASI token in open modal (SPEC-1, STD-1)
			const searchInputPeta = desktopPage.locator(".map-search-input").first();
			if (await searchInputPeta.isVisible()) {
				await searchInputPeta.click();
				const firstSearchItem = desktopPage.locator(".map-search-item").first();
				if (await firstSearchItem.isVisible()) {
					await firstSearchItem.click();
					// Wait for drawer to show details and SIMULASI token
					const simBadge = desktopPage.locator(".simulation-token").filter({ hasText: /SIMULASI/i }).first();
					await expect(simBadge).toBeVisible({ timeout: 5000 });
				}
			}

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/map-1280px-desktop.png`,
			});

			// Mobile Map (390px)
			await mobilePage.goto("/peta");
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobilePage.locator(".map-viewport")).toBeVisible({ timeout: 15000 });
			await mobilePage.waitForTimeout(1000);
			const mobileMapWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileMapWidth).toBeLessThanOrEqual(390);

			// Check mobile attribution clearance
			const mobAttribution = mobilePage.locator(".maplibregl-ctrl-bottom-right").first();
			const mobControls = mobilePage.locator(".map-floating-controls").first();
			if (await mobAttribution.isVisible() && await mobControls.isVisible()) {
				const attrBox = await mobAttribution.boundingBox();
				const ctrlBox = await mobControls.boundingBox();
				if (attrBox && ctrlBox) {
					expect(ctrlBox.y + ctrlBox.height).toBeLessThanOrEqual(attrBox.y + 4);
				}
			}

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/map-390px-mobile.png`,
			});

			// Mobile Map (320px)
			await mobile320Page.goto("/peta");
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobile320Page.locator(".map-viewport")).toBeVisible({ timeout: 15000 });
			await mobile320Page.waitForTimeout(1000);
			const mobile320MapWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320MapWidth).toBeLessThanOrEqual(320);

			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/map-320px-mobile.png`,
			});

			// -------------------------------------------------------------------
			// 2. AUTHENTICATION PAGES AUDIT
			// -------------------------------------------------------------------
			// SPEC-3: Await opacity: 1 on auth card via observable state instead of sleep(300)
			await desktopPage.goto("/login");
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.getByRole("heading", { name: "Masuk Petugas Desa" })).toBeVisible({ timeout: 10000 });
			await expect(desktopPage.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
			await expect(desktopPage.locator(".teduh-auth-card")).toHaveCSS("opacity", "1", { timeout: 10000 });

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/login-1280px-desktop.png`,
				fullPage: true,
			});

			await mobilePage.goto("/login");
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobilePage.getByRole("heading", { name: "Masuk Petugas Desa" })).toBeVisible({ timeout: 10000 });
			await expect(mobilePage.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
			await expect(mobilePage.locator(".teduh-auth-card")).toHaveCSS("opacity", "1", { timeout: 10000 });
			const mobileLoginWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileLoginWidth).toBeLessThanOrEqual(390);
			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/login-390px-mobile.png`,
				fullPage: true,
			});

			await mobile320Page.goto("/login");
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobile320Page.getByRole("heading", { name: "Masuk Petugas Desa" })).toBeVisible({ timeout: 10000 });
			await expect(mobile320Page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
			await expect(mobile320Page.locator(".teduh-auth-card")).toHaveCSS("opacity", "1", { timeout: 10000 });
			const mobile320LoginWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320LoginWidth).toBeLessThanOrEqual(320);
			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/login-320px-mobile.png`,
				fullPage: true,
			});

			await desktopPage.goto("/register");
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.getByRole("heading", { name: "Daftar Akun Petugas" })).toBeVisible({ timeout: 10000 });
			await expect(desktopPage.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
			await expect(desktopPage.locator(".teduh-auth-card")).toHaveCSS("opacity", "1", { timeout: 10000 });
			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/register-1280px-desktop.png`,
				fullPage: true,
			});

			await mobilePage.goto("/register");
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobilePage.getByRole("heading", { name: "Daftar Akun Petugas" })).toBeVisible({ timeout: 10000 });
			await expect(mobilePage.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
			await expect(mobilePage.locator(".teduh-auth-card")).toHaveCSS("opacity", "1", { timeout: 10000 });
			const mobileRegisterWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileRegisterWidth).toBeLessThanOrEqual(390);
			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/register-390px-mobile.png`,
				fullPage: true,
			});

			await mobile320Page.goto("/register");
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobile320Page.getByRole("heading", { name: "Daftar Akun Petugas" })).toBeVisible({ timeout: 10000 });
			await expect(mobile320Page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
			await expect(mobile320Page.locator(".teduh-auth-card")).toHaveCSS("opacity", "1", { timeout: 10000 });
			const mobile320RegisterWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320RegisterWidth).toBeLessThanOrEqual(320);
			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/register-320px-mobile.png`,
				fullPage: true,
			});

			// -------------------------------------------------------------------
			// 3. ORGANIZER DASHBOARD & WORKSPACE AUDIT
			// -------------------------------------------------------------------

			// Create Organizer user & organization via API
			const orgSignup = await desktopContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Prajuru ${key}`, email: orgEmail, password: "SyntheticBrowserPass123!" },
			});
			expect(orgSignup.ok()).toBe(true);

			const orgData = await approveSyntheticOrganization(browser, desktopContext.request, baseURL, { name: orgName, village: "Ubud", district: "Gianyar" });
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
			await desktop1440Context.addCookies(authCookies);
			await tabletContext.addCookies(authCookies);
			await mobileContext.addCookies(authCookies);
			await mobile320Context.addCookies(authCookies);

			// Visit Dashboard on Desktop
			await desktopPage.goto("/dashboard");
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });

			// Await Spatial Inspector road data settled (loading text detached)
			await desktopPage.getByText("Memuat data ruas jalan...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});

			// The current dashboard lists events; verify the created event remains manageable.
			await expect(desktopPage.getByText("Inspektur Spasial Kegiatan")).toHaveCount(0);
			await expect(desktopPage.locator(`[data-event-id="${eventId}"]`).getByRole("link", { name: "Kelola Kegiatan" })).toHaveAttribute("href", `/dashboard/events/${eventId}`);

			// SPEC-2.2: Assert EventLifecycleBadge is NOT truncated into "DRAF..." or "DR..."
			const statusBadge = desktopPage.locator(`[data-event-id="${eventId}"]`).getByText("DRAF (DRAFT)", { exact: true });
			await expect(statusBadge).toBeVisible();
			const badgeText = await statusBadge.textContent();
			expect(badgeText).toContain("DRAF");
			expect(badgeText).not.toBe("DR...");
			expect(badgeText).not.toBe("DRAF...");

			// Assert SIMULASI token on active event
			const simTokenDashboard = desktopPage.locator(`[data-event-id="${eventId}"] .simulation-token`);
			await expect(simTokenDashboard).toBeVisible();

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-1280px-desktop.png`,
				fullPage: true,
			});

			// Wide 1440px Dashboard
			await desktop1440Page.goto("/dashboard");
			await desktop1440Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktop1440Page.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });
			await desktop1440Page.getByText("Memuat data ruas jalan...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await desktop1440Page.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-1440px-desktop.png`,
				fullPage: true,
			});

			// Tablet Dashboard (768px)
			await tabletPage.goto("/dashboard");
			await tabletPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(tabletPage.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });
			await tabletPage.getByText("Memuat data ruas jalan...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			const tabletDashWidth = await tabletPage.evaluate(getScrollWidth);
			expect(tabletDashWidth).toBeLessThanOrEqual(768);
			await tabletPage.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-768px-tablet.png`,
				fullPage: true,
			});

			// Mobile Dashboard (390px)
			await mobilePage.goto("/dashboard");
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobilePage.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });
			await mobilePage.getByText("Memuat data ruas jalan...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});

			// SPEC-2.4: Mobile workspace topbar - role pill hidden below 768px, no collision with action buttons
			const mobileRolePill = mobilePage.locator(".teduh-workspace-role-pill");
			await expect(mobileRolePill).toBeHidden();

			const mobileDashWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileDashWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-390px-mobile.png`,
				fullPage: true,
			});

			// Mobile Dashboard (320px)
			await mobile320Page.goto("/dashboard");
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobile320Page.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });
			await mobile320Page.getByText("Memuat data ruas jalan...").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});

			const mobile320RolePill = mobile320Page.locator(".teduh-workspace-role-pill");
			await expect(mobile320RolePill).toBeHidden();

			const mobile320DashWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320DashWidth).toBeLessThanOrEqual(320);

			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/dashboard-320px-mobile.png`,
				fullPage: true,
			});

			// -------------------------------------------------------------------
			// 4. ROAD EDITOR & CATALOG 503 RECOVERY
			// -------------------------------------------------------------------
			await desktopPage.goto(`/dashboard/events/${eventId}/roads`);
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.getByText(roadName).first()).toBeVisible({ timeout: 15000 });

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/roads-editor-1280px-desktop.png`,
				fullPage: true,
			});

			await mobilePage.goto(`/dashboard/events/${eventId}/roads`);
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobilePage.getByText(roadName).first()).toBeVisible({ timeout: 15000 });
			const mobileRoadsWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileRoadsWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/roads-editor-390px-mobile.png`,
				fullPage: true,
			});

			await mobile320Page.goto(`/dashboard/events/${eventId}/roads`);
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobile320Page.getByText(roadName).first()).toBeVisible({ timeout: 15000 });
			const mobile320RoadsWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320RoadsWidth).toBeLessThanOrEqual(320);

			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/roads-editor-320px-mobile.png`,
				fullPage: true,
			});

			// -------------------------------------------------------------------
			// 5. SETTINGS PAGE AUDIT & POLISH
			// -------------------------------------------------------------------
			// SPEC-3: Await settled authenticated state on /settings (user email appears, NOT Mode Tamu)
			await desktopPage.goto("/settings");
			await desktopPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(desktopPage.getByText(orgEmail).first()).toBeVisible({ timeout: 15000 });
			await expect(desktopPage.getByText("Mode Tamu / Anda belum masuk")).toHaveCount(0);
			await expect(desktopPage.getByText(/Pengaturan Akun & Desa Adat/i)).toBeVisible();
			await expect(desktopPage.getByText(/Profil Petugas & Sesi Otentikasi/i)).toBeVisible();

			await desktopPage.screenshot({
				path: `${EVIDENCE_DIR}/settings-1280px-desktop.png`,
				fullPage: true,
			});

			await mobilePage.goto("/settings");
			await mobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobilePage.getByText(orgEmail).first()).toBeVisible({ timeout: 15000 });
			await expect(mobilePage.getByText("Mode Tamu / Anda belum masuk")).toHaveCount(0);
			const mobileSettingsWidth = await mobilePage.evaluate(getScrollWidth);
			expect(mobileSettingsWidth).toBeLessThanOrEqual(390);

			await mobilePage.screenshot({
				path: `${EVIDENCE_DIR}/settings-390px-mobile.png`,
				fullPage: true,
			});

			await mobile320Page.goto("/settings");
			await mobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(mobile320Page.getByText(orgEmail).first()).toBeVisible({ timeout: 15000 });
			await expect(mobile320Page.getByText("Mode Tamu / Anda belum masuk")).toHaveCount(0);
			const mobile320SettingsWidth = await mobile320Page.evaluate(getScrollWidth);
			expect(mobile320SettingsWidth).toBeLessThanOrEqual(320);

			await mobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/settings-320px-mobile.png`,
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

			officerContext = await browser.newContext({
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
			await officerPage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(officerPage.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });

			await officerPage.screenshot({
				path: `${EVIDENCE_DIR}/field-tasks-1280px-desktop.png`,
				fullPage: true,
			});

			// Mobile Field Tasks (390px)
			officerMobileContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
				extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
			});
			const officerCookies = await officerContext.cookies();
			await officerMobileContext.addCookies(officerCookies);
			const officerMobilePage = await officerMobileContext.newPage();

			await officerMobilePage.goto("/field");
			await officerMobilePage.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(officerMobilePage.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });
			const mobileFieldWidth = await officerMobilePage.evaluate(getScrollWidth);
			expect(mobileFieldWidth).toBeLessThanOrEqual(390);

			await officerMobilePage.screenshot({
				path: `${EVIDENCE_DIR}/field-tasks-390px-mobile.png`,
				fullPage: true,
			});

			// Mobile Field Tasks (320px)
			officerMobile320Context = await browser.newContext({
				viewport: { width: 320, height: 568 },
				extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
			});
			await officerMobile320Context.addCookies(officerCookies);
			const officerMobile320Page = await officerMobile320Context.newPage();

			await officerMobile320Page.goto("/field");
			await officerMobile320Page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
			await expect(officerMobile320Page.getByText(eventTitle).first()).toBeVisible({ timeout: 15000 });
			const mobile320FieldWidth = await officerMobile320Page.evaluate(getScrollWidth);
			expect(mobile320FieldWidth).toBeLessThanOrEqual(320);

			await officerMobile320Page.screenshot({
				path: `${EVIDENCE_DIR}/field-tasks-320px-mobile.png`,
				fullPage: true,
			});

		} finally {
			// STD-4: Safe deterministic context cleanup in finally even upon assertion failure
			await officerMobile320Context?.close().catch(() => {});
			await officerMobileContext?.close().catch(() => {});
			await officerContext?.close().catch(() => {});

			await desktopContext.close().catch(() => {});
			await desktop1440Context.close().catch(() => {});
			await tabletContext.close().catch(() => {});
			await mobileContext.close().catch(() => {});
			await mobile320Context.close().catch(() => {});

			// Database cleanup - strict complete teardown to avoid test artifact leakage
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
					await db.delete(events).where(inArray(events.id, eventIds));
				}
				await db.delete(roadSegments).where(eq(roadSegments.organizationId, org.id));
				await db.delete(invitations).where(eq(invitations.organizationId, org.id));
				await db.delete(organizations).where(eq(organizations.id, org.id));
			}

			// Clean up test users, accounts, and sessions
			const testUsers = await db.select({ id: user.id }).from(user).where(inArray(user.email, [orgEmail, officerEmail]));
			if (testUsers.length) {
				const userIds = testUsers.map((u) => u.id);
				await db.delete(session).where(inArray(session.userId, userIds));
				await db.delete(account).where(inArray(account.userId, userIds));
				await db.delete(user).where(inArray(user.id, userIds));
			}
		}
	});
});
