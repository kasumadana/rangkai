import { test, expect } from "./fixtures";

test.describe("E2E Health & Smoke Sanity Suite (C05)", () => {
	test("TC-000: Health check endpoint /api/health liveness and payload contract", async ({
		request,
		baseURL,
	}) => {
		const res = await request.get(`${baseURL}/api/health`, {
			headers: { Accept: "application/json" },
		});

		expect(res.status()).toBe(200);

		const data = (await res.json()) as {
			status: string;
			service: string;
		};

		expect(data.status).toBe("ok");
		expect(data.service).toBe("rangkai");
	});

	test("TC-Smoke-01: Public app shell boots cleanly without blank screen or uncaught errors", async ({
		publicPage,
		baseURL,
	}) => {
		const consoleErrors: string[] = [];
		publicPage.on("console", (msg) => {
			if (msg.type() === "error") {
				consoleErrors.push(msg.text());
			}
		});

		const pageErrors: Error[] = [];
		publicPage.on("pageerror", (err) => {
			pageErrors.push(err);
		});

		const res = await publicPage.goto(baseURL || "/");
		expect(res?.status()).toBeLessThan(400);

		// App root is mounted
		const body = publicPage.locator("body");
		await expect(body).toBeVisible();

		// No fatal page errors or uncaught console errors
		expect(pageErrors.length).toBe(0);
		expect(
			consoleErrors.filter(
				(msg) =>
					!msg.includes("favicon.ico") &&
					!msg.includes("404") &&
					!msg.includes("Worker failed to load"),
			),
		).toEqual([]);
	});

	test("TC-Smoke-02: Public session check returns clean anonymous session", async ({
		publicPage,
		baseURL,
	}) => {
		const res = await publicPage.request.get(`${baseURL}/api/auth/get-session`);
		expect(res.status()).toBe(200);
		const sessionData = await res.json();
		expect(sessionData === null || sessionData?.session === null).toBe(true);
	});
});
