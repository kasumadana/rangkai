import { expect, test, type Page } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
const event = { id, organizationId: org, title: "Kegiatan sintetis", category: "upacara_adat", venueName: "Lokasi", startsAt: "2030-01-01T01:00:00Z", endsAt: "2030-01-01T03:00:00Z", status: "draft", isSimulation: true };
async function setup(page: Page, officer = false) {
 await page.addInitScript(() => sessionStorage.setItem("rangkai:preloader-shown", "1"));
 await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/auth/get-session") return route.fulfill({ json: { user: { id: "user", name: "Pengguna", email: "test@example.test" }, session: { id: "session", userId: "user", expiresAt: "2035-01-01" } } });
  if (path === "/api/organizations/my") return route.fulfill({ json: { organizations: [{ id: org, name: "Desa sintetis", role: officer ? "officer" : "organizer", hasOperationalAuthority: true }] } });
  if (path === "/api/events" && route.request().method() === "POST") return route.fulfill({ json: { event } });
  if (path.endsWith("/extracted-fields")) return route.fulfill({ json: { event } });
  if (path === `/api/events/${id}`) return route.fulfill({ json: { event } });
  if (path === `/api/field/events/${id}`) return route.fulfill({ json: { event, permissions: { isOrganizer: false, canUpdateTraffic: officer, canUpdateCleanup: false }, roadImpacts: [], cleanupTasks: [] } });
  return route.fulfill({ json: { events: [], pagination: { page: 1, total: 0, totalPages: 0 }, roadImpacts: [], segments: [], candidates: [], documents: [], extractions: [], assignments: [], invitations: [], cleanupTasks: [], items: [] } });
 });
}
test("dashboard road map tracks the device location", async ({ page }) => {
 await setup(page);
 await page.addInitScript(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
   watchPosition: (success: (value: unknown) => void) => { setTimeout(() => success({ coords: { longitude: 115.22, latitude: -8.65, accuracy: 12 } }), 0); return 1; },
   clearWatch: () => {},
  } });
 });
 await page.goto(`/dashboard/events/${id}/roads`);
 const start = page.getByRole("button", { name: "Aktifkan pelacakan lokasi" });
 await start.scrollIntoViewIfNeeded(); await start.click();
 await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(1);
	const gps = await page.locator(".teduh-dashboard-map-wrapper .landing-gps-controls").boundingBox();
	const legend = await page.locator(".teduh-dashboard-map-legend").boundingBox();
	if (gps && legend) expect(gps.x + gps.width <= legend.x || legend.x + legend.width <= gps.x || gps.y + gps.height <= legend.y || legend.y + legend.height <= gps.y).toBe(true);
 await page.getByRole("button", { name: "Hentikan pelacakan lokasi" }).click();
 await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(0);
});
test("venue coordinate input explains incomplete coordinates", async ({ page }) => {
 await setup(page); await page.setViewportSize({ width: 320, height: 800 });
 await page.goto("/dashboard/events/new");
 await page.locator("#wizard-org-select").selectOption(org);
 await page.getByRole("button", { name: /Lewati.*Manual/ }).first().click();
 const venue = page.getByRole("region", { name: "Titik lokasi acara" });
 await expect(venue.getByRole("button", { name: "Tampilan Satelit" })).toBeVisible();
 await venue.getByLabel("Bujur (longitude)").fill("115.22");
 await expect(venue.getByText("Lengkapi kedua koordinat")).toBeVisible();
 await venue.getByLabel("Lintang (latitude)").fill("-8.65");
 await expect(venue.getByText(/Titik Terpilih/)).toBeVisible();
 await venue.getByRole("button", { name: "Hapus titik lokasi" }).click();
 await expect(venue.getByText("Titik lokasi belum ditentukan")).toBeVisible();
 expect(await page.evaluate(() => { const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return browser.document.documentElement.scrollWidth <= browser.innerWidth; })).toBe(true);
});
for (const width of [320, 390, 768, 1440]) test(`new event stays in wizard at ${width}`, async ({ page }) => {
 await setup(page); await page.setViewportSize({ width, height: 900 }); await page.goto("/dashboard/events/new");
 await expect(page.getByText(/Langkah 1 dari 4/)).toBeVisible();
 await page.locator("#wizard-org-select").selectOption(org);
 await page.getByRole("button", { name: /Lewati.*Manual/ }).first().click();
 await expect(page.getByText(/Langkah 2 dari 4/)).toBeVisible();
 const title = page.locator('input').filter({ hasNot: page.locator('[type="hidden"]') }).first();
 // The first text field on the details step is the event title.
 await title.fill("Kegiatan sintetis");
 await page.getByRole("button", { name: "Simpan Rincian" }).click();
 await expect(page.getByText("Draf disimpan")).toBeVisible();
 await expect(page).toHaveURL(/\/dashboard\/events\/new$/);
 await expect(page.getByText(/Langkah 2 dari 4/)).toBeVisible();
 expect(await page.evaluate(() => { const g = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return g.document.documentElement.scrollWidth <= g.innerWidth; })).toBeTruthy();
 await page.screenshot({ path: `test-results/C-wizard-${width}.png`, fullPage: true });
 await page.getByRole("link", { name: "Daftar Upacara" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
 await page.goto("/dashboard/events/new"); await expect(page.getByText(/Langkah 1 dari 4/)).toBeVisible();
});
test("saved routes and field permissions retain context", async ({ page }) => {
 await setup(page, true); await page.goto(`/dashboard/events/${id}`);
 await expect(page.getByText(/Langkah 1 dari 4/)).toHaveCount(0);
 await page.goto(`/dashboard/events/${id}/document`);
 await expect(page.getByText("Unggah Surat Edaran & Ekstraksi AI")).toBeVisible();
 await expect(page.getByText("Periksa & Konfirmasi Rincian Upacara")).toBeHidden();
 await page.goto(`/dashboard/events/${id}/review`);
 await expect(page.getByText("Periksa & Konfirmasi Rincian Upacara")).toBeVisible();
 await page.goto(`/field/events/${id}/cleanup`);
 await expect(page.getByRole("alert").filter({ hasText: "tidak memiliki izin" })).toBeVisible();
 await expect(page.getByRole("link", { name: "Ringkasan Kegiatan" })).toHaveCount(0);
});

test("unsaved wizard blocks links and browser Back, including after failed save", async ({ page }) => {
 await setup(page); await page.goto("/dashboard/events"); await page.goto("/dashboard/events/new");
 await page.locator("#wizard-org-select").selectOption(org);
 await page.getByRole("button", { name: /Lewati.*Manual/ }).first().click();
 await page.getByPlaceholder("Contoh: Karya Pujawali & Prosesi Melasti Pura Dalem Ubud").fill("Belum tersimpan");
 await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); await page.getByRole("dialog", { name: "Asisten" }).getByLabel("Pertanyaan").fill("Draf asisten"); await page.keyboard.press("Escape");
 const backDialog = page.waitForEvent("dialog");
 await page.evaluate(() => (globalThis as unknown as { history: { back: () => void } }).history.back());
 await (await backDialog).dismiss();
 await expect(page).toHaveURL(/\/dashboard\/events\/new$/);
 await expect(page.getByPlaceholder("Contoh: Karya Pujawali & Prosesi Melasti Pura Dalem Ubud")).toHaveValue("Belum tersimpan");
 await page.route("**/api/events", route => route.request().method() === "POST" ? route.fulfill({ status: 500, json: { error: { message: "Gagal sintetis" } } }) : route.fallback());
 await page.getByRole("button", { name: "Simpan Rincian" }).click(); await expect(page.getByText("Belum Dapat Menyimpan")).toBeVisible();
 const linkDialog = page.waitForEvent("dialog"); await page.getByRole("link", { name: "Daftar Upacara" }).click(); await (await linkDialog).dismiss(); await expect(page).toHaveURL(/\/dashboard\/events\/new$/);
 const discardDialog = page.waitForEvent("dialog"); await page.getByRole("link", { name: "Daftar Upacara" }).click(); await (await discardDialog).accept(); await expect(page).toHaveURL(/\/dashboard$/);
 await page.getByRole("button", { name: "Buka chatbot Rangkai" }).click(); await expect(page.getByRole("dialog", { name: "Asisten" }).getByLabel("Pertanyaan")).toHaveValue("Draf asisten");
});

test("AI failure retains wizard and manual entry remains available", async ({ page }) => {
 await setup(page); let createMode: unknown; await page.route("**/api/events", route => { if (route.request().method() !== "POST") return route.fallback(); createMode = route.request().postDataJSON().isSimulation; return route.fulfill({ json: { event } }); });
 await page.route(`**/api/events/${id}/documents`, route => route.fulfill({ json: { document: { id: "doc", originalName: "uji.pdf", sizeBytes: 10 } } }));
 await page.route(`**/api/events/${id}/extractions`, route => route.fulfill({ status: 503, json: { error: { message: "Layanan sintetis gagal" } } }));
 await page.goto("/dashboard/events/new"); await page.locator("#wizard-org-select").selectOption(org);
 await page.locator('select').filter({ has: page.locator('option[value="operational"]') }).selectOption("operational");
 await page.getByRole("checkbox").check();
 await page.locator('input[type="file"]').first().setInputFiles({ name: "uji.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic") });
 await expect(page.getByText(/Ekstraksi AI Tidak Berhasil/)).toBeVisible(); expect(createMode).toBe(false); await expect(page).toHaveURL(/\/dashboard\/events\/new$/);
 await expect(page.locator('select').filter({ has: page.locator('option[value="operational"]') })).toHaveValue("operational");
 await page.getByRole("button", { name: /Lewati.*Manual/ }).first().click(); await expect(page.getByText(/Langkah 2 dari 4/)).toBeVisible();
});

