import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const event = { id: "event-1", organizationId: "org-1", createdBy: "user-1", title: "Kegiatan sintetis dengan nama yang sangat panjang untuk pengujian tampilan dan navigasi", venueName: "Lokasi sintetis", startsAt: "2030-01-01T01:00:00Z", endsAt: "2030-01-01T03:00:00Z", status: "draft", isSimulation: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const longOrg = "Organisasi sintetis dengan nama yang sangat panjang untuk pengujian reflow dan aksesibilitas";

async function syntheticApi(page: Page, role: "organizer" | "officer") {
 let signedIn = true; let failLogout = false; let eventRequests = 0;
 await page.addInitScript(() => { sessionStorage.setItem("rangkai:preloader-shown", "1"); sessionStorage.setItem("rangkai:preloader-shown:peta", "1"); });
 await page.route("**/api/**", async route => {
  const url = new URL(route.request().url()); const path = url.pathname;
  if (path === "/api/auth/sign-out") { if (failLogout) return route.fulfill({ status: 500, json: { error: { message: "synthetic failure" } } }); signedIn = false; return route.fulfill({ json: { success: true } }); }
  if (path === "/api/auth/get-session") return route.fulfill({ json: signedIn ? { user: { id: "user-1", name: "Pengguna sintetis panjang", email: "test@example.test" }, session: { id: "session-1", userId: "user-1", expiresAt: "2030-01-01" } } : null });
  if (path === "/api/organizations/my") return route.fulfill({ json: { organizations: signedIn ? [{ id: "org-1", name: longOrg, role, village: null, district: null, hasOperationalAuthority: false }] : [] } });
  if (path === "/api/events") { eventRequests++; return route.fulfill({ json: { events: signedIn ? [event] : [], pagination: { page: 1, limit: 50, total: signedIn ? 1 : 0, totalPages: 1 } } }); }
  if (path === "/api/events/event-1") return route.fulfill({ json: { event } });
  if (path === "/api/field/events/event-1") return route.fulfill({ json: { event, permissions: { canUpdateTraffic: true, canUpdateCleanup: false, isOrganizer: role === "organizer" }, roadImpacts: [], cleanupTasks: [] } });
  if (path === "/api/field/tasks") return route.fulfill({ json: { assignments: [] } });
  if (path.includes("public/events")) return route.fulfill({ json: { events: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } } });
  if (path.includes("road-impacts")) return route.fulfill({ json: { type: "FeatureCollection", features: [] } });
  return route.fulfill({ json: { event, documents: [], extractions: [], assignments: [], invitations: [], roadImpacts: [], cleanupTasks: [], items: [], features: [] } });
 });
 return { setLogoutFailure: (value: boolean) => { failLogout = value; }, eventRequests: () => eventRequests };
}

