import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppVariables, Env } from "../../src/worker/types";
vi.mock("../../src/worker/routes/public", async () => {
 const { Hono: Router } = await import("hono"); const router = new Router();
 router.get("/events/:slug/roads", c => c.json({ isSimulation: true, roads: [{ id: "synthetic-road", displayName: "Synthetic road", operationalStatus: { effectiveStatus: "open", observedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T01:00:00.000Z" } }] }));
 router.get("/events/:slug/cleanup-summary", c => c.json({ isSimulation: true, summary: { totalTasks: 1, verifiedTasks: 1, submittedTasks: 0, inProgressTasks: 0, todoTasks: 0, reopenedTasks: 0 } }));
 return { publicRouter: router };
});
import { publicAssistantRouter } from "../../src/worker/routes/public-assistant";
const row = { slug: "synthetic", title: "Synthetic", status: "published", isSimulation: true, startsAt: null, endsAt: null };
function app() { const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [row] }; const server = new Hono<{ Bindings: Env; Variables: AppVariables }>(); server.use("*", async (c, next) => { c.set("db", { select: () => chain } as never); c.set("requestId", "test"); await next(); }); server.route("/assistant", publicAssistantRouter); return server; }
async function ask(intent: string) {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent, sourceIds: ["event:synthetic"] }) }] } }] }))));
 return app().request("/assistant/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "synthetic test" }) }, { PUBLIC_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "synthetic" });
}
afterEach(() => vi.unstubAllGlobals());
describe("assistant public evidence", () => {
 it("converts expired open to unconfirmed and keeps simulation label", async () => { const response = await ask("road_status"); const data = await response.json() as { status: string; answer: string; sources: Array<{ status: string; isSimulation: boolean; expiresAt: string; summary: { verifiedTasks: number } }> }; expect(data.status).toBe("answered"); expect(data.sources[0].status).toBe("unconfirmed"); expect(data.sources[0].isSimulation).toBe(true); expect(data.sources[0].expiresAt).toBe("2020-01-01T01:00:00.000Z"); });
 it("returns public cleanup counts without road transition", async () => { const response = await ask("cleanup_summary"); const data = await response.json() as { status: string; answer: string; sources: Array<{ status: string; isSimulation: boolean; expiresAt: string; summary: { verifiedTasks: number } }> }; expect(data.sources[0].summary.verifiedTasks).toBe(1); expect(data.answer).toContain("tidak membuka jalan"); });
});
