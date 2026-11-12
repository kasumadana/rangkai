import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { cleanupTasks, eventAssignments, events, memberships, roadImpacts, roadSegments, roadStatusUpdates, wasteRecords } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { freshRoadStatus, selectAssistantSources, validateSelection, type AssistantSource } from "../services/public-assistant";
import { assistantHelp } from "../services/assistant-help";
import type { AppVariables, Env } from "../types";
import { GEMINI_MODEL_NAME } from "../validators/extractions";

export type AssistantSourceFact =
 | { sourceId: string; url: string; kind: "event"; title: string; facts: { status: string; startsAt: string | null; endsAt: string | null; isSimulation: boolean } }
 | { sourceId: string; url: string; kind: "road"; title: string; facts: { status: string; observedAt: string | null; expiresAt: string | null; isSimulation: boolean } }
 | { sourceId: string; url: string; kind: "cleanup"; title: string; facts: { status: string; dueAt: string | null; isSimulation: boolean } }
 | { sourceId: string; url: string; kind: "waste"; title: string; facts: { category: string; measurementMethod: string; quantityKg: string | null; sackCount: number | null; isSimulation: boolean } }
 | { sourceId: string; url: string; kind: "help"; title: string; facts: Record<string, never> };

const inputSchema = z.object({ question: z.string().trim().min(1).max(500), organizationId: z.uuid().optional(), eventId: z.uuid().optional(), helpTopic: z.enum(["event", "traffic", "cleanup"]).optional() }).strict();