test("synthetic organizer shell, context, keyboard and logout", async ({ page }) => {
 const api = await syntheticApi(page, "organizer"); await page.setViewportSize({ width: 390, height: 844 });
 await page.goto("/dashboard"); await expect(page.getByRole("heading", { name: "Ringkasan" })).toBeVisible();
 const drawerButton = page.getByRole("button", { name: "Buka menu ruang kerja" });
 await drawerButton.click(); const drawer = page.locator("#workspace-navigation"); await expect(drawer.getByRole("link", { name: "Ringkasan" })).toBeFocused();
 await page.keyboard.press("Shift+Tab"); await expect(drawer.getByRole("link", { name: "Pengaturan" })).toBeFocused(); await page.keyboard.press("Tab"); await expect(drawer.getByRole("link", { name: "Ringkasan" })).toBeFocused(); await page.keyboard.press("Escape"); await expect(drawerButton).toBeFocused();
 await page.goto("/dashboard/events"); await expect(page.getByRole("heading", { name: "Kegiatan", exact: true })).toBeVisible(); await expect(page.getByTestId("event-row")).toContainText("Simulasi");
 await page.goto("/dashboard/events/event-1/review"); await drawerButton.click(); await expect(drawer.getByRole("link", { name: "Ringkasan" })).toBeVisible(); await expect(drawer.getByRole("link", { name: "Kegiatan", exact: true })).toBeVisible(); await expect(drawer.getByRole("link", { name: "Dokumen & AI" })).toHaveAttribute("aria-current", "page"); await expect(drawer.getByRole("link", { name: "Tim & Petugas" })).toBeVisible(); await page.keyboard.press("Escape");
 await page.goto("/field/events/event-1/traffic"); await drawerButton.click(); await expect(drawer.getByRole("link", { name: "Ringkasan" })).toBeVisible(); await expect(drawer.getByRole("link", { name: "Lalu lintas" })).toBeVisible(); await expect(drawer.getByRole("link", { name: "Kebersihan", exact: true })).toHaveCount(0); await page.keyboard.press("Escape");
 await page.goto("/settings"); await drawerButton.click(); await expect(drawer.getByRole("link", { name: "Ringkasan" })).toBeVisible(); await expect(drawer.getByRole("link", { name: "Pengaturan" })).toHaveAttribute("aria-current", "page"); await page.keyboard.press("Escape");
 const profile = page.getByRole("button", { name: "Profil" }); await profile.click(); const popover = page.locator("#profile-menu"); await expect(popover.getByRole("link", { name: "Ruang kerja" })).toBeFocused(); await page.keyboard.press("Shift+Tab"); await expect(popover.getByRole("button", { name: "Keluar" })).toBeFocused(); await page.keyboard.press("Tab"); await expect(popover.getByRole("link", { name: "Ruang kerja" })).toBeFocused(); await page.keyboard.press("Escape"); await expect(profile).toBeFocused();
 await profile.click(); api.setLogoutFailure(true); await popover.getByRole("button", { name: "Keluar" }).click(); await expect(popover.getByRole("alert")).toContainText("coba lagi"); await expect(page).toHaveURL(/settings/); api.setLogoutFailure(false); await popover.getByRole("button", { name: "Keluar" }).click(); await expect(page).toHaveURL("/"); await page.goto("/dashboard/events"); await expect(page.getByTestId("event-row")).toHaveCount(0); expect(api.eventRequests()).toBeGreaterThan(1);
});

test("synthetic officer navigation remains stable and permission-scoped", async ({ page }) => {
 await syntheticApi(page, "officer"); await page.setViewportSize({ width: 1440, height: 900 });
 for (const route of ["/field", "/field/events/event-1/traffic", "/settings"]) { await page.goto(route); const nav = page.locator("#workspace-navigation"); await expect(nav.getByRole("link", { name: "Tugas saya" })).toBeVisible(); await expect(nav.getByRole("link", { name: "Pengaturan" })).toBeVisible(); await expect(nav.getByRole("link", { name: "Ringkasan" })).toHaveCount(0); if (route.includes("event-1")) { await expect(nav.getByRole("link", { name: "Lalu lintas" })).toBeVisible(); await expect(nav.getByRole("link", { name: "Kebersihan", exact: true })).toHaveCount(0); } }
});

