import { test, expect } from "@playwright/test";

test("anonymous visitor sees reviewed help and its link", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
 await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 await page.route("**/api/public/assistant/questions", route => route.fulfill({ json: { status: "answered", intent: "help", answer: "Panduan penggunaan Rangkai:", searchUrl: "/events", sources: [{ sourceId: "help:location", kind: "help", title: "Melihat lokasi Anda", url: "/peta", answer: "Tekan tombol lokasi dan izinkan akses lokasi." }] } }));
 await page.goto("/"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click();
 const dialog = page.getByRole("dialog", { name: "Asisten" });
 await dialog.getByLabel("Pertanyaan").fill("Bagaimana melihat lokasi saya?");
 await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(dialog.getByText("Tekan tombol lokasi dan izinkan akses lokasi.")).toBeVisible();
 await expect(dialog.getByRole("link", { name: "Melihat lokasi Anda" })).toHaveAttribute("href", "/peta");
});

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
 await expect(page.getByRole("button", { name: "Buka chatbot Rangkai" })).toBeFocused();
 const mobileMenu = page.getByRole("button", { name: "Buka menu publik" });
 if (await mobileMenu.isVisible()) {
  await mobileMenu.click();
  await page.getByRole("navigation", { name: "Navigasi publik seluler" }).getByRole("link", { name: "Kegiatan" }).click();
 } else {
  await page.getByRole("navigation", { name: "Navigasi publik", exact: true }).getByRole("link", { name: "Kegiatan" }).click();
 }
 await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click();
 await expect(dialog.getByLabel("Pertanyaan")).toHaveValue("Kapan kegiatan?");
 await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(dialog.getByText("Belum ada informasi")).toBeVisible();
 expect(requests).toBe(1);
 await dialog.getByRole("link", { name: "Cari kegiatan secara manual" }).click();
 await expect(page).toHaveURL(/\/events$/); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click();
 await expect(dialog.getByText("Belum ada informasi")).toBeVisible();
});

test("internal denial stays private and organization change discards late response", async ({ page }) => {
 const org = "11111111-1111-4111-8111-111111111111";
 const event = "22222222-2222-4222-8222-222222222222";
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: "user-1", name: "Test", email: "test@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" } } }));
 await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", village: null, district: null, createdAt: "2026-01-01", role: "organizer" }] } }));
 await page.route("**/api/events?**", route => route.fulfill({ json: { events: [{ id: event, title: "Kegiatan uji", organizationId: org }], pagination: {} } }));
 let posted = false;
 await page.route("**/api/assistant/questions", async route => { posted = true; await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "denied", requestId: "test" } } }).catch(() => {}); });
 await page.goto("/login");
 await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click();
 const dialog = page.getByRole("dialog", { name: "Asisten" });
 await expect(dialog.getByRole("option", { name: "Data internal" })).toBeAttached();
 await dialog.getByLabel("Lingkup").selectOption("internal");
 await dialog.getByLabel("Organisasi").selectOption(org);
 await dialog.getByRole("combobox", { name: "Kegiatan", exact: true }).selectOption(event);
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
  await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click();
  const dialog = page.getByRole("dialog", { name: "Asisten" });
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  await expect(dialog.getByLabel("Pertanyaan")).toBeVisible();
 }
});



for (const variant of ["organizer", "traffic", "cleanup"] as const) {
 test(`internal ${variant} uses selected context and renders scoped source`, async ({ page }) => {
  const org = "11111111-1111-4111-8111-111111111111", event = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: "user-1", name: "Test", email: "test@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" } } }));
  await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", role: variant === "organizer" ? "organizer" : "officer" }] } }));
  await page.route("**/api/events?**", route => route.fulfill({ json: { events: [{ id: event, title: "Kegiatan uji", organizationId: org }], pagination: {} } }));
  await page.route("**/api/field/tasks", route => route.fulfill({ json: { assignments: [{ eventId: event, eventTitle: "Kegiatan uji", organizationId: org }] } }));
  let body: unknown;
  const facts = variant === "cleanup" ? { status: "submitted", dueAt: null, isSimulation: true } : { status: "open", observedAt: "2026-01-01T00:00:00Z", expiresAt: "invalid", isSimulation: true };
  await page.route("**/api/assistant/questions", route => { body = route.request().postDataJSON(); return route.fulfill({ json: { status: "answered", scope: "internal", intent: variant === "cleanup" ? "cleanup_summary" : "road_status", answer: "Lihat sumber", searchUrl: "/events", sources: [{ sourceId: "source:1", title: "Sumber uji", url: "/field/events/22222222-2222-4222-8222-222222222222", kind: variant === "cleanup" ? "cleanup" : "road", facts }] } }); });
  await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click();
  const dialog = page.getByRole("dialog", { name: "Asisten" });
  await dialog.getByLabel("Lingkup").selectOption("internal"); await dialog.getByLabel("Organisasi").selectOption(org);
  await dialog.getByRole("combobox", { name: "Kegiatan", exact: true }).selectOption(event);
  await dialog.getByLabel("Pertanyaan").fill("Apa statusnya?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
  await expect(dialog.getByRole("link", { name: "Sumber uji" })).toBeVisible(); await expect(dialog.getByText(/Simulasi/)).toBeVisible();
  if (variant !== "cleanup") await expect(dialog.getByText(/Belum terkonfirmasi/)).toBeVisible();
  expect(body).toEqual({ question: "Apa statusnya?", organizationId: org, eventId: event });
 });
}