test("organizer membership in another organization grants no field access", async ({ page }) => {
 await setup(page, true); await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: "33333333-3333-4333-8333-333333333333", name: "Organisasi lain", role: "organizer" }] } }));
 await page.goto(`/field/events/${id}/cleanup`); await expect(page.getByRole("alert").filter({ hasText: "tidak memiliki izin" })).toBeVisible();
});

test("saved document extraction carries its result into review", async ({ page }) => {
 await setup(page); await page.route(`**/api/events/${id}/documents`, route => route.fulfill({ json: { document: { id: "doc", originalName: "uji.pdf", sizeBytes: 10 } } }));
 await page.route(`**/api/events/${id}/extractions`, route => route.fulfill({ json: { extraction: { modelName: "synthetic", outputJson: { event_name: { value: "Nama hasil sintetis" } } } } }));
 await page.goto(`/dashboard/events/${id}/document`); await page.getByRole("checkbox", { name: /menyetujui/ }).check();
 await page.locator('input[type="file"]').setInputFiles({ name: "uji.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic") });
 await expect(page.getByText(/Surat berhasil dibaca/)).toBeVisible();
 const dialog = page.waitForEvent("dialog"); await page.getByRole("link", { name: "Periksa rincian" }).click(); await (await dialog).accept();
 await expect(page.getByText("Periksa & Konfirmasi Rincian Upacara")).toBeVisible();
 await expect(page.getByRole("textbox").first()).toHaveValue("Nama hasil sintetis");
});

