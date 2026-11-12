import { expect, test, type Page } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
async function setup(page: Page) {
 await page.addInitScript(() => sessionStorage.setItem("rangkai:preloader-shown", "1"));
 await page.route("**/api/**", route => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/auth/get-session") return route.fulfill({ json: { user: { id: "applicant", name: "Uji", email: "test@example.test" }, session: { id: "session", userId: "applicant", expiresAt: "2099-01-01" } } });
  if (path === "/api/organizations/my") return route.fulfill({ json: { organizations: [] } });
  return route.fulfill({ json: { events: [], pagination: { page: 1, total: 0, totalPages: 0 }, applications: [] } });
 });
}
test("applicant submits and checks pending status without organizer grant", async ({ page }) => {
 await setup(page); await page.setViewportSize({ width: 390, height: 844 }); let status = "empty"; let reads = 0; let posted: unknown;
 await page.route("**/api/me/organization-applications", async route => {
  if (route.request().method() === "POST") { posted = route.request().postDataJSON(); status = "pending"; return route.fulfill({ status: 201, json: { application: { id } } }); }
  reads++; return route.fulfill({ json: { applications: status === "pending" ? [{ id, name: "Desa sintetis", village: "Uji", district: "Denpasar", status: "pending", decisionReason: null, organizationId: null }] : [] } });
 });
 await page.clock.install(); await page.goto("/onboarding/organization");
 await page.getByLabel("Nama organisasi").fill("Desa sintetis"); await page.getByLabel("Desa / wilayah").fill("Uji"); await page.getByLabel("Kabupaten / kota").fill("Denpasar");
 await page.getByRole("button", { name: "Kirim pengajuan" }).click(); await expect(page).toHaveURL(/onboarding\/status/); await expect(page.getByText(/Menunggu tinjauan/)).toBeVisible();
 expect(posted).toEqual({ name: "Desa sintetis", village: "Uji", district: "Denpasar" }); await expect(page.getByRole("link", { name: "Buka panel kegiatan" })).toHaveCount(0);
 const before = reads; await page.clock.fastForward(61_000); await expect.poll(() => reads).toBeGreaterThan(before); await page.getByRole("button", { name: "Periksa status" }).click(); await expect.poll(() => reads).toBeGreaterThan(before + 1);
});
test("admin reviews and rejects with reason and sees server-confirmed state", async ({ page }) => {
 await setup(page); await page.setViewportSize({ width: 390, height: 844 }); let state = "pending"; let reason = "";
 await page.route("**/api/admin/organization-applications?*", route => route.fulfill({ json: { applications: [{ id, name: "Desa sintetis", village: "Uji", district: "Denpasar", applicantId: "applicant", status: state, decisionReason: reason || null }] } }));
 await page.route(`**/api/admin/organization-applications/${id}/decision`, route => { const payload = route.request().postDataJSON() as { decision: string; reason: string }; expect(payload).toEqual({ decision: "reject", reason: "Lengkapi dokumen" }); state = "rejected"; reason = payload.reason; return route.fulfill({ json: { application: { id, status: state } } }); });
 await page.goto("/admin/organizations"); await expect(page.getByText("Desa sintetis")).toBeVisible(); await expect(page.getByRole("button", { name: "Tolak" })).toBeDisabled();
 await page.getByLabel("Alasan penolakan").fill("Lengkapi dokumen"); await page.getByRole("button", { name: "Tolak" }).click(); await expect(page.getByText("Ditolak")).toBeVisible(); await expect(page.getByText("Alasan: Lengkapi dokumen")).toBeVisible();
});

test("admin approval is reflected only after server confirmation", async ({ page }) => {
 await setup(page); let approved = false;
 await page.route("**/api/admin/organization-applications?*", route => route.fulfill({ json: { applications: [{ id, name: "Desa sintetis", village: "Uji", district: "Denpasar", applicantId: "applicant", applicantName: "Pemohon uji", applicantEmail: "uji@example.test", status: approved ? "approved" : "pending", decisionReason: null }], hasMore: false } }));
 await page.route(`**/api/admin/organization-applications/${id}/decision`, route => { expect(route.request().postDataJSON()).toEqual({ decision: "approve" }); approved = true; return route.fulfill({ json: { application: { id, status: "approved" } } }); });
 await page.goto("/admin/organizations"); await expect(page.getByText(/Pemohon uji/)).toBeVisible(); await page.getByRole("button", { name: "Setujui" }).click(); await expect(page.getByText("Disetujui")).toBeVisible();
});

test("settings and event wizard direct new organizations to review", async ({ page }) => {
 await setup(page); await page.goto("/settings"); await expect(page.getByRole("link", { name: "Ajukan organisasi untuk ditinjau" })).toHaveAttribute("href", "/onboarding/organization");
 await page.goto("/dashboard/events/new"); await expect(page.getByRole("link", { name: "Ajukan organisasi untuk ditinjau" })).toHaveAttribute("href", "/onboarding/organization");
});

test("login without membership routes to application status", async ({ page }) => {
 await setup(page); let loggedIn = false;
 await page.route("**/api/auth/get-session", route => route.fulfill({ json: loggedIn ? { user: { id: "applicant", name: "Uji", email: "test@example.test" }, session: { id: "session", userId: "applicant", expiresAt: "2099-01-01" } } : null }));
 await page.route("**/api/auth/sign-in/email", route => { loggedIn = true; return route.fulfill({ json: { user: { id: "applicant", name: "Uji", email: "test@example.test" } } }); });
 await page.goto("/login"); await page.getByLabel("Alamat Email").fill("test@example.test"); await page.getByLabel("Kata Sandi", { exact: true }).fill("synthetic-password"); await page.getByRole("button", { name: /Masuk/ }).click();
 await expect(page).toHaveURL(/onboarding\/status/); await expect(page.getByRole("heading", { name: "Pengajuan organisasi" })).toBeVisible();
});

test("application and admin screens fit a narrow viewport", async ({ page }) => {
 await setup(page); await page.setViewportSize({ width: 320, height: 800 });
 await page.route("**/api/admin/organization-applications?*", route => route.fulfill({ json: { applications: [], hasMore: false } }));
 for (const path of ["/onboarding/status", "/admin/organizations"]) {
  await page.goto(path); await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => { const g = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return g.document.documentElement.scrollWidth <= g.innerWidth; })).toBe(true);
 }
});
