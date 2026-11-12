import { test, expect, type Browser } from "@playwright/test";
const id = '11111111-1111-4111-8111-111111111111', org = '22222222-2222-4222-8222-222222222222', user = '33333333-3333-4333-8333-333333333333';
const event = { id, organizationId: org, createdBy: user, title: 'Kegiatan Uji Sintetis dengan Nama Sangat Panjang untuk Memeriksa Pembungkusan', category: 'odalan', description: 'Data sintetis', venueName: 'Lokasi pengujian dengan nama yang panjang', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-01T04:00:00.000Z', status: 'draft', isSimulation: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };

async function setup(browser: Browser, width: number, role = 'organizer', canCleanup = true) { const page = await browser.newPage({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173', viewport: { width, height: 900 } });
  const errs: string[] = [], requests: string[] = [];
  page.on('pageerror', e => errs.push(e.message));
  let signed = true;
  await page.route('**/api/**', async r => { const p = new URL(r.request().url()).pathname;
  requests.push(p);
  let data;
  if (p.endsWith('/get-session')) data = signed ? { user: { id: user, name: 'Pengguna Uji', email: 'fixture@example.invalid', emailVerified: true, createdAt: event.createdAt, updatedAt: event.updatedAt }, session: { id: '44444444-4444-4444-8444-444444444444', userId: user, expiresAt: '2027-12-01T00:00:00.000Z', token: 'synthetic' } } : null;
  else if (p.endsWith('/sign-out')) { signed = false;
  data = { success: true } }
  else if (p === '/api/organizations/my') data = { organizations: [{ id: org, name: 'Organisasi Sintetis dengan Nama Sangat Panjang untuk Uji Tampilan', village: 'Desa Uji', district: 'Uji', createdAt: event.createdAt, role }] };
  else if (p === '/api/events') data = { events: [event, { ...event, id: '55555555-5555-4555-8555-555555555555', title: 'Kegiatan sintetis kedua', status: 'review' }], pagination: { page: 1, limit: 50, total: 2, totalPages: 1 } };
  else if (p === `/api/events/${id}`) data = { event };
  else if (p === '/api/field/tasks') data = { assignments: [{ eventId: id, eventTitle: event.title, status: 'draft', venueName: event.venueName, startsAt: event.startsAt, endsAt: event.endsAt, isSimulation: true, organizationId: org, organizationName: 'Organisasi Sintetis', canUpdateTraffic: true, canUpdateCleanup: true, isOrganizerOversight: false }] };
  else if (p === `/api/field/events/${id}`) data = { event, permissions: { canUpdateTraffic: true, canUpdateCleanup: canCleanup, isOrganizer: false }, roadImpacts: [], cleanupTasks: [] };
  else if (p === '/api/road-segments') data = { segments: [], roadSegments: [] };
  else if (p === '/api/invitations') data = { invitations: [] };
  else if (p.endsWith('/documents')) data = { documents: [] };
  else if (p.endsWith('/extracted-fields')) data = { fields: [] };
  else if (p.endsWith('/road-impacts')) data = { roadImpacts: [] };
  else if (p.endsWith('/road-candidates')) data = { candidates: [] };
  else if (p.endsWith('/cleanup-tasks')) data = { tasks: [] };
  else if (p.endsWith('/waste-records')) data = { records: [] };
  else if (p.endsWith('/assignments')) data = { assignments: [] };
  else if (p === '/api/public/events/synthetic') data = { event: { ...event, slug: 'synthetic', publicSlug: 'synthetic', status: 'published' } };
  else if (p === '/api/public/events/synthetic/roads') data = { roads: [] };
  else if (p === '/api/public/events/synthetic/cleanup-summary') data = { summary: null };
  else if (p === '/api/public/events') data = { events: [{ ...event, slug: 'synthetic', publicSlug: 'synthetic', status: 'published' }] };
  else if (p.includes('/public/')) data = { events: [] };
  else return r.fulfill({ status: 404, json: { error: { code: 'FIXTURE_UNAVAILABLE', message: 'Fixture endpoint unavailable', requestId: 'synthetic' } } });
  return r.fulfill({ json: data });
  });
  return { page, errs, requests };
  }

test("waste checklist without assumptions and total-only range", async ({ browser }) => {
  for (const width of [320, 390, 1440]) {
    const { page } = await setup(browser, width);
    const requests: Record<string, unknown>[] = [];
    await page.route('**/waste-plan', async route => {
      const body = route.request().postDataJSON(); requests.push(body);
      return route.fulfill({ json: { wastePlan: { output: { checklist: ['Siapkan wadah'], scenarioRange: body.scenario ? { formula: '', low: { totalKg: 10, categoriesKg: null }, high: { totalKg: 20, categoriesKg: null }, assumptions: body.scenario } : null, handlingAdvice: [{ category: 'organic', action: 'Pisahkan organik', source: 'https://example.org' }], facilities: { suitableMatches: [], nearbyCandidates: [] } } } } });
    });
    await page.goto(`/dashboard/events/${id}/cleanup`);
    await page.getByText('Susun skenario').click();
    await page.getByLabel('Perkiraan peserta (orang)').fill('100');
    await page.getByLabel('Durasi (jam)').fill('24');
    await page.getByRole('button', { name: 'Susun rencana' }).click();
    await expect(page.getByText('Siapkan wadah')).toBeVisible();
    expect(requests[0]).not.toHaveProperty('scenario');
    await page.getByText('Tambahkan asumsi rentang (opsional)').click();
    await page.getByLabel('Koefisien minimum (kg/orang/hari)').fill('0.1');
    await page.getByRole('button', { name: 'Susun rencana' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'secara lengkap' })).toBeVisible();
    await page.getByLabel('Koefisien maksimum (kg/orang/hari)').fill('0.2');
    await page.getByLabel('Asal asumsi koefisien').fill('Asumsi sintetis');
    await page.getByLabel('Organik (%)').fill('50');
    await page.getByRole('button', { name: 'Susun rencana' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'ketiga proporsi' })).toBeVisible();
    await page.getByLabel('Organik (%)').clear();
    await page.getByRole('button', { name: 'Susun rencana' }).click();
    await expect(page.getByText(/Rentang skenario: 10.20 kg/)).toBeVisible();
    expect(requests[1].scenario).not.toHaveProperty('categoryShares');
    await expect(page.getByText('Pisahkan organik')).toBeVisible();
    expect(await page.evaluate<string>("getComputedStyle(document.querySelector('.waste-scenario-panel label')).fontSize")).toBe('16px');
    expect(await page.evaluate<string>("getComputedStyle(document.querySelector('.waste-scenario-panel h2')).fontSize")).toBe('26px');
    expect(await page.evaluate<number>("document.querySelector('.waste-scenario-panel button[type=submit]').getBoundingClientRect().height")).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/waste-repair-${width}.png`, fullPage: true });
    await page.close();
  }
});


test("populated public detail has no horizontal overflow", async ({ browser }) => {
  const { page } = await setup(browser, 390);
  await page.goto('/events/synthetic');
  await expect(page.getByText(event.title).first()).toBeVisible();
  expect(await page.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth")).toBeTruthy();
  await page.screenshot({ path: 'test-results/detail-repair-390.png' });
  await page.close();
});




test("synthetic representative surfaces", async ({ browser }) => {
  test.setTimeout(180000);
  const routes = ["/", "/events", "/events/synthetic", "/peta", "/dashboard", "/dashboard/events/new", `/dashboard/events/${id}`, `/dashboard/events/${id}/document`, `/dashboard/events/${id}/roads`, `/dashboard/events/${id}/cleanup`, `/dashboard/events/${id}/team`, "/settings", `/field/events/${id}`, `/field/events/${id}/cleanup`];
  for (const width of [320, 390, 768, 1440]) {
    const { page } = await setup(browser, width);
    for (const [index, route] of routes.entries()) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.locator(".rangkai-preloader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      if (index === 2) await expect(page.getByRole("link", {name: "Tanya tentang kegiatan"})).toHaveAttribute("href", "/tanya?event=synthetic");
      await page.screenshot({ path: `test-results/sweep-${width}-${index}.png` });
    }
    if (width === 390) {
      await page.goto("/dashboard");
      const toggle = page.locator(".workspace-menu-toggle");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    await page.close();
  }
});


test("synthetic public search and filters", async ({ browser }) => {
  const { page } = await setup(browser, 390);
  await page.goto("/events");
  const search = page.getByLabel("Cari jadwal upacara");
  await expect(page.getByText(event.title)).toBeVisible();
  await search.fill("tidak cocok sintetis");
  await expect(page.getByText("Tidak ditemukan jadwal yang sesuai")).toBeVisible();
  await page.getByRole("button", { name: "Bersihkan pencarian" }).click();
  await expect(page.getByText(event.title)).toBeVisible();
  await page.getByLabel("Filter status jadwal").selectOption("published");
  await expect(page.getByText(event.title)).toBeVisible();
  await page.goto("/peta");
  await page.getByRole("button", {name: "Buka Menu"}).click();
  await expect(page.getByRole("link", {name: "Tanya kegiatan"}).last()).toHaveAttribute("href", "/tanya");
  await page.close();
});



test("synthetic account navigation and sign out", async ({ browser }) => {
  const { page } = await setup(browser, 390);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Pengaturan akun" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const signOut = page.waitForResponse(response => response.url().includes("/sign-out") && response.status() === 200);
  await page.getByRole("button", { name: "Keluar akun" }).first().click();
  await signOut;
  await expect(page.getByRole("link", { name: "Pengaturan akun" })).toHaveCount(0);
  await page.close();
});
