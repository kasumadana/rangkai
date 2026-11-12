import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { assertDevBranch, resolveDatabaseUrl } from "../../src/db/guard";
import { getDb } from "../../src/db";

describe("route evidence PostGIS geometry", () => {
 beforeAll(async () => { await assertDevBranch(); });
 it("detects crossing, shared endpoints and collinear overlaps, but not separated lines", async () => {
  const db = getDb(resolveDatabaseUrl());
  const result = await db.execute(sql`SELECT
   ST_Intersects(ST_GeomFromText('LINESTRING(115.2 -8.6,115.3 -8.7)', 4326), ST_GeomFromText('LINESTRING(115.2 -8.7,115.3 -8.6)', 4326)) AS crossing,
   ST_Intersects(ST_GeomFromText('LINESTRING(115.2 -8.6,115.3 -8.7)', 4326), ST_GeomFromText('LINESTRING(115.3 -8.7,115.4 -8.6)', 4326)) AS endpoint,
   ST_Intersects(ST_GeomFromText('LINESTRING(115.2 -8.6,115.3 -8.6)', 4326), ST_GeomFromText('LINESTRING(115.25 -8.6,115.35 -8.6)', 4326)) AS collinear,
   ST_Intersects(ST_GeomFromText('LINESTRING(115.2 -8.6,115.3 -8.6)', 4326), ST_GeomFromText('LINESTRING(115.2 -8.7,115.3 -8.7)', 4326)) AS separate`);
  expect(result.rows[0]).toMatchObject({ crossing: true, endpoint: true, collinear: true, separate: false });
 });
});

it("executes the public intersection query against guarded development PostGIS", async () => {
 const { vi } = await import("vitest");
 const { routeEvidence } = await import("../../src/worker/services/assistant-route-evidence");
 await assertDevBranch();
 const db = getDb(resolveDatabaseUrl());
 const originalFetch = globalThis.fetch;
 vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
  const url = String(request);
  if (!url.startsWith("https://api.openrouteservice.org/")) return originalFetch(request, init);
  if (url.includes("geocode")) { const ubung = url.includes("Ubung"); return Response.json({ features: [{ geometry: { type: "Point", coordinates: ubung ? [115.216, -8.65] : [115.26, -8.69] }, properties: { label: ubung ? "Ubung, Bali" : "Sanur, Bali" } }] }); }
  return Response.json({ features: [{ geometry: { type: "LineString", coordinates: [[115.216, -8.65], [115.26, -8.69]] } }] });
 }));
 try { expect((await routeEvidence(db, "Ubung", "Sanur", "synthetic")).kind).toBe("success"); } finally { vi.unstubAllGlobals(); }
});
