import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DbClient } from "../../src/db";
import { routeEvidence } from "../../src/worker/services/assistant-route-evidence";
import { validateSelection } from "../../src/worker/services/public-assistant";

const a = [115.216, -8.65], b = [115.26, -8.69];
const geocode = (point: number[], label: string) => Response.json({ features: [{ geometry: { type: "Point", coordinates: point }, properties: { label } }] });
const directions = () => Response.json({ features: [{ geometry: { type: "LineString", coordinates: [a, b] } }] });
const row = { id: "impact", title: "Jalan sintetis", slug: "synthetic", eventStatus: "active", isSimulation: true, startsAt: "2030-01-01T01:00:00Z", endsAt: "2030-01-01T03:00:00Z", status: "open", observedAt: "2020-01-01T00:00:00Z", expiresAt: "2020-01-01T01:00:00Z" };
function setup(rows: unknown[] = [row]) {
 const calls: Array<{ sql: string; params: unknown[] }> = [];
 const db = { execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => { calls.push(new PgDialect().sqlToQuery(query)); return { rows }; } } as unknown as DbClient;
 const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("geocode") ? String(url).includes("Ubung") ? geocode(a, "Ubung, Denpasar, Bali") : geocode(b, "Sanur, Denpasar, Bali") : directions());
 vi.stubGlobal("fetch", fetcher);
 return { db, fetcher, calls };
}
afterEach(() => vi.unstubAllGlobals());
describe("route evidence", () => {
 it("routes Ubung to Sanur and queries all eligible intersecting roads, preserving simulation and expiry", async () => {
  const { db, calls, fetcher } = setup(); const result = await routeEvidence(db, "Ubung", "Sanur", "synthetic");
  expect(result.kind).toBe("success"); if (result.kind !== "success") throw new Error("expected success");
  expect(result.rows[0]).toMatchObject({ status: "unconfirmed", isSimulation: true, publicUrl: "/events/synthetic", title: "Jalan sintetis" });
  expect(calls[0].sql).toMatch(/ST_Intersects/); expect(calls[0].sql).toMatch(/verified_by/); expect(calls[0].sql).toMatch(/has_operational_authority/); expect(calls[0].sql).toMatch(/quarantined_at IS NULL/);
  expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it("returns no claims when no road intersects or observation is absent", async () => {
  const { db } = setup([]); expect(await routeEvidence(db, "Ubung", "Sanur", "synthetic")).toMatchObject({ kind: "success", rows: [] });
  const other = setup([{ ...row, status: "open", observedAt: null, expiresAt: "2099-01-01T00:00:00Z" }]); expect(await routeEvidence(other.db, "Ubung", "Sanur", "synthetic")).toMatchObject({ rows: [{ status: "unconfirmed", observedAt: null }] });
 });
 it("rejects ambiguous, invalid and unavailable places or routes", async () => {
  const { db } = setup();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ features: [{ geometry: { type: "Point", coordinates: a }, properties: { label: "Ubung" } }, { geometry: { type: "Point", coordinates: b }, properties: { label: "Ubung" } }] })));
  expect((await routeEvidence(db, "Ubung", "Sanur", "synthetic")).kind).toBe("ambiguous");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ features: [{ geometry: { type: "Point", coordinates: [1, 2] }, properties: { label: "Ubung" } }] })));
  expect((await routeEvidence(db, "Ubung", "Sanur", "synthetic")).kind).toBe("unavailable");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect((await routeEvidence(db, "Ubung", "Sanur", "synthetic")).kind).toBe("unavailable");
 });
 it("rejects invented model locations", () => {
  expect(validateSelection({ intent: "route_help", sourceIds: [], origin: "Kuta", destination: "Sanur" }, [], "dari Ubung ke Sanur")).toBeNull();
  expect(validateSelection({ intent: "route_help", sourceIds: [], origin: "Ubung", destination: "Sanur" }, [], "dari Ubung ke Sanur")).not.toBeNull();
 });
});
