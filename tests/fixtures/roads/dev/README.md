# Synthetic Road Catalog Fixtures (`SYNTHETIC_TEST_DATA`)

> **MANDATORY INVARIANT (AGENTS.md §13, user-update.md):**  
> All features in this directory are synthetic development geometries.  
> **NEVER** mark synthetic geometry as verified in production.  
> **NEVER** expose synthetic road data as operational public closures.  
> Real pilot dataset acceptance is deferred pending C03 delivery from Okta/Oktazz.

## Purpose

These fixtures provide deterministic GeoJSON LineString coordinates in the Sanur / Denpasar pilot area to test:
- Bounding box spatial intersection (`ST_Intersects` on PostGIS LINESTRING SRID 4326).
- Coordinate order (`[longitude, latitude]`).
- Verification gate enforcement (unverified roads cannot be published).
- Planned impacts association with real PostGIS geometries.

## Schema for Future C03 Import

Genuine C03 pilot road data must include:
- `id`: UUID
- `displayName`: Official street/segment name (e.g., "Jl. Danau Tamblingan")
- `coverageArea`: Sub-district / village name (e.g., "Sanur")
- `geometry`: GeoJSON LineString with SRID 4326 coordinates
- `provenance`: Surveyor / authority source
- `verifiedBy`: Authorized reviewer user ID
- `verifiedAt`: ISO 8601 timestamp of human verification