test("synthetic reflow and public navigation", async ({ page }, testInfo) => {
 const screenshotPath = (name: string) => process.env.RANGKAI_UI_SCREENSHOTS ? join(process.env.RANGKAI_UI_SCREENSHOTS, name) : testInfo.outputPath(name);
 await syntheticApi(page, "organizer");
 for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await page.goto("/dashboard"); await expect(page.getByRole("heading", { name: "Ringkasan" })).toBeVisible(); await expect(page.getByText(longOrg)).toBeVisible(); expect(await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }).document.documentElement.scrollWidth <= (globalThis as unknown as { innerWidth: number }).innerWidth)).toBeTruthy(); await page.screenshot({ path: screenshotPath(`A-final-${width}.png`), fullPage: true }); }
 await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/dashboard"); await page.evaluate(() => { (globalThis as unknown as { document: { body: { style: { zoom: string } } } }).document.body.style.zoom = "200%"; }); expect(await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }).document.documentElement.scrollWidth <= (globalThis as unknown as { innerWidth: number }).innerWidth)).toBeTruthy(); await page.screenshot({ path: screenshotPath("A-final-zoom.png"), fullPage: true });
 await page.goto("/"); const publicTrigger = page.getByRole("button", { name: "Buka menu publik" }); await publicTrigger.click(); const publicDrawer = page.getByRole("dialog", { name: "Menu publik" }); await expect(publicDrawer.getByRole("link", { name: "Kegiatan" })).toBeVisible(); await page.keyboard.press("Escape"); await expect(publicTrigger).toBeFocused();
 await page.screenshot({ path: screenshotPath("A-final-public-390.png"), fullPage: false }); await page.goto("/peta"); await expect(page.getByLabel("Cari lokasi atau kegiatan")).toBeVisible(); await expect(page.getByRole("button", { name: "Buka menu publik" })).toBeVisible(); await page.screenshot({ path: screenshotPath("A-final-map-390.png"), fullPage: false }); await page.setViewportSize({ width: 1440, height: 900 }); await expect(page.getByRole("navigation", { name: "Navigasi publik", exact: true }).getByRole("link", { name: "Kegiatan" })).toBeVisible(); await page.screenshot({ path: screenshotPath("A-final-map-1440.png"), fullPage: false }); await page.goto("/dashboard/events"); await page.screenshot({ path: screenshotPath("A-final-list-1440.png"), fullPage: true }); await page.goto("/settings"); await page.screenshot({ path: screenshotPath("A-final-settings-1440.png"), fullPage: true });
});

test("synthetic event search includes later pages and overview orders dates", async ({ page }) => {
 await syntheticApi(page, "organizer");
 const later = { ...event, id: "later", title: "Kegiatan halaman kedua", startsAt: "2032-01-01T00:00:00Z" };
 const earlier = { ...event, id: "earlier", title: "Kegiatan paling dekat", startsAt: "2029-01-01T00:00:00Z" };
 await page.route("**/api/events?*", async route => { const url = new URL(route.request().url()); const second = url.searchParams.get("page") === "2"; await route.fulfill({ json: { events: second ? [later] : [event, earlier], pagination: { page: second ? 2 : 1, limit: 50, total: 3, totalPages: 2 } } }); });
 await page.goto("/dashboard/events"); await page.getByRole("searchbox", { name: "Cari kegiatan" }).fill("halaman kedua"); await expect(page.getByTestId("event-row")).toHaveCount(1); await expect(page.getByTestId("event-row")).toContainText("halaman kedua");
 await page.goto("/dashboard"); const attention = page.locator(".overview-list").first(); await expect(attention.locator("li").first()).toContainText("paling dekat");
});

test("synthetic organization switch emits validated context and updates role", async ({ page }) => {
 await syntheticApi(page, "organizer"); await page.route("**/api/organizations/my", route => route.fulfill({ json: { organizations: [{ id: "org-1", name: "Panitia", role: "organizer" }, { id: "org-2", name: "Petugas", role: "officer" }] } }));
 await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/settings"); await page.evaluate(() => (globalThis as unknown as { addEventListener: (name: string, handler: (event: { detail: string }) => void) => void; document: { body: { setAttribute: (name: string, value: string) => void } } }).addEventListener("rangkai:organization-changed", event => (globalThis as unknown as { document: { body: { setAttribute: (name: string, value: string) => void } } }).document.body.setAttribute("data-test-organization", event.detail)));
 await page.getByRole("button", { name: "Profil" }).click(); await page.locator("#profile-menu").getByLabel("Organisasi").selectOption("org-2"); await expect(page.locator("body")).toHaveAttribute("data-test-organization", "org-2"); await expect(page.locator("#workspace-navigation").getByRole("link", { name: "Tugas saya" })).toBeVisible(); await expect(page.locator("#workspace-navigation").getByRole("link", { name: "Ringkasan" })).toHaveCount(0);
});
