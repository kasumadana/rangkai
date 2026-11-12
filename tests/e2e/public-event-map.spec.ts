import { expect, test } from "@playwright/test";

test.use({ video: "off", launchOptions: { executablePath: process.env.RANGKAI_BROWSER_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

test("old UI catalogue opens the real public events list", async ({ page }) => {
	await page.goto("/ui-system");
	await expect(page).toHaveURL(/\/events$/);
});

test("event detail reports API failure and allows retry", async ({ page }) => {
	let attempts = 0;
	await page.route("**/api/public/events/gagal", async (route) => {
		attempts++;
		await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Unavailable", requestId: "test" } } });
	});
	await page.goto("/events/gagal");
	await expect(page.getByRole("heading", { name: "Rincian acara belum dapat dimuat" })).toBeVisible();
	await page.getByRole("button", { name: "Coba lagi" }).click();
	await expect.poll(() => attempts).toBeGreaterThan(1);
});

test("an event without saved coordinates does not get a fabricated venue pin", async ({ page }) => {
	await page.route("**/api/public/events/tanpa-titik**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/roads")) return route.fulfill({ json: { eventSlug: "tanpa-titik", roads: [{ id: "jalan-1", roadSegmentId: "segmen-1", displayName: "Jalan Uji", impactType: "closure", plannedFrom: null, plannedTo: null, geometry: { type: "LineString", coordinates: [[115.21, -8.65], [115.22, -8.66]] } }] } });
		if (path.endsWith("/alternative-routes")) return route.fulfill({ json: { eventSlug: "tanpa-titik", alternativeRoutes: [] } });
		if (path.endsWith("/cleanup-summary")) return route.fulfill({ status: 503, json: {} });
		return route.fulfill({ json: { event: { id: "acara-1", slug: "tanpa-titik", title: "Acara Tanpa Titik", venueName: "Pura Uji", venueLocation: null, status: "published", isSimulation: false, organization: { name: "Desa Uji", village: "Denpasar", district: "Denpasar" } } } });
	});
	await page.goto("/events/tanpa-titik");
	await expect(page.getByText("Titik lokasi belum ditentukan")).toBeVisible();
	await expect(page.locator('[aria-label^="Lokasi acara:"]')).toHaveCount(0);
	await expect(page.getByText("Jalan Uji").first()).toBeVisible();
});

for (const width of [320, 390, 768, 1280]) {
	test(`public detail shows simulation location and roads at ${width}px`, async ({ page }, testInfo) => {
		const mapErrors: string[] = [];
		page.on("console", (message) => { if (message.type() === "error" && message.text().includes("Worker failed to load")) mapErrors.push(message.text()); });
		page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
		await page.setViewportSize({ width, height: 800 });
		await page.route("**/api/public/events/latihan**", async (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith("/roads")) return route.fulfill({ json: { eventSlug: "latihan", isSimulation: true, roads: [{ id: "jalan-1", roadSegmentId: "segmen-1", displayName: "Jalan Uji", coverageArea: "Denpasar", impactType: "closure", plannedFrom: "2026-11-14T00:00:00Z", plannedTo: "2026-11-14T04:00:00Z", geometry: { type: "LineString", coordinates: [[115.21, -8.65], [115.22, -8.66]] }, operationalStatus: { effectiveStatus: "unconfirmed", rawStatus: "open", isStale: true, observedAt: "2026-11-13T23:00:00Z", expiresAt: "2026-11-13T23:30:00Z" } }] } });
			if (path.endsWith("/alternative-routes")) return route.fulfill({ json: { eventSlug: "latihan", isSimulation: true, alternativeRoutes: [{ id: "alt-1", name: "Alternatif Uji", geometry: { type: "LineString", coordinates: [[115.21, -8.64], [115.22, -8.64]] } }] } });
			if (path.endsWith("/cleanup-summary")) return route.fulfill({ status: 503, json: {} });
			return route.fulfill({ json: { event: { id: "acara-1", slug: "latihan", title: "Acara Simulasi Uji", venueName: "Pura Uji", venueLocation: { type: "Point", coordinates: [115.215, -8.655] }, startsAt: "2026-11-14T00:00:00Z", endsAt: "2026-11-14T04:00:00Z", status: "published", isSimulation: true, organization: { name: "Desa Uji", village: "Denpasar", district: "Denpasar" } } } });
		});
		await page.goto("/events/latihan");
		await expect(page.getByRole("heading", { name: "Acara Simulasi Uji" })).toBeVisible();
		await expect(page.getByText("Jalan Uji").first()).toBeVisible();
		await expect(page.getByText(/BELUM DIKONFIRMASI/i).first()).toBeVisible();
		await expect(page.locator('[aria-label="Lokasi acara: Pura Uji (simulasi)"]')).toHaveCount(1);
		await expect(page.getByText("Alternatif Uji").first()).toBeVisible();
		await page.locator(".teduh-roads-split").scrollIntoViewIfNeeded();
		await page.waitForTimeout(2500);
		expect(mapErrors).toEqual([]);
		await page.locator(".teduh-roads-split").screenshot({ path: testInfo.outputPath("road-map.png") });
		expect(await page.evaluate(() => {
			const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number };
			return browser.document.documentElement.scrollWidth <= browser.innerWidth;
		})).toBe(true);
	});
}

