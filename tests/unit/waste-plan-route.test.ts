import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppVariables, Env } from "../../src/worker/types";
const { getAccess } = vi.hoisted(() => ({ getAccess: vi.fn() }));
vi.mock("../../src/worker/middleware/assignments", () => ({ getEventAndCheckAccess: getAccess }));
import { advisoryRouter } from "../../src/worker/routes/advisory";
const eventId = "00000000-0000-4000-8000-000000000001";
const body = { estimatedParticipants: 100, durationHours: 24, scenario: { coefficientKgPerParticipantDay: { min: 0.1, max: 0.2, provenance: "synthetic" } } };
function harness() {
 const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
 app.use("*", async (c, next) => { c.set("requestId", "test"); c.set("auth", { api: { getSession: async () => ({ user: { id: "user" }, session: {} }) } } as never); c.set("db", { insert: () => ({ values: async () => undefined }) } as never); await next(); });
 app.route("/", advisoryRouter); return app;
}
function request(data: unknown) { return harness().request(`/events/${eventId}/waste-plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }, {}); }
beforeEach(() => getAccess.mockReset());
describe("waste plan authorization and range", () => {
 it("denies unassigned non-organizers", async () => { getAccess.mockResolvedValue("FORBIDDEN"); expect((await request(body)).status).toBe(403); });
 it("returns explicit range and never a measured forecast", async () => {
  getAccess.mockResolvedValue({ isOrganizer: true, event: { organizationId: "org" } });
  const res = await request(body); expect(res.status).toBe(201); const json = await res.json() as { wastePlan: { output: { forecastKg: null; status: string; scenarioRange: { low: { totalKg: number }; high: { totalKg: number } }; facilities: { suitableMatches: unknown[] } } } };
  expect(json.wastePlan.output.forecastKg).toBeNull(); expect(json.wastePlan.output.status).toBe("insufficient_historical_data");
  expect(json.wastePlan.output.scenarioRange.low.totalKg).toBe(10); expect(json.wastePlan.output.scenarioRange.high.totalKg).toBe(20);
  expect(json.wastePlan.output.facilities.suitableMatches).toEqual([]);
 });
 it("rejects inconsistent legacy fractions before saving", async () => {
  const res = await request({ ...body, organicFraction: 0.8, recyclableFraction: 0.8, residualFraction: 0 }); expect(res.status).toBe(422); expect(getAccess).not.toHaveBeenCalled();
 });
});