test("invalid response and rate limit allow retry without invented answer", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
 await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 let count = 0;
 await page.route("**/api/public/assistant/questions", route => { count++; return count === 1 ? route.fulfill({ status: 429, json: {} }) : count === 2 ? route.fulfill({ json: { answer: "fake" } }) : route.fulfill({ json: { status: "abstained", intent: "event_lookup", answer: "Tidak tersedia", sources: [], searchUrl: "/events" } }); });
 await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" });
 await dialog.getByLabel("Pertanyaan").fill("Kapan?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(dialog.getByRole("alert")).toContainText("Terlalu banyak"); await dialog.getByRole("button", { name: "Coba lagi" }).click();
 await expect(dialog.getByRole("alert")).toContainText("respons tidak valid"); await dialog.getByRole("button", { name: "Coba lagi" }).click();
 await expect(dialog.getByText("Tidak tersedia")).toBeVisible();
});

test("dialog isolates background and cycles keyboard focus", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null })); await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 await page.goto("/login"); const trigger = page.getByRole("button", { name: "Buka chatbot Rangkai" }); await trigger.focus(); await page.keyboard.press("Enter");
 const dialog = page.getByRole("dialog", { name: "Asisten" }); await expect(dialog).toBeFocused();
 expect(await page.locator("#root").evaluate(node => node.hasAttribute("inert"))).toBe(true);
 await page.keyboard.press("Tab");
 const expand = dialog.getByRole("button", { name: "Perluas" });
 if (await expand.isVisible()) await expect(expand).toBeFocused();
 else await expect(dialog.getByRole("button", { name: "Tutup asisten" })).toBeFocused();
 await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Kirim pertanyaan" })).toBeFocused();
 await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); expect(await page.locator("#root").evaluate(node => node.hasAttribute("inert"))).toBe(false);
});


test("private denial is shown without a public fallback", async ({ page }) => {
 const org = "11111111-1111-4111-8111-111111111111", event = "22222222-2222-4222-8222-222222222222";
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: "user-1", name: "Test", email: "test@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" } } }));
 await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", role: "organizer" }] } }));
 await page.route("**/api/events?**", route => route.fulfill({ json: { events: [{ id: event, title: "Kegiatan uji", organizationId: org }], pagination: {} } }));
 let publicCalls = 0; await page.route("**/api/public/assistant/questions", route => { publicCalls++; return route.abort(); });
 await page.route("**/api/assistant/questions", route => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "denied", requestId: "test" } } }));
 await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" });
 await dialog.getByLabel("Lingkup").selectOption("internal"); await dialog.getByLabel("Organisasi").selectOption(org); await dialog.getByRole("combobox", { name: "Kegiatan", exact: true }).selectOption(event);
 await dialog.getByLabel("Pertanyaan").fill("Status?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(dialog.getByRole("alert")).toContainText("tidak memiliki akses"); expect(publicCalls).toBe(0);
});

test("logout discards delayed private response", async ({ page }) => {
 const org = "11111111-1111-4111-8111-111111111111", event = "22222222-2222-4222-8222-222222222222";
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: "user-1", name: "Test", email: "test@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" } } }));
 await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", role: "organizer" }] } }));
 await page.route("**/api/events?**", route => route.fulfill({ json: { events: [{ id: event, title: "Kegiatan uji", organizationId: org }], pagination: {} } }));
 let posted = false; await page.route("**/api/assistant/questions", async route => { posted = true; await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ json: { status: "answered", scope: "internal", intent: "event_lookup", answer: "PRIVATE LATE", sources: [], searchUrl: "/events" } }).catch(() => {}); });
 await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" });
 await dialog.getByLabel("Lingkup").selectOption("internal"); await dialog.getByLabel("Organisasi").selectOption(org); await dialog.getByRole("combobox", { name: "Kegiatan", exact: true }).selectOption(event); await dialog.getByLabel("Pertanyaan").fill("Status?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect.poll(() => posted).toBe(true); await page.evaluate('window.dispatchEvent(new Event("rangkai:session-changed"))'); await expect(dialog.getByLabel("Lingkup")).toHaveValue("public"); await page.waitForTimeout(700); await expect(dialog.getByText("PRIVATE LATE")).toHaveCount(0);
});

