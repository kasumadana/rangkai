import { expect, test, type Page } from "@playwright/test";
import type { Map as MapLibreMap } from "maplibre-gl";

const eventId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const taskId = "44444444-4444-4444-8444-444444444444";
const event = { id: eventId, organizationId: orgId, title: "Kegiatan sintetis", category: "upacara_adat", venueName: "Lokasi", startsAt: "2030-01-01T01:00:00Z", endsAt: "2030-01-01T03:00:00Z", status: "active", isSimulation: true };
const task = { id: taskId, eventId, title: "Tugas sintetis", status: "in_progress", description: null, location: null, assignedUserId: "user", dueAt: null, verifiedBy: null, verifiedAt: null, createdAt: "2030-01-01T00:00:00Z", updatedAt: "2030-01-01T00:00:00Z" };

async function fieldSetup(page: Page) {
 await page.addInitScript(() => sessionStorage.setItem("rangkai:preloader-shown", "1"));
 await page.route("**/api/**", route => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/auth/get-session") return route.fulfill({ json: { user: { id: "user", name: "Petugas", email: "test@example.test" }, session: { id: "session", userId: "user", expiresAt: "2035-01-01" } } });
  if (path === "/api/organizations/my") return route.fulfill({ json: { organizations: [{ id: orgId, name: "Desa sintetis", role: "officer" }] } });
  if (path === `/api/events/${eventId}`) return route.fulfill({ json: { event } });
  if (path === `/api/field/events/${eventId}`) return route.fulfill({ json: { event, permissions: { isOrganizer: false, canUpdateTraffic: true, canUpdateCleanup: true }, roadImpacts: [], cleanupTasks: [task] } });
  if (path === `/api/events/${eventId}/cleanup-tasks`) return route.fulfill({ json: { cleanupTasks: [task] } });
  return route.fulfill({ json: { events: [], pagination: { page: 1, total: 0, totalPages: 0 }, roadImpacts: [], cleanupTasks: [], wasteRecords: [], items: [] } });
 });
}

test("rendered map line and marker expose stored details; drawing hides catalog and keeps preview", async ({ page }) => {
 await page.route("**/tile.openstreetmap.org/**", route => route.abort());
 await page.goto("/tests/e2e/fixtures/road-map-harness.html");
 await expect(page.locator(".maplibregl-canvas")).toBeVisible();
 await page.waitForFunction(() => { const map = (globalThis as unknown as { testMap: MapLibreMap }).testMap; return Boolean(map?.getLayer("dashboard-impacts-line")); });
 await expect.poll(() => page.evaluate(() => { const map = (globalThis as unknown as { testMap: MapLibreMap }).testMap; return map.queryRenderedFeatures({ layers: ["dashboard-impacts-line"] }).length; }), { timeout: 15000 }).toBeGreaterThan(0);
 await expect.poll(() => page.evaluate(() => (globalThis as unknown as { testMap: MapLibreMap }).testMap.queryRenderedFeatures({ layers: ["dashboard-catalog-line"] }).length)).toBeGreaterThan(0);
 const clickLine = async () => {
  const point = await page.evaluate(() => { const map = (globalThis as unknown as { testMap: MapLibreMap }).testMap; const p = map.project([115.216, -8.6559]); return { x: p.x, y: p.y }; });
  await page.locator(".maplibregl-canvas").click({ position: point });
 };
 await clickLine();
 const popup = page.locator(".maplibregl-popup-content").last();
 await expect(popup).toContainText("Jalan Dampak Sintetis");
 await expect(popup).toContainText("Dampak: Penutupan");
 await expect(popup).toContainText("Status: Ditutup");
 await expect(popup).toContainText("Berlaku hingga: 1 Jan 2099, 08.00 WITA");
 await expect(popup).toContainText("09.00 WITA");
 await expect(popup).toContainText("11.30 WITA");
 await page.locator(".maplibregl-popup-close-button").last().click();
 const catalogPoint = await page.evaluate(() => { const p = (globalThis as unknown as { testMap: MapLibreMap }).testMap.project([115.216, -8.6548]); return { x: p.x, y: p.y }; });
 await page.locator(".maplibregl-canvas").click({ position: catalogPoint });
 await expect(page.locator(".maplibregl-popup-content").last()).toContainText("Jalan Dampak Sintetis");
 await expect(page.locator(".maplibregl-popup-content").last()).toContainText("11.30 WITA");
 await page.locator(".maplibregl-popup-close-button").last().click();
 await page.getByRole("button", { name: "Jalan Dampak Sintetis" }).click();
 await expect(page.locator(".maplibregl-popup-content").last()).toContainText("09.00 WITA");
 await page.getByRole("tab", { name: /Tandai Titik Jalan/ }).click();
 await expect.poll(() => page.evaluate(() => (globalThis as unknown as { testMap: MapLibreMap }).testMap.getLayoutProperty("dashboard-catalog-line", "visibility"))).toBe("none");
 const canvas = page.locator(".maplibregl-canvas");
 await canvas.click({ position: { x: 160, y: 150 } });
 await canvas.click({ position: { x: 260, y: 150 } });
 await expect(page.getByText(/2 titik ditandai/)).toBeVisible();
 await expect.poll(() => page.evaluate(() => { const map = (globalThis as unknown as { testMap: MapLibreMap }).testMap; return map.queryRenderedFeatures([[155, 140], [265, 160]], { layers: ["dashboard-drawn-line"] }).length; })).toBeGreaterThan(0);
 await expect.poll(() => page.evaluate(() => { const map = (globalThis as unknown as { testMap: MapLibreMap }).testMap; return map.queryRenderedFeatures({ layers: ["dashboard-catalog-line"] }).length; })).toBe(0);
});

