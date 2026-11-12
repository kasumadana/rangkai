import { expect, test } from "@playwright/test";

test.use({ video: "off", launchOptions: { executablePath: process.env.RANGKAI_BROWSER_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

test("anonymous access to the old workspace catalogue returns to the landing page", async ({ page }) => {
	await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
	await page.goto("/ui-system");
	await expect(page).toHaveURL(/\/$/);
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

test("an open report without expiry is not presented as confirmed open", async ({ page }) => {
	await page.route("**/api/public/events/tanpa-masa**", async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/roads")) return route.fulfill({ json: { roads: [{ id: "jalan-1", roadSegmentId: "segmen-1", displayName: "Jalan Tanpa Masa", impactType: "closure", plannedFrom: null, plannedTo: null, operationalStatus: { effectiveStatus: "open", rawStatus: "open", isStale: false, observedAt: null, expiresAt: null } }] } });
		if (path.endsWith("/alternative-routes")) return route.fulfill({ json: { alternativeRoutes: [] } });
		if (path.endsWith("/cleanup-summary")) return route.fulfill({ status: 503, json: {} });
		return route.fulfill({ json: { event: { id: "acara-1", slug: "tanpa-masa", title: "Acara Uji", venueName: null, venueLocation: null, status: "published", isSimulation: true, organization: { name: "Desa Uji", village: "Denpasar", district: "Denpasar" } } } });
	});
	await page.goto("/events/tanpa-masa");
	const road = page.getByRole("button", { name: /Jalan Tanpa Masa/ }).first();
	await expect(road).toContainText("Belum terkonfirmasi");
	await expect(road).not.toContainText("Dibuka");
	await expect(page.getByText("Lokasi belum ditentukan", { exact: true })).toBeVisible();
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
		await expect(page.getByText(/Belum terkonfirmasi/i).first()).toBeVisible();
		await expect(page.locator('[aria-label="Lokasi acara: Pura Uji (simulasi)"]')).toHaveCount(1);
		await expect(page.getByText("Alternatif Uji").first()).toBeVisible();
		const road = page.getByRole("button", { name: /Jalan Uji/ }).first();
		await road.click();
		await expect(road).toHaveAttribute("aria-pressed", "true");
		if (width === 390) {
			const basemap = page.getByRole("group", { name: "Pilih tampilan peta dasar" });
			await basemap.getByRole("button", { name: "Peta Jalan" }).click();
			await expect(basemap.getByRole("button", { name: "Peta Jalan" })).toHaveAttribute("aria-pressed", "true");
			await basemap.getByRole("button", { name: "Satelit" }).click();
			await expect(basemap.getByRole("button", { name: "Satelit" })).toHaveAttribute("aria-pressed", "true");
			await expect(road).toHaveAttribute("aria-pressed", "true");
			await expect(page.locator('[aria-label="Lokasi acara: Pura Uji (simulasi)"]')).toHaveCount(1);
		}
		if (width <= 1024) {
			const map = await page.locator(".teduh-roads-map-box").boundingBox();
			const list = await page.locator(".teduh-roads-list").boundingBox();
			expect(map!.y).toBeLessThan(list!.y);
			expect(map!.height).toBeLessThanOrEqual(381);
		}
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

test("landing map switches basemaps and both maps track the device location", async ({ page }) => {
	test.setTimeout(90000);
	await page.setViewportSize({ width: 1280, height: 860 });
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
			watchPosition: (success: (value: unknown) => void) => { setTimeout(() => success({ coords: { longitude: 115.22, latitude: -8.65, accuracy: 12 } }), 0); return 1; },
			clearWatch: () => {},
		} });
	});

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

	const landingLocateBtn = page.getByRole("button", { name: "Aktifkan pelacakan lokasi" });
	await expect(landingLocateBtn).toBeVisible();
	await landingLocateBtn.click();

	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(1);
	await page.getByRole("button", { name: "Hentikan pelacakan lokasi" }).click();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(0);

	// 2. Verify Public Spatial Map Console (/peta) controls
	await page.goto("/peta");
	const petaLocateBtn = page.getByRole("button", { name: "Aktifkan pelacakan lokasi" });
	await expect(petaLocateBtn).toBeVisible();
	await petaLocateBtn.click();

	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(1);
	await page.getByRole("button", { name: "Hentikan pelacakan lokasi" }).click();
	await expect(page.locator('[aria-label="Lokasi Anda"]')).toHaveCount(0);
});

test("schedule cards have visible borders, primary detail buttons, and navigate on card click", async ({ page }) => {
	await page.route("**/api/public/events**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/roads")) return route.fulfill({ json: { eventSlug: "latihan", roads: [] } });
		if (path.endsWith("/alternative-routes")) return route.fulfill({ json: { eventSlug: "latihan", alternativeRoutes: [] } });
		if (path.endsWith("/cleanup-summary")) return route.fulfill({ status: 503, json: {} });
		if (path === "/api/public/events/latihan") {
			return route.fulfill({ json: { event: { id: "acara-1", slug: "latihan", title: "Karya Agung Ubud", venueName: "Pura Desa Ubud", venueLocation: { type: "Point", coordinates: [115.26, -8.5] }, startsAt: "2026-11-14T00:00:00Z", endsAt: "2026-11-14T04:00:00Z", status: "published", isSimulation: false, organization: { name: "Desa Adat Ubud", village: "Ubud", district: "Ubud" } } } });
		}
		return route.fulfill({ json: { events: [{ id: "acara-1", slug: "latihan", title: "Karya Agung Ubud", category: "pujawali", venueName: "Pura Desa Ubud", startsAt: "2026-11-14T00:00:00Z", endsAt: "2026-11-14T04:00:00Z", status: "published", isSimulation: false, organization: { name: "Desa Adat Ubud", village: "Ubud", district: "Ubud" } }], items: [{ id: "acara-1", slug: "latihan", title: "Karya Agung Ubud", category: "pujawali", venueName: "Pura Desa Ubud", startsAt: "2026-11-14T00:00:00Z", endsAt: "2026-11-14T04:00:00Z", status: "published", isSimulation: false, organization: { name: "Desa Adat Ubud", village: "Ubud", district: "Ubud" } }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }, page: 1, pageSize: 50, total: 1, totalPages: 1 } });
	});
	await page.setViewportSize({ width: 390, height: 800 });
	await page.goto("/");
	const card = page.locator(".schedule-card").filter({ hasText: "Karya Agung Ubud" }).first();
	await card.scrollIntoViewIfNeeded();
	await expect(card).toBeVisible();
	const styles = await card.evaluate((el) => {
		const browser = globalThis as unknown as {
			getComputedStyle: (node: unknown) => {
				borderTopWidth: string;
				borderLeftWidth: string;
				backgroundColor: string;
				color: string;
			};
		};
		const cardNode = el as unknown as {
			querySelector: (selector: string) => unknown;
		};
		const cardStyle = browser.getComputedStyle(el);
		const detailBtn = cardNode.querySelector(".btn-schedule-detail");
		const btnStyle = detailBtn ? browser.getComputedStyle(detailBtn) : null;
		return {
			borderTopWidth: cardStyle.borderTopWidth,
			borderLeftWidth: cardStyle.borderLeftWidth,
			btnBg: btnStyle?.backgroundColor ?? "",
			btnColor: btnStyle?.color ?? "",
		};
	});
	expect(styles.borderTopWidth).toBe("1px");
	expect(styles.borderLeftWidth).toBe("1px");
	expect(styles.btnBg).toBe("rgb(77, 112, 47)");
	expect(styles.btnColor).toBe("rgb(255, 255, 255)");
	await card.getByText("Pura Desa Ubud").click();
	await expect(page).toHaveURL(/\/events\/latihan$/);
	await expect(page.getByRole("heading", { name: "Karya Agung Ubud" })).toBeVisible();
});