test("server-confirmed logout clears a dirty wizard without trapping the user", async ({ page }) => {
 await setup(page); await page.route("**/api/auth/sign-out", route => route.fulfill({ json: { success: true } }));
 await page.goto("/dashboard/events/new"); await page.locator("#wizard-org-select").selectOption(org);
 await page.getByRole("button", { name: "Profil" }).click(); await page.getByRole("button", { name: "Keluar" }).click();
 await expect(page).toHaveURL("/");
 expect(await page.evaluate(() => (globalThis as unknown as { sessionStorage: { getItem: (key: string) => string | null } }).sessionStorage.getItem("rangkai:event-wizard-draft-v1"))).toBeNull();
});

test("saved event routes and field views survive direct links and refresh", async ({ page }) => {
 await setup(page); await page.setViewportSize({ width: 390, height: 844 });
 for (const route of [`/dashboard/events/${id}/roads`, `/dashboard/events/${id}/cleanup`, `/dashboard/events/${id}/team`, `/field/events/${id}`]) {
  await page.goto(route); await expect(page.getByRole("heading", { name: "Kegiatan sintetis" }).first()).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: "Kegiatan sintetis" }).first()).toBeVisible();
  expect(await page.evaluate(() => { const g = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return g.document.documentElement.scrollWidth <= g.innerWidth; })).toBeTruthy();
 }
 await page.screenshot({ path: "test-results/C-field-390.png", fullPage: true });
});

