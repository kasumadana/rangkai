import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { cleanupRouter } from "../../src/worker/routes/cleanup";
import { resetExtractionRateLimits } from "../../src/worker/validators/documents";
import type { AppVariables, Env } from "../../src/worker/types";

const state = vi.hoisted(() => ({ access: {} as unknown }));
vi.mock("../../src/worker/middleware/assignments", () => ({ getEventAndCheckAccess: vi.fn(async () => state.access) }));
const taskId = "11111111-1111-4111-8111-111111111111";
const beforeId = "22222222-2222-4222-8222-222222222222";
const afterId = "33333333-3333-4333-8333-333333333333";
const requestBody = { beforeEvidenceId: beforeId, afterEvidenceId: afterId };
let rows: unknown[][];
let authenticated: boolean;
const bucket = { get: vi.fn(async (): Promise<unknown> => null) };
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", async (c, next) => {
 const chain = { from: () => chain, where: () => chain, limit: async () => rows.shift() ?? [] };
 c.set("db", { select: () => chain } as never);
 c.set("auth", { api: { getSession: async () => authenticated ? { user: { id: "officer" }, session: {} } : null } } as never);
 await next();
});
app.route("/api", cleanupRouter);
function request(body: unknown = requestBody, enabled = true) {
 return app.request(`/api/cleanup-tasks/${taskId}/photo-quality`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { AI_PHOTO_ASSESSMENT_ENABLED: enabled ? "true" : "false", GEMINI_API_KEY: "synthetic", rangkai_documents_dev: bucket } as never);
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { authenticated = true; rows = [[{ id: taskId, eventId: "event", assignedUserId: "officer" }]]; state.access = { isOrganizer: true, event: { status: "active", organizationId: "org" } }; bucket.get.mockReset().mockResolvedValue(null); resetExtractionRateLimits(); });
describe("synthetic photo quality route", () => {
 it("requires authentication", async () => { authenticated = false; expect((await request()).status).toBe(401); });
 it("rejects invalid IDs", async () => { expect((await request({ ...requestBody, beforeEvidenceId: "bad" })).status).toBe(422); });
 it("rejects unauthorized and unassigned officers", async () => { state.access = "FORBIDDEN"; expect((await request()).status).toBe(403); rows = [[{ eventId: "event", assignedUserId: "other" }]]; state.access = { isOrganizer: false, event: { status: "active", organizationId: "org" } }; expect((await request()).status).toBe(403); });
 it("hides tasks outside the organization", async () => { state.access = "NOT_FOUND"; expect((await request()).status).toBe(404); });
 it("returns 503 when disabled", async () => { expect((await request(requestBody, false)).status).toBe(503); });
 it("rejects evidence from another task or wrong stage", async () => { rows.push([], [{ stage: "after" }]); expect((await request()).status).toBe(404); rows = [[{ eventId: "event" }], [{ stage: "after" }], [{ stage: "before" }]]; expect((await request()).status).toBe(404); expect(bucket.get).not.toHaveBeenCalled(); });
 it("returns 503 for missing private objects", async () => { rows.push([{ stage: "before", r2Key: "private-before" }], [{ stage: "after", r2Key: "private-after" }]); expect((await request()).status).toBe(503); });
 it("rejects oversized stored objects without reading them", async () => { rows.push([{ stage: "before", r2Key: "a" }], [{ stage: "after", r2Key: "b" }]); bucket.get.mockResolvedValue({ size: 6 * 1024 * 1024 }); expect((await request()).status).toBe(503); });
 it("rejects unsupported stored image types", async () => { rows.push([{ stage: "before", r2Key: "a" }], [{ stage: "after", r2Key: "b" }]); bucket.get.mockResolvedValue({ size: 4, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1,2,3,4])); controller.close(); } }), httpMetadata: { contentType: "image/gif" } }); expect((await request()).status).toBe(503); });
 it("rejects cancelled events", async () => { state.access = { isOrganizer: true, event: { status: "cancelled", organizationId: "org" } }; expect((await request()).status).toBe(409); });

 it("allows the assigned officer and returns review-only output without a lifecycle mutation", async () => {
  state.access = { isOrganizer: false, event: { status: "active", organizationId: "org" } };
  rows.push([{ stage: "before", r2Key: "a" }], [{ stage: "after", r2Key: "b" }]);
  const bytes = new Uint8Array(45); bytes.set([137,80,78,71,13,10,26,10]); bytes.set([73,72,68,82], 12); bytes[19] = 2; bytes[23] = 2; bytes.set([73,69,78,68,174,66,96,130], 37);
  bucket.get.mockImplementation(async () => ({ size: bytes.length, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), httpMetadata: { contentType: "image/png" } }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ beforeReadable: true, afterReadable: true, sameAreaLikely: "uncertain", issues: [], observations: [] }) }] } }] }))));
  const response = await request(); expect(response.status).toBe(200);
  const payload = z.object({ data: z.unknown() }).parse(await response.json());
  expect(payload.data).toMatchObject({ taskId, wasteWeightKg: null, automaticallyVerified: false, requiresOrganizerReview: true });
  expect(rows).toHaveLength(0);
 });

});