test("dual-permission officer gets cleanup tasks and can retry failed photo uploads", async ({ page }) => {
 await fieldSetup(page);
 let attempts = 0; const stages: string[] = [];
 await page.route(`**/api/cleanup-tasks/${taskId}/evidence`, async route => {
  attempts++; const data = route.request().postData() || ""; stages.push(data.includes("after") ? "after" : "before");
  if (attempts === 1) return route.fulfill({ status: 503, json: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Penyimpanan sintetis gagal", requestId: "test" } } });
  return route.fulfill({ json: { evidence: { id: `evidence-${attempts}` } } });
 });
 const cleanupRequest = page.waitForRequest(request => request.url().includes(`/api/events/${eventId}/cleanup-tasks`) && request.method() === "GET");
 await page.goto(`/field/events/${eventId}/traffic`); await cleanupRequest;
 await page.goto(`/field/events/${eventId}/cleanup`);
 await expect(page.getByText("Tugas sintetis").first()).toBeVisible();
 const panel = page.locator('[data-dirty-group="evidence"]');
 await panel.locator("select").first().selectOption(taskId);
 await panel.locator("select").nth(1).selectOption("before");
 const file = panel.locator('input[type="file"]');
 const photo = { name: "uji.png", mimeType: "image/png", buffer: Buffer.from("synthetic image") };
 await file.setInputFiles({ name: "uji.webp", mimeType: "image/webp", buffer: Buffer.from("synthetic") });
 await expect(page.getByRole("alert")).toContainText("JPEG atau PNG"); expect(attempts).toBe(0);
 await file.setInputFiles({ name: "kosong.png", mimeType: "image/png", buffer: Buffer.alloc(0) }); await expect(page.getByRole("alert")).toContainText("Foto kosong"); expect(attempts).toBe(0);
 await file.setInputFiles({ name: "besar.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }); await expect(page.getByRole("alert")).toContainText("maksimal 5 MB"); expect(attempts).toBe(0);
 await file.setInputFiles(photo); await expect(page.getByRole("alert")).toContainText("Penyimpanan sintetis gagal");
 await file.setInputFiles(photo); await expect(page.getByRole("status").filter({ hasText: '"BEFORE"' })).toBeVisible();
 await panel.locator("select").nth(1).selectOption("after"); await file.setInputFiles(photo);
 await expect(page.getByRole("status").filter({ hasText: '"AFTER"' })).toBeVisible();
 expect(attempts).toBe(3); expect(stages).toEqual(["before", "before", "after"]);
});