test("assigned cleanup task shows context and starting it does not update roads", async ({ page }) => {
 await setup(page, true); const taskId = "44444444-4444-4444-8444-444444444444";
 const task = { id: taskId, eventId: id, title: "Bersihkan area sintetis", status: "todo", description: null, location: null, assignedUserId: "user", dueAt: null, verifiedBy: null, verifiedAt: null, createdAt: "2030-01-01T00:00:00Z", updatedAt: "2030-01-01T00:00:00Z" };
 let roadWrites = 0;
 await page.route(`**/api/field/events/${id}`, route => route.fulfill({ json: { event, permissions: { isOrganizer: false, canUpdateTraffic: false, canUpdateCleanup: true }, roadImpacts: [], cleanupTasks: [task] } }));
 await page.route(`**/api/events/${id}/cleanup-tasks`, route => route.fulfill({ json: { cleanupTasks: [task] } }));
 await page.route(`**/api/cleanup-tasks/${taskId}`, route => route.fulfill({ json: { task: { ...task, status: "in_progress" } } }));
 page.on("request", request => { if (request.method() !== "GET" && request.url().includes("road")) roadWrites++; });
 await page.setViewportSize({ width: 390, height: 900 }); await page.goto(`/field/events/${id}/cleanup/${taskId}`);
 await expect(page.getByRole("heading", { name: /Kegiatan sintetis.*Bersihkan area sintetis/ })).toBeVisible();
 await page.screenshot({ path: "test-results/C2-task-390.png", fullPage: true });
 await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: "test-results/C2-task-1440.png", fullPage: true });
 await page.getByRole("button", { name: "Mulai Kerjakan" }).click(); await expect(page.getByText("Tugas dimulai.")).toBeVisible(); expect(roadWrites).toBe(0);
});