test("map trigger avoids map controls and fits at reflow widths", async ({ page }) => {
 test.setTimeout(90000);
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null })); await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 for (const width of [320, 390, 768, 1440]) {
  await page.setViewportSize({ width, height: 800 }); await page.goto("/peta"); const trigger = page.getByRole("button", { name: "Buka chatbot Rangkai" }); await expect(trigger).toBeVisible();
  const a = await trigger.boundingBox(); const controls = page.locator(".map-floating-controls"); const b = await controls.boundingBox();
  expect(a).not.toBeNull(); expect(a!.x).toBeGreaterThanOrEqual(0); expect(a!.x + a!.width).toBeLessThanOrEqual(width);
  if (b) expect(a!.x + a!.width <= b.x || b.x + b.width <= a!.x || a!.y + a!.height <= b.y || b.y + b.height <= a!.y).toBe(true);
  const statusBar = page.locator(".map-statusbar"); const status = await statusBar.isVisible() ? await statusBar.boundingBox() : null; if (status) expect(a!.x + a!.width <= status.x || status.x + status.width <= a!.x || a!.y + a!.height <= status.y || status.y + status.height <= a!.y).toBe(true);
  await trigger.click(); const dialog = page.getByRole("dialog", { name: "Asisten" }); await expect(dialog).toBeVisible(); await page.screenshot({ path: `test-results/assistant-map-${width}.png` });
 }
});

test("expired session discards an in-flight private response", async ({ page }) => {
 const org = "11111111-1111-4111-8111-111111111111", event = "22222222-2222-4222-8222-222222222222";
 const expiry = new Date(Date.now() + 3500).toISOString();
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: "user-1", name: "Test", email: "test@example.test", emailVerified: true }, session: { id: "session", userId: "user-1", expiresAt: expiry } } }));
 await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", role: "organizer" }] } }));
 await page.route("**/api/events?**", route => route.fulfill({ json: { events: [{ id: event, title: "Kegiatan uji", organizationId: org }], pagination: {} } }));
 let posted = false; await page.route("**/api/assistant/questions", async route => { posted = true; await new Promise(resolve => setTimeout(resolve, 5000)); await route.fulfill({ json: { status: "answered", scope: "internal", intent: "event_lookup", answer: "EXPIRED PRIVATE", sources: [], searchUrl: "/events" } }).catch(() => {}); });
 await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" });
 await dialog.getByLabel("Lingkup").selectOption("internal"); await dialog.getByLabel("Organisasi").selectOption(org); await dialog.getByRole("combobox", { name: "Kegiatan", exact: true }).selectOption(event); await dialog.getByLabel("Pertanyaan").fill("Status?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click(); await expect.poll(() => posted).toBe(true);
 await expect(dialog.getByLabel("Lingkup")).toHaveValue("public", { timeout: 6000 }); await page.waitForTimeout(2500); await expect(dialog.getByText("EXPIRED PRIVATE")).toHaveCount(0);
});

test("200 percent reflow keeps dialog controls reachable", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null })); await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 await page.setViewportSize({ width: 640, height: 900 }); await page.goto("/login"); await page.evaluate('document.documentElement.style.zoom = "2"'); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click();
 const dialog = page.getByRole("dialog", { name: "Asisten" }); await dialog.getByLabel("Pertanyaan").fill("Uji pembesaran"); await expect(dialog.getByRole("button", { name: "Kirim pertanyaan" })).toBeVisible(); await page.screenshot({ path: "test-results/assistant-zoom-200.png" });
});

