import crypto from "node:crypto";
import * as dotenv from "dotenv";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { assertDevBranch } from "../../src/db/guard";
import { loadSyntheticAiFixtures } from "../fixtures/ai/dev/loader";
import { loadSyntheticRoadFixtures } from "../fixtures/roads/dev/loader";
import { getDb, type DbClient } from "../../src/db/index";
import {
	account,
	session,
	user,
} from "../../src/db/auth-schema";
import {
	EVENT_STATUSES,
	aiExtractions,
	auditLogs,
	cleanupEvidence,
	cleanupTasks,
	documents,
	eventAssignments,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
	roadStatusUpdates,
	wasteRecords,
} from "../../src/db/schema";
import app from "../../src/worker/index";
import { resetExtractionRateLimits, resetUploadRateLimits } from "../../src/worker/validators/documents";

dotenv.config({ path: ".dev.vars" });

// Helper: In-memory mock R2Bucket
function createMockR2Bucket(): R2Bucket {
	const store = new Map<
		string,
		{
			buffer: ArrayBuffer;
			metadata: Record<string, string>;
			contentType: string;
		}
	>();

	return {
		put: async (key: string, value: unknown, options?: unknown) => {
			let buffer: ArrayBuffer;
			if (value instanceof ArrayBuffer) {
				buffer = value;
			} else if (value instanceof Uint8Array) {
				const copy = new Uint8Array(value.byteLength);
				copy.set(value);
				buffer = copy.buffer;
			} else if (
				typeof value === "object" &&
				value !== null &&
				"arrayBuffer" in value &&
				typeof (value as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer === "function"
			) {
				buffer = await (value as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
			} else {
				const encoded = new TextEncoder().encode(String(value));
				const copy = new Uint8Array(encoded.byteLength);
				copy.set(encoded);
				buffer = copy.buffer;
			}

			const opt = options as {
				httpMetadata?: { contentType?: string };
				customMetadata?: Record<string, string>;
			};

			store.set(key, {
				buffer,
				metadata: opt?.customMetadata || {},
				contentType: opt?.httpMetadata?.contentType || "application/octet-stream",
			});

			return {
				key,
				size: buffer.byteLength,
			} as unknown as R2Object;
		},
		get: async (key: string) => {
			const item = store.get(key);
			if (!item) return null;
			return {
				key,
				size: item.buffer.byteLength,
				body: item.buffer,
				arrayBuffer: async () => item.buffer,
				writeHttpMetadata: (headers: Headers) => {
					headers.set("content-type", item.contentType);
				},
			} as unknown as R2ObjectBody;
		},
		delete: async (key: string | string[]) => {
			const keys = Array.isArray(key) ? key : [key];
			for (const k of keys) {
				store.delete(k);
			}
		},
	} as unknown as R2Bucket;
}

describe("A05-A08 Integrated Operations: Documents, Extraction, Roads & Public APIs", () => {
	let db: DbClient;
	const runKey = crypto.randomUUID().slice(0, 8);
	const testPassword = "TestPassword123!";

	let mockR2: R2Bucket;
	let testEnv: Record<string, unknown>;

	// Run-owned test fixture IDs
	const fixtureOrgA = {
		id: crypto.randomUUID(),
		name: `Banjar Test A (${runKey})`,
		village: "Desa A",
		district: "Kecamatan A",
	};

	const fixtureOrgB = {
		id: crypto.randomUUID(),
		name: `Banjar Test B (${runKey})`,
		village: "Desa B",
		district: "Kecamatan B",
	};

	const fixtureUserOrganizerA = {
		id: `usr_org_a_${runKey}`,
		name: `Organizer A ${runKey}`,
		email: `organizer.a.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureUserTrafficOfficerA = {
		id: `usr_traff_a_${runKey}`,
		name: `Traffic Officer A ${runKey}`,
		email: `traffic.a.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureUserCleanupOfficerA = {
		id: `usr_clean_a_${runKey}`,
		name: `Cleanup Officer A ${runKey}`,
		email: `cleanup.a.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureUserOrganizerB = {
		id: `usr_org_b_${runKey}`,
		name: `Organizer B ${runKey}`,
		email: `organizer.b.${runKey}@test.local`,
		emailVerified: true,
	};

	const fixtureSyntheticRoadSegmentA = {
		id: crypto.randomUUID(),
		displayName: `[TEST] Jl. Danau Tamblingan Unverified (${runKey})`,
		geom: "SRID=4326;LINESTRING(115.2500 -8.6800, 115.2600 -8.6900)",
		coverageArea: "Sanur",
		verifiedBy: null,
		verifiedAt: null,
	};

	const fixtureSyntheticRoadSegmentB = {
		id: crypto.randomUUID(),
		displayName: `[TEST] Jl. Danau Poso Unverified (${runKey})`,
		geom: "SRID=4326;LINESTRING(115.2600 -8.6900, 115.2700 -8.7000)",
		coverageArea: "Sanur",
		verifiedBy: null,
		verifiedAt: null,
	};

	let organizerACookie = "";
	let trafficOfficerACookie = "";
	let cleanupOfficerACookie = "";
	let organizerBCookie = "";

	let draftEventId = "";
	let reviewEventId = "";
	let publishedEventId = "";
	let publishedEventSlug = "";
	let completedEventId = "";

	let uploadedDocId = "";
	let createdImpactId = "";

	beforeAll(async () => {
		const { pinnedUrl, branchId } = await assertDevBranch();
		expect(branchId).toBe("br-wandering-paper-aogdxs48");
		db = getDb(pinnedUrl);
		mockR2 = createMockR2Bucket();

		testEnv = {
			DATABASE_URL: pinnedUrl,
			DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
			BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
			BETTER_AUTH_URL: "http://localhost:5173",
			rangkai_documents_dev: mockR2,
			GEMINI_API_KEY: process.env.GEMINI_API_KEY || "dummy_gemini_api_key_for_tests",
			GEMINI_MODEL: "gemini-2.5-flash",
		};

		// Clean state
		resetUploadRateLimits();
		resetExtractionRateLimits();

		// Seed organizations
		await db.insert(organizations).values([fixtureOrgA, fixtureOrgB]);

		// Seed users
		await db.insert(user).values([
			{
				id: fixtureUserOrganizerA.id,
				name: fixtureUserOrganizerA.name,
				email: fixtureUserOrganizerA.email,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: fixtureUserTrafficOfficerA.id,
				name: fixtureUserTrafficOfficerA.name,
				email: fixtureUserTrafficOfficerA.email,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: fixtureUserCleanupOfficerA.id,
				name: fixtureUserCleanupOfficerA.name,
				email: fixtureUserCleanupOfficerA.email,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: fixtureUserOrganizerB.id,
				name: fixtureUserOrganizerB.name,
				email: fixtureUserOrganizerB.email,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		const hashedPw = await hashPassword(testPassword);

		// Seed accounts
		await db.insert(account).values([
			{
				id: `acc_org_a_${runKey}`,
				accountId: fixtureUserOrganizerA.id,
				providerId: "credential",
				userId: fixtureUserOrganizerA.id,
				password: hashedPw,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: `acc_traff_a_${runKey}`,
				accountId: fixtureUserTrafficOfficerA.id,
				providerId: "credential",
				userId: fixtureUserTrafficOfficerA.id,
				password: hashedPw,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: `acc_clean_a_${runKey}`,
				accountId: fixtureUserCleanupOfficerA.id,
				providerId: "credential",
				userId: fixtureUserCleanupOfficerA.id,
				password: hashedPw,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: `acc_org_b_${runKey}`,
				accountId: fixtureUserOrganizerB.id,
				providerId: "credential",
				userId: fixtureUserOrganizerB.id,
				password: hashedPw,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		// Seed memberships
		await db.insert(memberships).values([
			{
				organizationId: fixtureOrgA.id,
				userId: fixtureUserOrganizerA.id,
				role: "organizer",
			},
			{
				organizationId: fixtureOrgA.id,
				userId: fixtureUserTrafficOfficerA.id,
				role: "officer",
			},
			{
				organizationId: fixtureOrgA.id,
				userId: fixtureUserCleanupOfficerA.id,
				role: "officer",
			},
			{
				organizationId: fixtureOrgB.id,
				userId: fixtureUserOrganizerB.id,
				role: "organizer",
			},
		]);

		// Seed truthful synthetic road segments (strictly unverified)
		await db.insert(roadSegments).values([
			{
				id: fixtureSyntheticRoadSegmentA.id,
				displayName: fixtureSyntheticRoadSegmentA.displayName,
				geom: fixtureSyntheticRoadSegmentA.geom,
				coverageArea: fixtureSyntheticRoadSegmentA.coverageArea,
				verifiedBy: null,
				verifiedAt: null,
			},
			{
				id: fixtureSyntheticRoadSegmentB.id,
				displayName: fixtureSyntheticRoadSegmentB.displayName,
				geom: fixtureSyntheticRoadSegmentB.geom,
				coverageArea: fixtureSyntheticRoadSegmentB.coverageArea,
				verifiedBy: null,
				verifiedAt: null,
			},
		]);

		// Sign in users to capture session cookies
		const signInUser = async (email: string) => {
			const res = await app.request(
				"http://localhost:5173/api/auth/sign-in/email",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ email, password: testPassword }),
				},
				testEnv,
			);
			const setCookie = res.headers.get("set-cookie") || "";
			return setCookie.split(";")[0];
		};

		organizerACookie = await signInUser(fixtureUserOrganizerA.email);
		trafficOfficerACookie = await signInUser(fixtureUserTrafficOfficerA.email);
		cleanupOfficerACookie = await signInUser(fixtureUserCleanupOfficerA.email);
		organizerBCookie = await signInUser(fixtureUserOrganizerB.email);

		// Helper to create test events
		const createTestEvent = async (title: string, status = "draft") => {
			const id = crypto.randomUUID();
			const now = new Date();
			await db.insert(events).values({
				id,
				organizationId: fixtureOrgA.id,
				createdBy: fixtureUserOrganizerA.id,
				title,
				status: status as (typeof EVENT_STATUSES)[number],
				startsAt: new Date("2026-11-20T08:00:00Z"),
				endsAt: new Date("2026-11-20T14:00:00Z"),
				venueName: "Pura Agung",
				category: "upacara",
				createdAt: now,
				updatedAt: now,
			});
			return id;
		};

		draftEventId = await createTestEvent("Draft Event A05", "draft");
		reviewEventId = await createTestEvent("Review Event A05", "review");
		completedEventId = await createTestEvent("Completed Event A05", "completed");

		// Assign traffic officer to draft and published events
		await db.insert(eventAssignments).values([
			{
				eventId: draftEventId,
				userId: fixtureUserTrafficOfficerA.id,
				canUpdateTraffic: true,
				canUpdateCleanup: false,
			},
			{
				eventId: draftEventId,
				userId: fixtureUserCleanupOfficerA.id,
				canUpdateTraffic: false,
				canUpdateCleanup: true,
			},
		]);
	});

	afterAll(async () => {
		if (!db) return;
		try {
			const orgIds = [fixtureOrgA.id, fixtureOrgB.id];
			const testEvents = await db
				.select({ id: events.id })
				.from(events)
				.where(inArray(events.organizationId, orgIds));

			const eventIds = testEvents.map((e) => e.id);
			if (eventIds.length > 0) {
				// Delete waste records
				await db.delete(wasteRecords).where(inArray(wasteRecords.eventId, eventIds));

				// Delete cleanup evidence and tasks
				const tasks = await db
					.select({ id: cleanupTasks.id })
					.from(cleanupTasks)
					.where(inArray(cleanupTasks.eventId, eventIds));
				const taskIds = tasks.map((t) => t.id);
				if (taskIds.length > 0) {
					await db
						.delete(cleanupEvidence)
						.where(inArray(cleanupEvidence.taskId, taskIds));
					await db
						.delete(cleanupTasks)
						.where(inArray(cleanupTasks.eventId, eventIds));
				}

				// Delete road status updates
				const impacts = await db
					.select({ id: roadImpacts.id })
					.from(roadImpacts)
					.where(inArray(roadImpacts.eventId, eventIds));
				const impactIds = impacts.map((i) => i.id);
				if (impactIds.length > 0) {
					await db
						.delete(roadStatusUpdates)
						.where(inArray(roadStatusUpdates.roadImpactId, impactIds));
					await db
						.delete(roadImpacts)
						.where(inArray(roadImpacts.eventId, eventIds));
				}

				// Delete extractions & documents
				const docs = await db
					.select({ id: documents.id })
					.from(documents)
					.where(inArray(documents.eventId, eventIds));
				const docIds = docs.map((d) => d.id);
				if (docIds.length > 0) {
					await db
						.delete(aiExtractions)
						.where(inArray(aiExtractions.documentId, docIds));
					await db
						.delete(documents)
						.where(inArray(documents.eventId, eventIds));
				}

				await db.delete(auditLogs).where(inArray(auditLogs.eventId, eventIds));
				await db
					.delete(eventAssignments)
					.where(inArray(eventAssignments.eventId, eventIds));
				await db.delete(events).where(inArray(events.id, eventIds));
			}

			await db
				.delete(roadSegments)
				.where(
					inArray(roadSegments.id, [
						fixtureSyntheticRoadSegmentA.id,
						fixtureSyntheticRoadSegmentB.id,
					]),
				);

			const userIds = [
				fixtureUserOrganizerA.id,
				fixtureUserTrafficOfficerA.id,
				fixtureUserCleanupOfficerA.id,
				fixtureUserOrganizerB.id,
			];
			await db.delete(session).where(inArray(session.userId, userIds));
			await db.delete(account).where(inArray(account.userId, userIds));
			await db.delete(user).where(inArray(user.id, userIds));
			await db.delete(organizations).where(inArray(organizations.id, orgIds));
		} catch (err) {
			console.error("Cleanup error in afterAll:", err);
		}
	});

	// =========================================================================
	// TICKET 1: A05 - Private Document Upload
	// =========================================================================
	describe("1. A05 - Private Event Document Upload", () => {
		const createValidJpegBytes = () => {
			const b = new Uint8Array(100);
			b[0] = 0xff;
			b[1] = 0xd8;
			b[2] = 0xff;
			return b;
		};

		const createValidPngBytes = () => {
			const b = new Uint8Array(100);
			b[0] = 0x89;
			b[1] = 0x50;
			b[2] = 0x4e;
			b[3] = 0x47;
			b[4] = 0x0d;
			b[5] = 0x0a;
			b[6] = 0x1a;
			b[7] = 0x0a;
			return b;
		};

		const createValidPdfBytes = () => {
			const b = new Uint8Array(100);
			b[0] = 0x25;
			b[1] = 0x50;
			b[2] = 0x44;
			b[3] = 0x46; // %PDF
			return b;
		};

		it("REJECTS anonymous upload attempt (401)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{ method: "POST", body: form },
				testEnv,
			);
			expect(res.status).toBe(401);
		});

		it("REJECTS field officer upload attempt (403)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: trafficOfficerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("FORBIDDEN");
		});

		it("REJECTS upload to an event owned by another organization (403)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerBCookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("REJECTS cross-site Sec-Fetch-Site upload request (403)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Sec-Fetch-Site": "cross-site",
					},
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("REJECTS untrusted Origin header on multipart upload (403)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://attacker.evil.com",
					},
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("REJECTS form-urlencoded Content-Type on documents endpoint (400)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: "file=foo",
				},
				testEnv,
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("BAD_REQUEST");
		});

		it("REJECTS multiple files in single multipart upload (400)", async () => {
			const form = new FormData();
			form.append(
				"file1",
				new File([createValidJpegBytes()], "doc1.jpg", { type: "image/jpeg" })
			);
			form.append(
				"file2",
				new File([createValidJpegBytes()], "doc2.jpg", { type: "image/jpeg" })
			);

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Exactly one file");
		});

		it("REJECTS extension and inspected MIME mismatch (e.g. .jpg file with PDF magic bytes) (400)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidPdfBytes()], "document.jpg", { type: "image/jpeg" })
			);

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("does not match inspected file");
		});
		it("REJECTS empty 0-byte file (400)", async () => {
			const form = new FormData();
			form.append("file", new File([new Uint8Array(0)], "empty.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(400);
		});

		it("REJECTS file exceeding limit (8MB + 1 byte = 8,388,609 bytes) (413)", async () => {
			const oversizedBytes = new Uint8Array(8 * 1024 * 1024 + 1);
			oversizedBytes[0] = 0xff;
			oversizedBytes[1] = 0xd8;
			oversizedBytes[2] = 0xff;

			const form = new FormData();
			form.append("file", new File([oversizedBytes], "oversized.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(413);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("FILE_TOO_LARGE");
		});

		it("REJECTS file with invalid magic bytes / spoofed signature (400)", async () => {
			const corruptedBytes = new TextEncoder().encode("Not a real JPEG image");
			const form = new FormData();
			form.append("file", new File([corruptedBytes], "spoofed.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(400);
		});

		it("REJECTS upload to completed event (409)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${completedEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(409);
		});

		it("UPLOADS valid JPEG document successfully to draft event (201)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidJpegBytes()], "../../../unsafe_surat_pengumuman.jpg", {
					type: "image/jpeg",
				}),
			);

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
					},
					body: form,
				},
				testEnv,
			);

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				document: {
					id: string;
					eventId: string;
					originalName: string;
					mimeType: string;
					sizeBytes: number;
					createdAt: string;
				};
			};

			expect(body.document.id).toBeDefined();
			expect(body.document.eventId).toBe(draftEventId);
			expect(body.document.mimeType).toBe("image/jpeg");
			// Path traversal stripped
			expect(body.document.originalName).toBe("unsafe_surat_pengumuman.jpg");
			// R2 key MUST NOT be returned in response
			expect((body.document as Record<string, unknown>).r2Key).toBeUndefined();

			uploadedDocId = body.document.id;

			// Verify atomic audit log
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, draftEventId),
						eq(auditLogs.action, "document.uploaded"),
					),
				);
			expect(audits.length).toBeGreaterThanOrEqual(1);
			expect(audits[0].entityId).toBe(uploadedDocId);
		});

		it("UPLOADS valid PNG document successfully (201)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidPngBytes()], "denah.png", { type: "image/png" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(201);
			const body = (await res.json()) as { document: { mimeType: string } };
			expect(body.document.mimeType).toBe("image/png");
		});

		it("UPLOADS PDF document to review event and resets status to draft (201)", async () => {
			const form = new FormData();
			form.append("file", new File([createValidPdfBytes()], "undangan.pdf", { type: "application/pdf" }));

			const res = await app.request(
				`http://localhost:5173/api/events/${reviewEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);

			expect(res.status).toBe(201);

			// Verify event status reset to draft
			const eventRow = (
				await db.select().from(events).where(eq(events.id, reviewEventId)).limit(1)
			)[0];
			expect(eventRow.status).toBe("draft");
			expect(eventRow.verifiedBy).toBeNull();
			expect(eventRow.verifiedAt).toBeNull();
		});

		it("LISTS documents for event via GET /api/events/:eventId/documents (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { documents: Array<{ id: string; originalName: string }> };
			expect(body.documents.length).toBeGreaterThanOrEqual(1);
			expect(body.documents.some((d) => d.id === uploadedDocId)).toBe(true);
			// Does not expose r2Key
			expect((body.documents[0] as Record<string, unknown>).r2Key).toBeUndefined();
		});

		it("DOWNLOADS document content via GET /api/events/:eventId/documents/:documentId (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents/${uploadedDocId}`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("image/jpeg");
			expect(res.headers.get("cache-control")).toContain("private");

			const bytes = new Uint8Array(await res.arrayBuffer());
			expect(bytes[0]).toBe(0xff);
			expect(bytes[1]).toBe(0xd8);
		});

		it("REJECTS download for unauthorized user (403)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents/${uploadedDocId}`,
				{
					method: "GET",
					headers: { Cookie: organizerBCookie },
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});
	});

	// =========================================================================
	// TICKET 2: A06 - Gemini Extraction and Human Correction
	// =========================================================================
	describe("2. A06 - Private Source Extraction and Human Correction", () => {
		let createdExtractionId = "";

		it("REJECTS extraction by non-organizer (403)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/extractions`,
				{
					method: "POST",
					headers: {
						Cookie: trafficOfficerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ documentId: uploadedDocId }),
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("REJECTS extraction for document belonging to another event (404)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${reviewEventId}/extractions`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ documentId: uploadedDocId }),
				},
				testEnv,
			);
			expect(res.status).toBe(404);
		});

		it("EXECUTES Gemini extraction and validates structured schema (200)", async () => {
			// Mock global fetch for Gemini API call
			const realFetch = globalThis.fetch;
			globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
				const urlStr = String(url);
				if (urlStr.includes("generativelanguage.googleapis.com")) {
					const mockAiResponse = {
						candidates: [
							{
								content: {
									parts: [
										{
											text: JSON.stringify({
												schema_version: "1.0",
												event_name: {
													value: "Karya Melasti Sanur",
													evidence: "Upacara Karya Melasti di Sanur",
													needs_review: false,
												},
												start_datetime: {
													value: "2026-11-20T08:00:00+08:00",
													evidence: "20 November 2026 pukul 08.00 WITA",
													needs_review: false,
												},
												end_datetime: {
													value: null,
													evidence: null,
													needs_review: true,
												},
												venue_name: {
													value: "Pantai Matahari Terbit",
													evidence: "bertempat di Pantai Matahari Terbit",
													needs_review: false,
												},
												affected_road_names: [
													{
														name: "Jl. Danau Tamblingan",
														evidence: "melewati Jl. Danau Tamblingan",
														needs_review: true,
													},
												],
												traffic_impact_description: {
													value: "Iring-iringan prosesi adat melintasi jalan utama",
													evidence: "prosesi melintasi jalan utama",
													needs_review: true,
												},
												issues: ["Waktu selesai tidak tercantum pada surat"],
											}),
										},
									],
								},
							},
						],
					};
					return new Response(JSON.stringify(mockAiResponse), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				return realFetch(url, init);
			};

			try {
				const res = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ documentId: uploadedDocId }),
					},
					testEnv,
				);

				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					extraction: {
						id: string;
						documentId: string;
						status: string;
						modelName: string;
						promptVersion: string;
						schemaVersion: string;
						outputJson: {
							event_name: { value: string; needs_review: boolean };
							start_datetime: { value: string };
							end_datetime: { value: string | null; needs_review: boolean };
							affected_road_names: Array<{ name: string }>;
							issues: string[];
						};
					};
				};

				expect(body.extraction.status).toBe("completed");
				expect(body.extraction.modelName).toBe("gemini-2.5-flash");
				expect(body.extraction.outputJson.event_name.value).toBe("Karya Melasti Sanur");
				expect(body.extraction.outputJson.end_datetime.value).toBeNull();
				expect(body.extraction.outputJson.end_datetime.needs_review).toBe(true);
				expect(body.extraction.outputJson.affected_road_names[0].name).toBe(
					"Jl. Danau Tamblingan",
				);
				expect(body.extraction.outputJson.issues).toContain(
					"Waktu selesai tidak tercantum pada surat",
				);

				createdExtractionId = body.extraction.id;

				// Verify audit log
				const audits = await db
					.select()
					.from(auditLogs)
					.where(
						and(
							eq(auditLogs.eventId, draftEventId),
							eq(auditLogs.action, "extraction.completed"),
						),
					);
				expect(audits.length).toBeGreaterThanOrEqual(1);
			} finally {
				globalThis.fetch = realFetch;
			}
		});

		it("RETRIEVES extraction detail via GET /api/extractions/:extractionId (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/extractions/${createdExtractionId}`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { extraction: { id: string; status: string } };
			expect(body.extraction.id).toBe(createdExtractionId);
			expect(body.extraction.status).toBe("completed");
		});

		it("REJECTS concurrent extraction attempt when one is already in progress (409)", async () => {
			// Manually insert an active extraction in 'processing' status to simulate in-flight reservation
			const tempActiveExtractionId = crypto.randomUUID();
			await db.insert(aiExtractions).values({
				id: tempActiveExtractionId,
				documentId: uploadedDocId,
				modelName: "gemini-2.5-flash",
				promptVersion: "v1.1",
				schemaVersion: "1.0",
				status: "processing",
				createdAt: new Date(),
			});

			try {
				const res = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ documentId: uploadedDocId }),
					},
					testEnv,
				);
				expect(res.status).toBe(409);
				const body = (await res.json()) as { error: { code: string; message: string } };
				expect(body.error.code).toBe("STATE_CONFLICT");
				expect(body.error.message).toContain("already in progress");
			} finally {
				await db.delete(aiExtractions).where(eq(aiExtractions.id, tempActiveExtractionId));
			}
		});

		it("REJECTS extraction when exceeding rate limit (429)", async () => {
			// Deplete extraction rate limit (5 attempts)
			for (let i = 0; i < 5; i++) {
				await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ documentId: uploadedDocId }),
					},
					testEnv,
				);
			}

			// 6th attempt must trigger 429 RATE_LIMITED
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/extractions`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ documentId: uploadedDocId }),
				},
				testEnv,
			);
			expect(res.status).toBe(429);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("RATE_LIMITED");

			// Reset rate limits so subsequent tests run unimpeded
			resetExtractionRateLimits();
		});
		it("APPLIES corrected fields via PATCH /api/events/:eventId/extracted-fields (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/extracted-fields`,
				{
					method: "PATCH",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Karya Melasti Sanur (Terkonfirmasi)",
						startsAt: "2026-11-20T08:00:00Z",
						endsAt: "2026-11-20T16:00:00Z",
						venueName: "Pantai Matahari Terbit Sanur",
						category: "upacara",
						description: "Prosesi adat melasti menuju segara",
						permitReference: "SURAT/2026/099",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { event: { title: string; endsAt: string } };
			expect(body.event.title).toBe("Karya Melasti Sanur (Terkonfirmasi)");
			expect(new Date(body.event.endsAt).toISOString()).toBe("2026-11-20T16:00:00.000Z");

			// Verify atomic audit log
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, draftEventId),
						eq(auditLogs.action, "event.extracted_fields_corrected"),
					),
				);
			expect(audits.length).toBeGreaterThanOrEqual(1);
		});

		it("HANDLES Gemini provider failure gracefully by saving failed extraction state", async () => {
			const realFetch = globalThis.fetch;
			globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
				const urlStr = String(url);
				if (urlStr.includes("generativelanguage.googleapis.com")) {
					return new Response(JSON.stringify({ error: { message: "Internal error" } }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				}
				return realFetch(url, init);
			};

			try {
				const res = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ documentId: uploadedDocId }),
					},
					testEnv,
				);

				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					extraction: { status: string; errorCode: string };
				};
				expect(body.extraction.status).toBe("failed");
				expect(body.extraction.errorCode).toBe("PROVIDER_ERROR");
			} finally {
				globalThis.fetch = realFetch;
			}
		});
	});

	// =========================================================================
	// TICKET 3: A07 - Verified Road Catalog and Planned Impacts
	// =========================================================================
	describe("3. A07 - Verified Road Catalog and Planned Impacts", () => {
		it("REJECTS non-organizer querying road catalog (403)", async () => {
			const res = await app.request(
				"http://localhost:5173/api/road-segments?bbox=115.2, -8.7, 115.3, -8.6",
				{
					method: "GET",
					headers: { Cookie: trafficOfficerACookie },
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("REJECTS malformed or reversed bbox query parameter (422)", async () => {
			// Reversed minLat > maxLat
			const res = await app.request(
				"http://localhost:5173/api/road-segments?bbox=115.2,-8.5,115.3,-8.9",
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("TRUTHFUL SYNTHETIC FIXTURES: Validates unverified synthetic road and AI loaders", () => {
			// Verify road loader: exactly 5 synthetic roads, all unverified
			const roadCollection = loadSyntheticRoadFixtures();
			expect(roadCollection.features.length).toBe(5);
			for (const f of roadCollection.features) {
				expect(f.properties.verified).toBe(false);
				expect(f.properties.verifiedBy).toBeNull();
				expect(f.properties.verifiedAt).toBeNull();
				expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
			}

			// Verify AI loader: exactly 5 synthetic document pairs
			const aiFixtures = loadSyntheticAiFixtures();
			expect(aiFixtures.length).toBe(5);
			for (const fix of aiFixtures) {
				expect(fix.id).toBeDefined();
				expect(fix.sourceMime).toBeDefined();
			expect(fix.groundTruth.event_name.value).toBeDefined();
			}
		});

		it("EXCLUDES unverified road segments from catalog search (200)", async () => {
			// Query bbox containing the synthetic segments
			const res = await app.request(
				"http://localhost:5173/api/road-segments?bbox=115.24,-8.70,115.27,-8.67",
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { segments: Array<{ id: string }> };
			// All synthetic segments are unverified, so they MUST NOT appear in catalog!
			expect(body.segments.some((s) => s.id === fixtureSyntheticRoadSegmentA.id)).toBe(false);
			expect(body.segments.some((s) => s.id === fixtureSyntheticRoadSegmentB.id)).toBe(false);
		});

		it("RETURNS empty array when bbox has no coverage (200)", async () => {
			const res = await app.request(
				"http://localhost:5173/api/road-segments?bbox=106.8,-6.2,106.9,-6.1",
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { segments: unknown[] };
			expect(body.segments).toEqual([]);
		});

		it("REJECTS road impact creation with unverified road segment (422)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/road-impacts`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						roadSegmentId: fixtureSyntheticRoadSegmentA.id,
						plannedFrom: "2026-11-20T08:00:00Z",
						plannedTo: "2026-11-20T12:00:00Z",
						impactType: "closure",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("not been verified");
		});

		it("REJECTS road impact with plannedTo <= plannedFrom (422)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/road-impacts`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						roadSegmentId: fixtureSyntheticRoadSegmentA.id,
						plannedFrom: "2026-11-20T12:00:00Z",
						plannedTo: "2026-11-20T08:00:00Z",
						impactType: "closure",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(422);
		});

		it("REJECTS event publication referencing unverified road segment (422)", async () => {
			// Directly insert an unverified road impact on reviewEventId
			const tempImpact = await db
				.insert(roadImpacts)
				.values({
					id: crypto.randomUUID(),
					eventId: reviewEventId,
					roadSegmentId: fixtureSyntheticRoadSegmentA.id,
					plannedFrom: new Date("2026-11-20T08:00:00Z"),
					plannedTo: new Date("2026-11-20T12:00:00Z"),
					impactType: "closure",
					diversionNote: "Uji coba segmen belum verifikasi",
				})
				.returning();

			// Transition review event to review state with organizer verification
			await db
				.update(events)
				.set({
					status: "review",
					verifiedBy: fixtureUserOrganizerA.id,
					verifiedAt: new Date(),
				})
				.where(eq(events.id, reviewEventId));

			const res = await app.request(
				`http://localhost:5173/api/events/${reviewEventId}/publish`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
					},
				},
				testEnv,
			);

			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("unverified road segment");

			// Clean up temp impact
			await db.delete(roadImpacts).where(eq(roadImpacts.id, tempImpact[0].id));
		});
	});

	// =========================================================================
	// TICKET 4: A08 - Authorized Road Status History and Anonymous Public Information
	// =========================================================================
	describe("4. A08 - Authorized Road Status History and Anonymous Public Information", () => {
		const mutationA = crypto.randomUUID();
		const mutationB = crypto.randomUUID();
		let observedTime = "";

		beforeAll(async () => {
			// Directly insert an isolated non-operational published event and road impact via DB
			// (Truthful testing: synthetic road segments remain unverified per C03 deferral)
			publishedEventSlug = `sanur-operations-${runKey}`;
			const pubEventRows = await db
				.insert(events)
				.values({
					id: crypto.randomUUID(),
					organizationId: fixtureOrgA.id,
					createdBy: fixtureUserOrganizerA.id,
					title: `Published Event Operations ${runKey}`,
					venueName: "Pantai Matahari Terbit Sanur",
					startsAt: new Date("2026-11-20T08:00:00Z"),
					endsAt: new Date("2026-11-20T14:00:00Z"),
					category: "upacara",
					status: "published",
					publicSlug: publishedEventSlug,
					publishedAt: new Date(),
					verifiedBy: fixtureUserOrganizerA.id,
					verifiedAt: new Date(),
				})
				.returning();
			publishedEventId = pubEventRows[0].id;

			await db.insert(eventAssignments).values([
				{
					eventId: publishedEventId,
					userId: fixtureUserTrafficOfficerA.id,
					canUpdateTraffic: true,
					canUpdateCleanup: false,
				},
				{
					eventId: publishedEventId,
					userId: fixtureUserCleanupOfficerA.id,
					canUpdateTraffic: false,
					canUpdateCleanup: true,
				},
			]);

			const impRows = await db
				.insert(roadImpacts)
				.values({
					eventId: publishedEventId,
					roadSegmentId: fixtureSyntheticRoadSegmentA.id,
					plannedFrom: new Date("2026-11-20T08:00:00Z"),
					plannedTo: new Date("2026-11-20T14:00:00Z"),
					impactType: "closure",
					diversionNote: "Pengalihan uji coba",
				})
				.returning();
			createdImpactId = impRows[0].id;
		});

		it("REJECTS status update by unauthenticated caller (401)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						status: "closed",
						observedAt: new Date().toISOString(),
						mutationId: crypto.randomUUID(),
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(401);
		});

		it("REJECTS status update by cleanup-only officer (403)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "closed",
						observedAt: new Date().toISOString(),
						mutationId: crypto.randomUUID(),
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("FORBIDDEN");
		});

		it("REJECTS status update with observation timestamp > 5m in future (422)", async () => {
			const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			const res = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: trafficOfficerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "closed",
						observedAt: futureTime,
						mutationId: crypto.randomUUID(),
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("RECORDS road status update by assigned traffic officer with server TTL (200)", async () => {
			observedTime = new Date().toISOString();

			const res = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: trafficOfficerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "closed",
						observedAt: observedTime,
						mutationId: mutationA,
						note: "Ditutup sementara untuk iring-iringan upacara",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				status: string;
				observedAt: string;
				expiresAt: string;
				updatedBy: string;
			};

			expect(body.status).toBe("closed");
			expect(body.updatedBy).toBe(fixtureUserTrafficOfficerA.id);

			// Server TTL check: expiresAt should be approximately observedAt + 30 minutes
			const expiryDate = new Date(body.expiresAt);
			const obsDate = new Date(body.observedAt);
			const diffMinutes = (expiryDate.getTime() - obsDate.getTime()) / (60 * 1000);
			expect(Math.round(diffMinutes)).toBe(30);

			// Verify atomic audit log
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, publishedEventId),
						eq(auditLogs.action, "road_status.updated"),
					),
				);
			expect(audits.length).toBeGreaterThanOrEqual(1);
		});

		it("IS IDEMPOTENT: repeated mutationId with identical payload returns 200 without duplicate row or audit", async () => {
			const auditsBefore = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, publishedEventId),
						eq(auditLogs.action, "road_status.updated"),
					),
				);

			const res = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: trafficOfficerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "closed",
						observedAt: observedTime,
						mutationId: mutationA,
						note: "Ditutup sementara untuk iring-iringan upacara",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { status: string };
			expect(body.status).toBe("closed");

			const auditsAfter = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, publishedEventId),
						eq(auditLogs.action, "road_status.updated"),
					),
				);
			expect(auditsAfter.length).toBe(auditsBefore.length);
		});

		it("REJECTS reused mutationId with conflicting payload (409)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: trafficOfficerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "open", // conflicting with original "closed"
						observedAt: new Date().toISOString(),
						mutationId: mutationA,
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("STATE_CONFLICT");
		});

		it("SUPPORTS append-only history with second status update (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "intermittent",
						observedAt: new Date().toISOString(),
						mutationId: mutationB,
						note: "Dibuka situasional secara bergantian",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { status: string };
			expect(body.status).toBe("intermittent");

			// Confirm append-only: both updates exist in DB
			const updates = await db
				.select()
				.from(roadStatusUpdates)
				.where(eq(roadStatusUpdates.roadImpactId, createdImpactId));
			expect(updates.length).toBe(2);
		});

		// ---------------------------------------------------------------------
		// Anonymous Public Endpoints
		// ---------------------------------------------------------------------
		it("PUBLIC: GET /api/public/events lists published events without auth (200)", async () => {
			const res = await app.request(
				"http://localhost:5173/api/public/events",
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				events: Array<{
					id: string;
					publicSlug: string;
					title: string;
					status: string;
				}>;
			};

			expect(body.events.length).toBeGreaterThanOrEqual(1);
			const publishedEvent = body.events.find((e) => e.id === publishedEventId);
			expect(publishedEvent).toBeDefined();
			expect(publishedEvent?.publicSlug).toBe(publishedEventSlug);
			expect(publishedEvent?.status).toBe("published");

			// Draft, review, completed events MUST NOT be exposed
			expect(body.events.some((e) => e.id === reviewEventId)).toBe(false);
			expect(body.events.some((e) => e.id === completedEventId)).toBe(false);

			// Privacy check: no email, user ID, or internal fields
			expect((publishedEvent as Record<string, unknown>).createdBy).toBeUndefined();
			expect((publishedEvent as Record<string, unknown>).organizationId).toBeUndefined();
		});

		it("PUBLIC: GET /api/public/events/:slug returns public event detail (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/public/events/${publishedEventSlug}`,
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				event: {
					publicSlug: string;
					title: string;
					status: string;
					venueName: string;
				};
			};

			expect(body.event.publicSlug).toBe(publishedEventSlug);
			expect(body.event.status).toBe("published");
			expect(body.event.venueName).toBe("Pantai Matahari Terbit Sanur");
			// Private fields excluded
			expect((body.event as Record<string, unknown>).createdBy).toBeUndefined();
		});

		it("PUBLIC: GET /api/public/events/:slug returns 404 for non-existent slug", async () => {
			const res = await app.request(
				"http://localhost:5173/api/public/events/non-existent-slug-xyz",
				{ method: "GET" },
				testEnv,
			);
			expect(res.status).toBe(404);
		});

		it("PUBLIC: GET /api/public/events/:slug/roads returns effective live status (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/public/events/${publishedEventSlug}/roads`,
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				roads: Array<{
					id: string;
					roadSegmentName: string;
					impactType: string;
					effectiveStatus: string;
					isExpired: boolean;
					lastConfirmedAt: string;
					expiresAt: string;
				}>;
			};

			expect(body.roads.length).toBe(1);
			const road = body.roads[0];
			expect(road.id).toBe(createdImpactId);
			expect(road.roadSegmentName).toContain("Jl. Danau Tamblingan");
			// Latest status was "intermittent"
			expect(road.effectiveStatus).toBe("intermittent");
			expect(road.isExpired).toBe(false);
			expect(road.lastConfirmedAt).toBeDefined();

			// PRIVACY CHECK: Officer private note and officer ID MUST NOT be exposed!
			expect((road as Record<string, unknown>).note).toBeUndefined();
			expect((road as Record<string, unknown>).updatedBy).toBeUndefined();
		});

		it("PUBLIC: Marks expired road status as unconfirmed", async () => {
			// Manually expire the status updates in the database for testing
			const pastExpiry = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
			await db
				.update(roadStatusUpdates)
				.set({ expiresAt: pastExpiry })
				.where(eq(roadStatusUpdates.roadImpactId, createdImpactId));

			const res = await app.request(
				`http://localhost:5173/api/public/events/${publishedEventSlug}/roads`,
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				roads: Array<{
					effectiveStatus: string;
					isExpired: boolean;
					lastConfirmedAt: string;
				}>;
			};

			const road = body.roads[0];
			// AGENTS.md §13 & docs/02-SRS: Expired status must be displayed as unconfirmed!
			expect(road.effectiveStatus).toBe("unconfirmed");
			expect(road.isExpired).toBe(true);
			// Retains last confirmed observation time
			expect(road.lastConfirmedAt).toBeDefined();
		});
	});

	describe("5. A08 - Cleanup Tasks, Private Photo Evidence, Waste Records and Verification", () => {
		let cleanupTaskId: string;
		let beforeEvidenceId: string;

		const createPngBytes = () => {
			const bytes = new Uint8Array(16);
			bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			return bytes;
		};

		const createJpegBytes = () => {
			const bytes = new Uint8Array(16);
			bytes.set([0xff, 0xd8, 0xff, 0xe0]);
			return bytes;
		};

		it("LISTS cleanup tasks for event initially empty (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/cleanup-tasks`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { cleanupTasks: unknown[] };
			expect(Array.isArray(body.cleanupTasks)).toBe(true);
			expect(body.cleanupTasks.length).toBe(0);
		});

		it("REJECTS cleanup task creation by non-organizer officer (403)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/cleanup-tasks`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Pembersihan Area Upacara",
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("REJECTS cleanup task with invalid coordinates (422)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/cleanup-tasks`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Pembersihan Invalid Coordinate",
						location: { lng: 115.2, lat: 95.0 }, // Invalid lat > 90
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("REJECTS cleanup task assigning user outside organization (422)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/cleanup-tasks`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Pembersihan Area Upacara",
						assignedUserId: fixtureUserOrganizerB.id, // Org B user
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("CREATES valid cleanup task atomically with audit log (201)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/cleanup-tasks`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Pembersihan Pura Sanur Pasca Upacara",
						description: "Pengangkutan sampah canang dan wadah sisa sesajen.",
						location: { lng: 115.2166, lat: -8.65 },
						assignedUserId: fixtureUserCleanupOfficerA.id,
						dueAt: "2026-11-20T16:00:00+08:00",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				cleanupTask: {
					id: string;
					title: string;
					status: string;
					assignedUserId: string;
					location: { lng: number; lat: number };
				};
			};

			expect(body.cleanupTask.id).toBeDefined();
			expect(body.cleanupTask.title).toBe("Pembersihan Pura Sanur Pasca Upacara");
			expect(body.cleanupTask.status).toBe("todo");
			expect(body.cleanupTask.assignedUserId).toBe(fixtureUserCleanupOfficerA.id);
			expect(body.cleanupTask.location).toEqual({ lng: 115.2166, lat: -8.65 });
			cleanupTaskId = body.cleanupTask.id;

			// Verify audit log committed
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.entityId, cleanupTaskId),
						eq(auditLogs.action, "cleanup_task.created"),
					),
				);
			expect(audits.length).toBe(1);
			expect(audits[0].entityType).toBe("cleanup_task");
		});

		it("ROLE CHECK: Rejects officer modifying administrative fields via PATCH (403)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
				{
					method: "PATCH",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Judul Baru Yang Tidak Diizinkan",
						dueAt: "2026-11-21T18:00:00+08:00",
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("ALLOWS cleanup officer to update task status to in_progress via PATCH (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
				{
					method: "PATCH",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "in_progress",
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { cleanupTask: { status: string } };
			expect(body.cleanupTask.status).toBe("in_progress");
		});

		it("ALLOWS organizer to update task title and description via PATCH (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
				{
					method: "PATCH",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Pembersihan Kawasan Pura Sanur & Pantai",
						description: "Fokus pada area parkir dan tepi pantai.",
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { cleanupTask: { title: string; description: string } };
			expect(body.cleanupTask.title).toBe("Pembersihan Kawasan Pura Sanur & Pantai");
			expect(body.cleanupTask.description).toBe("Fokus pada area parkir dan tepi pantai.");
		});

		it("REJECTS evidence photo upload with invalid/spoofed file (422)", async () => {
			resetUploadRateLimits();
			const form = new FormData();
			form.append("stage", "before");
			form.append(
				"file",
				new File([new TextEncoder().encode("not an image")], "fake.jpg", {
					type: "image/jpeg",
				}),
			);

			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("REJECTS evidence photo upload with invalid stage (422)", async () => {
			const form = new FormData();
			form.append("stage", "during"); // Invalid stage
			form.append(
				"file",
				new File([createPngBytes()], "valid.png", { type: "image/png" }),
			);

			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("ACCEPTS valid before photo evidence upload to R2 (201)", async () => {
			const form = new FormData();
			form.append("stage", "before");
			form.append(
				"file",
				new File([createPngBytes()], "before_cleaning.png", {
					type: "image/png",
				}),
			);

			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: form,
				},
				testEnv,
			);

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				evidence: { id: string; taskId: string; stage: string; createdAt: string };
			};
			expect(body.evidence.id).toBeDefined();
			expect(body.evidence.taskId).toBe(cleanupTaskId);
			expect(body.evidence.stage).toBe("before");
			beforeEvidenceId = body.evidence.id;

			// Verify safe metadata returned - no raw R2 key leaked
			expect((body.evidence as Record<string, unknown>).r2Key).toBeUndefined();
		});

		it("SUBMISSION REQUIREMENT: Rejects submission without 'after' photo evidence (409)", async () => {
			// Task is currently in_progress and only has 'before' photo evidence
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/submit`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
				},
				testEnv,
			);
			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("without at least one 'after' photo");
		});

		it("ACCEPTS valid after photo evidence upload to R2 (201)", async () => {
			const form = new FormData();
			form.append("stage", "after");
			form.append(
				"file",
				new File([createJpegBytes()], "after_cleaning.jpg", {
					type: "image/jpeg",
				}),
			);

			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: form,
				},
				testEnv,
			);

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				evidence: { id: string; taskId: string; stage: string; createdAt: string };
			};
			expect(body.evidence.id).toBeDefined();
			expect(body.evidence.stage).toBe("after");
		});

		it("CONTROLLED RETRIEVAL: Downloads evidence photo for authorized officer (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence/${beforeEvidenceId}`,
				{
					method: "GET",
					headers: { Cookie: cleanupOfficerACookie },
				},
				testEnv,
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("Cache-Control")).toContain("private");
		});

		it("CONTROLLED RETRIEVAL: Rejects unauthorized user downloading evidence (403)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence/${beforeEvidenceId}`,
				{
					method: "GET",
					headers: { Cookie: organizerBCookie }, // Other org
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("ROLE CHECK: Rejects officer B modifying officer A's assigned task (403)", async () => {
			// Organizer B cookie trying to patch Officer A's task in Org A
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
				{
					method: "PATCH",
					headers: {
						Cookie: organizerBCookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "in_progress",
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("EVIDENCE OWNERSHIP: Rejects officer B uploading photo evidence to officer A's task (403)", async () => {
			const form = new FormData();
			form.append("file", new File([createJpegBytes()], "officer_b.jpg", { type: "image/jpeg" }));
			form.append("stage", "before");

			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: organizerBCookie,
						Origin: "http://localhost:5173",
					},
					body: form,
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("SUBMISSION: Officer submits completed cleanup task (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/submit`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { cleanupTask: { status: string } };
			expect(body.cleanupTask.status).toBe("submitted");

			// Audit logged
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.entityId, cleanupTaskId),
						eq(auditLogs.action, "cleanup_task.submitted"),
					),
				);
			expect(audits.length).toBe(1);
		});

		it("VERIFICATION: Rejects officer attempting task verification (403)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/verify`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
				},
				testEnv,
			);
			expect(res.status).toBe(403);
		});

		it("VERIFICATION & INDEPENDENCE: Organizer verifies task WITHOUT opening roads (200)", async () => {
			// Query initial road impact status on the event
			const roadStatusBefore = await db
				.select()
				.from(roadStatusUpdates)
				.where(eq(roadStatusUpdates.roadImpactId, createdImpactId))
				.orderBy(desc(roadStatusUpdates.observedAt))
				.limit(1);

			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/verify`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
					},
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				cleanupTask: { status: string; verifiedBy: string; verifiedAt: string };
			};
			expect(body.cleanupTask.status).toBe("verified");
			expect(body.cleanupTask.verifiedBy).toBe(fixtureUserOrganizerA.id);
			expect(body.cleanupTask.verifiedAt).toBeDefined();

			// CRITICAL DOMAIN INVARIANT (AGENTS §13 & SRS FR-056):
			// Cleanup verification must NOT automatically reopen or alter road status!
			const roadStatusAfter = await db
				.select()
				.from(roadStatusUpdates)
				.where(eq(roadStatusUpdates.roadImpactId, createdImpactId))
				.orderBy(desc(roadStatusUpdates.observedAt))
				.limit(1);

			expect(roadStatusAfter.length).toBe(roadStatusBefore.length);
			if (roadStatusBefore[0]) {
				expect(roadStatusAfter[0].status).toBe(roadStatusBefore[0].status);
			}
		});

		it("LIFECYCLE LOCK: Rejects direct PATCH modification on verified task (409)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
				{
					method: "PATCH",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Judul setelah verifikasi yang dilarang",
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Verified tasks cannot be edited");
		});
		it("REOPEN: Organizer reopens verified task (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/reopen`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						reason: "Perlu pembersihan tambahan di bagian sudut pelataran.",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				cleanupTask: { status: string; verifiedBy: string | null; verifiedAt: string | null };
			};
			expect(body.cleanupTask.status).toBe("reopened");
			expect(body.cleanupTask.verifiedBy).toBeNull();
			expect(body.cleanupTask.verifiedAt).toBeNull();
		});

		it("WASTE RECORDS: Rejects waste record with neither quantityKg nor sackCount (422)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/waste-records`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						category: "organic",
						measurementMethod: "weighed",
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("WASTE RECORDS: Creates weighed organic waste record (201)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/waste-records`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						category: "organic",
						quantityKg: 42.5,
						measurementMethod: "weighed",
						destination: "Kompos TPS3R Sanur",
						taskId: cleanupTaskId,
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				wasteRecord: {
					id: string;
					category: string;
					quantityKg: number;
					measurementMethod: string;
					destination: string;
				};
			};

			expect(body.wasteRecord.id).toBeDefined();
			expect(body.wasteRecord.category).toBe("organic");
			expect(body.wasteRecord.quantityKg).toBe(42.5);
			expect(body.wasteRecord.measurementMethod).toBe("weighed");
			expect(body.wasteRecord.destination).toBe("Kompos TPS3R Sanur");
		});

		it("WASTE RECORDS: Creates estimated residual waste record with sack count (201)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/waste-records`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						category: "residual",
						sackCount: 5,
						measurementMethod: "estimated",
						destination: "TPA Suwung",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				wasteRecord: {
					id: string;
					category: string;
					sackCount: number;
					measurementMethod: string;
				};
			};

			expect(body.wasteRecord.category).toBe("residual");
			expect(body.wasteRecord.sackCount).toBe(5);
			expect(body.wasteRecord.measurementMethod).toBe("estimated");
		});

		it("WASTE RECORDS: Lists waste records for event (200)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/waste-records`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { wasteRecords: Array<{ category: string }> };
			expect(body.wasteRecords.length).toBeGreaterThanOrEqual(2);
		});

		it("PUBLIC: Returns aggregated cleanup summary without private details (200)", async () => {
			// Publish the draft event or create cleanup items on published event
			await db.insert(cleanupTasks).values({
				id: crypto.randomUUID(),
				eventId: publishedEventId,
				title: "Pembersihan Area Upacara Publik",
				status: "verified",
				assignedUserId: fixtureUserCleanupOfficerA.id,
			});

			await db.insert(wasteRecords).values({
				id: crypto.randomUUID(),
				eventId: publishedEventId,
				category: "organic",
				quantityKg: "35.00",
				measurementMethod: "weighed",
				recordedBy: fixtureUserOrganizerA.id,
			});

			const res = await app.request(
				`http://localhost:5173/api/public/events/${publishedEventSlug}/cleanup-summary`,
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				cleanupSummary: {
					totalTasks: number;
					verifiedTasks: number;
					wasteTotals: {
						weighedKg: number;
						estimatedKg: number;
						totalSacks: number;
						byCategory: Record<string, { weighedKg: number; estimatedKg: number; totalSacks: number }>;
					};
				};
			};

			expect(body.cleanupSummary).toBeDefined();
			expect(body.cleanupSummary.totalTasks).toBeGreaterThanOrEqual(1);
			expect(body.cleanupSummary.verifiedTasks).toBeGreaterThanOrEqual(1);
			expect(body.cleanupSummary.wasteTotals.weighedKg).toBeGreaterThanOrEqual(35);
			expect(body.cleanupSummary.wasteTotals.estimatedKg).toBeGreaterThanOrEqual(0);
			expect(body.cleanupSummary.wasteTotals.totalSacks).toBeGreaterThanOrEqual(0);

			// PRIVACY CHECK: Zero private notes, keys, assignee emails
			expect((body.cleanupSummary as Record<string, unknown>).assignedUserEmail).toBeUndefined();
			expect((body.cleanupSummary as Record<string, unknown>).r2Key).toBeUndefined();
		});
	});
});
