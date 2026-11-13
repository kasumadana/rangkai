import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicRouter } from "../../src/worker/routes/public";
import type { AppVariables, Env } from "../../src/worker/types";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", async (c, next) => {
	c.set("requestId", "test-route-guidance");
	await next();
});
app.route("/api/public", publicRouter);

const coordinates: Array<[number, number]> = [
	[115.205, -8.652],
	[115.21, -8.648],
	[115.22, -8.65],
];

afterEach(() => vi.restoreAllMocks());

describe("POST /api/public/routes/guidance", () => {
	it("keeps the ORS key in the Worker and returns the ORS road geometry", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							geometry: { type: "LineString", coordinates },
							properties: {
								summary: { distance: 1800, duration: 240 },
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/geo+json" } },
			),
		);

		const response = await app.request(
			"http://localhost/api/public/routes/guidance",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ coordinates }),
			},
			{ ORS_API_KEY: "test-ors-key", NETWORK_ROUTING_ENABLED: "true" },
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			coordinates,
			distanceMeters: 1800,
			durationSeconds: 240,
		});
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
		);
		expect(new Headers(init?.headers).get("Authorization")).toBe("test-ors-key");
		expect(JSON.parse(String(init?.body))).toEqual({
			coordinates,
			instructions: false,
		});
	});

	it("fails closed when the server key is missing", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const response = await app.request(
			"http://localhost/api/public/routes/guidance",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ coordinates }),
			},
			{ NETWORK_ROUTING_ENABLED: "true" },
		);

		expect(response.status).toBe(503);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("rejects coordinates outside Bali before contacting ORS", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const response = await app.request(
			"http://localhost/api/public/routes/guidance",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ coordinates: [[106.8456, -6.2088], coordinates[1]] }),
			},
			{ ORS_API_KEY: "test-ors-key", NETWORK_ROUTING_ENABLED: "true" },
		);

		expect(response.status).toBe(422);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("rejects routes with more than ORS's waypoint limit", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const response = await app.request(
			"http://localhost/api/public/routes/guidance",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ coordinates: Array.from({ length: 51 }, () => coordinates[0]) }),
			},
			{ ORS_API_KEY: "test-ors-key", NETWORK_ROUTING_ENABLED: "true" },
		);

		expect(response.status).toBe(422);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