test("saving one cleanup group preserves another dirty group and failed saves", async ({ page }) => {
 await setup(page); let failWaste = true;
 await page.route(`**/api/events/${id}/waste-records`, route => route.request().method() === "POST" ? route.fulfill(failWaste ? { status: 500, json: { error: { message: "Gagal sintetis" } } } : { json: { wasteRecord: {} } }) : route.fulfill({ json: { wasteRecords: [] } }));
 await page.route(`**/api/events/${id}/cleanup-tasks`, route => route.request().method() === "POST" ? route.fulfill({ json: { task: {} } }) : route.fulfill({ json: { cleanupTasks: [] } }));
 await page.goto(`/dashboard/events/${id}/cleanup`);
 await page.getByRole("button", { name: "Tambah Tugas" }).click();
 await page.getByPlaceholder("Contoh: Pembersihan Sisa Canang & Sampah Plastik Catus Pata").fill("Tugas belum disimpan");
 await page.getByPlaceholder("Berat (Kg)").first().fill("2");
 await page.getByRole("button", { name: "Simpan Catatan Sampah" }).click(); await expect(page.getByText(/Gagal sintetis/)).toBeVisible();
 let dialogPromise = page.waitForEvent("dialog"); await page.getByRole("link", { name: "Daftar Upacara" }).click(); await (await dialogPromise).dismiss(); await expect(page).toHaveURL(/cleanup$/);
 failWaste = false; await page.getByRole("button", { name: "Simpan Catatan Sampah" }).click(); await expect(page.getByText(/Catatan timbunan sampah pasca-upacara berhasil disimpan/)).toBeVisible();
 dialogPromise = page.waitForEvent("dialog"); await page.getByRole("link", { name: "Daftar Upacara" }).click(); await (await dialogPromise).dismiss(); await expect(page.getByPlaceholder("Contoh: Pembersihan Sisa Canang & Sampah Plastik Catus Pata")).toHaveValue("Tugas belum disimpan");
 await page.getByRole("button", { name: "Simpan Tugas" }).click(); await expect(page.getByText("Tugas kebersihan baru berhasil ditambahkan.")).toBeVisible();
 await page.getByRole("link", { name: "Daftar Upacara" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
});

test("owned workflow surfaces reflow with shared controls", async ({ page }) => {
 await setup(page);
 for (const width of [320, 390, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  for (const [name, path] of [["new", "/dashboard/events/new"], ["document", `/dashboard/events/${id}/document`], ["review", `/dashboard/events/${id}/review`], ["roads", `/dashboard/events/${id}/roads`], ["cleanup", `/dashboard/events/${id}/cleanup`], ["team", `/dashboard/events/${id}/team`], ["field", `/field/events/${id}`]] as const) {
   await page.goto(path); await expect(page.locator(".workflow-page")).toBeVisible();
   expect(await page.evaluate(() => { const g = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return g.document.documentElement.scrollWidth <= g.innerWidth; }), `${name} at ${width}`).toBeTruthy();
   if (width !== 320) await page.screenshot({ path: `test-results/C2-${name}-${width}.png`, fullPage: true });
  }
 }
});


test("wizard and field reflow at 200 percent CSS zoom approximation", async ({ page }) => {
 await setup(page); await page.setViewportSize({ width: 390, height: 900 });
 for (const path of ["/dashboard/events/new", `/field/events/${id}`]) {
  await page.goto(path);
  await page.evaluate(() => { (globalThis as unknown as { document: { body: { style: { zoom: string } } } }).document.body.style.zoom = "200%"; });
  expect(await page.evaluate(() => { const g = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return g.document.documentElement.scrollWidth <= g.innerWidth; })).toBeTruthy();
 }
});

test("newer wizard edits stay dirty when an earlier save finishes", async ({ page }) => {
 await setup(page); let release: (() => void) | undefined;
 const hold = new Promise<void>(resolve => { release = resolve; });
 await page.route(`**/api/events/${id}/extracted-fields`, async route => { await hold; await route.fulfill({ json: { event } }); });
 await page.goto("/dashboard/events/new"); await page.locator("#wizard-org-select").selectOption(org);
 await page.getByRole("button", { name: /Lewati.*Manual/ }).first().click();
 const title = page.getByPlaceholder("Contoh: Karya Pujawali & Prosesi Melasti Pura Dalem Ubud");
 await title.fill("Versi pertama"); await page.getByRole("button", { name: "Simpan Rincian" }).click();
 await title.fill("Perubahan terbaru"); release?.();
 await expect(page.getByText(/perubahan terbaru belum disimpan/i)).toBeVisible();
 const dialog = page.waitForEvent("dialog"); await page.getByRole("link", { name: "Daftar Upacara" }).click(); await (await dialog).dismiss();
 await expect(title).toHaveValue("Perubahan terbaru");
});
