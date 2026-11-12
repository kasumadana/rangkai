import { test, expect } from "@playwright/test";

test("public widget opens from compatibility URL and keeps draft across routes", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
 await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "no", requestId: "test" } } }));
 let requests = 0;
 await page.route("**/api/public/assistant/questions", route => { requests++; return route.fulfill({ json: { status: "abstained", intent: "event_lookup", answer: "Belum ada informasi", sources: [], searchUrl: "/events" } }); });
 await page.goto("/tanya?event=test-event");
 const dialog = page.getByRole("dialog", { name: "Asisten" });
 await expect(dialog).toBeVisible();
 await expect(dialog.getByLabel("Kode kegiatan (opsional)")).toHaveValue("test-event");
 expect(requests).toBe(0);
 await dialog.getByLabel("Pertanyaan").fill("Kapan kegiatan?");
 await page.keyboard.press("Escape");
 await expect(page.getByRole("button", { name: "Asisten" })).toBeFocused();
 await page.getByRole("button", { name: "Asisten" }).click();
 await expect(dialog.getByLabel("Pertanyaan")).toHaveValue("Kapan kegiatan?");
 await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(dialog.getByText("Belum ada informasi")).toBeVisible();
 expect(requests).toBe(1);
});

test("internal denial stays private and organization change discards late response", async ({ page }) => {
 const org = "11111111-1111-4111-8111-111111111111";
 const event = "22222222-2222-4222-8222-222222222222";
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: "user-1", name: "Test", email: "test@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" } } }));
 await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", village: null, district: null, createdAt: "2026-01-01", role: "organizer" }] } }));
 let posted = false;
 await page.route("**/api/assistant/questions", async route => { posted = true; await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "denied", requestId: "test" } } }).catch(() => {}); });
 await page.goto("/login");
 await page.getByRole("button", { name: "Asisten" }).click();
 const dialog = page.getByRole("dialog", { name: "Asisten" });
 await expect(dialog.getByRole("option", { name: "Data internal" })).toBeAttached();
 await dialog.getByLabel("Lingkup").selectOption("internal");
 await dialog.getByLabel("Organisasi").selectOption(org);
 await dialog.getByLabel("ID kegiatan").fill(event);
 await dialog.getByLabel("Pertanyaan").fill("Bagaimana status jalan?");
 await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect.poll(() => posted).toBe(true);
 await page.evaluate('window.dispatchEvent(new CustomEvent("rangkai:organization-changed", { detail: "other" }))');
 await expect(dialog.getByLabel("Lingkup")).toHaveValue("public");
 await expect(dialog.getByText("Konteks tidak ditemukan", { exact: false })).toHaveCount(0);
});

test("widget fits narrow and wide viewports", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
 await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 for (const width of [320, 390, 768, 1440]) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Asisten" }).click();
  const dialog = page.getByRole("dialog", { name: "Asisten" });
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  await expect(dialog.getByLabel("Pertanyaan")).toBeVisible();
 }
});

