import { approveSyntheticOrganization } from "./approval-fixture";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import {
	auditLogs,
	cleanupEvidence,
	cleanupTasks,
	eventAssignments,
	events,
	invitations,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
	roadStatusUpdates,
	wasteRecords,
} from "../../src/db/schema";

function createValidPngBytes(totalByteLength = 128): Uint8Array {
	const size = Math.max(totalByteLength, 64);
	const b = new Uint8Array(size);
	const header = [
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x02, 0x58, 0x00, 0x00, 0x01, 0x90,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x9b, 0x3b, 0x42, 0x11,
	];
	b.set(header, 0);
	const iend = [
		0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	];
	b.set(iend, size - iend.length);
	return b;
}

test.describe("Journey 5: Selected Cleanup Photo/Waste/Submit -> Organizer Verify/Reopen -> Road Unchanged", () => {
	test("officer uploads evidence and submits task, organizer verifies without reopening road, then reopens task", async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(60_000);
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);

		const orgEmail = `organizer.cleanup.${key}@test.local`;
		const officerEmail = `officer.cleanup.${key}@test.local`;
		const orgName = `Desa Adat Kebersihan ${key}`;
		const eventTitle = `Upacara Tawur Kesanga ${key}`;
		const roadName = `Jalan Raya Ubud ${key}`;
		const taskTitle = `Pembersihan Area Catus Pata ${key}`;

		const orgContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});
		const officerContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" },
		});

		const orgPage = await orgContext.newPage();
		const officerPage = await officerContext.newPage();

		try {
			// 1. Organizer Setup & Organization
			const orgSignup = await orgContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Organizer ${key}`, email: orgEmail, password: "SyntheticBrowserPass123!" },
			});
			expect(orgSignup.ok()).toBe(true);

			const org = await approveSyntheticOrganization(browser, orgContext.request, baseURL, { name: orgName, village: "Ubud", district: "Gianyar" });

			// 2. Create Event & Simulation Road
			const createEventRes = await orgContext.request.post(`${baseURL}/api/events`, {
				data: {
					organizationId: org.organization.id,
					title: eventTitle,
					category: "upacara_adat",
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

			// Set initial road status to CLOSED by organizer
			const setClosedRes = await orgContext.request.post(`${baseURL}/api/road-impacts/${impactId}/status`, {
				data: {
					status: "closed",
					observedAt: new Date().toISOString(),
					mutationId: randomUUID(),
					note: "Penutupan jalur prosesi upacara",
				},
			});
			expect(setClosedRes.status()).toBe(200);

			// 3. Officer Invitation & Acceptance
			const inviteRes = await orgContext.request.post(`${baseURL}/api/invitations`, {
				data: {
					organizationId: org.organization.id,
					eventId,
					recipientEmail: officerEmail,
					role: "officer",
					canUpdateTraffic: false,
					canUpdateCleanup: true,
				},
			});
			expect(inviteRes.status()).toBe(201);
			const inviteData = (await inviteRes.json()) as { invitation: { token: string } };

			const officerSignup = await officerContext.request.post(`${baseURL}/api/auth/sign-up/email`, {
				data: { name: `Petugas Kebersihan ${key}`, email: officerEmail, password: "SyntheticBrowserPass123!" },
			});
			expect(officerSignup.ok()).toBe(true);

			const acceptRes = await officerContext.request.post(
				`${baseURL}/api/invitations/${inviteData.invitation.token}/accept`,
			);
			expect(acceptRes.status()).toBe(200);

			const [officerUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, officerEmail));
			expect(officerUser).toBeDefined();

			// 4. Create Cleanup Task assigned to Officer
			const createTaskRes = await orgContext.request.post(`${baseURL}/api/events/${eventId}/cleanup-tasks`, {
				data: {
					title: taskTitle,
					description: "Area Jaba Pura dan simpang Catus Pata",
					assignedUserId: officerUser.id,
				},
			});
			expect(createTaskRes.status()).toBe(201);
			const taskData = (await createTaskRes.json()) as { cleanupTask: { id: string } };
			const taskId = taskData.cleanupTask.id;

			// 5. Officer navigates to deep link: /field/events/:id/cleanup/:taskId
			await officerPage.goto(`/field/events/${eventId}/cleanup/${taskId}`);
			await expect(officerPage.getByText(taskTitle).first()).toBeVisible();

			// Click "Mulai Kerjakan"
			const startBtn = officerPage.getByRole("button", { name: "Mulai Kerjakan" }).first();
			await startBtn.click();
			await expect(officerPage.getByRole("button", { name: "Serahkan Tugas" }).first()).toBeVisible();

			// Upload evidence photo (PNG buffer)
			const pngBuffer = Buffer.from(createValidPngBytes(256));
			const fileInput = officerPage.locator('input[type="file"]');
			await fileInput.setInputFiles({
				name: "after_cleanup.png",
				mimeType: "image/png",
				buffer: pngBuffer,
			});
			await expect(officerPage.getByText(/Foto bukti tahap.*AFTER.*berhasil diunggah/i)).toBeVisible();

			// Fill Waste Records
			const numberInputs = officerPage.locator('input[type="number"]');
			await numberInputs.nth(0).fill("25"); // Organic kg
			await numberInputs.nth(1).fill("10"); // Recyclable kg
			await numberInputs.nth(2).fill("3");  // Residual sacks

			const saveWasteBtn = officerPage.getByRole("button", { name: "Simpan Catatan Sampah" });
			await saveWasteBtn.click();
			await expect(officerPage.getByText(/Catatan timbunan sampah.*berhasil disimpan/i)).toBeVisible();

			// Click "Serahkan Tugas"
			const submitTaskBtn = officerPage.getByRole("button", { name: "Serahkan Tugas" }).first();
			await submitTaskBtn.click();
			await expect(officerPage.getByText(/Tugas kebersihan diserahkan untuk diverifikasi/i)).toBeVisible();

			await officerPage.screenshot({
				path: "./.scratch/production-readiness/correction-evidence/journey5-cleanup-submitted.png",
				fullPage: true,
			});

			// 6. Organizer Verifies Cleanup in Workspace
			await orgPage.goto(`/dashboard/events/${eventId}/cleanup`);
			await expect(orgPage.getByText(taskTitle).first()).toBeVisible();

			const verifyBtn = orgPage.getByRole("button", { name: "Verifikasi Prajuru" }).first();
			await expect(verifyBtn).toBeVisible();
			await verifyBtn.click();

			await expect(orgPage.getByText(/Kebersihan area berhasil diverifikasi Prajuru/i)).toBeVisible();

			await orgPage.screenshot({
				path: "./.scratch/production-readiness/correction-evidence/journey5-organizer-verified.png",
				fullPage: true,
			});

			// 7. Critical Domain Invariant Verification (AGENTS.md §13 & docs/02-SRS.md FR-056)
			// Cleanup verification must NEVER reopen roads automatically!
			const roadCheckRes = await orgContext.request.get(`${baseURL}/api/events/${eventId}/road-impacts`);
			expect(roadCheckRes.status()).toBe(200);
			const roadCheckData = (await roadCheckRes.json()) as {
				roadImpacts: Array<{ id: string; operationalStatus: { effectiveStatus: string } }>;
			};
			const targetRoad = roadCheckData.roadImpacts.find((r) => r.id === impactId);
			expect(targetRoad).toBeDefined();
			// Operational status MUST STILL BE "closed", NOT reopened!
			expect(targetRoad?.operationalStatus.effectiveStatus).toBe("closed");

			// 8. Organizer Reopens Task
			// In RouteViews, verified tasks can be reopened via API or reopen flow
			const reopenRes = await orgContext.request.post(`${baseURL}/api/cleanup-tasks/${taskId}/reopen`, {
				data: { reason: "Pengecekan ulang kebersihan selokan area Pura" },
			});
			expect(reopenRes.status()).toBe(200);

			// Reload organizer page to confirm task is reopened
			await orgPage.reload();
			await expect(orgPage.getByText(/TERBUKA KEMBALI|REOPENED|in_progress/i).first()).toBeVisible();

			await orgPage.screenshot({
				path: "./.scratch/production-readiness/correction-evidence/journey5-cleanup-reopened.png",
				fullPage: true,
			});
		} finally {
			await orgContext.close();
			await officerContext.close();

			// Database cleanup
			const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
			if (org) {
				const owned = await db.select({ id: events.id }).from(events).where(eq(events.organizationId, org.id));
				if (owned.length) {
					const eventIds = owned.map((e) => e.id);
					const tasks = await db.select({ id: cleanupTasks.id }).from(cleanupTasks).where(inArray(cleanupTasks.eventId, eventIds));
					if (tasks.length) {
						const taskIds = tasks.map((t) => t.id);
						await db.delete(cleanupEvidence).where(inArray(cleanupEvidence.taskId, taskIds));
						await db.delete(cleanupTasks).where(inArray(cleanupTasks.id, taskIds));
					}
					await db.delete(wasteRecords).where(inArray(wasteRecords.eventId, eventIds));

					const impacts = await db.select({ id: roadImpacts.id }).from(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					if (impacts.length) {
						await db.delete(roadStatusUpdates).where(inArray(roadStatusUpdates.roadImpactId, impacts.map((i) => i.id)));
						await db.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
					}
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
				.where(inArray(user.email, [orgEmail, officerEmail]));
			if (usersToDelete.length) {
				const uids = usersToDelete.map((u) => u.id);
				await db.delete(session).where(inArray(session.userId, uids));
				await db.delete(account).where(inArray(account.userId, uids));
				await db.delete(user).where(inArray(user.id, uids));
			}
		}
	});
});
