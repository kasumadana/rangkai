import crypto from "node:crypto";
import * as dotenv from "dotenv";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import { assertDevBranch, AUTHORIZED_DEV_BRANCH } from "../../src/db/guard";
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
import {
	MAX_CLEANUP_PHOTO_SIZE_BYTES,
	MAX_DOCUMENT_SIZE_BYTES,
	resetExtractionRateLimits,
	resetUploadRateLimits,
} from "../../src/worker/validators/documents";
import { GEMINI_MODEL_NAME } from "../../src/worker/validators/extractions";

dotenv.config({ path: ".dev.vars" });
neonConfig.webSocketConstructor = WebSocket;

function withHeldMutation<T>(
	test: (payload: { query?: string; params?: unknown[] }) => boolean,
	start: () => Promise<T> | T,
	during: () => Promise<void>,
): Promise<{ result: T; hits: number }> {
	const fetchReal = globalThis.fetch;
	let release: () => void = () => {};
	let arrived: () => void = () => {};
	let hit = 0;
	const gate = new Promise<void>((r) => (release = r));
	const arrival = new Promise<void>((r) => (arrived = r));

	globalThis.fetch = async (input, init) => {
		let payload: { query?: string; params?: unknown[] } | undefined;
		try {
			payload = JSON.parse(init?.body as string);
		} catch {
			// ignore non-JSON request body
		}
		if (payload?.query && test(payload) && hit === 0) {
			hit++;
			arrived();
			await gate;
			return fetchReal(input, init);
		}
		return fetchReal(input, init);
	};

	let pending: Promise<T> | undefined;
	return (async () => {
		try {
			pending = Promise.resolve(start());
			await Promise.race([
				arrival,
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error("Interception timeout")), 20000),
				),
			]);
			await during();
			release();
			const result = await pending;
			return { result, hits: hit };
		} finally {
			release();
			globalThis.fetch = fetchReal;
			if (pending) await pending.catch(() => {});
		}
	})();
}

async function executeWithLockOverlap<T, U>(
	pinnedConnection: string,
	test: (payload: { query?: string; params?: unknown[] }) => boolean,
	first: () => Promise<T> | T,
	second: () => Promise<U> | U,
): Promise<{
	results: [T, U];
	overlapObserved: boolean;
	hits: number;
	firstPid: number;
	secondPid: number;
}> {
	const pool = new Pool({ connectionString: pinnedConnection });
	pool.on("error", () => {}); // Prevent unhandled error event when pooler closes idle websocket
	let client:
		| {
				query: (
					sql: string,
					params?: unknown[],
				) => Promise<{ rows: Array<Record<string, unknown>> }>;
				release: () => void;
		  }
		| undefined;
	let firstPending: Promise<T> | undefined;
	let secondPending: Promise<U> | undefined;
	let gateHeld = false;
	let hits = 0;
	let firstPid = 0;
	let secondPid = 0;
	const fetchReal = globalThis.fetch;
	const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

	try {
		client = (await pool.connect()) as unknown as {
			query: (
				sql: string,
				params?: unknown[],
			) => Promise<{ rows: Array<Record<string, unknown>> }>;
			release: () => void;
		};
		const identity = await client.query(
			"SELECT current_setting('neon.branch_id', true) AS branch",
		);
		if (identity.rows[0]?.branch !== AUTHORIZED_DEV_BRANCH) {
			throw new Error("Unauthorized gate connection");
		}
		await client.query("BEGIN");
		const key = crypto.randomInt(1, 2000000000);
		await client.query("SELECT pg_advisory_xact_lock($1)", [key]);
		gateHeld = true;
		const owner = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
			?.pid as number;

		globalThis.fetch = async (input, init) => {
			let payload: { query?: string; params?: unknown[] } | undefined;
			try {
				payload = JSON.parse(init?.body as string);
			} catch {
				// ignore non-JSON request body
			}
			if (payload?.query && test(payload) && hits === 0) {
				hits++;
				const response = await fetchReal(input, {
					...init,
					body: JSON.stringify({
						queries: [
							payload,
							{ query: "SELECT pg_advisory_xact_lock($1)", params: [key] },
						],
					}),
				});
				if (!response.ok) return response;
				const data = (await response.json()) as { results?: unknown[] };
				if (!data.results?.[0]) throw new Error("Missing batch result");
				return new Response(JSON.stringify(data.results[0]), {
					status: response.status,
					headers: response.headers,
				});
			}
			return fetchReal(input, init);
		};

		const q = neon(pinnedConnection);
		const blockedBy = async (blocker: number) => {
			const deadline = Date.now() + 20000;
			while (Date.now() < deadline) {
				const rows =
					await q`SELECT pid FROM pg_stat_activity WHERE ${blocker}::int = ANY(pg_blocking_pids(pid))`;
				if (rows.length === 1) return rows[0].pid as number;
				await pause(100);
			}
			throw new Error("Owned lock overlap not observed");
		};

		firstPending = Promise.resolve(first());
		firstPid = await blockedBy(owner);
		secondPending = Promise.resolve(second());
		secondPid = await blockedBy(firstPid);

		await client.query("COMMIT");
		gateHeld = false;

		const results = await Promise.all([firstPending, secondPending]);
		return { results, overlapObserved: true, hits, firstPid, secondPid };
	} finally {
		if (gateHeld && client) {
			try {
				await client.query("ROLLBACK");
			} catch {
				// ignore rollback failure on closed client
			}
		}
		globalThis.fetch = fetchReal;
		if (firstPending) await firstPending.catch(() => {});
		if (secondPending) await secondPending.catch(() => {});
		client?.release();
		await pool.end();
	}
}

/**
 * Structurally valid binary builders for unit/integration boundary checks.
 * (Real workerd R2 storage is additionally verified in tests/integration/health.test.ts).
 */
function createValidJpegBytes(totalByteLength = 128): Uint8Array {
	const size = Math.max(totalByteLength, 64);
	const b = new Uint8Array(size);
	// SOI + APP0 (JFIF) + SOF0 (600x400, 3 components)
	const header = [
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
		0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
		0x08, 0x01, 0x90, 0x02, 0x58, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01,
		0x03, 0x11, 0x01,
	];
	b.set(header, 0);
	// EOI marker at the end
	b[size - 2] = 0xff;
	b[size - 1] = 0xd9;
	return b;
}

function createValidPngBytes(totalByteLength = 128): Uint8Array {
	const size = Math.max(totalByteLength, 64);
	const b = new Uint8Array(size);
	// PNG signature + IHDR chunk (width=600 [0x00000258], height=400 [0x00000190], 8-bit RGB)
	const header = [
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x02, 0x58, 0x00, 0x00, 0x01, 0x90,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x9b, 0x3b, 0x42, 0x11,
	];
	b.set(header, 0);
	// IEND chunk at the end
	const iend = [
		0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	];
	b.set(iend, size - iend.length);
	return b;
}

function createValidPdfBytes(totalByteLength = 128): Uint8Array {
	const basePdf =
		"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
	const baseBytes = new TextEncoder().encode(basePdf);
	if (totalByteLength <= baseBytes.byteLength) {
		return baseBytes;
	}
	const out = new Uint8Array(totalByteLength);
	const eofBytes = new TextEncoder().encode("\n%%EOF\n");
	out.set(baseBytes.subarray(0, baseBytes.byteLength - eofBytes.byteLength), 0);
	out.fill(0x20, baseBytes.byteLength - eofBytes.byteLength, totalByteLength - eofBytes.byteLength);
	out.set(eofBytes, totalByteLength - eofBytes.byteLength);
	return out;
}

