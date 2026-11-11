import { test, expect } from "@playwright/test";

test("synthetic answers, abstention and unavailable state", async ({ page }) => {
 const errors: string[] = [];
 page.on("pageerror", error => errors.push(error.message));
 let mode = 0;
 await page.route("**/api/public/assistant/questions", async route => {
  if (mode === 2) return route.fulfill({ status: 503, json: { error: { code: "FEATURE_DISABLED", message: "disabled", requestId: "test" } } });
  return route.fulfill({ json: mode === 0 ? { status: "answered", intent: "road_status", answer: "Data sintetis", searchUrl: "/events", sources: [{ sourceId: "road:synthetic", publicUrl: "/events/synthetic", title: "Jalan sintetis", eventStatus: "active", status: "CLOSED", isSimulation: true, observedAt: "2020-01-01T00:00:00Z", expiresAt: "2020-01-02T00:00:00Z" }] } : { status: "abstained", intent: "out_of_scope", answer: "Informasi belum tersedia", sources: [], searchUrl: "/events" } });
 });
 await page.goto("/tanya");
 await page.getByLabel("Pertanyaan").fill("Apa kondisi jalan?");
 await page.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(page.getByText("Jalan sintetis")).toBeVisible();
 await expect(page.getByText(/Simulasi.*belum terkonfirmasi/)).toBeVisible();
 mode = 1; await page.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(page.getByText("Belum dapat menjawab")).toBeVisible();
 mode = 2; await page.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(page.getByText(/Layanan tanya jawab sedang tidak tersedia/)).toBeVisible();
 await expect(page.getByRole("link", { name: "Cari kegiatan", exact: true })).toBeVisible();
 for (const width of [320, 390, 1280]) {
  await page.setViewportSize({ width, height: 800 });
  await page.screenshot({ path: `test-results/assistant-synthetic-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
 }
 expect(errors).toEqual([]);
});
