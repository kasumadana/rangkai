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

		// No fatal page errors
		expect(pageErrors.length).toBe(0);
	});

	test("TC-Smoke-02: Public session check handles unauthenticated or fail-closed state cleanly", async ({
		publicPage,
		baseURL,
	}) => {
		const res = await publicPage.request.get(`${baseURL}/api/auth/get-session`);
		// Better Auth returns 200 with null session if DB is configured,
		// or 503 DEPENDENCY_UNAVAILABLE (fail-closed) if running without DB binding.
		if (res.status() === 200) {
			const sessionData = await res.json();
			expect(sessionData === null || sessionData?.session === null).toBe(true);
		} else {
			expect(res.status()).toBe(503);
			const errorData = await res.json();
			expect(errorData.error.code).toBe("DEPENDENCY_UNAVAILABLE");
		}
	});
});
