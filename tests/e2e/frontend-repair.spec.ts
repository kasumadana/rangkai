import { test, expect } from '@playwright/test';

test('assistant sources and mobile drawer', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.route('**/api/public/assistant/questions', route => route.fulfill({ json: { status: 'answered', intent: 'road_status', answer: 'Data sintetis', searchUrl: '/events', sources: [
    ...['open', 'closed', 'intermittent', 'unknown', 'unconfirmed'].map(status => ({ sourceId: `road:${status}`, title: status, publicUrl: '/events/synthetic', status, eventStatus: 'active', isSimulation: true, observedAt: null, expiresAt: '2026-11-12T00:00:20Z' })),
    { sourceId: 'event:two', title: 'Jadwal lengkap', publicUrl: '/events/synthetic', status: 'published', isSimulation: false, observedAt: null, expiresAt: null, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-01T04:00:00Z' },
    { sourceId: 'event:one', title: 'Kegiatan sintetis', publicUrl: '/events/synthetic', status: 'published', isSimulation: false, observedAt: null, expiresAt: null, startsAt: '2026-12-01T00:00:00Z', endsAt: null }
  ] } }));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/tanya');
  await expect(page.getByText(/Gemini dari Google/)).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Buka menu navigasi' });
  await expect(page.getByRole('dialog', { name: 'Menu Ponsel' })).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog', { name: 'Menu Ponsel' })).toHaveCount(0);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Menu Ponsel' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('link', { name: /Akses Petugas/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('Pertanyaan').fill('Kapan kegiatan?');
  await page.getByRole('button', { name: 'Kirim pertanyaan' }).click();
  await expect(page.getByText('Status jalan: Ditutup', { exact: false })).toBeVisible();
  await expect(page.getByText('Status jalan: Terbuka', { exact: false })).toBeVisible();
  await expect(page.getByText('Status jalan: Buka tutup', { exact: false })).toBeVisible();
  await expect(page.getByText(/waktu selesai belum diketahui/)).toBeVisible();
  await expect(page.getByText(/1 Desember 2026/)).toHaveCount(2);
  await expect(page.getByText(/08.00.*12.00/)).toBeVisible();
  await page.clock.fastForward('00:30');
  await expect(page.getByText(/Status jalan: belum terkonfirmasi/i)).toHaveCount(5);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth")).toBeTruthy();
    expect(await page.evaluate<string>("getComputedStyle(document.querySelector('.assistant-panel textarea')).fontSize")).toBe('16px');
    expect(await page.evaluate<number>("document.querySelector('.assistant-panel button[type=submit]').getBoundingClientRect().height")).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate<string>("getComputedStyle(document.querySelector('.assistant-panel h2')).fontSize")).toBe('26px');
    expect(await page.evaluate<string>("getComputedStyle(document.querySelector('.assistant-panel button[type=submit]')).fontSize")).toBe('16px');
    await page.screenshot({ path: `test-results/assistant-repair-${width}.png`, fullPage: true });
  }
});
