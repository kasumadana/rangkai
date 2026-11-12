import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbClient } from "../../db";
import { freshRoadStatus } from "./public-assistant";

type Point = [number, number];
const point = z.tuple([z.number().finite().min(114.2).max(115.85), z.number().finite().min(-8.95).max(-8)]);
const geocoder = z.object({ features: z.array(z.object({ geometry: z.object({ type: z.literal("Point"), coordinates: point }), properties: z.object({ label: z.string().min(1).max(300) }) })).max(5) });
const route = z.object({ features: z.array(z.object({ geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(point).min(2).max(20000) }) })).length(1) });

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 8000);
 try {
  const response = await fetch(url, { ...init, signal: controller.signal, redirect: "error" });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 1_000_000) throw new Error("provider unavailable");
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("provider response too large");
  return JSON.parse(text) as unknown;
 } finally { clearTimeout(timer); }
}

async function resolvePlace(place: string, key: string): Promise<{ point: Point; label: string } | null> {
 const query = new URLSearchParams({ text: place, size: "5", "boundary.rect.min_lon": "114.2", "boundary.rect.min_lat": "-8.95", "boundary.rect.max_lon": "115.85", "boundary.rect.max_lat": "-8" });
 const body = geocoder.safeParse(await fetchJson(`https://api.openrouteservice.org/geocode/search?${query}`, { headers: { Authorization: key } }));
 if (!body.success) throw new Error("invalid provider response");
 if (body.data.features.length !== 1) return null;
 const result = body.data.features[0];
 if (!result.properties.label.normalize("NFKC").toLocaleLowerCase("id-ID").includes(place.normalize("NFKC").toLocaleLowerCase("id-ID"))) return null;
 return { point: result.geometry.coordinates, label: result.properties.label };
}

function distance(a: Point, b: Point): number {
 const rad = Math.PI / 180; const dLat = (a[1] - b[1]) * rad; const dLon = (a[0] - b[0]) * rad;
 const value = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
 return 12742000 * Math.asin(Math.sqrt(Math.min(1, value)));
}

export async function routeEvidence(db: DbClient, origin: string, destination: string, key: string) {
 try {
  const [a, b] = await Promise.all([resolvePlace(origin, key), resolvePlace(destination, key)]);
  if (!a || !b || distance(a.point, b.point) < 50) return { kind: "ambiguous" as const };
  const result = route.safeParse(await fetchJson("https://api.openrouteservice.org/v2/directions/driving-car/geojson", { method: "POST", headers: { Authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ coordinates: [a.point, b.point], instructions: false }) }));
  if (!result.success) return { kind: "unavailable" as const };
  const coordinates = result.data.features[0].geometry.coordinates;
  if (distance(a.point, coordinates[0]) > 1000 || distance(b.point, coordinates[coordinates.length - 1]) > 1000) return { kind: "unavailable" as const };
  const geometry = JSON.stringify({ type: "LineString", coordinates });
  const resultRows = await db.execute(sql`
   SELECT ri.id AS "id", rs.display_name AS "title", e.public_slug AS "slug", e.status AS "eventStatus", e.is_simulation AS "isSimulation", ri.planned_from AS "startsAt", ri.planned_to AS "endsAt", latest.status AS "status", latest.observed_at AS "observedAt", latest.expires_at AS "expiresAt"
   FROM road_impacts ri JOIN events e ON e.id = ri.event_id JOIN organizations o ON o.id = e.organization_id JOIN road_segments rs ON rs.id = ri.road_segment_id
   LEFT JOIN LATERAL (SELECT status, observed_at, expires_at FROM road_status_updates WHERE road_impact_id = ri.id ORDER BY observed_at DESC, created_at DESC LIMIT 1) latest ON true
   WHERE e.status IN ('published', 'active') AND e.public_slug IS NOT NULL AND (e.is_simulation IS DISTINCT FROM FALSE OR o.has_operational_authority = TRUE)
    AND ((rs.source_type = 'catalog' AND rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL) OR (e.is_simulation AND rs.source_type = 'simulation_draft' AND rs.organization_id = e.organization_id))
    AND rs.quarantined_at IS NULL AND ST_Intersects(rs.geom, ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326))
   ORDER BY ri.planned_from, ri.id LIMIT 101
  `);
  const stamp = (v: unknown): string | null => { if (v == null) return null; const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
  const rows = resultRows.rows.slice(0, 100).map(row => ({ sourceId: `road:${String(row.id)}`, publicUrl: `/events/${encodeURIComponent(String(row.slug))}`, title: String(row.title), eventStatus: String(row.eventStatus), isSimulation: row.isSimulation !== false, startsAt: stamp(row.startsAt), endsAt: stamp(row.endsAt), status: stamp(row.observedAt) && Date.parse(stamp(row.observedAt)!) <= Date.now() ? freshRoadStatus(String(row.status), stamp(row.expiresAt)) : "unconfirmed", observedAt: stamp(row.observedAt), expiresAt: stamp(row.expiresAt) }));
  return { kind: "success" as const, rows, truncated: resultRows.rows.length > 100, originLabel: a.label, destinationLabel: b.label };
 } catch { return { kind: "unavailable" as const }; }
}
