import { expect, test } from "@playwright/test";

test("event map panel remains readable and reachable at mobile and desktop widths", async ({ page }) => {
 await page.addInitScript(() => { sessionStorage.setItem("rangkai:preloader-shown:peta", "1"); });
 await page.route("**/api/**", route => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/auth/get-session") return route.fulfill({ json: null });
  if (path === "/api/public/events") return route.fulfill({ json: { events: [{ id: "event-1", slug: "simulasi", title: "Kegiatan simulasi dengan nama panjang", category: null, description: null, venueName: "Lokasi kegiatan", venueLocation: { type: "Point", coordinates: [115.22, -8.65] }, startsAt: "2030-01-01T01:00:00Z", endsAt: "2030-01-01T03:00:00Z", status: "published", publishedAt: null, organizationName: "Desa", village: "Denpasar", district: "Denpasar", isSimulation: true }], pagination: { page: 1, total: 1, totalPages: 1 } } });
  if (path.endsWith("/roads")) return route.fulfill({ json: { roads: [], isSimulation: true } });
  if (path.endsWith("/alternative-routes")) return route.fulfill({ json: { routes: [] } });
  if (path.includes("road-impacts")) return route.fulfill({ json: { type: "FeatureCollection", features: [] } });
  return route.fulfill({ status: 401, json: {} });
 });
 for (const width of [320, 390, 768, 1280]) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/peta?event=simulasi");
  const panel = page.getByLabel("Rincian Upacara & Ruas Jalan Terdampak");
  await expect(panel.getByRole("heading", { name: "Kegiatan simulasi dengan nama panjang" })).toBeVisible();
  await expect(panel.getByText("SIMULASI", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buka chatbot Rangkai" })).toBeHidden();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  await panel.getByRole("button", { name: "Tutup Panel" }).click();
  await expect(panel).not.toBeInViewport();
  await expect(page.getByRole("button", { name: "Buka chatbot Rangkai" })).toBeVisible();
 }
});

test("an event without venue coordinates has no fabricated map pin", async ({ page }) => {
 await page.addInitScript(() => { sessionStorage.setItem("rangkai:preloader-shown:peta", "1"); });
 await page.route("**/api/**", route => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/public/events") return route.fulfill({ json: { events: [{ id: "event-old", slug: "lama", title: "Kegiatan lama", category: null, description: null, venueName: "Lokasi lama", venueLocation: null, startsAt: null, endsAt: null, status: "published", publishedAt: null, organizationName: "Desa", village: "Denpasar", district: "Denpasar", isSimulation: true }], pagination: { page: 1, total: 1, totalPages: 1 } } });
  if (path.endsWith("/roads")) return route.fulfill({ json: { roads: [], isSimulation: true } });
  if (path.endsWith("/alternative-routes")) return route.fulfill({ json: { alternativeRoutes: [] } });
  if (path.includes("road-impacts")) return route.fulfill({ json: { type: "FeatureCollection", features: [] } });
  if (path === "/api/auth/get-session") return route.fulfill({ json: null });
  return route.fulfill({ status: 401, json: {} });
 });
 await page.goto("/peta?event=lama");
 await expect(page.getByRole("heading", { name: "Kegiatan lama" })).toBeVisible();
 await expect(page.locator('[aria-label^="Lokasi acara:"]')).toHaveCount(0);
});