test("public fresh and expired road statuses retain freshness", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null })); await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 await page.route("**/api/public/assistant/questions", route => route.fulfill({ json: { status: "answered", intent: "road_status", answer: "Lihat sumber", searchUrl: "/events", sources: [
  { sourceId: "road:fresh", publicUrl: "/events/test", title: "Jalan segar", status: "open", eventStatus: "active", isSimulation: false, observedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" },
  { sourceId: "road:expired", publicUrl: "/events/test", title: "Jalan kedaluwarsa", status: "open", eventStatus: "active", isSimulation: false, observedAt: "2026-01-01T00:00:00Z", expiresAt: "2020-01-01T00:00:00Z" }
 ] } }));
 await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" }); await dialog.getByLabel("Pertanyaan").fill("Jalan?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click();
 await expect(dialog.locator("article").filter({ hasText: "Jalan segar" })).toContainText("Terbuka"); await expect(dialog.locator("article").filter({ hasText: "Jalan kedaluwarsa" })).toContainText("Belum terkonfirmasi");
});

test("mobile sheet expands and remains usable with a reduced viewport", async ({ page }) => {
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: null })); await page.route("**/api/organizations/my", route => route.fulfill({ status: 401, json: {} }));
 await page.setViewportSize({ width: 390, height: 800 }); await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" });
 const before = await dialog.boundingBox(); await dialog.getByRole("button", { name: "Perluas" }).click(); const after = await dialog.boundingBox(); expect(after!.height).toBeGreaterThan(before!.height);
 await page.setViewportSize({ width: 390, height: 450 }); await dialog.getByLabel("Pertanyaan").fill("Uji papan ketik"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).scrollIntoViewIfNeeded(); await expect(dialog.getByRole("button", { name: "Kirim pertanyaan" })).toBeInViewport();
});

test("account change clears private history", async ({ page }) => {
 const org = "11111111-1111-4111-8111-111111111111", event = "22222222-2222-4222-8222-222222222222"; let account = "user-1";
 await page.clock.install(); await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: account, name: "Test", email: "test@example.test", emailVerified: true }, session: { id: account, userId: account, expiresAt: "2099-01-01T00:00:00Z" } } }));
 await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", role: "organizer" }] } })); await page.route("**/api/events?**", route => route.fulfill({ json: { events: [{ id: event, title: "Kegiatan uji", organizationId: org }], pagination: {} } }));
 await page.route("**/api/assistant/questions", route => route.fulfill({ json: { status: "answered", scope: "internal", intent: "event_lookup", answer: "PRIVATE ACCOUNT ONE", sources: [], searchUrl: "/events" } }));
 await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" }); await dialog.getByLabel("Lingkup").selectOption("internal"); await dialog.getByLabel("Organisasi").selectOption(org); await dialog.getByRole("combobox", { name: "Kegiatan", exact: true }).selectOption(event); await dialog.getByLabel("Pertanyaan").fill("Status?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click(); await expect(dialog.getByText("PRIVATE ACCOUNT ONE")).toBeVisible();
 account = "user-2"; await page.clock.fastForward(31000); await page.evaluate('document.dispatchEvent(new Event("visibilitychange"))'); await expect(dialog.getByLabel("Lingkup")).toHaveValue("public"); await expect(dialog.getByText("PRIVATE ACCOUNT ONE")).toHaveCount(0);
});



test("account change discards a pending private response", async ({ page }) => {
 const org = "11111111-1111-4111-8111-111111111111", event = "22222222-2222-4222-8222-222222222222"; let account = "user-1"; let release: (() => void) | undefined; let posted = false;
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: account, name: "Test", email: "test@example.test", emailVerified: true }, session: { id: account, userId: account, expiresAt: "2099-01-01T00:00:00Z" } } }));
 await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: org, name: "Organisasi", role: "organizer" }] } })); await page.route("**/api/events?**", route => route.fulfill({ json: { events: [{ id: event, title: "Kegiatan uji", organizationId: org }], pagination: {} } }));
 await page.route("**/api/assistant/questions", async route => { posted = true; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ json: { status: "answered", scope: "internal", intent: "event_lookup", answer: "LATE ACCOUNT ONE", sources: [], searchUrl: "/events" } }).catch(() => {}); });
 await page.goto("/login"); await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); const dialog = page.getByRole("dialog", { name: "Asisten" }); await dialog.getByLabel("Lingkup").selectOption("internal"); await dialog.getByLabel("Organisasi").selectOption(org); await dialog.getByRole("combobox", { name: "Kegiatan", exact: true }).selectOption(event); await dialog.getByLabel("Pertanyaan").fill("Status?"); await dialog.getByRole("button", { name: "Kirim pertanyaan" }).click(); await expect.poll(() => posted).toBe(true);
 account = "user-2"; await page.evaluate('document.dispatchEvent(new Event("visibilitychange"))'); await expect(dialog.getByLabel("Lingkup")).toHaveValue("public"); release?.(); await expect(dialog.getByText("LATE ACCOUNT ONE")).toHaveCount(0);
});
