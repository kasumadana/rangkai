import { beforeAll, describe, expect, it } from "vitest";
import { assertDevBranch } from "../../src/db/guard";
import app from "../../src/worker/index";
import { evaluateEffectiveRoadStatus, ROAD_STATUS_TTL_MS } from "../../src/worker/routes/roads";

describe("Public Road Geometry & Status Freshness (Tickets 01 & 02)", () => {
	beforeAll(async () => {
		await assertDevBranch();
	});

	describe("Ticket 01: GET /api/public/road-impacts", () => {
		it("rejects malformed bbox with 422 VALIDATION_FAILED", async () => {
			// Only 3 coordinate values
			const res1 = await app.request("http://localhost:5173/api/public/road-impacts?bbox=115.1,-8.7,115.3");
			expect(res1.status).toBe(422);
			const body1 = await res1.json<{ error: { code: string; message: string } }>();
			expect(body1.error.code).toBe("VALIDATION_FAILED");

			// Inverted minLng > maxLng
			const res2 = await app.request("http://localhost:5173/api/public/road-impacts?bbox=115.5,-8.7,115.2,-8.6");
			expect(res2.status).toBe(422);

			// Inverted minLat > maxLat
			const res3 = await app.request("http://localhost:5173/api/public/road-impacts?bbox=115.1,-8.5,115.3,-8.8");
			expect(res3.status).toBe(422);

			// Non-numeric bbox
			const res4 = await app.request("http://localhost:5173/api/public/road-impacts?bbox=abc,def,ghi,jkl");
			expect(res4.status).toBe(422);
		});

		it("rejects invalid time window where 'from' is after 'to' with 422", async () => {
			const res = await app.request(
				"http://localhost:5173/api/public/road-impacts?from=2026-11-10T12:00:00Z&to=2026-11-10T08:00:00Z",
			);
			expect(res.status).toBe(422);
			const body = await res.json<{ error: { code: string } }>();
			expect(body.error.code).toBe("VALIDATION_FAILED");
		});

		it("returns valid GeoJSON FeatureCollection with honest pagination and properties", async () => {
			const res = await app.request("http://localhost:5173/api/public/road-impacts?limit=10");
			expect(res.status).toBe(200);
			const data = await res.json<{
				type: string;
				features: Array<{
					type: string;
					id: string;
					geometry: { type: string; coordinates: unknown };
					properties: {
						impactId: string;
						roadSegmentId: string;
						eventId: string;
						eventSlug: string;
						effectiveStatus: string;
						isStale: boolean;
						isSimulation: boolean;
					};
				}>;
				pagination: {
					page: number;
					limit: number;
					total: number;
					totalPages: number;
					truncated: boolean;
				};
			}>();

			expect(data.type).toBe("FeatureCollection");
			expect(Array.isArray(data.features)).toBe(true);
			expect(data.pagination).toBeDefined();
			expect(data.pagination.limit).toBe(10);
			expect(typeof data.pagination.total).toBe("number");
			expect(typeof data.pagination.truncated).toBe("boolean");

			// Check feature integrity if any features exist
			for (const feat of data.features) {
				expect(feat.type).toBe("Feature");
				expect(feat.id).toBeDefined();
				expect(["LineString", "MultiLineString"]).toContain(feat.geometry.type);
				expect(feat.properties.impactId).toBeDefined();
				expect(feat.properties.eventId).toBeDefined();
				expect(feat.properties.eventSlug).toBeDefined();
				expect(["open", "intermittent", "closed", "unconfirmed", "unknown"]).toContain(
					feat.properties.effectiveStatus,
				);
				expect(typeof feat.properties.isStale).toBe("boolean");
				expect(typeof feat.properties.isSimulation).toBe("boolean");
			}
		});

		it("filters by bounding box without server error", async () => {
			// Catur Muka Denpasar bounding box
			const res = await app.request(
				"http://localhost:5173/api/public/road-impacts?bbox=115.20,-8.67,115.23,-8.64&limit=20",
			);
			expect(res.status).toBe(200);
			const data = await res.json<{ type: string; features: unknown[] }>();
			expect(data.type).toBe("FeatureCollection");
			expect(Array.isArray(data.features)).toBe(true);
		});
	});

	describe("Ticket 02: TTL and status freshness evaluator", () => {
		it("preserves authoritative 30-minute status TTL", () => {
			expect(ROAD_STATUS_TTL_MS).toBe(30 * 60 * 1000);
		});

		it("evaluates null or missing updates as unconfirmed/unknown and isStale=true", () => {
			const res = evaluateEffectiveRoadStatus(null);
			expect(res.effectiveStatus).toBe("unconfirmed");
			expect(res.rawStatus).toBe("unknown");
			expect(res.isStale).toBe(true);
			expect(res.observedAt).toBeNull();
			expect(res.expiresAt).toBeNull();
		});

		it("marks status as fresh when observed within TTL", () => {
			const baseTime = new Date("2026-11-09T10:00:00Z");
			const observedAt = new Date("2026-11-09T09:45:00Z"); // 15 min ago
			const expiresAt = new Date(observedAt.getTime() + ROAD_STATUS_TTL_MS); // expires 10:15:00Z

			const res = evaluateEffectiveRoadStatus(
				{
					status: "closed",
					observedAt,
					expiresAt,
					updatedBy: "user_officer_1",
				},
				baseTime,
			);

			expect(res.effectiveStatus).toBe("closed");
			expect(res.rawStatus).toBe("closed");
			expect(res.isStale).toBe(false);
			expect(res.observedAt).toBe(observedAt.toISOString());
			expect(res.expiresAt).toBe(expiresAt.toISOString());
		});

		it("marks status as unconfirmed immediately upon exact expiration", () => {
			const observedAt = new Date("2026-11-09T09:30:00Z");
			const expiresAt = new Date("2026-11-09T10:00:00Z"); // exact 30 min

			// Just before expiry (1 second before)
			const beforeRes = evaluateEffectiveRoadStatus(
				{
					status: "open",
					observedAt,
					expiresAt,
					updatedBy: "user_officer_1",
				},
				new Date("2026-11-09T09:59:59Z"),
			);
			expect(beforeRes.effectiveStatus).toBe("open");
			expect(beforeRes.isStale).toBe(false);

			// At exact expiry
			const exactRes = evaluateEffectiveRoadStatus(
				{
					status: "open",
					observedAt,
					expiresAt,
					updatedBy: "user_officer_1",
				},
				new Date("2026-11-09T10:00:00Z"),
			);
			expect(exactRes.effectiveStatus).toBe("unconfirmed");
			expect(exactRes.rawStatus).toBe("open");
			expect(exactRes.isStale).toBe(true);

			// After expiry
			const afterRes = evaluateEffectiveRoadStatus(
				{
					status: "open",
					observedAt,
					expiresAt,
					updatedBy: "user_officer_1",
				},
				new Date("2026-11-09T10:05:00Z"),
			);
			expect(afterRes.effectiveStatus).toBe("unconfirmed");
			expect(afterRes.rawStatus).toBe("open");
			expect(afterRes.isStale).toBe(true);
		});

		it("never automatically converts expired closed or intermittent to open", () => {
			const observedAt = new Date("2026-11-09T08:00:00Z");
			const expiresAt = new Date("2026-11-09T08:30:00Z");
			const wayLater = new Date("2026-11-09T12:00:00Z");

			const closedRes = evaluateEffectiveRoadStatus(
				{
					status: "closed",
					observedAt,
					expiresAt,
					updatedBy: "user_officer_1",
				},
				wayLater,
			);
			expect(closedRes.effectiveStatus).toBe("unconfirmed");
			expect(closedRes.effectiveStatus).not.toBe("open");
			expect(closedRes.isStale).toBe(true);

			const intermittentRes = evaluateEffectiveRoadStatus(
				{
					status: "intermittent",
					observedAt,
					expiresAt,
					updatedBy: "user_officer_1",
				},
				wayLater,
			);
			expect(intermittentRes.effectiveStatus).toBe("unconfirmed");
			expect(intermittentRes.effectiveStatus).not.toBe("open");
			expect(intermittentRes.isStale).toBe(true);
		});
	});
});