export const assistantRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();
assistantRouter.onError((_error, c) => sendError(c, "DEPENDENCY_UNAVAILABLE", "Asisten sementara tidak tersedia.", 503));
assistantRouter.use("/questions", requireAuth);
assistantRouter.use("/questions", rateLimit({ windowMs: 60000, max: 10, keyPrefix: "internal-assistant" }));
assistantRouter.use("/questions", bodyLimit({ maxSize: 4096, onError: c => sendError(c, "VALIDATION_FAILED", "Request too large.", 422) }));
assistantRouter.post("/questions", async c => {
 let body: unknown;
 try { body = await c.req.json(); } catch { return sendError(c, "VALIDATION_FAILED", "Invalid JSON body.", 422); }
 const parsed = inputSchema.safeParse(body);
 if (!parsed.success) return sendError(c, "VALIDATION_FAILED", "Invalid assistant request.", 422);
 const { question, organizationId, eventId, helpTopic } = parsed.data;
 if (helpTopic && (organizationId || eventId)) return sendError(c, "VALIDATION_FAILED", "Help does not accept event context.", 422);
 if (helpTopic) {
  const item = assistantHelp[helpTopic];
  return c.json({ status: "answered", scope: "help", intent: "help", answer: item.answer, sources: [{ sourceId: `help:${helpTopic}`, url: item.url, kind: "help", title: "Panduan penggunaan", facts: {} }], searchUrl: item.url });
 }
 const db = c.get("db");
 const userId = c.get("user")!.id;
 if (organizationId && !eventId) {
  const [member] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))).limit(1);
  if (!member) return sendError(c, "FORBIDDEN", "Access denied.", 403);
 }
 if (!organizationId || !eventId) return c.json({ status: "selection_required", scope: "internal", intent: "select_context", answer: "Pilih organisasi dan kegiatan terlebih dahulu.", sources: [], searchUrl: "/events" });
 const access = async () => {
  const [member] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))).limit(1);
  if (!member) return { error: "organization" as const };
  const [event] = await db.select({ id: events.id, title: events.title, status: events.status, startsAt: events.startsAt, endsAt: events.endsAt, isSimulation: events.isSimulation }).from(events).where(and(eq(events.id, eventId), eq(events.organizationId, organizationId))).limit(1);
  if (!event) return { error: "event" as const };
  if (member.role === "organizer") return { event, organizer: true, traffic: true, cleanup: true };
  if (member.role !== "officer") return { error: "assignment" as const };
  const [assignment] = await db.select({ traffic: eventAssignments.canUpdateTraffic, cleanup: eventAssignments.canUpdateCleanup }).from(eventAssignments).where(and(eq(eventAssignments.eventId, eventId), eq(eventAssignments.userId, userId))).limit(1);
  if (!assignment) return { error: "assignment" as const };
  return { event, organizer: false, traffic: assignment.traffic, cleanup: assignment.cleanup };
 };
 const denied = (error: "organization" | "event" | "assignment") => error === "event" ? sendError(c, "NOT_FOUND", "Event not found.", 404) : sendError(c, "FORBIDDEN", "Access denied.", 403);
 const initial = await access();
 if (initial.error) return denied(initial.error);
 if (c.env?.PUBLIC_ASSISTANT_ENABLED !== "true") return sendError(c, "FEATURE_DISABLED", "Asisten tidak aktif.", 503);
 if (!c.env.GEMINI_API_KEY?.trim()) return sendError(c, "DEPENDENCY_UNAVAILABLE", "Asisten belum dikonfigurasi.", 503);
 const source: AssistantSource = { sourceId: `event:${eventId}`, publicUrl: "", title: initial.event.title, status: initial.event.status, isSimulation: initial.event.isSimulation, startsAt: null, endsAt: null, observedAt: null, expiresAt: null };
 const selected = validateSelection(await selectAssistantSources(question, [source], c.env.GEMINI_API_KEY.trim(), c.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_NAME), [source]);
 if (!selected) return sendError(c, "DEPENDENCY_UNAVAILABLE", "Asisten tidak dapat memproses pertanyaan. Gunakan halaman kegiatan.", 503);
 const originalSession = c.get("session");
 const validateSession = async () => {
  try {
   const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true, disableRefresh: true } });
   if (!session?.user || !session.session || session.user.id !== userId || session.session.userId !== userId || session.session.id !== originalSession?.id || !Number.isFinite(session.session.expiresAt.getTime()) || session.session.expiresAt.getTime() <= Date.now()) return sendError(c, "UNAUTHORIZED", "Authentication required.", 401);
  } catch { return sendError(c, "DEPENDENCY_UNAVAILABLE", "Authentication dependency unavailable.", 503); }
 };
 const sessionError = await validateSession();
 if (sessionError) return sessionError;
 const current = await access();
 if (current.error) return denied(current.error);
 if (selected.intent === "road_status" && !current.traffic || selected.intent === "cleanup_summary" && !current.cleanup) return sendError(c, "FORBIDDEN", "Permission required.", 403);
 const url = current.organizer ? `/dashboard/events/${eventId}` : `/field/events/${eventId}`;
 const base = { status: "abstained" as const, scope: "internal" as const, intent: selected.intent, answer: "Informasi yang diminta belum dapat dijawab. Gunakan halaman kegiatan.", sources: [] as AssistantSourceFact[], searchUrl: url };
 if (!selected.sourceIds.includes(source.sourceId)) {
  const sessionError = await validateSession();
  if (sessionError) return sessionError;
  return c.json(base);
 }
 const sim = current.event.isSimulation;
 if (selected.intent === "event_lookup") {
  base.sources.push({ sourceId: source.sourceId, url, kind: "event", title: current.event.title, facts: { status: current.event.status, startsAt: current.event.startsAt?.toISOString() ?? null, endsAt: current.event.endsAt?.toISOString() ?? null, isSimulation: sim } });
 } else if (selected.intent === "road_status") {
  const roads = await db.select({ id: roadImpacts.id, title: roadSegments.displayName }).from(roadImpacts).innerJoin(roadSegments, eq(roadImpacts.roadSegmentId, roadSegments.id)).where(eq(roadImpacts.eventId, eventId)).limit(20);
  for (const road of roads) {
   const [latest] = await db.select({ status: roadStatusUpdates.status, observedAt: roadStatusUpdates.observedAt, expiresAt: roadStatusUpdates.expiresAt }).from(roadStatusUpdates).where(eq(roadStatusUpdates.roadImpactId, road.id)).orderBy(desc(roadStatusUpdates.createdAt)).limit(1);
   const expiresAt = latest?.expiresAt?.toISOString() ?? null;
   base.sources.push({ sourceId: `road:${road.id}`, url: current.organizer ? `${url}/roads` : url, kind: "road", title: road.title, facts: { status: freshRoadStatus(latest?.status ?? "unknown", expiresAt), observedAt: latest?.observedAt?.toISOString() ?? null, expiresAt, isSimulation: sim } });
  }
 } else if (selected.intent === "cleanup_summary") {
  const tasks = await db.select({ id: cleanupTasks.id, title: cleanupTasks.title, status: cleanupTasks.status, dueAt: cleanupTasks.dueAt }).from(cleanupTasks).where(eq(cleanupTasks.eventId, eventId)).limit(20);
  const waste = await db.select({ id: wasteRecords.id, category: wasteRecords.category, measurementMethod: wasteRecords.measurementMethod, quantityKg: wasteRecords.quantityKg, sackCount: wasteRecords.sackCount }).from(wasteRecords).where(eq(wasteRecords.eventId, eventId)).limit(20);
  for (const task of tasks) base.sources.push({ sourceId: `cleanup:${task.id}`, url: current.organizer ? `${url}/cleanup` : url, kind: "cleanup", title: task.title, facts: { status: task.status, dueAt: task.dueAt?.toISOString() ?? null, isSimulation: sim } });
  for (const record of waste) base.sources.push({ sourceId: `waste:${record.id}`, url: current.organizer ? `${url}/cleanup` : url, kind: "waste", title: current.event.title, facts: { category: record.category, measurementMethod: record.measurementMethod, quantityKg: record.quantityKg, sackCount: record.sackCount, isSimulation: sim } });
 }
 const finalAccess = await access();
 if (finalAccess.error) return denied(finalAccess.error);
 if (selected.intent === "road_status" && !finalAccess.traffic || selected.intent === "cleanup_summary" && !finalAccess.cleanup) return sendError(c, "FORBIDDEN", "Permission required.", 403);
 if (finalAccess.organizer !== current.organizer || finalAccess.event.isSimulation !== sim) return sendError(c, "DEPENDENCY_UNAVAILABLE", "Konteks berubah. Silakan coba lagi.", 503);
 const finalSessionError = await validateSession();
 if (finalSessionError) return finalSessionError;
 for (const item of base.sources) if (item.kind === "road") item.facts.status = freshRoadStatus(item.facts.status, item.facts.expiresAt);
 if (!base.sources.length) return c.json(base);
 return c.json({ ...base, status: "answered", answer: selected.intent === "road_status" ? "Status kedaluwarsa tidak terkonfirmasi; jalan terbuka belum tentu lancar." : selected.intent === "cleanup_summary" ? "Berikut catatan kebersihan dan sampah. Verifikasi kebersihan tidak membuka jalan." : "Berikut data kegiatan yang dipilih." });
});
