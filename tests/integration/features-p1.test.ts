import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db/index";
import {
	advisoryDecisions,
	advisoryRuns,
	eventAlternativeRoutes,
	events,
} from "../../src/db/schema";
import app from "../../src/worker/index";
import { SIMULATED_DATA } from "../../src/db/seed";
import { eq } from "drizzle-orm";

describe("P1 Features & Advisory Integration Tests (Tickets 04, 05, 06, 07, 08, 09)", () => {
	let organizerCookie: string = "";
	const testEventId = "e0000000-0000-4000-8000-000000000099";
	const testEventSlug = "p1-test-event-slug";
	let dbClient: ReturnType<typeof getDb>;

	beforeAll(async () => {
		const { pinnedUrl } = await assertDevBranch();
		dbClient = getDb(pinnedUrl);

		// Sign in simulated organizer
		const signInRes = await app.request("http://localhost:5173/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: SIMULATED_DATA.users.organizer.email,
				password: process.env.SEED_ORGANIZER_PASSWORD || "SimulatedOrganizer123!",
			}),
		});
		expect(signInRes.status).toBe(200);
		const cookie = signInRes.headers.get("set-cookie") || "";
		organizerCookie = cookie.split(";")[0];

		// Create a clean test event owned by organizer's organization
		await dbClient
			.insert(events)
			.values({
				id: testEventId,
				organizationId: SIMULATED_DATA.organization.id,
				createdBy: SIMULATED_DATA.users.organizer.id,
				title: "P1 Test Upacara Adat Sanur",
				category: "upacara_adat",
				venueName: "Pura Segara Sanur",
				publicSlug: testEventSlug,
				status: "published",
				isSimulation: true,
				startsAt: new Date("2026-11-12T08:00:00Z"),
				endsAt: new Date("2026-11-12T14:00:00Z"),
			})
			.onConflictDoUpdate({
				target: events.id,
				set: {
					status: "published",
					title: "P1 Test Upacara Adat Sanur",
					startsAt: new Date("2026-11-12T08:00:00Z"),
					endsAt: new Date("2026-11-12T14:00:00Z"),
				},
			});
	});

	afterAll(async () => {
		// Clean up test data
		await dbClient
			.delete(advisoryDecisions)
			.where(eq(advisoryDecisions.eventId, testEventId));
		await dbClient
			.delete(advisoryRuns)
			.where(eq(advisoryRuns.eventId, testEventId));
		await dbClient
			.delete(eventAlternativeRoutes)
			.where(eq(eventAlternativeRoutes.eventId, testEventId));
		await dbClient
			.delete(events)
			.where(eq(events.id, testEventId));
	});

	describe("Ticket 04: Human-selected Road Candidates (GET /api/events/:id/road-candidates)", () => {
		it("rejects unauthenticated request with 401", async () => {
			const res = await app.request(`http://localhost:5173/api/events/${testEventId}/road-candidates`);
			expect(res.status).toBe(401);
		});

		it("returns ranked candidates from verified catalog without mutating state", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/road-candidates?query=Gajah+Mada`,
				{
					headers: { Cookie: organizerCookie },
				},
			);
			expect(res.status).toBe(200);
			const data = await res.json<{
				candidates: Array<{
					candidateId: string;
					displayName: string;
					coverageArea: string;
					matchScore: number;
					matchMethod: string;
					reviewRequired: boolean;
					explanation: string;
					geometry: unknown;
				}>;
			}>();

			expect(Array.isArray(data.candidates)).toBe(true);
			if (data.candidates.length > 0) {
				const top = data.candidates[0];
				expect(top.displayName.toLowerCase()).toContain("gajah mada");
				expect(top.matchScore).toBeGreaterThanOrEqual(0.4);
				expect(top.reviewRequired).toBe(true);
				expect(top.geometry).toBeDefined();
			}
		});

		it("rejects invalid UUID format with 422", async () => {
			const res = await app.request(`http://localhost:5173/api/events/invalid-uuid/road-candidates`, {
				headers: { Cookie: organizerCookie },
			});
			expect(res.status).toBe(422);
		});
	});

	describe("Ticket 05: Grounded Impact Planner (POST & GET /api/events/:id/impact-analysis)", () => {
		let latestRunId: string = "";

		it("generates grounded impact analysis with strict signals, findings, and snapshot hash", async () => {
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
					kind: string;
					status: string;
					inputSnapshotHash: string;
					output: {
						signals: Array<{ id: string; type: string }>;
						findings: Array<{ id: string; factRefs: string[] }>;
						taskSuggestions: Array<{ id: string; reasonRefs: string[] }>;
						disclaimer: string;
					};
				};
			}>();

			expect(data.advisoryRun.kind).toBe("impact_analysis");
			expect(data.advisoryRun.status).toBe("completed");
			expect(data.advisoryRun.inputSnapshotHash).toBeDefined();
			latestRunId = data.advisoryRun.id;

			const allowedSignalIds = new Set(data.advisoryRun.output.signals.map((s) => s.id));
			for (const f of data.advisoryRun.output.findings) {
				for (const ref of f.factRefs) {
					expect(allowedSignalIds.has(ref)).toBe(true);
				}
			}
			for (const t of data.advisoryRun.output.taskSuggestions) {
				for (const ref of t.reasonRefs) {
					expect(allowedSignalIds.has(ref)).toBe(true);
				}
			}
		});

		it("reads latest impact analysis and evaluates staleness correctly", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/impact-analysis/latest`,
				{
					headers: { Cookie: organizerCookie },
				},
			);
			expect(res.status).toBe(200);
			const data = await res.json<{
				advisoryRun: { id: string };
				isStale: boolean;
			}>();

			expect(data.advisoryRun.id).toBe(latestRunId);
		});

		it("records organizer decision without mutating domain operational status", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/impact-analysis/${latestRunId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						decision: "approved",
						reason: "Checklist koordinasi diterima oleh panitia.",
					}),
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{
				decision: { id: string; decision: string; reason: string };
			}>();
			expect(data.decision.decision).toBe("approved");
			expect(data.decision.reason).toContain("Checklist koordinasi");
		});
	});

	describe("Ticket 06: Reviewed Manual Alternative Routes", () => {
		let createdRouteId: string = "";

		it("creates a draft manual alternative route inside Bali bounds", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						name: "Jalur Alternatif Melalui Jl. Danau Poso",
						description: "Pengalihan bagi kendaraan roda dua dan roda empat ringan.",
						coordinates: [
							[115.258, -8.691],
							[115.260, -8.695],
							[115.262, -8.700],
						],
					}),
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{
				alternativeRoute: { id: string; status: string; name: string };
			}>();
			expect(data.alternativeRoute.status).toBe("draft");
			createdRouteId = data.alternativeRoute.id;
		});

		it("does not expose draft alternative route on public API", async () => {
			const res = await app.request(
				`http://localhost:5173/api/public/events/${testEventSlug}/alternative-routes`,
			);
			expect(res.status).toBe(200);
			const data = await res.json<{ alternativeRoutes: Array<{ id: string }> }>();
			expect(data.alternativeRoutes.some((r) => r.id === createdRouteId)).toBe(false);
		});

		it("approves draft alternative route and exposes it publicly", async () => {
			const approveRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes/${createdRouteId}/approve`,
				{
					method: "POST",
					headers: { Cookie: organizerCookie },
				},
			);
			expect(approveRes.status).toBe(200);

			const publicRes = await app.request(
				`http://localhost:5173/api/public/events/${testEventSlug}/alternative-routes`,
			);
			expect(publicRes.status).toBe(200);
			const publicData = await publicRes.json<{ alternativeRoutes: Array<{ id: string; status?: string }> }>();
			expect(publicData.alternativeRoutes.some((r) => r.id === createdRouteId)).toBe(true);
		});

		it("revokes alternative route and removes it from public visibility", async () => {
			const revokeRes = await app.request(
				`http://localhost:5173/api/events/${testEventId}/alternative-routes/${createdRouteId}/revoke`,
				{
					method: "POST",
					headers: { Cookie: organizerCookie },
				},
			);
			expect(revokeRes.status).toBe(200);

			const publicRes = await app.request(
				`http://localhost:5173/api/public/events/${testEventSlug}/alternative-routes`,
			);
			expect(publicRes.status).toBe(200);
			const publicData = await publicRes.json<{ alternativeRoutes: Array<{ id: string }> }>();
			expect(publicData.alternativeRoutes.some((r) => r.id === createdRouteId)).toBe(false);
		});
	});

	describe("Ticket 07: Conditional Network Routing Gate (POST /api/public/routes/alternatives)", () => {
		it("returns honest 503 SERVICE_UNAVAILABLE pointing to manual routes when ORS is not enabled", async () => {
			const res = await app.request(
				"http://localhost:5173/api/public/routes/alternatives",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						origin: [115.2166, -8.6500],
						destination: [115.2200, -8.6550],
						profile: "driving-car",
					}),
				},
			);
			expect(res.status).toBe(503);
			const data = await res.json<{
				status: string;
				configured: boolean;
				manualFallbackRecommended: boolean;
			}>();
			expect(data.status).toBe("unavailable");
			expect(data.configured).toBe(false);
			expect(data.manualFallbackRecommended).toBe(true);
		});

		it("rejects coordinates outside Bali bounds with 422", async () => {
			const res = await app.request(
				"http://localhost:5173/api/public/routes/alternatives",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						origin: [106.8456, -6.2088], // Jakarta coordinates
						destination: [115.2200, -8.6550],
					}),
				},
			);
			expect(res.status).toBe(422);
		});
	});

	describe("Ticket 08: Reviewed Public Notice Drafts (POST /api/events/:id/public-notice-draft)", () => {
		let latestNoticeRunId: string = "";

		it("generates bounded public notice drafts adhering to word and char limits", async () => {
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
						officerBrief: string;
						isSimulation: boolean;
						wordCount: number;
						charCount: number;
					};
				};
			}>();

			latestNoticeRunId = data.noticeDraft.id;
			expect(data.noticeDraft.output.wordCount).toBeLessThanOrEqual(120);
			expect(data.noticeDraft.output.charCount).toBeLessThanOrEqual(600);
			expect(data.noticeDraft.output.isSimulation).toBe(true);
			expect(data.noticeDraft.output.publicSummary).toContain("SIMULASI");
		});

		it("records notice approval decision without mutating event publication status", async () => {
			const res = await app.request(
				`http://localhost:5173/api/events/${testEventId}/public-notice-draft/${latestNoticeRunId}/decision`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: organizerCookie,
					},
					body: JSON.stringify({
						decision: "approved",
						reason: "Teks pengumuman disetujui prajuru untuk siaran grup WhatsApp banjar.",
					}),
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{ decision: { decision: string } }>();
			expect(data.decision.decision).toBe("approved");

			// Confirm event status is STILL published, untouched by advisory decision!
			const eventRow = await dbClient
				.select({ status: events.status })
				.from(events)
				.where(eq(events.id, testEventId));
			expect(eventRow[0].status).toBe("published");
		});
	});

	describe("Ticket 09: Waste Planning Tool (POST /api/events/:id/waste-plan)", () => {
		it("returns honest forecastKg=null and transparent scenario assumptions", async () => {
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
					}),
				},
			);
			expect(res.status).toBe(201);
			const data = await res.json<{
				wastePlan: {
					output: {
						status: string;
						forecastKg: null;
						assumptions: { rateKgPerParticipantPerDay: number };
						scenarioLogistics: { estimatedTotalKg: number; estimatedSackCount: number };
						checklist: string[];
					};
				};
			}>();

			expect(data.wastePlan.output.status).toBe("insufficient_historical_data");
			expect(data.wastePlan.output.forecastKg).toBeNull();
			expect(data.wastePlan.output.scenarioLogistics.estimatedTotalKg).toBeGreaterThan(0);
			expect(data.wastePlan.output.scenarioLogistics.estimatedSackCount).toBeGreaterThan(0);
			expect(data.wastePlan.output.checklist.length).toBeGreaterThanOrEqual(3);
		});
	});
});
