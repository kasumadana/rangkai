import { expect, test } from "@playwright/test";

test.use({ video: "off" });

test("landing GPS follows real reported coordinates and can be stopped", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
			watchPosition: (success: (value: unknown) => void) => { setTimeout(() => success({ coords: { longitude: 115.22, latitude: -8.65, accuracy: 12 } }), 0); return 1; },
			clearWatch: () => { (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.gpsStopped = "yes"; },
		} });
	});
	await page.goto("/");
	const start = page.getByRole("button", { name: "Aktifkan pelacakan lokasi" });
	await start.scrollIntoViewIfNeeded();
	await start.click();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(1);
	await page.getByRole("button", { name: "Hentikan pelacakan lokasi" }).click();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-gps-stopped", "yes");
	expect(errors).toEqual([]);
});

test("GPS denial never invents a location", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
			watchPosition: (_success: unknown, failure: (value: unknown) => void) => { setTimeout(() => failure({ code: 1 }), 0); return 1; },
			clearWatch: () => {},
		} });
	});
	await page.goto("/");
	const start = page.getByRole("button", { name: "Aktifkan pelacakan lokasi" });
	await start.scrollIntoViewIfNeeded(); await start.click();
	await expect(page.getByRole("alert").filter({ hasText: "Izin lokasi ditolak" })).toBeVisible();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(0);
});

test("area map GPS uses device position instead of a district center", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
			watchPosition: (success: (value: unknown) => void) => { setTimeout(() => success({ coords: { longitude: 115.22, latitude: -8.65, accuracy: 12 } }), 0); return 7; },
			clearWatch: () => {},
		} });
	});
	await page.goto("/peta");
	await page.getByRole("button", { name: "Aktifkan pelacakan lokasi" }).click();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(1);
	await page.getByRole("button", { name: "Hentikan pelacakan lokasi" }).click();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(0);
});
