import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import {
	auditLogs,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
} from "../../src/db/schema";

test.describe("Journey 6: Map Failure Fallback, Catalog 503 Retry, and 390px Mobile Viewport", () => {
	test("map failure renders accessible list, catalog 503 displays error banner and recovers on retry, 390px viewport does not overflow", async ({
		browser,
		baseURL,
	}) => {
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.map.${key}@test.local`;
		const orgName = `Desa Adat Peta ${key}`;
		const eventTitle = `Upacara Melasti Segara ${key}`;
		const longRoadName = `Jalan Raya Bypass Ngurah Rai Simpang Segara Sanur Kauh No. 123-A/B Kawasan Pesisir ${key}`;

		// Setup Organizer Context
		const orgContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});

		try {
			// 1. Organizer Setup & Organization
			const orgSignup = await orgContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Organizer ${key}`, email: orgEmail, password: "SyntheticBrowserPass123!" },
			});
			expect(orgSignup.ok()).toBe(true);

			const orgRes = await orgContext.request.post(`${baseURL}/api/organizations`, {
				data: { name: orgName, village: "Sanur", district: "Denpasar Selatan" },
			});
			expect(orgRes.status()).toBe(201);
			const org = (await orgRes.json()) as { organization: { id: string } };

			// 2. Create Event & Simulation Road with long legal name
			const createEventRes = await orgContext.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: org.organization.id,
					title: eventTitle,
					category: "melasti",
					venueName: "Pantai Segara Sanur",
					startsAt: new Date(Date.now() + 3600000).toISOString(),
					endsAt: new Date(Date.now() + 18000000).toISOString(),
					isSimulation: true,
				},
			});
			expect(createEventRes.status()).toBe(201);
			const createdEvent = (await createEventRes.json()) as { event: { id: string } };
			const eventId = createdEvent.event.id;

			const addRoadRes = await orgContext.request.post(`${baseURL}/api/events/${eventId}/simulation-road-impacts`, {
				data: {
					mutationId: randomUUID(),
					displayName: longRoadName,
					coverageArea: "Sanur Kauh",
					humanVerified: true,
					impactType: "closure",
					plannedFrom: new Date(Date.now() + 3600000).toISOString(),
					plannedTo: new Date(Date.now() + 18000000).toISOString(),
					coordinates: [
						[115.263, -8.685],
						[115.264, -8.686],
					],
				},
			});
			expect(addRoadRes.status()).toBe(201);

			// Review and publish event
			const reviewRes = await orgContext.request.post(`${baseURL}/api/events/${eventId}/review`, {});
			expect(reviewRes.status()).toBe(200);

			const publishRes = await orgContext.request.post(`${baseURL}/api/events/${eventId}/publish`, {
				data: { isSimulation: true },
			});
			expect(publishRes.status()).toBe(200);
			const publishedData = (await publishRes.json()) as { event: { publicSlug: string } };
			const publicSlug = publishedData.event.publicSlug;

			// -----------------------------------------------------------------------
			// SUB-FLOW A: Map Failure -> Accessible Road List Fallback
			// -----------------------------------------------------------------------
			// Create a context where WebGL is disabled to trigger MapLibre fallback
			const noWebglContext = await browser.newContext({
				viewport: { width: 1280, height: 720 },
			});
			await noWebglContext.addInitScript(() => {
				const w = globalThis as unknown as {
					WebGLRenderingContext?: unknown;
					WebGL2RenderingContext?: unknown;
					HTMLCanvasElement?: { prototype: { getContext: (type: string) => unknown } };
				};
				w.WebGLRenderingContext = undefined;
				w.WebGL2RenderingContext = undefined;
				if (w.HTMLCanvasElement?.prototype) {
					w.HTMLCanvasElement.prototype.getContext = function () {
						return null;
					};
				}
			});

			const noWebglPage = await noWebglContext.newPage();
			await noWebglPage.goto(`/events/${publicSlug}/map`);

			// Fallback text list must be displayed
			await expect(noWebglPage.getByText(/Peta tidak tersedia/i)).toBeVisible();
			await expect(noWebglPage.getByText(/Daftar Ruas Jalan Terdampak/i)).toBeVisible();
			await expect(noWebglPage.getByText(longRoadName).first()).toBeVisible();

			await noWebglPage.screenshot({
				path: "D:/Development/Lomba/rangkai/.scratch/production-readiness/correction-evidence/journey6-map-fallback-accessible-list.png",
				fullPage: true,
			});
			await noWebglContext.close();

			// -----------------------------------------------------------------------
			// SUB-FLOW B: Catalog 503 Error Banner & Recovery Retry
			// -----------------------------------------------------------------------
			const catalogTestPage = await orgContext.newPage();

			// Intercept catalog endpoint with 503 Service Unavailable
			await catalogTestPage.route("**/api/road-segments*", async (route) => {
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({
						error: {
							code: "DEPENDENCY_UNAVAILABLE",
							message: "Layanan katalog jalan sedang dalam pemeliharaan berkala.",
							requestId: "req-catalog-503-probe",
						},
					}),
				});
			});

			await catalogTestPage.goto(`/dashboard/events/${eventId}/roads`);

			// Alert banner is shown indicating catalog unavailable with retry button
			await expect(catalogTestPage.getByRole("alert")).toBeVisible();
			await expect(catalogTestPage.getByText(/Katalog ruas jalan tidak tersedia/i)).toBeVisible();

			// Unroute to allow recovery
			await catalogTestPage.unroute("**/api/road-segments*");

			// Click "Coba lagi" in alert banner
			const retryBtn = catalogTestPage.getByRole("button", { name: /Coba lagi/i }).first();
			await retryBtn.click();

			// Verify error alert dismisses
			await expect(catalogTestPage.getByText(/Katalog ruas jalan tidak tersedia/i)).not.toBeVisible();

			await catalogTestPage.screenshot({
				path: "D:/Development/Lomba/rangkai/.scratch/production-readiness/correction-evidence/journey6-catalog-503-recovery.png",
				fullPage: true,
			});
			await catalogTestPage.close();

			// -----------------------------------------------------------------------
			// SUB-FLOW C: 390px Mobile Viewport No-Overflow Verification
			// -----------------------------------------------------------------------
			const mobileContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
				extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
			});
			// Copy storage/cookies from orgContext
			const cookies = await orgContext.cookies();
			await mobileContext.addCookies(cookies);

			const mobilePage = await mobileContext.newPage();
			await mobilePage.goto(`/dashboard/events/${eventId}/roads`);

			// Wait for road card with long name
			await expect(mobilePage.getByText(longRoadName).first()).toBeVisible();

			// Assert horizontal scroll does not exceed 390px
			const scrollWidth = await mobilePage.evaluate(
				() =>
					(globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document
						.documentElement.scrollWidth,
			);
			expect(scrollWidth).toBeLessThanOrEqual(390);

			// Assert delete button is visible and fits within 390px viewport
			const deleteBtn = mobilePage.getByRole("button", { name: /Hapus Ruas Jalan/i }).first();
			await expect(deleteBtn).toBeVisible();
			const boundingBox = await deleteBtn.boundingBox();
			expect(boundingBox).not.toBeNull();
			if (boundingBox) {
				expect(boundingBox.x + boundingBox.width).toBeLessThanOrEqual(390);
			}

			// Capture settled mobile view
			await mobilePage.screenshot({
				path: "D:/Development/Lomba/rangkai/.scratch/production-readiness/correction-evidence/journey6-mobile-390px-no-overflow.png",
				fullPage: true,
			});

			// Capture tablet / intermediate view (768x1024)
			await mobilePage.setViewportSize({ width: 768, height: 1024 });
			await mobilePage.screenshot({
				path: "D:/Development/Lomba/rangkai/.scratch/production-readiness/correction-evidence/journey6-tablet-intermediate.png",
				fullPage: true,
			});

			// Capture desktop view (1280x720)
			await mobilePage.setViewportSize({ width: 1280, height: 720 });
			await mobilePage.screenshot({
				path: "D:/Development/Lomba/rangkai/.scratch/production-readiness/correction-evidence/journey6-desktop-settled.png",
				fullPage: true,
			});

			await mobileContext.close();
		} finally {
			await orgContext.close();

			// Database cleanup
			const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
			if (org) {
				const owned = await db.select({ id: events.id }).from(events).where(eq(events.organizationId, org.id));
				if (owned.length) {
					const eventIds = owned.map((e) => e.id);
					const impacts = await db.select({ id: roadImpacts.id }).from(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					if (impacts.length) {
						await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					}
				}
				await db.delete(roadSegments).where(eq(roadSegments.organizationId, org.id));
				await db.delete(auditLogs).where(eq(auditLogs.organizationId, org.id));
				await db.delete(events).where(eq(events.organizationId, org.id));
				await db.delete(memberships).where(eq(memberships.organizationId, org.id));
				await db.delete(organizations).where(eq(organizations.id, org.id));
			}

			const [testUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, orgEmail));
			if (testUser) {
				await db.delete(session).where(eq(session.userId, testUser.id));
				await db.delete(account).where(eq(account.userId, testUser.id));
				await db.delete(user).where(eq(user.id, testUser.id));
			}
		}
	});
});