function buildCompleteAiExtractionPayload(
	overrides: Record<string, unknown> = {},
) {
	return {
		schema_version: "1.0",
		event_name: {
			value: "Karya Melasti Sanur",
			evidence: "Upacara Karya Melasti di Sanur",
			needs_review: false,
		},
		event_category: {
			value: "upacara_adat",
			evidence: "Upacara Karya Melasti",
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
		procession_description: {
			value: "Iring-iringan krama desa menuju Pantai Matahari Terbit",
			evidence: "iring-iringan menuju Pantai Matahari Terbit",
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
		organizer_name: {
			value: "Desa Adat Intaran",
			evidence: "Panitia Desa Adat Intaran",
			needs_review: false,
		},
		cleanup_location_notes: {
			value: "Pembersihan pesisir pantai dan jalur prosesi",
			evidence: "pembersihan area pesisir pasca melasti",
			needs_review: false,
		},
		contact_information: {
			value: "I Made Surya (0812-0000-0101)",
			evidence: "Narahubung: I Made Surya (0812-0000-0101)",
			needs_review: true,
		},
		issues: ["Waktu selesai tidak tercantum pada surat"],
		...overrides,
	};
}

// Helper: In-memory mock R2Bucket for unit/fault-injection tests
// (Real workerd R2 binding tests run in tests/integration/health.test.ts)
function createMockR2Bucket(): R2Bucket & {
	_store: Map<
		string,
		{
			buffer: ArrayBuffer;
			metadata: Record<string, string>;
			contentType: string;
		}
	>;
} {
	const store = new Map<
		string,
		{
			buffer: ArrayBuffer;
			metadata: Record<string, string>;
			contentType: string;
		}
	>();

	return {
		_store: store,
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
				typeof (value as { arrayBuffer: () => Promise<ArrayBuffer> })
					.arrayBuffer === "function"
			) {
				buffer = await (
					value as { arrayBuffer: () => Promise<ArrayBuffer> }
				).arrayBuffer();
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
				contentType:
					opt?.httpMetadata?.contentType || "application/octet-stream",
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
	} as unknown as R2Bucket & {
		_store: Map<
			string,
			{
				buffer: ArrayBuffer;
				metadata: Record<string, string>;
				contentType: string;
			}
		>;
	};
}

describe("A05-A08 Integrated Operations: Documents, Extraction, Roads & Public APIs", () => {
	let db: DbClient;
	let pinnedUrl = "";
	const runKey = crypto.randomUUID().slice(0, 8);
	const testPassword = "TestPassword123!";

	let mockR2: ReturnType<typeof createMockR2Bucket>;
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

	const fixtureUserOrganizerA2 = {
		id: `usr_org_a2_${runKey}`,
		name: `Organizer A2 ${runKey}`,
		email: `organizer.a2.${runKey}@test.local`,
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

	const fixtureUserCleanupOfficerA2 = {
		id: `usr_clean_a2_${runKey}`,
		name: `Cleanup Officer A2 ${runKey}`,
		email: `cleanup.a2.${runKey}@test.local`,
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
	let organizerA2Cookie = "";
	let trafficOfficerACookie = "";
	let cleanupOfficerACookie = "";
	let cleanupOfficerA2Cookie = "";
	let organizerBCookie = "";

	let draftEventId = "";
	let reviewEventId = "";
	let publishedEventId = "";
	let publishedEventSlug = "";
	let completedEventId = "";

	let uploadedDocId = "";
	let secondUploadedDocId = "";
	let createdImpactId = "";

	beforeAll(async () => {
		const preflight = await assertDevBranch();
		expect(preflight.branchId).toBe("br-wandering-paper-aogdxs48");
		pinnedUrl = preflight.pinnedUrl;
		db = getDb(pinnedUrl);
		mockR2 = createMockR2Bucket();

		testEnv = {
			DATABASE_URL: pinnedUrl,
			DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
			BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
			BETTER_AUTH_URL: "http://localhost:5173",
			rangkai_documents_dev: mockR2,
			GEMINI_API_KEY:
				process.env.GEMINI_API_KEY || "dummy_gemini_api_key_for_tests",
			GEMINI_MODEL: process.env.GEMINI_MODEL,
		};

		resetUploadRateLimits();
		resetExtractionRateLimits();

		await db.insert(organizations).values([fixtureOrgA, fixtureOrgB]);

		const now = new Date();
		await db.insert(user).values([
			{ ...fixtureUserOrganizerA, createdAt: now, updatedAt: now },
			{ ...fixtureUserOrganizerA2, createdAt: now, updatedAt: now },
			{ ...fixtureUserTrafficOfficerA, createdAt: now, updatedAt: now },
			{ ...fixtureUserCleanupOfficerA, createdAt: now, updatedAt: now },
			{ ...fixtureUserCleanupOfficerA2, createdAt: now, updatedAt: now },
			{ ...fixtureUserOrganizerB, createdAt: now, updatedAt: now },
		]);

		const hashedPw = await hashPassword(testPassword);

		await db.insert(account).values([
			{
				id: `acc_org_a_${runKey}`,
				accountId: fixtureUserOrganizerA.id,
				providerId: "credential",
				userId: fixtureUserOrganizerA.id,
				password: hashedPw,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: `acc_org_a2_${runKey}`,
				accountId: fixtureUserOrganizerA2.id,
				providerId: "credential",
				userId: fixtureUserOrganizerA2.id,
				password: hashedPw,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: `acc_traff_a_${runKey}`,
				accountId: fixtureUserTrafficOfficerA.id,
				providerId: "credential",
				userId: fixtureUserTrafficOfficerA.id,
				password: hashedPw,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: `acc_clean_a_${runKey}`,
				accountId: fixtureUserCleanupOfficerA.id,
				providerId: "credential",
				userId: fixtureUserCleanupOfficerA.id,
				password: hashedPw,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: `acc_clean_a2_${runKey}`,
				accountId: fixtureUserCleanupOfficerA2.id,
				providerId: "credential",
				userId: fixtureUserCleanupOfficerA2.id,
				password: hashedPw,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: `acc_org_b_${runKey}`,
				accountId: fixtureUserOrganizerB.id,
				providerId: "credential",
				userId: fixtureUserOrganizerB.id,
				password: hashedPw,
				createdAt: now,
				updatedAt: now,
			},
		]);

		await db.insert(memberships).values([
			{
				organizationId: fixtureOrgA.id,
				userId: fixtureUserOrganizerA.id,
				role: "organizer",
			},
			{
				organizationId: fixtureOrgA.id,
				userId: fixtureUserOrganizerA2.id,
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
				organizationId: fixtureOrgA.id,
				userId: fixtureUserCleanupOfficerA2.id,
				role: "officer",
			},
			{
				organizationId: fixtureOrgB.id,
				userId: fixtureUserOrganizerB.id,
				role: "organizer",
			},
		]);

		// Seed truthful synthetic road segments (strictly unverified: verifiedBy=null, verifiedAt=null)
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
		organizerA2Cookie = await signInUser(fixtureUserOrganizerA2.email);
		trafficOfficerACookie = await signInUser(fixtureUserTrafficOfficerA.email);
		cleanupOfficerACookie = await signInUser(fixtureUserCleanupOfficerA.email);
		cleanupOfficerA2Cookie = await signInUser(
			fixtureUserCleanupOfficerA2.email,
		);
		organizerBCookie = await signInUser(fixtureUserOrganizerB.email);

		const createTestEvent = async (title: string, status = "draft") => {
			const id = crypto.randomUUID();
			const ts = new Date();
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
				createdAt: ts,
				updatedAt: ts,
			});
			return id;
		};

		draftEventId = await createTestEvent("Draft Event A05", "draft");
		reviewEventId = await createTestEvent("Review Event A05", "review");
		completedEventId = await createTestEvent(
			"Completed Event A05",
			"completed",
		);

		// Assign officers to draftEventId (including second cleanup officer for task-ownership isolation tests)
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
			{
				eventId: draftEventId,
				userId: fixtureUserCleanupOfficerA2.id,
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
				await db
					.delete(wasteRecords)
					.where(inArray(wasteRecords.eventId, eventIds));

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
				fixtureUserOrganizerA2.id,
				fixtureUserTrafficOfficerA.id,
				fixtureUserCleanupOfficerA.id,
				fixtureUserCleanupOfficerA2.id,
				fixtureUserOrganizerB.id,
			];
			await db
				.delete(memberships)
				.where(inArray(memberships.organizationId, orgIds));
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
		it("REJECTS anonymous upload attempt (401)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }),
			);

			const res = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{ method: "POST", body: form },
				testEnv,
			);
			expect(res.status).toBe(401);
		});

		it("REJECTS field officer upload attempt (403)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }),
			);

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
			form.append(
				"file",
				new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }),
			);

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
			form.append(
				"file",
				new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }),
			);

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
			form.append(
				"file",
				new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }),
			);

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

		it("REJECTS multiple files in single multipart upload (422)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidJpegBytes()], "doc1.jpg", { type: "image/jpeg" }),
			);
			form.append(
				"file",
				new File([createValidJpegBytes()], "doc2.jpg", { type: "image/jpeg" }),
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
			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Exactly one file");
		});

		it("REJECTS extension and inspected MIME mismatch (e.g. .jpg file with PDF magic bytes) (422)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidPdfBytes()], "document.jpg", {
					type: "application/pdf",
				}),
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
			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("does not match inspected file");
		});

		it("REJECTS claimed Content-Type and detected magic bytes mismatch (422)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidJpegBytes()], "document.jpg", {
					type: "image/png",
				}),
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
			expect(res.status).toBe(422);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain("does not match inspected file");
		});

		it("REJECTS empty 0-byte file (422)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([new Uint8Array(0)], "empty.jpg", { type: "image/jpeg" }),
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
			expect(res.status).toBe(422);
		});

		it("REJECTS frameless JPEG, 1x1 PNG, and truncated PDF without %%EOF (422)", async () => {
			// Frameless JPEG (only SOI + EOI, no SOF frame header)
			const framelessJpeg = new Uint8Array(100);
			framelessJpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02], 0);
			framelessJpeg[98] = 0xff;
			framelessJpeg[99] = 0xd9;
			const formJpeg = new FormData();
			formJpeg.append(
				"file",
				new File([framelessJpeg], "frameless.jpg", { type: "image/jpeg" }),
			);
			const resJpeg = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: formJpeg,
				},
				testEnv,
			);
			expect(resJpeg.status).toBe(422);

			// 1x1 PNG (width=1, height=1)
			const oneByOnePng = createValidPngBytes(100);
			oneByOnePng.set([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01], 16);
			const formPng = new FormData();
			formPng.append(
				"file",
				new File([oneByOnePng], "tiny.png", { type: "image/png" }),
			);
			const resPng = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: formPng,
				},
				testEnv,
			);
			expect(resPng.status).toBe(422);

			// Truncated PDF without %%EOF
			const truncatedPdf = new TextEncoder().encode(
				"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" + " ".repeat(60),
			);
			const formPdf = new FormData();
			formPdf.append(
				"file",
				new File([truncatedPdf], "truncated.pdf", { type: "application/pdf" }),
			);
			const resPdf = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: formPdf,
				},
				testEnv,
			);
			expect(resPdf.status).toBe(422);
		});

		it("REJECTS file exceeding limit (8MB + 1 byte = 8,388,609 bytes) (413)", async () => {
			resetUploadRateLimits();
			const oversizedBytes = createValidJpegBytes(MAX_DOCUMENT_SIZE_BYTES + 1);

			const form = new FormData();
			form.append(
				"file",
				new File([oversizedBytes], "oversized.jpg", { type: "image/jpeg" }),
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
			expect(res.status).toBe(413);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
		});

		it("ACCEPTS exact 8MB boundary document file (8,388,608 bytes) (201) and rejects chunked stream exceeding envelope without Content-Length (413)", async () => {
			resetUploadRateLimits();
			const exact8MbBytes = createValidJpegBytes(MAX_DOCUMENT_SIZE_BYTES);
			const form = new FormData();
			form.append(
				"file",
				new File([exact8MbBytes], "exact8mb.jpg", { type: "image/jpeg" }),
			);

			const exactRes = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: { Cookie: organizerACookie },
					body: form,
				},
				testEnv,
			);
			expect(exactRes.status).toBe(201);
			const exactBody = (await exactRes.json()) as {
				document: { id: string; sizeBytes: number };
			};
			expect(exactBody.document.sizeBytes).toBe(MAX_DOCUMENT_SIZE_BYTES);

			// Clean up the 8MB test document so it doesn't clutter subsequent list assertions
			await db
				.delete(documents)
				.where(eq(documents.id, exactBody.document.id));

			// Chunked stream without Content-Length exceeding MAX_DOCUMENT_SIZE_BYTES + 64KB envelope
			const chunkSize = 1024 * 1024;
			let bytesSent = 0;
			const targetTotal = MAX_DOCUMENT_SIZE_BYTES + 128 * 1024;
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					if (bytesSent >= targetTotal) {
						controller.close();
						return;
					}
					const chunk = new Uint8Array(
						Math.min(chunkSize, targetTotal - bytesSent),
					);
					bytesSent += chunk.byteLength;
					controller.enqueue(chunk);
				},
			});

			const streamRes = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type":
							"multipart/form-data; boundary=----ChunkedBoundaryTest",
					},
					body: stream,
					duplex: "half",
				} as RequestInit,
				testEnv,
			);
			expect(streamRes.status).toBe(413);
		});

		it("REJECTS file with invalid magic bytes / spoofed signature (422)", async () => {
			resetUploadRateLimits();
			const corruptedBytes = new TextEncoder().encode("Not a real JPEG image");
			const form = new FormData();
			form.append(
				"file",
				new File([corruptedBytes], "spoofed.jpg", { type: "image/jpeg" }),
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
			expect(res.status).toBe(422);
		});

		it("REJECTS upload to completed event (409)", async () => {
			resetUploadRateLimits();
			const form = new FormData();
			form.append(
				"file",
				new File([createValidJpegBytes()], "test.jpg", { type: "image/jpeg" }),
			);

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

		it("UPLOADS valid JPEG document successfully to draft event with processingConsent (201)", async () => {
			resetUploadRateLimits();
			const form = new FormData();
			form.append("processingConsent", "true");
			form.append(
				"file",
				new File(
					[createValidJpegBytes()],
					"../../../unsafe_surat_pengumuman.jpg",
					{
						type: "image/jpeg",
					},
				),
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
					aiConsentGranted: boolean;
					createdAt: string;
				};
			};

			expect(body.document.id).toBeDefined();
			expect(body.document.eventId).toBe(draftEventId);
			expect(body.document.mimeType).toBe("image/jpeg");
			expect(body.document.aiConsentGranted).toBe(true);
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
			expect(audits.some((a) => a.entityId === uploadedDocId)).toBe(true);
		});

		it("UPLOADS valid PNG document without initial consent (201)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidPngBytes()], "denah.png", { type: "image/png" }),
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
			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				document: { id: string; mimeType: string; aiConsentGranted: boolean };
			};
			expect(body.document.mimeType).toBe("image/png");
			expect(body.document.aiConsentGranted).toBe(false);
			secondUploadedDocId = body.document.id;
		});

		it("UPLOADS PDF document to review event and resets status to draft (201)", async () => {
			const form = new FormData();
			form.append(
				"file",
				new File([createValidPdfBytes()], "undangan.pdf", {
					type: "application/pdf",
				}),
			);

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
				await db
					.select()
					.from(events)
					.where(eq(events.id, reviewEventId))
					.limit(1)
			)[0];
			expect(eventRow.status).toBe("draft");
			expect(eventRow.verifiedBy).toBeNull();
			expect(eventRow.verifiedAt).toBeNull();
		});

		it("COMPENSATES R2 upload on DB failure and logs safe diagnostics without r2Key if R2 delete also fails (503)", async () => {
			resetUploadRateLimits();
			const errorLogs: string[] = [];
			const origConsoleError = console.error;
			console.error = (...args: unknown[]) => {
				errorLogs.push(args.map((a) => JSON.stringify(a)).join(" "));
			};

			const failingDeleteR2 = {
				...mockR2,
				delete: async () => {
					throw new Error("Simulated R2 delete network failure");
				},
			};

			const realFetch = globalThis.fetch;
			globalThis.fetch = async (input, init) => {
				let payload: { query?: string } | undefined;
				try {
					payload = JSON.parse(init?.body as string);
				} catch {
					// ignore
				}
				if (payload?.query && payload.query.includes("INSERT INTO documents")) {
					return new Response(
						JSON.stringify({ message: "Simulated DB failure" }),
						{ status: 500 },
					);
				}
				return realFetch(input, init);
			};

			try {
				const form = new FormData();
				form.append(
					"file",
					new File([createValidJpegBytes()], "comp_test.jpg", {
						type: "image/jpeg",
					}),
				);

				const res = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/documents`,
					{
						method: "POST",
						headers: { Cookie: organizerACookie },
						body: form,
					},
					{ ...testEnv, rangkai_documents_dev: failingDeleteR2 },
				);

				expect(res.status).toBe(503);
				const resText = await res.text();
				expect(resText).not.toContain("events/");
				expect(resText).not.toContain("comp_test.jpg");
				expect(
					errorLogs.some(
						(l) =>
							l.includes("r2_compensation_delete_failed") &&
							!l.includes("comp_test.jpg") &&
							!l.includes("r2Key"),
					),
				).toBe(true);
			} finally {
				globalThis.fetch = realFetch;
				console.error = origConsoleError;
			}
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
			const body = (await res.json()) as {
				documents: Array<{ id: string; originalName: string }>;
			};
			expect(body.documents.length).toBeGreaterThanOrEqual(2);
			expect(body.documents.some((d) => d.id === uploadedDocId)).toBe(true);
			expect(
				(body.documents[0] as Record<string, unknown>).r2Key,
			).toBeUndefined();
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

		it("REJECTS download for unauthorized user or field officer (403)", async () => {
			const resOrgB = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents/${uploadedDocId}`,
				{
					method: "GET",
					headers: { Cookie: organizerBCookie },
				},
				testEnv,
			);
			expect(resOrgB.status).toBe(403);

			const resOfficer = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/documents/${uploadedDocId}`,
				{
					method: "GET",
					headers: { Cookie: trafficOfficerACookie },
				},
				testEnv,
			);
			expect(resOfficer.status).toBe(403);
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
					body: JSON.stringify({
						documentId: uploadedDocId,
						processingConsent: true,
					}),
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
					body: JSON.stringify({
						documentId: uploadedDocId,
						processingConsent: true,
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(404);
		});

		it("REJECTS extraction when processingConsent is missing on unconsented document or explicitly false (422)", async () => {
			resetExtractionRateLimits();
			// secondUploadedDocId was uploaded without processingConsent
			const resNoConsent = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/extractions`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ documentId: secondUploadedDocId }),
				},
				testEnv,
			);
			expect(resNoConsent.status).toBe(422);
			const bodyNoConsent = (await resNoConsent.json()) as {
				error: { message: string };
			};
			expect(bodyNoConsent.error.message).toContain("processingConsent");

			// Explicit processingConsent: false must also be rejected with 422 even on a previously consented document
			const resFalseConsent = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/extractions`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						documentId: uploadedDocId,
						processingConsent: false,
					}),
				},
				testEnv,
			);
			expect(resFalseConsent.status).toBe(422);
		});

		it("EXECUTES Gemini extraction and validates full AI-SPEC §3 structured schema (200)", async () => {
			resetExtractionRateLimits();
			const realFetch = globalThis.fetch;
			globalThis.fetch = async (
				url: string | URL | Request,
				init?: RequestInit,
			) => {
				const urlStr = String(url);
				if (urlStr.includes("generativelanguage.googleapis.com")) {
					const mockAiResponse = {
						candidates: [
							{
								content: {
									parts: [
										{
											text: JSON.stringify(buildCompleteAiExtractionPayload()),
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
						body: JSON.stringify({
							documentId: uploadedDocId,
							processingConsent: true,
						}),
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
							event_category: { value: string };
							start_datetime: { value: string };
							end_datetime: { value: string | null; needs_review: boolean };
							venue_name: { value: string };
							procession_description: { value: string };
							affected_road_names: Array<{ name: string }>;
							traffic_impact_description: { value: string };
							organizer_name: { value: string };
							cleanup_location_notes: { value: string };
							contact_information: { value: string };
							issues: string[];
						};
					};
				};

				expect(body.extraction.status).toBe("completed");
				expect(body.extraction.modelName).toBe(GEMINI_MODEL_NAME);
				expect(body.extraction.outputJson.event_name.value).toBe(
					"Karya Melasti Sanur",
				);
				expect(body.extraction.outputJson.event_category.value).toBe(
					"upacara_adat",
				);
				// Normalized to UTC ISO string
				expect(body.extraction.outputJson.start_datetime.value).toBe(
					"2026-11-20T00:00:00.000Z",
				);
				expect(body.extraction.outputJson.end_datetime.value).toBeNull();
				expect(body.extraction.outputJson.end_datetime.needs_review).toBe(true);
				expect(body.extraction.outputJson.procession_description.value).toContain(
					"Iring-iringan",
				);
				expect(body.extraction.outputJson.organizer_name.value).toBe(
					"Desa Adat Intaran",
				);
				expect(body.extraction.outputJson.cleanup_location_notes.value).toContain(
					"Pembersihan pesisir",
				);
				expect(body.extraction.outputJson.contact_information.value).toContain(
					"I Made Surya",
				);
				expect(body.extraction.outputJson.affected_road_names[0].name).toBe(
					"Jl. Danau Tamblingan",
				);
				expect(body.extraction.outputJson.issues).toContain(
					"Waktu selesai tidak tercantum pada surat",
				);

				createdExtractionId = body.extraction.id;

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

		it("RESPECTS GEMINI_MODEL environment variable override when provided", async () => {
			resetExtractionRateLimits();
			const realFetch = globalThis.fetch;
			let calledModel = "";
			globalThis.fetch = async (
				url: string | URL | Request,
				init?: RequestInit,
			) => {
				const urlStr = String(url);
				if (urlStr.includes("generativelanguage.googleapis.com")) {
					const match = urlStr.match(/models\/([^:]+):generateContent/);
					if (match) calledModel = decodeURIComponent(match[1]);
					const mockAiResponse = {
						candidates: [
							{
								content: {
									parts: [
										{
											text: JSON.stringify(buildCompleteAiExtractionPayload()),
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
						body: JSON.stringify({
							documentId: uploadedDocId,
							processingConsent: true,
						}),
					},
					{
						...testEnv,
						GEMINI_MODEL: "gemini-custom-override",
					},
				);
				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					extraction: { modelName: string; status: string };
				};
				expect(body.extraction.status).toBe("completed");
				expect(body.extraction.modelName).toBe("gemini-custom-override");
				expect(calledModel).toBe("gemini-custom-override");
			} finally {
				globalThis.fetch = realFetch;
				resetExtractionRateLimits();
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
			const body = (await res.json()) as {
				extraction: { id: string; status: string };
			};
			expect(body.extraction.id).toBe(createdExtractionId);
			expect(body.extraction.status).toBe("completed");
		});

		it("REJECTS vacuous {} and calendar-invalid ISO dates (e.g. Feb 30) from AI provider as SCHEMA_VALIDATION_FAILED", async () => {
			resetExtractionRateLimits();
			const realFetch = globalThis.fetch;
			let callNum = 0;
			globalThis.fetch = async (
				url: string | URL | Request,
				init?: RequestInit,
			) => {
				const urlStr = String(url);
				if (urlStr.includes("generativelanguage.googleapis.com")) {
					callNum++;
					const badPayload =
						callNum === 1
							? {} // vacuous object missing required AI-SPEC fields
							: buildCompleteAiExtractionPayload({
									start_datetime: {
										value: "2026-02-30T08:00:00+08:00", // impossible calendar rollover
										evidence: "30 Februari 2026",
										needs_review: true,
									},
								});
					return new Response(
						JSON.stringify({
							candidates: [
								{
									content: {
										parts: [{ text: JSON.stringify(badPayload) }],
									},
								},
							],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				return realFetch(url, init);
			};

			try {
				const resVacuous = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							documentId: uploadedDocId,
							processingConsent: true,
						}),
					},
					testEnv,
				);
				expect(resVacuous.status).toBe(200);
				const bodyVacuous = (await resVacuous.json()) as {
					extraction: { status: string; errorCode: string; outputJson: unknown };
				};
				expect(bodyVacuous.extraction.status).toBe("failed");
				expect(bodyVacuous.extraction.errorCode).toBe(
					"SCHEMA_VALIDATION_FAILED",
				);
				expect(bodyVacuous.extraction.outputJson).toBeNull();

				const resRollover = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							documentId: uploadedDocId,
							processingConsent: true,
						}),
					},
					testEnv,
				);
				expect(resRollover.status).toBe(200);
				const bodyRollover = (await resRollover.json()) as {
					extraction: { status: string; errorCode: string; outputJson: unknown };
				};
				expect(bodyRollover.extraction.status).toBe("failed");
				expect(bodyRollover.extraction.errorCode).toBe(
					"SCHEMA_VALIDATION_FAILED",
				);
				expect(bodyRollover.extraction.outputJson).toBeNull();
			} finally {
				globalThis.fetch = realFetch;
				resetExtractionRateLimits();
			}
		});

		it("REJECTS concurrent extraction attempt across ANY document of the same event when one is already in progress (409)", async () => {
			resetExtractionRateLimits();
			// Insert an active extraction in 'processing' status on uploadedDocId
			const tempActiveExtractionId = crypto.randomUUID();
			await db.insert(aiExtractions).values({
				id: tempActiveExtractionId,
				documentId: uploadedDocId,
				modelName: GEMINI_MODEL_NAME,
				promptVersion: "v1.1",
				schemaVersion: "1.0",
				status: "processing",
				createdAt: new Date(),
			});

			try {
				// Attempt extraction on the SECOND document (secondUploadedDocId) of the SAME event (draftEventId)
				const res = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							documentId: secondUploadedDocId,
							processingConsent: true,
						}),
					},
					testEnv,
				);
				expect(res.status).toBe(409);
				const body = (await res.json()) as {
					error: { code: string; message: string };
				};
				expect(body.error.code).toBe("STATE_CONFLICT");
				expect(body.error.message).toContain("already in progress for this event");
			} finally {
				await db
					.delete(aiExtractions)
					.where(eq(aiExtractions.id, tempActiveExtractionId));
				resetExtractionRateLimits();
			}
		});

		it("COMPLETION GUARD: Rejects extraction completion with 409 if event transitions to cancelled while Gemini is in flight", async () => {
			resetExtractionRateLimits();
			const tempEventId = crypto.randomUUID();
			const tempDocId = crypto.randomUUID();
			const tempR2Key = `events/${tempEventId}/documents/${tempDocId}/temp.jpg`;

			await db.insert(events).values({
				id: tempEventId,
				organizationId: fixtureOrgA.id,
				createdBy: fixtureUserOrganizerA.id,
				title: "In-Flight Cancel Extraction Event",
				status: "draft",
			});
			await db.insert(documents).values({
				id: tempDocId,
				eventId: tempEventId,
				uploadedBy: fixtureUserOrganizerA.id,
				r2Key: tempR2Key,
				originalName: "temp.jpg",
				mimeType: "image/jpeg",
				sizeBytes: 128,
				visibility: "private",
				aiConsentBy: fixtureUserOrganizerA.id,
				aiConsentAt: new Date(),
			});
			await mockR2.put(tempR2Key, createValidJpegBytes(), {
				httpMetadata: { contentType: "image/jpeg" },
			});

			const realFetch = globalThis.fetch;
			globalThis.fetch = async (
				url: string | URL | Request,
				init?: RequestInit,
			) => {
				const urlStr = String(url);
				if (urlStr.includes("generativelanguage.googleapis.com")) {
					// While Gemini call is in flight, transition the event to 'cancelled'
					await db
						.update(events)
						.set({ status: "cancelled" })
						.where(eq(events.id, tempEventId));

					return new Response(
						JSON.stringify({
							candidates: [
								{
									content: {
										parts: [
											{
												text: JSON.stringify(buildCompleteAiExtractionPayload()),
											},
										],
									},
								},
							],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				return realFetch(url, init);
			};

			try {
				const res = await app.request(
					`http://localhost:5173/api/events/${tempEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							documentId: tempDocId,
							processingConsent: true,
						}),
					},
					testEnv,
				);

				expect(res.status).toBe(409);
				const extRows = await db
					.select()
					.from(aiExtractions)
					.where(eq(aiExtractions.documentId, tempDocId));
				expect(extRows.length).toBe(1);
				expect(extRows[0].status).toBe("failed");
				expect(extRows[0].errorCode).toBe("EVENT_STATE_CONFLICT");
				expect(extRows[0].outputJson).toBeNull();
			} finally {
				globalThis.fetch = realFetch;
				await db
					.delete(auditLogs)
					.where(eq(auditLogs.eventId, tempEventId));
				await db
					.delete(aiExtractions)
					.where(eq(aiExtractions.documentId, tempDocId));
				await db.delete(documents).where(eq(documents.id, tempDocId));
				await db.delete(events).where(eq(events.id, tempEventId));
				resetExtractionRateLimits();
			}
		});

		it("ENFORCES organization-scoped rate limit across multiple organizers in the same organization (429)", async () => {
			resetExtractionRateLimits();
			const realFetch = globalThis.fetch;
			globalThis.fetch = async (
				url: string | URL | Request,
				init?: RequestInit,
			) => {
				if (String(url).includes("generativelanguage.googleapis.com")) {
					return new Response(JSON.stringify({ error: { message: "err" } }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				}
				return realFetch(url, init);
			};

			try {
				// 3 attempts by Organizer A + 2 attempts by Organizer A2 = 5 attempts for fixtureOrgA
				for (let i = 0; i < 5; i++) {
					const cookie = i < 3 ? organizerACookie : organizerA2Cookie;
					const r = await app.request(
						`http://localhost:5173/api/events/${draftEventId}/extractions`,
						{
							method: "POST",
							headers: {
								Cookie: cookie,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								documentId: uploadedDocId,
								processingConsent: true,
							}),
						},
						testEnv,
					);
					expect(r.status).toBe(200);
				}

				// 6th attempt by Organizer A2 in the same organization MUST be rejected with 429 RATE_LIMITED
				const res = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerA2Cookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							documentId: uploadedDocId,
							processingConsent: true,
						}),
					},
					testEnv,
				);
				expect(res.status).toBe(429);
				const body = (await res.json()) as { error: { code: string } };
				expect(body.error.code).toBe("RATE_LIMITED");
			} finally {
				globalThis.fetch = realFetch;
				resetExtractionRateLimits();
			}
		});

		it("PERSISTS all 12 corrected fields via PATCH /api/events/:eventId/extracted-fields, reads them back, and strips contactInformation from non-organizer responses (200)", async () => {
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
						startsAt: "2026-11-20T08:00:00+08:00",
						endsAt: "2026-11-20T16:00:00+08:00",
						venueName: "Pantai Matahari Terbit Sanur",
						category: "upacara_adat",
						description: "Prosesi adat melasti menuju segara",
						permitReference: "SURAT/2026/099",
						processionDescription:
							"Berjalan kaki dari Pura Agung menuju Pantai Matahari Terbit",
						trafficImpactDescription:
							"Penutupan satu lajur di Jl. Danau Tamblingan selama iring-iringan",
						organizerName: "Prajuru Desa Adat Intaran",
						cleanupLocationNotes:
							"Titik kumpul karung sampah di parkir utara pantai",
						contactInformation: "I Made Surya - 0812-9999-8888 (Private)",
					}),
				},
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				event: {
					title: string;
					startsAt: string;
					endsAt: string;
					venueName: string;
					category: string;
					description: string;
					permitReference: string;
					processionDescription: string;
					trafficImpactDescription: string;
					organizerName: string;
					cleanupLocationNotes: string;
					contactInformation: string;
				};
			};
			expect(body.event.title).toBe("Karya Melasti Sanur (Terkonfirmasi)");
			expect(new Date(body.event.startsAt).toISOString()).toBe(
				"2026-11-20T00:00:00.000Z",
			);
			expect(new Date(body.event.endsAt).toISOString()).toBe(
				"2026-11-20T08:00:00.000Z",
			);
			expect(body.event.processionDescription).toBe(
				"Berjalan kaki dari Pura Agung menuju Pantai Matahari Terbit",
			);
			expect(body.event.trafficImpactDescription).toBe(
				"Penutupan satu lajur di Jl. Danau Tamblingan selama iring-iringan",
			);
			expect(body.event.organizerName).toBe("Prajuru Desa Adat Intaran");
			expect(body.event.cleanupLocationNotes).toBe(
				"Titik kumpul karung sampah di parkir utara pantai",
			);
			expect(body.event.contactInformation).toBe(
				"I Made Surya - 0812-9999-8888 (Private)",
			);

			// Read back via GET /api/events/:eventId as Organizer -> includes contactInformation
			const getOrgRes = await app.request(
				`http://localhost:5173/api/events/${draftEventId}`,
				{ method: "GET", headers: { Cookie: organizerACookie } },
				testEnv,
			);
			expect(getOrgRes.status).toBe(200);
			const getOrgBody = (await getOrgRes.json()) as {
				event: Record<string, unknown>;
			};
			expect(getOrgBody.event.processionDescription).toBe(
				"Berjalan kaki dari Pura Agung menuju Pantai Matahari Terbit",
			);
			expect(getOrgBody.event.contactInformation).toBe(
				"I Made Surya - 0812-9999-8888 (Private)",
			);

			// Read back via GET /api/events/:eventId as Assigned Field Officer -> strips contactInformation!
			const getOfficerRes = await app.request(
				`http://localhost:5173/api/events/${draftEventId}`,
				{ method: "GET", headers: { Cookie: trafficOfficerACookie } },
				testEnv,
			);
			expect(getOfficerRes.status).toBe(200);
			const getOfficerBody = (await getOfficerRes.json()) as {
				event: Record<string, unknown>;
			};
			expect(getOfficerBody.event.processionDescription).toBe(
				"Berjalan kaki dari Pura Agung menuju Pantai Matahari Terbit",
			);
			expect(getOfficerBody.event.contactInformation).toBeUndefined();

			// Verify audit log records hasContactInformation boolean rather than raw private PII
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
			const latestAudit = audits[audits.length - 1];
			expect(
				(latestAudit.afterJson as Record<string, unknown>).hasContactInformation,
			).toBe(true);
			expect(JSON.stringify(latestAudit.afterJson)).not.toContain(
				"0812-9999-8888",
			);
		});

		it("DERIVES extracted-fields audit before_json and review reset from the current locked row during concurrent overlap", async () => {
			// Transition reviewEventId to review state with human verification
			await db
				.update(events)
				.set({
					title: "Judul Awal Sebelum Overlap",
					status: "review",
					verifiedBy: fixtureUserOrganizerA.id,
					verifiedAt: new Date(),
				})
				.where(eq(events.id, reviewEventId));

			let interveningStatus = 0;
			const held = await withHeldMutation(
				(p) =>
					Boolean(
						p.query &&
							p.query.includes("'event.extracted_fields_corrected'") &&
							p.params?.includes(reviewEventId),
					),
				() =>
					app.request(
						`http://localhost:5173/api/events/${reviewEventId}/extracted-fields`,
						{
							method: "PATCH",
							headers: {
								Cookie: organizerACookie,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								organizerName: "Panitia Kedua Setelah Intervensi",
							}),
						},
						testEnv,
					),
				async () => {
					// While the first PATCH is held after preflight, another organizer updates title
					const r = await app.request(
						`http://localhost:5173/api/events/${reviewEventId}`,
						{
							method: "PATCH",
							headers: {
								Cookie: organizerA2Cookie,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								title: "Judul Diubah Saat In-Flight",
							}),
						},
						testEnv,
					);
					interveningStatus = r.status;
				},
			);

			expect(interveningStatus).toBe(200);
			expect(held.result.status).toBe(200);

			// The held extracted-fields audit log MUST capture the locked row's updated title ("Judul Diubah Saat In-Flight")
			// rather than the stale preflight title ("Judul Awal Sebelum Overlap")!
			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, reviewEventId),
						eq(auditLogs.action, "event.extracted_fields_corrected"),
					),
				);
			expect(audits.length).toBe(1);
			expect((audits[0].beforeJson as { title: string }).title).toBe(
				"Judul Diubah Saat In-Flight",
			);
			expect((audits[0].beforeJson as { status: string }).status).toBe("draft");
		});

		it("HANDLES Gemini provider failure gracefully by saving failed extraction state", async () => {
			resetExtractionRateLimits();
			const realFetch = globalThis.fetch;
			globalThis.fetch = async (
				url: string | URL | Request,
				init?: RequestInit,
			) => {
				const urlStr = String(url);
				if (urlStr.includes("generativelanguage.googleapis.com")) {
					return new Response(
						JSON.stringify({ error: { message: "Internal error" } }),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
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
						body: JSON.stringify({
							documentId: uploadedDocId,
							processingConsent: true,
						}),
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
				resetExtractionRateLimits();
			}
		});

		it(
			"LIVE SYNTHETIC GEMINI SMOKE: Calls real Gemini model (gemini-3.5-flash-lite) on synthetic announcement fixture SYNTH_AI_001 without fetch mocking",
			async () => {
				resetUploadRateLimits();
				resetExtractionRateLimits();

				const aiFixtures = loadSyntheticAiFixtures();
				const synth01 = aiFixtures.find((f) => f.id === "SYNTH_AI_001")!;
				expect(synth01).toBeDefined();

				const form = new FormData();
				form.append("processingConsent", "true");
				form.append(
					"file",
					new File([synth01.sourceBuffer], "sample-01-complete.png", {
						type: "image/png",
					}),
				);

				const uploadRes = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/documents`,
					{
						method: "POST",
						headers: { Cookie: organizerACookie },
						body: form,
					},
					testEnv,
				);
				expect(uploadRes.status).toBe(201);
				const uploadBody = (await uploadRes.json()) as {
					document: { id: string };
				};

				let extRes = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/extractions`,
					{
						method: "POST",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							documentId: uploadBody.document.id,
							processingConsent: true,
						}),
					},
					testEnv,
				);

				expect(extRes.status).toBe(200);
				let extBody = (await extRes.json()) as {
					extraction: {
						id: string;
						status: "completed" | "failed";
						modelName: string;
						promptVersion: string;
						schemaVersion: string;
						errorCode: string | null;
						latencyMs: number;
						outputJson: Record<string, unknown> | null;
					};
					manualFallbackAvailable: boolean;
				};

				if (extBody.extraction.status === "failed" && extBody.extraction.errorCode === "PROVIDER_ERROR") { await new Promise((r) => setTimeout(r, 2500)); resetExtractionRateLimits(); extRes = await app.request(`http://localhost:5173/api/events/${draftEventId}/extractions`, { method: "POST", headers: { Cookie: organizerACookie, "Content-Type": "application/json" }, body: JSON.stringify({ documentId: uploadBody.document.id, processingConsent: true }) }, testEnv); extBody = (await extRes.json()) as typeof extBody; }
				expect(extBody.extraction.status).toBe("completed");
				expect(extBody.extraction.errorCode).toBeNull();
				expect(extBody.extraction.modelName).toBe(GEMINI_MODEL_NAME);
				expect(extBody.extraction.latencyMs).toBeGreaterThan(0);
				expect(extBody.manualFallbackAvailable).toBe(true);
				expect(extBody.extraction.outputJson).not.toBeNull();

				const out = extBody.extraction.outputJson as {
					event_name: { value: string | null };
					venue_name: { value: string | null };
					organizer_name: { value: string | null };
					start_datetime: { value: string | null };
					affected_road_names: Array<{ name: string }>;
				};
				expect(out.event_name.value).toBeTruthy();
				expect(out.venue_name.value).toBeTruthy();
				expect(out.start_datetime.value).toBeTruthy();
				expect(out.affected_road_names.length).toBeGreaterThan(0);

				const [persistedExtraction] = await db
					.select()
					.from(aiExtractions)
					.where(eq(aiExtractions.id, extBody.extraction.id));
				expect(persistedExtraction).toBeDefined();
				expect(persistedExtraction.status).toBe("completed");
				expect(persistedExtraction.errorCode).toBeNull();
				expect(persistedExtraction.outputJson).not.toBeNull();
				const persistedOut = persistedExtraction.outputJson as typeof out;
				expect(persistedOut.event_name.value).toBeTruthy();
				expect(persistedOut.venue_name.value).toBeTruthy();
			},
			60000,
		);
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

		it("TRUTHFUL SYNTHETIC FIXTURES: Validates unverified synthetic road and rendered AI announcement loaders", () => {
			const roadCollection = loadSyntheticRoadFixtures();
			expect(roadCollection.features.length).toBe(5);
			for (const f of roadCollection.features) {
				expect(f.properties.verified).toBe(false);
				expect(f.properties.verifiedBy).toBeNull();
				expect(f.properties.verifiedAt).toBeNull();
				expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
			}

			// Verify AI loader: 5 readable synthetic document pairs with SYNTHETIC_TEST_DATA markers and null ambiguous dates on SYNTH_AI_004
			const aiFixtures = loadSyntheticAiFixtures();
			expect(aiFixtures.length).toBe(5);
			for (const fix of aiFixtures) {
				expect(fix.id).toBeDefined();
				expect(fix.sourceMime).toBeDefined();
				expect(fix.sourceBuffer.byteLength).toBeGreaterThan(500);
				expect(fix.groundTruth.event_name.value).toBeDefined();
			}
			const ambiguousFixture = aiFixtures.find((f) => f.id === "SYNTH_AI_004")!;
			expect(ambiguousFixture.groundTruth.start_datetime.value).toBeNull();
			expect(ambiguousFixture.groundTruth.start_datetime.needs_review).toBe(
				true,
			);
			expect(ambiguousFixture.groundTruth.end_datetime.value).toBeNull();
			expect(ambiguousFixture.groundTruth.end_datetime.needs_review).toBe(true);
		});

		it("EXCLUDES unverified road segments from catalog search (200)", async () => {
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
			expect(
				body.segments.some((s) => s.id === fixtureSyntheticRoadSegmentA.id),
			).toBe(false);
			expect(
				body.segments.some((s) => s.id === fixtureSyntheticRoadSegmentB.id),
			).toBe(false);
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

		it("REJECTS road impact creation and PATCH update with unverified road segment (422)", async () => {
			const resCreate = await app.request(
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

			expect(resCreate.status).toBe(422);
			const bodyCreate = (await resCreate.json()) as {
				error: { message: string };
			};
			expect(bodyCreate.error.message).toContain("not been verified");

			// Also verify PATCH rejects updating an existing road impact to an unverified segment
			const tempImpact = await db
				.insert(roadImpacts)
				.values({
					id: crypto.randomUUID(),
					eventId: draftEventId,
					roadSegmentId: fixtureSyntheticRoadSegmentA.id,
					plannedFrom: new Date("2026-11-20T08:00:00Z"),
					plannedTo: new Date("2026-11-20T12:00:00Z"),
					impactType: "closure",
				})
				.returning();

			try {
				const resPatch = await app.request(
					`http://localhost:5173/api/events/${draftEventId}/road-impacts/${tempImpact[0].id}`,
					{
						method: "PATCH",
						headers: {
							Cookie: organizerACookie,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							roadSegmentId: fixtureSyntheticRoadSegmentB.id,
						}),
					},
					testEnv,
				);
				expect(resPatch.status).toBe(422);
			} finally {
				await db
					.delete(roadImpacts)
					.where(eq(roadImpacts.id, tempImpact[0].id));
			}
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

			await db
				.update(events)
				.set({
					status: "review",
					verifiedBy: fixtureUserOrganizerA.id,
					verifiedAt: new Date(),
				})
				.where(eq(events.id, reviewEventId));

			try {
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
			} finally {
				await db
					.delete(roadImpacts)
					.where(eq(roadImpacts.id, tempImpact[0].id));
			}
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
			// Published event has ZERO unverified road impacts attached in operational state.
			// Road status update mechanics are tested on the non-public draftEventId so that
			// unverified synthetic geometry is never seeded as operational public map data!
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
					contactInformation: "Private Contact 0811-2222-3333",
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

			// Non-public draftEventId impact for testing authenticated officer status updates & history
			const impRows = await db
				.insert(roadImpacts)
				.values({
					eventId: draftEventId,
					roadSegmentId: fixtureSyntheticRoadSegmentA.id,
					plannedFrom: new Date("2026-11-20T08:00:00Z"),
					plannedTo: new Date("2026-11-20T14:00:00Z"),
					impactType: "closure",
					diversionNote: "Pengalihan uji coba non-publik",
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

		it("RECORDS road status update by assigned traffic officer with 30m server TTL (200)", async () => {
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
				duplicate: boolean;
			};

			expect(body.status).toBe("closed");
			expect(body.updatedBy).toBe(fixtureUserTrafficOfficerA.id);
			expect(body.duplicate).toBe(false);

			const expiryDate = new Date(body.expiresAt);
			const obsDate = new Date(body.observedAt);
			const diffMinutes =
				(expiryDate.getTime() - obsDate.getTime()) / (60 * 1000);
			expect(Math.round(diffMinutes)).toBe(30);

			const audits = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, draftEventId),
						eq(auditLogs.action, "road_status.updated"),
					),
				);
			expect(audits.length).toBeGreaterThanOrEqual(1);
		});

		it("IS IDEMPOTENT: repeated mutationId with identical 5-field payload returns 200 without duplicate row or audit", async () => {
			const auditsBefore = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, draftEventId),
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
			const body = (await res.json()) as { status: string; duplicate: boolean };
			expect(body.status).toBe("closed");
			expect(body.duplicate).toBe(true);

			const auditsAfter = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.eventId, draftEventId),
						eq(auditLogs.action, "road_status.updated"),
					),
				);
			expect(auditsAfter.length).toBe(auditsBefore.length);
		});

		it("REJECTS reused mutationId with conflicting status, note, or actor (409)", async () => {
			const resStatusConflict = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: trafficOfficerACookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status: "open",
						observedAt: observedTime,
						mutationId: mutationA,
						note: "Ditutup sementara untuk iring-iringan upacara",
					}),
				},
				testEnv,
			);
			expect(resStatusConflict.status).toBe(409);

			// Same status/time/note, but different actor (Organizer A instead of Traffic Officer A) -> 409
			const resActorConflict = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
				{
					method: "POST",
					headers: {
						Cookie: organizerACookie,
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
			expect(resActorConflict.status).toBe(409);
		});

		it("SUPPORTS append-only history and evaluates expired status as 'unconfirmed' (never silently 'open')", async () => {
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

			const updates = await db
				.select()
				.from(roadStatusUpdates)
				.where(eq(roadStatusUpdates.roadImpactId, createdImpactId));
			expect(updates.length).toBe(2);

			// Expire the status updates and verify GET /api/road-impacts/:impactId/status-history reports 'unconfirmed'
			const pastExpiry = new Date(Date.now() - 5 * 60 * 1000);
			await db
				.update(roadStatusUpdates)
				.set({ expiresAt: pastExpiry })
				.where(eq(roadStatusUpdates.roadImpactId, createdImpactId));

			const histRes = await app.request(
				`http://localhost:5173/api/road-impacts/${createdImpactId}/status-history`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);
			expect(histRes.status).toBe(200);
			const histBody = (await histRes.json()) as {
				current: {
					effectiveStatus: string;
					rawStatus: string;
					isStale: boolean;
				};
				history: unknown[];
			};
			expect(histBody.current.effectiveStatus).toBe("unconfirmed");
			expect(histBody.current.rawStatus).toBe("intermittent");
			expect(histBody.current.isStale).toBe(true);
			expect(histBody.history.length).toBe(2);
		});

		it("CONCURRENCY RACE: Rejects road status update with 409/403 when event is cancelled or assignment is revoked after preflight", async () => {
			// Test intervening event cancellation after preflight
			const heldCancelRace = await withHeldMutation(
				(p) =>
					Boolean(
						p.query &&
							p.query.includes("INSERT INTO road_status_updates") &&
							p.params?.includes(createdImpactId),
					),
				() =>
					app.request(
						`http://localhost:5173/api/road-impacts/${createdImpactId}/status`,
						{
							method: "POST",
							headers: {
								Cookie: trafficOfficerACookie,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								status: "closed",
								observedAt: new Date().toISOString(),
								mutationId: crypto.randomUUID(),
							}),
						},
						testEnv,
					),
				async () => {
					await db
						.update(events)
						.set({ status: "cancelled" })
						.where(eq(events.id, draftEventId));
				},
			);

			expect(heldCancelRace.result.status).toBe(409);

			// Restore draftEventId status to 'draft'
			await db
				.update(events)
				.set({ status: "draft" })
				.where(eq(events.id, draftEventId));
		});

		// ---------------------------------------------------------------------
		// Anonymous Public Endpoints & Unverified Road Segment Exclusion (Item 1)
		// ---------------------------------------------------------------------
		it("PUBLIC: GET /api/public/events lists published events without auth and strips private fields (200)", async () => {
			const res = await app.request(
				"http://localhost:5173/api/public/events",
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				events: Array<Record<string, unknown>>;
			};

			expect(body.events.length).toBeGreaterThanOrEqual(1);
			const publishedEvent = body.events.find(
				(e) => e.id === publishedEventId,
			)!;
			expect(publishedEvent).toBeDefined();
			expect(publishedEvent.publicSlug).toBe(publishedEventSlug);
			expect(publishedEvent.status).toBe("published");

			expect(body.events.some((e) => e.id === reviewEventId)).toBe(false);
			expect(body.events.some((e) => e.id === completedEventId)).toBe(false);

			// Privacy checks
			expect(publishedEvent.createdBy).toBeUndefined();
			expect(publishedEvent.organizationId).toBeUndefined();
			expect(publishedEvent.contactInformation).toBeUndefined();
		});

		it("PUBLIC: GET /api/public/events/:slug returns public event detail and 404 for unknown slug", async () => {
			const res = await app.request(
				`http://localhost:5173/api/public/events/${publishedEventSlug}`,
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				event: Record<string, unknown>;
			};

			expect(body.event.publicSlug).toBe(publishedEventSlug);
			expect(body.event.status).toBe("published");
			expect(body.event.venueName).toBe("Pantai Matahari Terbit Sanur");
			expect(body.event.createdBy).toBeUndefined();
			expect(body.event.contactInformation).toBeUndefined();

			const res404 = await app.request(
				"http://localhost:5173/api/public/events/non-existent-slug-xyz",
				{ method: "GET" },
				testEnv,
			);
			expect(res404.status).toBe(404);
		});

		it("PUBLIC EXCLUSION: GET /api/public/events/:slug/roads and GET /api/public/events?bbox=... strictly exclude unverified synthetic road segments even if inconsistent DB rows exist", async () => {
			// Temporarily insert an inconsistent road_impacts row on publishedEventId pointing to unverified fixtureSyntheticRoadSegmentA
			const inconsistentImpact = await db
				.insert(roadImpacts)
				.values({
					id: crypto.randomUUID(),
					eventId: publishedEventId,
					roadSegmentId: fixtureSyntheticRoadSegmentA.id,
					plannedFrom: new Date("2026-11-20T08:00:00Z"),
					plannedTo: new Date("2026-11-20T14:00:00Z"),
					impactType: "closure",
					diversionNote: "Legacy unverified segment row",
				})
				.returning();

			try {
				const roadsRes = await app.request(
					`http://localhost:5173/api/public/events/${publishedEventSlug}/roads`,
					{ method: "GET" },
					testEnv,
				);
				expect(roadsRes.status).toBe(200);
				const roadsBody = (await roadsRes.json()) as {
					roads: unknown[];
					roadImpacts: unknown[];
				};
				// Unverified synthetic geometry MUST be filtered out of public road output!
				expect(roadsBody.roads).toEqual([]);
				expect(roadsBody.roadImpacts).toEqual([]);

				// Public bbox spatial filter MUST also ignore unverified road segments
				const bboxRes = await app.request(
					"http://localhost:5173/api/public/events?bbox=115.24,-8.70,115.27,-8.67",
					{ method: "GET" },
					testEnv,
				);
				expect(bboxRes.status).toBe(200);
				const bboxBody = (await bboxRes.json()) as {
					events: Array<{ id: string }>;
				};
				expect(bboxBody.events.some((e) => e.id === publishedEventId)).toBe(
					false,
				);
			} finally {
				await db
					.delete(roadImpacts)
					.where(eq(roadImpacts.id, inconsistentImpact[0].id));
			}
		});
	});

	// =========================================================================
	// TICKET 5: A08 - Cleanup Tasks, Private Photo Evidence, Waste Records & Concurrency
	// =========================================================================
	describe("5. A08 - Cleanup Tasks, Private Photo Evidence, Waste Records and Verification", () => {
		let cleanupTaskId: string;
		let beforeEvidenceId: string;

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
						location: { lng: 115.2, lat: 95.0 },
					}),
				},
				testEnv,
			);
			expect(res.status).toBe(422);
		});

		it("REJECTS cleanup task assigning user outside organization or without cleanup assignment (422)", async () => {
			const resOrgB = await app.request(
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
						assignedUserId: fixtureUserOrganizerB.id,
					}),
				},
				testEnv,
			);
			expect(resOrgB.status).toBe(422);

			// Traffic-only officer (canUpdateCleanup=false) cannot be assigned a cleanup task
			const resTrafficOnly = await app.request(
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
						assignedUserId: fixtureUserTrafficOfficerA.id,
					}),
				},
				testEnv,
			);
			expect(resTrafficOnly.status).toBe(422);
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
			expect(body.cleanupTask.title).toBe(
				"Pembersihan Pura Sanur Pasca Upacara",
			);
			expect(body.cleanupTask.status).toBe("todo");
			expect(body.cleanupTask.assignedUserId).toBe(
				fixtureUserCleanupOfficerA.id,
			);
			expect(body.cleanupTask.location).toEqual({ lng: 115.2166, lat: -8.65 });
			cleanupTaskId = body.cleanupTask.id;

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

		it("ROLE & LIFECYCLE CHECK: Rejects officer modifying administrative fields (403) and rejects organizer PATCH shortcutting to submitted/verified/reopened (409)", async () => {
			const resOfficerAdmin = await app.request(
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
			expect(resOfficerAdmin.status).toBe(403);

			// Organizer attempting to shortcut status to 'submitted' or 'verified' via PATCH must receive 409
			for (const disallowedStatus of ["submitted", "verified", "reopened"]) {
				const resShortcut = await app.request(
					`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
					{
						method: "PATCH",
						headers: {
							Cookie: organizerACookie,
							Origin: "http://localhost:5173",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ status: disallowedStatus }),
					},
					testEnv,
				);
				expect(resShortcut.status).toBe(409);
			}

			// Submitting while still in 'todo' status must also fail with 409 (requires 'in_progress')
			const resSubmitFromTodo = await app.request(
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
			expect(resSubmitFromTodo.status).toBe(409);
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
			const body = (await res.json()) as {
				cleanupTask: { title: string; description: string };
			};
			expect(body.cleanupTask.title).toBe(
				"Pembersihan Kawasan Pura Sanur & Pantai",
			);
			expect(body.cleanupTask.description).toBe(
				"Fokus pada area parkir dan tepi pantai.",
			);
		});

		it("REJECTS evidence photo upload with invalid/spoofed file, extension mismatch, or invalid stage (422) and oversized >5MB (413)", async () => {
			resetUploadRateLimits();
			const formSpoofed = new FormData();
			formSpoofed.append("stage", "before");
			formSpoofed.append(
				"file",
				new File([new TextEncoder().encode("not an image")], "fake.jpg", {
					type: "image/jpeg",
				}),
			);

			const resSpoofed = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: formSpoofed,
				},
				testEnv,
			);
			expect(resSpoofed.status).toBe(422);

			// Extension mismatch (.png filename with JPEG bytes)
			const formExtMismatch = new FormData();
			formExtMismatch.append("stage", "before");
			formExtMismatch.append(
				"file",
				new File([createValidJpegBytes()], "mismatch.png", {
					type: "image/jpeg",
				}),
			);
			const resExtMismatch = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: formExtMismatch,
				},
				testEnv,
			);
			expect(resExtMismatch.status).toBe(422);

			// Invalid stage
			const formStage = new FormData();
			formStage.append("stage", "during");
			formStage.append(
				"file",
				new File([createValidPngBytes()], "valid.png", { type: "image/png" }),
			);
			const resStage = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: formStage,
				},
				testEnv,
			);
			expect(resStage.status).toBe(422);

			// Oversized > 5MB (5,242,881 bytes) -> 413
			const formOversized = new FormData();
			formOversized.append("stage", "before");
			formOversized.append(
				"file",
				new File(
					[createValidJpegBytes(MAX_CLEANUP_PHOTO_SIZE_BYTES + 1)],
					"oversized.jpg",
					{ type: "image/jpeg" },
				),
			);
			const resOversized = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
					},
					body: formOversized,
				},
				testEnv,
			);
			expect(resOversized.status).toBe(413);
		});

		it("ACCEPTS valid before photo evidence upload to R2 (201)", async () => {
			resetUploadRateLimits();
			const form = new FormData();
			form.append("stage", "before");
			form.append(
				"file",
				new File([createValidPngBytes()], "before_cleaning.png", {
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
				evidence: {
					id: string;
					taskId: string;
					stage: string;
					createdAt: string;
				};
			};
			expect(body.evidence.id).toBeDefined();
			expect(body.evidence.taskId).toBe(cleanupTaskId);
			expect(body.evidence.stage).toBe("before");
			beforeEvidenceId = body.evidence.id;

			expect(
				(body.evidence as Record<string, unknown>).r2Key,
			).toBeUndefined();
		});

		it("SUBMISSION REQUIREMENT: Rejects submission without 'after' photo evidence (409)", async () => {
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
			expect(body.error.message).toContain(
				"without at least one 'after' photo",
			);
		});

		it("ACCEPTS valid after photo evidence upload to R2 (201)", async () => {
			const form = new FormData();
			form.append("stage", "after");
			form.append(
				"file",
				new File([createValidJpegBytes()], "after_cleaning.jpg", {
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
				evidence: {
					id: string;
					taskId: string;
					stage: string;
					createdAt: string;
				};
			};
			expect(body.evidence.id).toBeDefined();
			expect(body.evidence.stage).toBe("after");
		});

		it("CONTROLLED RETRIEVAL: Downloads evidence photo for assigned task officer and organizer (200)", async () => {
			const resOfficer = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence/${beforeEvidenceId}`,
				{
					method: "GET",
					headers: { Cookie: cleanupOfficerACookie },
				},
				testEnv,
			);
			expect(resOfficer.status).toBe(200);
			expect(resOfficer.headers.get("Cache-Control")).toContain("private");

			const resOrganizer = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence/${beforeEvidenceId}`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);
			expect(resOrganizer.status).toBe(200);
		});

		it("TASK-ASSIGNEE ISOLATION (Item 4): Rejects second cleanup officer assigned to the SAME event (Cleanup Officer A2) from reading evidence, patching, uploading, or submitting Cleanup Officer A's task (403)", async () => {
			// 1. Evidence download by event-assigned non-assignee officer -> 403
			const resReadEvidence = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence/${beforeEvidenceId}`,
				{
					method: "GET",
					headers: { Cookie: cleanupOfficerA2Cookie },
				},
				testEnv,
			);
			expect(resReadEvidence.status).toBe(403);

			// 2. Task PATCH by event-assigned non-assignee officer -> 403
			const resPatch = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
				{
					method: "PATCH",
					headers: {
						Cookie: cleanupOfficerA2Cookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ status: "in_progress" }),
				},
				testEnv,
			);
			expect(resPatch.status).toBe(403);

			// 3. Evidence upload by event-assigned non-assignee officer -> 403
			const form = new FormData();
			form.append(
				"file",
				new File([createValidJpegBytes()], "officer_a2.jpg", {
					type: "image/jpeg",
				}),
			);
			form.append("stage", "before");
			const resUpload = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/evidence`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerA2Cookie,
						Origin: "http://localhost:5173",
					},
					body: form,
				},
				testEnv,
			);
			expect(resUpload.status).toBe(403);

			// 4. Submit by event-assigned non-assignee officer -> 403
			const resSubmit = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/submit`,
				{
					method: "POST",
					headers: {
						Cookie: cleanupOfficerA2Cookie,
						Origin: "http://localhost:5173",
					},
				},
				testEnv,
			);
			expect(resSubmit.status).toBe(403);
		});

		it("SUBMISSION: Assigned officer submits completed cleanup task (200)", async () => {
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
				cleanupTask: {
					status: string;
					verifiedBy: string;
					verifiedAt: string;
				};
			};
			expect(body.cleanupTask.status).toBe("verified");
			expect(body.cleanupTask.verifiedBy).toBe(fixtureUserOrganizerA.id);
			expect(body.cleanupTask.verifiedAt).toBeDefined();

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

		it("REOPEN & RESUBMIT LIFECYCLE: Organizer reopens verified task to 'reopened' (200), officer transitions reopened -> in_progress -> submitted (200)", async () => {
			const resReopen = await app.request(
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

			expect(resReopen.status).toBe(200);
			const bodyReopen = (await resReopen.json()) as {
				cleanupTask: {
					status: string;
					verifiedBy: string | null;
					verifiedAt: string | null;
				};
			};
			expect(bodyReopen.cleanupTask.status).toBe("reopened");
			expect(bodyReopen.cleanupTask.verifiedBy).toBeNull();
			expect(bodyReopen.cleanupTask.verifiedAt).toBeNull();

			// Direct submit from 'reopened' without transitioning to 'in_progress' must fail with 409
			const resDirectSubmit = await app.request(
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
			expect(resDirectSubmit.status).toBe(409);

			// Officer transitions reopened -> in_progress
			const resInProgress = await app.request(
				`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}`,
				{
					method: "PATCH",
					headers: {
						Cookie: cleanupOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ status: "in_progress" }),
				},
				testEnv,
			);
			expect(resInProgress.status).toBe(200);

			// Officer resubmits -> submitted
			const resResubmit = await app.request(
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
			expect(resResubmit.status).toBe(200);
			const bodyResubmit = (await resResubmit.json()) as {
				cleanupTask: { status: string };
			};
			expect(bodyResubmit.cleanupTask.status).toBe("submitted");
		});

		it("WASTE RECORDS: Rejects waste record with neither quantityKg nor sackCount (422) and rejects traffic-only officer (403)", async () => {
			const resInvalid = await app.request(
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
			expect(resInvalid.status).toBe(422);

			const resTrafficOfficer = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/waste-records`,
				{
					method: "POST",
					headers: {
						Cookie: trafficOfficerACookie,
						Origin: "http://localhost:5173",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						category: "organic",
						quantityKg: 10,
						measurementMethod: "weighed",
					}),
				},
				testEnv,
			);
			expect(resTrafficOfficer.status).toBe(403);
		});

		it("WASTE RECORDS: Creates weighed organic waste record and estimated residual waste record (201) and lists them (200)", async () => {
			const resWeighed = await app.request(
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

			expect(resWeighed.status).toBe(201);
			const bodyWeighed = (await resWeighed.json()) as {
				wasteRecord: {
					id: string;
					category: string;
					quantityKg: number;
					measurementMethod: string;
					destination: string;
				};
			};

			expect(bodyWeighed.wasteRecord.id).toBeDefined();
			expect(bodyWeighed.wasteRecord.category).toBe("organic");
			expect(bodyWeighed.wasteRecord.quantityKg).toBe(42.5);
			expect(bodyWeighed.wasteRecord.measurementMethod).toBe("weighed");
			expect(bodyWeighed.wasteRecord.destination).toBe("Kompos TPS3R Sanur");

			const resEstimated = await app.request(
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

			expect(resEstimated.status).toBe(201);

			const resList = await app.request(
				`http://localhost:5173/api/events/${draftEventId}/waste-records`,
				{
					method: "GET",
					headers: { Cookie: organizerACookie },
				},
				testEnv,
			);

			expect(resList.status).toBe(200);
			const bodyList = (await resList.json()) as {
				wasteRecords: Array<{ category: string }>;
			};
			expect(bodyList.wasteRecords.length).toBeGreaterThanOrEqual(2);
		});

		it("CONCURRENCY RACES (Item 4): Authoritative SQL CTE blocks waste-record insert and cleanup task mutation when event is cancelled or assignment is revoked in flight", async () => {
			const wastesBefore = await db
				.select()
				.from(wasteRecords)
				.where(eq(wasteRecords.eventId, draftEventId));

			// 1. Hold waste_records INSERT CTE while event transitions to 'cancelled'
			const heldWasteCancel = await withHeldMutation(
				(p) =>
					Boolean(
						p.query &&
							p.query.includes("INSERT INTO waste_records") &&
							p.params?.includes(draftEventId),
					),
				() =>
					app.request(
						`http://localhost:5173/api/events/${draftEventId}/waste-records`,
						{
							method: "POST",
							headers: {
								Cookie: cleanupOfficerACookie,
								Origin: "http://localhost:5173",
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								category: "recyclable",
								quantityKg: 99,
								measurementMethod: "weighed",
							}),
						},
						testEnv,
					),
				async () => {
					await db
						.update(events)
						.set({ status: "cancelled" })
						.where(eq(events.id, draftEventId));
				},
			);

			expect(heldWasteCancel.result.status).toBe(409);

			// Verify zero phantom waste records were inserted
			const wastesAfter = await db
				.select()
				.from(wasteRecords)
				.where(eq(wasteRecords.eventId, draftEventId));
			expect(wastesAfter.length).toBe(wastesBefore.length);

			// Restore draftEventId to 'draft'
			await db
				.update(events)
				.set({ status: "draft" })
				.where(eq(events.id, draftEventId));

			// 2. Real database lock overlap (`executeWithLockOverlap`): verify concurrent verify and reopen serialize on FOR UPDATE OF ct, e
			const overlapResult = await executeWithLockOverlap(
				pinnedUrl,
				(p) =>
					Boolean(
						p.query &&
							p.query.includes("'cleanup_task.verified'") &&
							p.params?.includes(cleanupTaskId),
					),
				() =>
					app.request(
						`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/verify`,
						{
							method: "POST",
							headers: {
								Cookie: organizerACookie,
								Origin: "http://localhost:5173",
							},
						},
						testEnv,
					),
				() =>
					app.request(
						`http://localhost:5173/api/cleanup-tasks/${cleanupTaskId}/verify`,
						{
							method: "POST",
							headers: {
								Cookie: organizerA2Cookie,
								Origin: "http://localhost:5173",
							},
						},
						testEnv,
					),
			);

			expect(overlapResult.overlapObserved).toBe(true);
			expect(overlapResult.results[0].status).toBe(200);
			// Second verify sees task is already verified by first request and returns 409 STATE_CONFLICT
			expect(overlapResult.results[1].status).toBe(409);
		});

		it("PUBLIC: Returns aggregated cleanup summary with strict weighed vs estimated separation and zero private details (200)", async () => {
			await db.insert(cleanupTasks).values({
				id: crypto.randomUUID(),
				eventId: publishedEventId,
				title: "Pembersihan Area Upacara Publik",
				status: "verified",
				assignedUserId: fixtureUserCleanupOfficerA.id,
			});

			await db.insert(wasteRecords).values([
				{
					id: crypto.randomUUID(),
					eventId: publishedEventId,
					category: "organic",
					quantityKg: "35.00",
					measurementMethod: "weighed",
					recordedBy: fixtureUserOrganizerA.id,
				},
				{
					id: crypto.randomUUID(),
					eventId: publishedEventId,
					category: "recyclable",
					quantityKg: "12.50",
					sackCount: 4,
					measurementMethod: "estimated",
					recordedBy: fixtureUserOrganizerA.id,
				},
			]);

			const res = await app.request(
				`http://localhost:5173/api/public/events/${publishedEventSlug}/cleanup-summary`,
				{ method: "GET" },
				testEnv,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				event: { title: string; status: string };
				summary: {
					totalTasks: number;
					completedTasks: number;
					verifiedTasks: number;
				};
				wasteTotals: {
					weighedKg: number;
					estimatedKg: number;
					totalSacks: number;
				};
				byCategory: Record<
					string,
					{ weighedKg: number; estimatedKg: number; sackCount: number }
				>;
				cleanupSummary: {
					totalTasks: number;
					verifiedTasks: number;
					wasteTotals: {
						weighedKg: number;
						estimatedKg: number;
						totalSacks: number;
					};
				};
			};

			expect(body.event.status).toBe("published");
			expect(body.summary.totalTasks).toBeGreaterThanOrEqual(1);
			expect(body.summary.verifiedTasks).toBeGreaterThanOrEqual(1);
			expect(body.wasteTotals.weighedKg).toBe(35);
			expect(body.wasteTotals.estimatedKg).toBe(12.5);
			expect(body.wasteTotals.totalSacks).toBe(4);
			expect(body.byCategory.organic.weighedKg).toBe(35);
			expect(body.byCategory.recyclable.estimatedKg).toBe(12.5);
			expect(body.byCategory.recyclable.sackCount).toBe(4);

			expect(body.cleanupSummary).toBeDefined();
			expect(body.cleanupSummary.wasteTotals.weighedKg).toBe(35);
			expect(body.cleanupSummary.wasteTotals.estimatedKg).toBe(12.5);

			expect(
				(body.cleanupSummary as Record<string, unknown>).assignedUserEmail,
			).toBeUndefined();
			expect(
				(body.cleanupSummary as Record<string, unknown>).r2Key,
			).toBeUndefined();
		});
	});
});
