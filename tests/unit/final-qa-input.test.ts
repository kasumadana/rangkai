import { describe, expect, it } from "vitest";
import { shouldLoadCleanupTasks, validateCleanupPhoto } from "../../src/react-app/lib/cleanup-input";
import { catalogVisibility, roadDetails } from "../../src/react-app/features/map/road-details";
describe("final QA regressions", () => {
 it("loads cleanup data on the shared field event view for dual-permission officers", () => {
  expect(shouldLoadCleanupTasks("/field/events/123", false, true)).toBe(true);
  expect(shouldLoadCleanupTasks("/field/events/123", false, false)).toBe(false);
  expect(shouldLoadCleanupTasks("/field/events/123/cleanup/task", false, true)).toBe(true);
 });
 it("accepts JPEG/PNG only and enforces the backend's 5 MB boundary", () => {
  for (const type of ["image/jpeg", "image/png"]) expect(() => validateCleanupPhoto({ type, size: 5 * 1024 * 1024 })).not.toThrow();
  for (const photo of [{ type: "image/webp", size: 10 }, { type: "image/png", size: 0 }, { type: "image/png", size: 5 * 1024 * 1024 + 1 }]) expect(() => validateCleanupPhoto(photo)).toThrow();
 });
 it("hides catalog geometry when drawing and in operational mode, restores it in catalog mode", () => {
  expect(catalogVisibility("draw")).toBe("none");
  expect(catalogVisibility("operational")).toBe("none");
  expect(catalogVisibility("catalog")).toBe("visible");
 });
 it("uses actual road name and WITA schedule without treating an expired open as current", () => {
  const text = roadDetails({ segment: { id: "synthetic", displayName: "SYNTHETIC Jalan Uji", coverageArea: "Uji" }, impactType: "closure", plannedFrom: "2026-11-13T00:00:00Z", plannedTo: null, operationalStatus: { effectiveStatus: "open", rawStatus: "open", isStale: false, observedAt: null, expiresAt: "2020-01-01T00:00:00Z" } });
  expect(text).toContain("SYNTHETIC Jalan Uji");
  expect(text).toContain("08.00 WITA");
  expect(text).toContain("Selesai: Belum ditetapkan");
  expect(text).toContain("Status: Belum terkonfirmasi");
 });
});
