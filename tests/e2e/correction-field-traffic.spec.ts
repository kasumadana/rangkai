import { approveSyntheticOrganization } from "./approval-fixture";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import {
	auditLogs,
	eventAssignments,
	events,
	invitations,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
	roadStatusUpdates,
} from "../../src/db/schema";

test.use({ actionTimeout: 10_000 });

test.describe("Journey 4: Field Officer Traffic Update -> Public Live Status & Unassigned Denial", () => {
	test("assigned officer updates road status, public view reflects update, unassigned user is denied, stale status displays unconfirmed", async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(120_000);
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.traffic.${key}@test.local`;
		const officer1Email = `officer1.traffic.${key}@test.local`;
		const officer2Email = `officer2.traffic.${key}@test.local`;
		const orgName = `Desa Adat Traffic ${key}`;
		const eventTitle = `Upacara Pengarakan Ogoh-Ogoh ${key}`;
		const roadName = `Jalan Catus Pata ${key}`;

		// Organizer context
		const orgContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		// Assigned Officer context
		const officer1Context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		// Unassigned user context
		const officer2Context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		// Anonymous public context
		const publicContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
		});

		const officer1Page = await officer1Context.newPage();
		const officer2Page = await officer2Context.newPage();
		const publicPage = await publicContext.newPage();

		try {
			// 1. Setup Organizer & Organization
			const orgSignup = await orgContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Organizer ${key}`, email: orgEmail, password: "SyntheticBrowserPass123!" },
			});
			expect(orgSignup.ok()).toBe(true);

			const org = await approveSyntheticOrganization(browser, orgContext.request, baseURL, { name: orgName, village: "Ubud", district: "Ubud" });

			// 2. Create Event & Simulation Road
			const createEventRes = await orgContext.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: org.organization.id,
					title: eventTitle,
					category: "ngaben",
					venueName: "Catus Pata Ubud",
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
			const roadData = (await addRoadRes.json()) as { roadImpact: { id: string } };
			const impactId = roadData.roadImpact.id;

			// Transition to review and publish
			const reviewRes = await orgContext.request.post(`${baseURL}/api/events/${eventId}/review`, {});
			expect(reviewRes.status()).toBe(200);

			const publishRes = await orgContext.request.post(`${baseURL}/api/events/${eventId}/publish`, {
				data: { isSimulation: true },
			});
			expect(publishRes.status()).toBe(200);
			const publishedData = (await publishRes.json()) as { event: { publicSlug: string } };
			const publicSlug = publishedData.event.publicSlug;

			// 3. Create Invitation for Officer 1 (Assigned Traffic Officer)
			const inviteRes = await orgContext.request.post(`${baseURL}/api/invitations`, {
				data: {
					organizationId: org.organization.id,
					eventId,
					recipientEmail: officer1Email,
					role: "officer",
					canUpdateTraffic: true,
					canUpdateCleanup: false,
				},
			});
			expect(inviteRes.status()).toBe(201);
			const inviteData = (await inviteRes.json()) as { invitation: { token: string } };

			// Officer 1 signs up and accepts invitation
			const officer1Signup = await officer1Context.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Pecalang ${key}`, email: officer1Email, password: "SyntheticBrowserPass123!" },
			});
			expect(officer1Signup.ok()).toBe(true);

			const acceptRes = await officer1Context.request.post(
				`${baseURL}/api/invitations/${inviteData.invitation.token}/accept`,
			);
			if (acceptRes.status() !== 200) {
				console.log("acceptRes error:", acceptRes.status(), await acceptRes.text());
			}
			expect(acceptRes.status()).toBe(200);

			// 4. The assigned event is listed with its permission and opens the field post.
			let failTasks = true;
			await officer1Page.route("**/api/field/tasks", async (route) => {
				if (failTasks) {
					failTasks = false;
					await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Penugasan tidak tersedia", requestId: "test" } } });
				} else await route.continue();
			});
			await officer1Page.goto("/field");
			await expect(officer1Page.getByText("Gagal Memuat Penugasan")).toBeVisible();
			await officer1Page.getByRole("button", { name: "Coba Lagi" }).click();
			const assignment = officer1Page.getByRole("listitem").filter({ hasText: eventTitle });
			await expect(assignment).toBeVisible();
			await expect(assignment.getByText("SIMULASI")).toBeVisible();
			await expect(assignment.getByText("Pos Pecalang (Jalan)")).toBeVisible();
			await expect(assignment.getByText("Tim Kebersihan")).toHaveCount(0);
			await assignment.getByRole("link", { name: "Buka tugas" }).click();
			await expect(officer1Page).toHaveURL(new RegExp(`/field/events/${eventId}$`));
			await expect(officer1Page.getByText(eventTitle).first()).toBeVisible();
			await expect(officer1Page.getByText("Kendali Status Ruas Jalan (Pecalang)")).toBeVisible();
			await expect(officer1Page.getByText(roadName).first()).toBeVisible();

			// Fill field note and click "Tutup Total"
			const noteInput = officer1Page.getByPlaceholder(/Contoh: Iring-iringan Melasti/i);
			await noteInput.fill("Iring-iringan telah memasuki Catus Pata.");

			const closeRoad = officer1Page.getByRole("button", { name: "Tutup Total" }).first();
			await closeRoad.click();
			const confirmation = officer1Page.getByRole("dialog", { name: "Konfirmasi Perubahan Status Jalan" });
			await expect(confirmation).toBeVisible();
			await officer1Page.keyboard.press("Escape");
			await expect(confirmation).toBeHidden();
			await expect(closeRoad).toBeFocused();
			await closeRoad.click();
			await confirmation.getByRole("button", { name: "Simpan Status" }).click();

			// Assert success feedback
			await expect(officer1Page.getByText(/Status "CLOSED" berhasil disimpan ke server/i)).toBeVisible();

			// Capture screenshot of officer dashboard
			await officer1Page.screenshot({
				path: "./.scratch/production-readiness/correction-evidence/journey4-field-officer-status.png",
				fullPage: true,
			});

			// 5. Public Visitor verifies updated status
			await publicPage.goto(`/events/${publicSlug}`);
			await expect(publicPage.getByText(/DITUTUP \(CLOSED\)/i).first()).toBeVisible();
			await expect(publicPage.getByText(/Tutup Total/i).first()).toBeVisible();

			await publicPage.screenshot({
				path: "./.scratch/production-readiness/correction-evidence/journey4-public-status-closed.png",
				fullPage: true,
			});

			// 6. Officer without traffic permission denial verification
			const officer2Signup = await officer2Context.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Cleanup Officer ${key}`, email: officer2Email, password: "SyntheticBrowserPass123!" },
			});
			expect(officer2Signup.ok()).toBe(true);

			const invite2Res = await orgContext.request.post(`${baseURL}/api/invitations`, {
				data: {
					organizationId: org.organization.id,
					eventId,
					recipientEmail: officer2Email,
					role: "officer",
					canUpdateTraffic: false,
					canUpdateCleanup: true,
				},
			});
			expect(invite2Res.status()).toBe(201);
			const invite2Data = (await invite2Res.json()) as { invitation: { token: string } };

			const accept2Res = await officer2Context.request.post(
				`${baseURL}/api/invitations/${invite2Data.invitation.token}/accept`,
			);
			expect(accept2Res.status()).toBe(200);

			// Direct API attempt by officer without traffic permission returns 403
			const unauthorizedStatusRes = await officer2Context.request.post(`${baseURL}/api/road-impacts/${impactId}/status`, {
				data: {
					status: "open",
					observedAt: new Date().toISOString(),
					mutationId: randomUUID(),
				},
			});
			expect(unauthorizedStatusRes.status()).toBe(403);

			// Browser navigation by officer without traffic permission does not expose traffic controls
			await officer2Page.goto(`/field/events/${eventId}`);
			await expect(officer2Page.getByText("Kendali Status Ruas Jalan (Pecalang)")).not.toBeVisible();
			await expect(officer2Page.getByRole("button", { name: "Tutup Total" })).not.toBeVisible();

			// 7. Stale Status Simulation
			// Manually update expiresAt of road status update to past in DB
			await db
				.update(roadStatusUpdates)
				.set({
					expiresAt: new Date(Date.now() - 600000), // 10 minutes ago
				})
				.where(eq(roadStatusUpdates.roadImpactId, impactId));

			// Public user reloads page
			await publicPage.reload();
			await expect(publicPage.getByText(/Belum terkonfirmasi/i).first()).toBeVisible();

			await publicPage.screenshot({
				path: "./.scratch/production-readiness/correction-evidence/journey4-public-status-stale.png",
				fullPage: true,
			});
		} finally {
			await orgContext.close();
			await officer1Context.close();
			await officer2Context.close();
			await publicContext.close();

			// DB cleanup
			const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
			if (org) {
				const owned = await db.select({ id: events.id }).from(events).where(eq(events.organizationId, org.id));
				if (owned.length) {
					const eventIds = owned.map((e) => e.id);
					const impacts = await db.select({ id: roadImpacts.id }).from(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					if (impacts.length) {
						await db.delete(roadStatusUpdates).where(inArray(roadStatusUpdates.roadImpactId, impacts.map((i) => i.id)));
					}
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
				.where(inArray(user.email, [orgEmail, officer1Email, officer2Email]));
			if (usersToDelete.length) {
				const uids = usersToDelete.map((u) => u.id);
				await db.delete(session).where(inArray(session.userId, uids));
				await db.delete(account).where(inArray(account.userId, uids));
				await db.delete(user).where(inArray(user.id, uids));
			}
		}
	});
});
