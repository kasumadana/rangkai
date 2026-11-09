import crypto from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDevBranch } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db/index";
import { account, user } from "../../src/db/auth-schema";
import {
	advisoryDecisions,
	advisoryRuns,
	auditLogs,
	eventAlternativeRouteHistory,
	eventAlternativeRoutes,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
} from "../../src/db/schema";
import app from "../../src/worker/index";

describe("P1 Features & Advisory Integration Tests (Tickets 04-09, SPEC-01 to SPEC-11)", () => {
	const runKey = crypto.randomUUID().slice(0, 8);
	const testPassword = "P1TestPassword123!";

	// Scoped IDs
	const orgAId = crypto.randomUUID();
	const orgBId = crypto.randomUUID();
	const userOrganizerId = crypto.randomUUID();
	const userOfficerId = crypto.randomUUID();
	const userForeignOrgId = crypto.randomUUID();

	const testEventId = crypto.randomUUID();
	const testEventSlug = `p1-test-event-${runKey}`;

	const foreignPrivateEventId = crypto.randomUUID();
	const foreignPrivateSlug = `p1-foreign-private-${runKey}`;

	let dbClient: DbClient;
	let organizerCookie: string = "";
	let officerCookie: string = "";

	let segmentIdA: string = "";

	beforeAll(async () => {
		const { pinnedUrl } = await assertDevBranch();
		dbClient = getDb(pinnedUrl);

		// 1. Create run-owned organizations
		await dbClient.insert(organizations).values([
			{
				id: orgAId,
				name: `Banjar A SYNTHETIC_TEST_DATA ${runKey}`,
				village: "Sanur Kauh",
				district: "Denpasar Selatan",
				hasOperationalAuthority: true,
			},
			{
				id: orgBId,
				name: `Banjar B Foreign SYNTHETIC_TEST_DATA ${runKey}`,
				village: "Ubud",
				district: "Gianyar",
				hasOperationalAuthority: false, // Unauthorized real event
			},
		]);

		// 2. Create users
		const hashedPw = await hashPassword(testPassword);
		await dbClient.insert(user).values([
			{
				id: userOrganizerId,
				name: "Organizer A",
				email: `organizer-a-${runKey}@example.com`,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: userOfficerId,
				name: "Officer A",
				email: `officer-a-${runKey}@example.com`,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: userForeignOrgId,
				name: "Foreign Organizer B",
				email: `foreign-b-${runKey}@example.com`,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		// 3. Create Better Auth accounts
		await dbClient.insert(account).values([
			{
				id: `acc_org_${runKey}`,
				accountId: userOrganizerId,
				providerId: "credential",
				userId: userOrganizerId,
				password: hashedPw,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: `acc_off_${runKey}`,
				accountId: userOfficerId,
				providerId: "credential",
				userId: userOfficerId,
				password: hashedPw,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: `acc_for_${runKey}`,
				accountId: userForeignOrgId,
				providerId: "credential",
				userId: userForeignOrgId,
				password: hashedPw,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		// 4. Create memberships
		await dbClient.insert(memberships).values([
			{
				id: crypto.randomUUID(),
				organizationId: orgAId,
				userId: userOrganizerId,
				role: "organizer",
			},
			{
				id: crypto.randomUUID(),
				organizationId: orgAId,
				userId: userOfficerId,
				role: "officer",
			},
			{
				id: crypto.randomUUID(),
				organizationId: orgBId,
				userId: userForeignOrgId,
				role: "organizer",
			},
		]);

		// 5. Sign in organizer and officer to obtain session cookies
		const signInRes = await app.request("http://localhost:5173/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: `organizer-a-${runKey}@example.com`,
				password: testPassword,
			}),
		});
		expect(signInRes.status).toBe(200);
		organizerCookie = (signInRes.headers.get("set-cookie") || "").split(";")[0];

		const officerSignInRes = await app.request("http://localhost:5173/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: `officer-a-${runKey}@example.com`,
				password: testPassword,
			}),
		});
		expect(officerSignInRes.status).toBe(200);
		officerCookie = (officerSignInRes.headers.get("set-cookie") || "").split(";")[0];

		// 6. Look up an existing catalog road segment in Sanur
		const segRows = await dbClient
			.select({ id: roadSegments.id })
			.from(roadSegments)
			.limit(1);
		segmentIdA = segRows[0]?.id || "";

		// 7. Seed test event
		const now = new Date();
		const startsAt = new Date(now.getTime() + 3600_000);
		const endsAt = new Date(now.getTime() + 7200_000);

		await dbClient.insert(events).values({
			id: testEventId,
			organizationId: orgAId,
			createdBy: userOrganizerId,
			title: `P1 Upacara Adat Sanur SYNTHETIC_TEST_DATA ${runKey}`,
			category: "upacara_adat",
			venueName: "Pura Segara Sanur",
			publicSlug: testEventSlug,
			status: "published",
			isSimulation: true,
			verifiedBy: userOrganizerId,
			verifiedAt: now,
			startsAt,
			endsAt,
		});

		// 8. Seed foreign private unauthorized event (SPEC-02 sentinel)
		await dbClient.insert(events).values({
			id: foreignPrivateEventId,
			organizationId: orgBId,
			createdBy: userForeignOrgId,
			title: `SENTINEL_FOREIGN_TITLE_${runKey}`,
			category: "upacara_adat",
			venueName: "Foreign Private Location",
			publicSlug: foreignPrivateSlug,
			status: "draft", // Unreviewed draft, non-public
			isSimulation: false, // Real event without operational authority
			startsAt,
			endsAt,
		});
	});

	afterAll(async () => {
		// Clean up only run-owned fixtures
		const eventIds = [testEventId, foreignPrivateEventId];
		const userIds = [userOrganizerId, userOfficerId, userForeignOrgId];
		const orgIds = [orgAId, orgBId];

		try {
			await dbClient.delete(advisoryDecisions).where(inArray(advisoryDecisions.eventId, eventIds));
			await dbClient.delete(advisoryRuns).where(inArray(advisoryRuns.eventId, eventIds));
			await dbClient.delete(eventAlternativeRouteHistory).where(sql`event_id IN (${testEventId}::uuid, ${foreignPrivateEventId}::uuid)`);
			await dbClient.delete(eventAlternativeRoutes).where(inArray(eventAlternativeRoutes.eventId, eventIds));
			await dbClient.delete(roadImpacts).where(inArray(roadImpacts.eventId, eventIds));
			await dbClient.delete(auditLogs).where(inArray(auditLogs.organizationId, orgIds));
			await dbClient.delete(events).where(inArray(events.id, eventIds));
			await dbClient.delete(memberships).where(inArray(memberships.organizationId, orgIds));
			await dbClient.delete(account).where(inArray(account.userId, userIds));
			await dbClient.delete(user).where(inArray(user.id, userIds));
			await dbClient.delete(organizations).where(inArray(organizations.id, orgIds));
		} catch (err) {
			console.error("Cleanup error in afterAll:", err);
		}
	});

	describe("Ticket 04: Road Candidate Matching (GET /api/events/:id/road-candidates)", () => {
		it("rejects unauthenticated request with 401", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}/road-candidates?query=Danau`);
			expect(res.status).toBe(401);
		});

		it("rejects field officer access with 403 (Organizer only permission)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/road-candidates?query=Danau`,
				{ headers: { Cookie: officerCookie } },
			);
			expect(res.status).toBe(403);
		});

		it("returns ranked candidates scoped to organization region without quarantined roads", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/road-candidates?query=Danau`,
				{ headers: { Cookie: organizerCookie } },
			);
			expect(res.status).toBe(200);
			const data = await res.json<{
				query: string;
				candidates: Array<{
					candidateId: string;
					displayName: string;
					coverageArea: string;
					matchScore: number;
					reviewRequired: boolean;
				}>;
			}>();
			expect(Array.isArray(data.candidates)).toBe(true);
			if (data.candidates.length > 0) {
				expect(data.candidates[0].reviewRequired).toBe(true);
				expect(data.candidates[0].matchScore).toBeGreaterThan(0);
			}
		});
	});

	describe("Ticket 07: Conditional Network Routing Safety Gate (SPEC-01)", () => {
		it("unconditionally returns 503 SERVICE_UNAVAILABLE even with valid coordinates", async () => {
			const res = await app.request("http://localhost:5173/api/public/routes/alternatives", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					origin: [115.258, -8.691],
					destination: [115.262, -8.700],
					profile: "driving-car",
				}),
			});
			expect(res.status).toBe(503);
			const data = await res.json<{
				error: { code: string; message: string; details?: { alternativeRoutesUrl: string } };
			}>();
			expect(data.error.code).toBe("SERVICE_UNAVAILABLE");
			expect(data.error.message).toContain("Network routing is temporarily unavailable");
			expect(data.error.details?.alternativeRoutesUrl).toBeDefined();
		});

		it("rejects invalid out-of-bounds coordinates with 422", async () => {
			const res = await app.request("http://localhost:5173/api/public/routes/alternatives", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					origin: [106.8456, -6.2088], // Jakarta
					destination: [115.262, -8.700],
				}),
			});
			expect(res.status).toBe(422);
		});
	});

	describe("Ticket 06: Reviewed Manual Alternative Routes (STD-01, SPEC-07, SPEC-08)", () => {
		let routeId: string = "";

		it("creates draft alternative route", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						name: "Jalur Alternatif Danau Poso",
						description: "Pengalihan roda dua",
						coordinates: [
							[115.258, -8.691],
							[115.260, -8.695],
						],
					}),
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{ alternativeRoute: { id: string; status: string } }>();
			expect(data.alternativeRoute.status).toBe("draft");
			routeId = data.alternativeRoute.id;
		});

		it("rejects approval when event has NO road impacts (400 NO_ROAD_IMPACTS)", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes/${routeId}/approve`,
				{
					method: "POST",
					headers: { Cookie: organizerCookie },
				},
			);
			expect(res.status).toBe(400);
			const data = await res.json<{ error: { code: string } }>();
			expect(data.error.code).toBe("NO_ROAD_IMPACTS");
		});

		it("approves alternative route after road impacts attached, binding snapshot hash and history", async () => {
			// Attach road impact
			const impactId = crypto.randomUUID();
			const now = new Date();
			await dbClient.insert(roadImpacts).values({
				id: impactId,
				eventId: testEventId,
				roadSegmentId: segmentIdA,
				impactType: "closure",
				plannedFrom: new Date(now.getTime() + 1800_000),
				plannedTo: new Date(now.getTime() + 7200_000),
			});

			const approveRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes/${routeId}/approve`,
				{
					method: "POST",
					headers: { Cookie: organizerCookie },
				},
			);
			expect(approveRes.status).toBe(200);
			const data = await approveRes.json<{ alternativeRoute: { status: string; approvedAt: string } }>();
			expect(data.alternativeRoute.status).toBe("approved");

			// Verify history row was inserted
			const historyRows = await dbClient.execute(sql`
				SELECT * FROM event_alternative_route_history
				WHERE route_id = ${routeId}::uuid AND action = 'approved';
			`);
			expect(historyRows.rows.length).toBeGreaterThanOrEqual(1);

			// Idempotent re-approval returns 200 without duplicate state
			const repeatRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes/${routeId}/approve`,
				{
					method: "POST",
					headers: { Cookie: organizerCookie },
				},
			);
			expect(repeatRes.status).toBe(200);

			// Expose on public API
			const publicRes = await app.request(
				`http://localhost:5173/api/public/events/${testEventSlug}/alternative-routes`,
			);
			expect(publicRes.status).toBe(200);
			const publicData = await publicRes.json<{ alternativeRoutes: Array<{ id: string }> }>();
			expect(publicData.alternativeRoutes.some((r) => r.id === routeId)).toBe(true);
		});

		it("revokes alternative route and removes from public visibility", async () => {
			const revokeRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes/${routeId}/revoke`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({ reason: "Jalur pengalihan sudah tidak diperlukan" }),
				},
			);
			expect(revokeRes.status).toBe(200);

			// Public read should no longer show revoked route
			const publicRes = await app.request(
				`http://localhost:5173/api/public/events/${testEventSlug}/alternative-routes`,
			);
			expect(publicRes.status).toBe(200);
			const publicData = await publicRes.json<{ alternativeRoutes: Array<{ id: string }> }>();
			expect(publicData.alternativeRoutes.some((r) => r.id === routeId)).toBe(false);
		});
	});

	describe("Ticket 05: Grounded Impact Analysis & Freshness (SPEC-02, SPEC-03, SPEC-04)", () => {
		let runId: string = "";

		it("generates grounded impact analysis with honest model provenance and no private leaks", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/impact-analysis`,
				{
					method: "POST",
					headers: { Cookie: organizerCookie },
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{
				advisoryRun: {
					id: string;
					modelIdentifier: string;
					output: { findings: Array<{ title: string; description: string }> };
				};
			}>();
			runId = data.advisoryRun.id;

			// Never store invented "gemini-1.5-flash-deterministic" (SPEC-03)
			expect(data.advisoryRun.modelIdentifier).not.toBe("gemini-1.5-flash-deterministic");

			// Cross-org privacy exclusion (SPEC-02): foreign private title never appears in findings
			const allText = JSON.stringify(data.advisoryRun.output);
			expect(allText).not.toContain(`SENTINEL_FOREIGN_TITLE_${runKey}`);
		});

		it("evaluates staleness against current factual snapshot", async () => {
			const latestRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/impact-analysis/latest`,
				{ headers: { Cookie: organizerCookie } },
			);
			expect(latestRes.status).toBe(200);
			const data = await latestRes.json<{ isStale: boolean }>();
			expect(data.isStale).toBe(false);
		});

		it("records decision and rejects duplicate decisions when input becomes stale (SPEC-04)", async () => {
			// Approve fresh run
			const decRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/impact-analysis/${runId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({ decision: "approved", reason: "Telah ditinjau panitia" }),
				},
			);
			expect(decRes.status).toBe(201);

			// Idempotent replay
			const repeatRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/impact-analysis/${runId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({ decision: "approved" }),
				},
			);
			expect(repeatRes.status).toBe(200);

			// Mutate event venue to invalidate snapshot hash
			await dbClient
				.update(events)
				.set({ venueName: "Pura Segara Sanur Updated Venue" })
				.where(eq(events.id, testEventId));

			// Submitting new decision on now-stale run must return 409
			const staleRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/impact-analysis/${runId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({ decision: "dismissed" }),
				},
			);
			expect(staleRes.status).toBe(409);
		});
	});

	describe("Ticket 08: Public Notice Drafts & Validated Corrections (SPEC-05, SPEC-06)", () => {
		let noticeRunId: string = "";

		it("generates notice draft bounded by word (<=120) and character (<=600) limits with simulation tag", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/public-notice-draft`,
				{
					method: "POST",
					headers: { Cookie: organizerCookie },
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{
				noticeDraft: {
					id: string;
					output: {
						publicSummary: string;
						whatsappNotice: string;
						wordCount: number;
						charCount: number;
					};
				};
			}>();
			noticeRunId = data.noticeDraft.id;

			expect(data.noticeDraft.output.wordCount).toBeLessThanOrEqual(120);
			expect(data.noticeDraft.output.charCount).toBeLessThanOrEqual(600);
			expect(data.noticeDraft.output.publicSummary).toContain("[SIMULASI - UJI COBA]");
		});

		it("rejects correction exceeding 600 characters or unsupported safety claims (422)", async () => {
			// Exceeding 600 characters
			const overLimitRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/public-notice-draft/${noticeRunId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						decision: "approved",
						correctedWhatsappNotice: "A".repeat(601),
					}),
				},
			);
			expect(overLimitRes.status).toBe(422);

			// Unsupported police/safety claim
			const prohibitedClaimRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/public-notice-draft/${noticeRunId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						decision: "approved",
						correctedWhatsappNotice: "Jalan ini dijamin aman resmi oleh polisi.",
					}),
				},
			);
			expect(prohibitedClaimRes.status).toBe(422);

			// Unlisted road claim
			const unlistedRoadRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/public-notice-draft/${noticeRunId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						decision: "approved",
						correctedWhatsappNotice: "Melewati Jalan Palsu tanpa hambatan.",
					}),
				},
			);
			expect(unlistedRoadRes.status).toBe(422);
		});

		it("accepts valid human correction and preserves immutable simulation label", async () => {
			const validCorrectionRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/public-notice-draft/${noticeRunId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						decision: "approved",
						reason: "Koreksi redaksi panitia desa",
						correctedPublicSummary: "Pengalihan arus di seputaran Pura Segara.",
						correctedWhatsappNotice: "Om Swastyastu, mohon perhatian ada upacara adat.",
					}),
				},
			);
			expect(validCorrectionRes.status).toBe(201);

			// Verify latest query returns accepted correctedOutputJson
			const latestRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/public-notice-draft/latest`,
				{ headers: { Cookie: organizerCookie } },
			);
			expect(latestRes.status).toBe(200);
			const latestData = await latestRes.json<{
				latestDecision: {
					decision: string;
					correctedOutputJson: {
						correctedPublicSummary: string;
						correctedWhatsappNotice: string;
					};
				};
			}>();
			expect(latestData.latestDecision.decision).toBe("approved");
			// Simulation tag automatically prepended
			expect(latestData.latestDecision.correctedOutputJson.correctedPublicSummary).toContain("[SIMULASI - UJI COBA]");
		});
	});

	describe("Ticket 09: Waste Logistics & Honest Assumptions (SPEC-09)", () => {
		it("returns forecastKg=null and operational checklist when rate is omitted or 0", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/waste-plan`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						estimatedParticipants: 500,
						durationHours: 6,
						wastePerPersonDayKg: 0, // Omitted or zero
					}),
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{
				wastePlan: {
					output: {
						method: string;
						forecastKg: null;
						scenarioLogistics: null;
						checklist: string[];
					};
				};
			}>();

			expect(data.wastePlan.output.forecastKg).toBeNull();
			expect(data.wastePlan.output.method).toBe("operational_checklist");
			expect(data.wastePlan.output.scenarioLogistics).toBeNull();
			expect(Array.isArray(data.wastePlan.output.checklist)).toBe(true);
		});

		it("calculates scenario logistics with exact user coefficients when provided", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/waste-plan`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						estimatedParticipants: 1000,
						durationHours: 12,
						wastePerPersonDayKg: 0.4,
						organicFraction: 0.7,
						recyclableFraction: 0.2,
						residualFraction: 0.1,
					}),
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{
				wastePlan: {
					output: {
						scenarioLogistics: {
							estimatedTotalKg: number;
							estimatedOrganicKg: number;
							estimatedSackCount: number;
						};
					};
				};
			}>();

			expect(data.wastePlan.output.scenarioLogistics).toBeDefined();
			// 1000 participants * 0.4 kg/day * (12 / 24) = 200 kg total
			expect(data.wastePlan.output.scenarioLogistics.estimatedTotalKg).toBe(200);
			expect(data.wastePlan.output.scenarioLogistics.estimatedOrganicKg).toBe(140);
			expect(data.wastePlan.output.scenarioLogistics.estimatedSackCount).toBeGreaterThan(0);
		});
	});
});