test("map failure exposes the road list and can be retried", async ({ page }) => {
	await page.addInitScript({ content: `(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		window.__failMapWebGL = sessionStorage.getItem('map-retry-enabled') !== 'yes';
		HTMLCanvasElement.prototype.getContext = function(type, ...args) {
			if (window.__failMapWebGL && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) return null;
			return original.call(this, type, ...args);
		};
	})();` });
	await page.route("**/api/public/events/latihan**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/roads")) return route.fulfill({ json: { eventSlug: "latihan", roads: [{ id: "jalan-1", roadSegmentId: "segmen-1", displayName: "Jalan Uji", impactType: "closure", plannedFrom: null, plannedTo: null, geometry: { type: "LineString", coordinates: [[115.21, -8.65], [115.22, -8.66]] } }] } });
		if (path.endsWith("/alternative-routes")) return route.fulfill({ json: { eventSlug: "latihan", alternativeRoutes: [] } });
		if (path.endsWith("/cleanup-summary")) return route.fulfill({ status: 503, json: {} });
		return route.fulfill({ json: { event: { id: "acara-1", slug: "latihan", title: "Acara Uji", venueName: "Pura Uji", venueLocation: { type: "Point", coordinates: [115.215, -8.655] }, status: "published", isSimulation: true, organization: { name: "Desa Uji", village: "Denpasar", district: "Denpasar" } } } });
	});
	await page.goto("/events/latihan/map");
	await expect(page.getByText(/Peta tidak tersedia/i).first()).toBeVisible();
	await expect(page.getByText("Jalan Uji").first()).toBeVisible();
	await page.evaluate(() => { const browser = globalThis as unknown as { __failMapWebGL: boolean; sessionStorage: { setItem: (key: string, value: string) => void } }; browser.__failMapWebGL = false; browser.sessionStorage.setItem("map-retry-enabled", "yes"); });
	await page.getByRole("button", { name: "Coba lagi peta" }).click();
	await expect(page.locator('[aria-label="Lokasi acara: Pura Uji (simulasi)"]')).toHaveCount(1);
	await page.route("**/ArcGIS/rest/services/World_Imagery/**", (route) => route.abort());
	await page.reload();
	await expect(page.getByText(/Peta tidak tersedia/i).first()).toBeVisible({ timeout: 15000 });
	await expect(page.getByText("Jalan Uji").first()).toBeVisible();
});

test("landing map and /peta support street/satellite switch, user location tracking, and green alternative route guidance", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 860 });

	// 1. Verify Landing Page (/) map controls
	await page.goto("/");
	const landingMapGroup = page.getByRole("group", { name: "Pilih tampilan peta dasar" });
	await landingMapGroup.scrollIntoViewIfNeeded();

	const landingSatBtn = landingMapGroup.getByRole("button", { name: "Satelit" });
	const landingStreetBtn = landingMapGroup.getByRole("button", { name: "Peta Jalan" });
	await expect(landingSatBtn).toBeVisible();
	await expect(landingStreetBtn).toBeVisible();

	await landingStreetBtn.click();
	await expect(landingStreetBtn).toHaveAttribute("aria-pressed", "true");

	const landingLocateBtn = page.getByRole("button", {
		name: /Lokasi Saya & Rute Alternatif|Rute Alternatif Aktif/i,
	});
	await expect(landingLocateBtn).toBeVisible();
	await landingLocateBtn.click();

	await expect(page.getByText(/Garis Hijau:/i).first()).toBeVisible({ timeout: 10000 });
	await expect(page.getByRole("link", { name: /Navigasi Google Maps/i })).toBeVisible();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(1);

	// 2. Verify Public Spatial Map Console (/peta) controls
	await page.goto("/peta");
	const petaMapGroup = page.getByRole("group", { name: "Pilih tampilan peta dasar" }).first();
	const petaSatBtn = petaMapGroup.getByRole("button", { name: "Satelit" });
	const petaStreetBtn = petaMapGroup.getByRole("button", { name: "Peta Jalan" });
	await expect(petaSatBtn).toBeVisible();
	await expect(petaStreetBtn).toBeVisible();

	await petaStreetBtn.click();
	await expect(petaStreetBtn).toHaveAttribute("aria-pressed", "true");

	const petaLocateBtn = page.getByRole("button", {
		name: "Pusatkan Peta ke Lokasi Saya",
	});
	await expect(petaLocateBtn).toBeVisible();
	await petaLocateBtn.click();

	await expect(page.getByText(/Garis Hijau:/i).first()).toBeVisible({ timeout: 10000 });
	await expect(page.getByRole("link", { name: /Buka Google Maps/i })).toBeVisible();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(1);
});

