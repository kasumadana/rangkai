import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import { auditLogs, events, memberships, organizations, roadImpacts, roadSegments } from "../../src/db/schema";

test.describe("Journey 3: Wizard -> Roads -> Simulation Publish -> Public View", () => {
	test("organizer creates draft, adds simulation road, publishes simulation event, and public views simulation banner", async ({ browser, baseURL }) => {
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);
		const email = `wizard.${key}@test.local`;
		const orgName = `Desa Adat Wizard ${key}`;
		const eventTitle = `Upacara Melasti Uji Coba ${key}`;

		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		const page = await context.newPage();

		const publicContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
		});
		const publicPage = await publicContext.newPage();

		try {
			// 1. Sign up organizer and create organization
			const signup = await context.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Organizer ${key}`, email, password: "SyntheticBrowserPass123!" },
			});
			expect(signup.ok()).toBe(true);

			const orgRes = await context.request.post(`${baseURL}/api/organizations`, {
				data: { name: orgName, village: "Sanur", district: "Denpasar Selatan" },
			});
			if (orgRes.status() !== 201) {
				console.log("orgRes error:", orgRes.status(), await orgRes.text());
			}
			expect(orgRes.status()).toBe(201);
			const org = (await orgRes.json()) as { organization: { id: string } };

			// 2. Create draft event via API to ensure valid session/org
			const createEventRes = await context.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: org.organization.id,
					title: eventTitle,
					category: "melasti",
					venueName: "Pura Segara Sanur",
					startsAt: new Date(Date.now() + 86400000).toISOString(),
					endsAt: new Date(Date.now() + 86400000 + 14400000).toISOString(),
					isSimulation: true,
				},
			});
			expect(createEventRes.status()).toBe(201);
			const createdEvent = (await createEventRes.json()) as { event: { id: string } };
			const eventId = createdEvent.event.id;

			// 3. Navigate to Event Review Tab
			await page.goto(`/dashboard/events/${eventId}/review`);
			await expect(page.getByRole("heading", { name: "Periksa & Konfirmasi Rincian Upacara" })).toBeVisible();

			// Verify fields are editable and save manual correction
			const textInputs = page.locator('input[type="text"]');
			await textInputs.nth(0).fill(`${eventTitle} (Terkoreksi)`);
			await textInputs.nth(1).fill("Pura Segara Sanur");

			const datetimeInputs = page.locator('input[type="datetime-local"]');
			await datetimeInputs.nth(0).fill("2026-11-20T08:00");
			await datetimeInputs.nth(1).fill("2026-11-20T14:00");

			const saveDraftBtn = page.getByRole("button", { name: "Simpan Draf" });
			await saveDraftBtn.click();
			await expect(page.getByText(/Perubahan rincian.*berhasil disimpan/i)).toBeVisible();

			// 4. Navigate to Roads Tab
			await page.getByRole("button", { name: "Peta & Ruas Jalan" }).click();
			await expect(page).toHaveURL(new RegExp(`/dashboard/events/${eventId}/roads`));

			// Add a simulation road via atomic API
			const roadMutationId = randomUUID();
			const addRoadRes = await context.request.post(`${baseURL}/api/events/${eventId}/simulation-road-impacts`, {
				data: {
					mutationId: roadMutationId,
					displayName: `Jalan Pantai Sanur ${key}`,
					coverageArea: "Sanur",
					humanVerified: true,
					impactType: "closure",
					plannedFrom: new Date(Date.now() + 86400000).toISOString(),
					plannedTo: new Date(Date.now() + 86400000 + 14400000).toISOString(),
					coordinates: [
						[115.2625, -8.685],
						[115.2635, -8.686],
					],
				},
			});
			if (addRoadRes.status() !== 201) {
				console.log("addRoadRes error:", addRoadRes.status(), await addRoadRes.text());
			}
			expect(addRoadRes.status()).toBe(201);

			// Reload roads page to verify road impact appears in the list
			await page.reload();
			await expect(page.getByText(`Jalan Pantai Sanur ${key}`).first()).toBeVisible();
			await expect(page.getByText(/Ruas Jalan Terdampak \(1\)/i).first()).toBeVisible();

			// 5. Navigate back to Review Tab to mark verified by Prajuru
			await page.getByRole("button", { name: "Surat Edaran & Review" }).click();
			await expect(page).toHaveURL(new RegExp(`/dashboard/events/${eventId}/review`));

			const reviewPromise = page.waitForResponse(
				(r) => r.url().endsWith("/review") && r.request().method() === "POST" && r.status() === 200,
			);
			const reviewBtn = page.getByRole("button", { name: "Konfirmasi Prajuru (Review)" });
			await reviewBtn.click();
			await reviewPromise;

			// 6. Publish event as simulation
			const publishRes = await context.request.post(`${baseURL}/api/events/${eventId}/publish`, {
				data: {
					isSimulation: true,
				},
			});
			if (publishRes.status() !== 200) {
				console.log("publishRes error:", publishRes.status(), await publishRes.text());
			}
			expect(publishRes.status()).toBe(200);
			const publishedData = (await publishRes.json()) as { event: { publicSlug: string; isSimulation: boolean } };
			expect(publishedData.event.isSimulation).toBe(true);
			const publicSlug = publishedData.event.publicSlug;

			// 7. Anonymous Public View
			await publicPage.goto(`/events/${publicSlug}`);
			// Public view must clearly identify simulation
			await expect(publicPage.getByText(/SIMULASI/i).first()).toBeVisible();
			await expect(publicPage.getByText(`${eventTitle} (Terkoreksi)`).first()).toBeVisible();
			await expect(publicPage.getByText(`Jalan Pantai Sanur ${key}`).first()).toBeVisible();

			// Capture settled screenshot
			await publicPage.screenshot({
				path: "D:/Development/Lomba/rangkai/.scratch/production-readiness/correction-evidence/journey3-public-simulation.png",
				fullPage: true,
			});
		} finally {
			await context.close();
			await publicContext.close();

			const [testUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
			const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
			if (org) {
				const owned = await db.select({ id: events.id }).from(events).where(eq(events.organizationId, org.id));
				if (owned.length) {
					const eventIds = owned.map((e) => e.id);
					await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
				}
				await db.delete(roadSegments).where(eq(roadSegments.organizationId, org.id));
				await db.delete(auditLogs).where(eq(auditLogs.organizationId, org.id));
				await db.delete(events).where(eq(events.organizationId, org.id));
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
});
