import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { publicRouter } from "./public";
import { events, organizations } from "../../db/schema";
import { sendError } from "../lib/errors";
import { rateLimit } from "../middleware/rate-limit";
import { assistantInputSchema, freshRoadStatus, selectAssistantSources, validateSelection, type AssistantSource } from "../services/public-assistant";
import type { AppVariables, Env } from "../types";
import { GEMINI_MODEL_NAME } from "../validators/extractions";
import { routeEvidence } from "../services/assistant-route-evidence";

export const publicAssistantRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();
publicAssistantRouter.use("/questions", rateLimit({ windowMs: 60000, max: 10, keyPrefix: "public-assistant" }));
publicAssistantRouter.use("/questions", bodyLimit({ maxSize: 4096, onError: c => sendError(c, "VALIDATION_FAILED", "Request too large.", 422) }));
publicAssistantRouter.post("/questions", async c => {
 if (c.env?.PUBLIC_ASSISTANT_ENABLED !== "true") return sendError(c, "FEATURE_DISABLED", "Asisten publik tidak aktif.", 503);
 if (!c.env.GEMINI_API_KEY?.trim()) return sendError(c, "DEPENDENCY_UNAVAILABLE", "Asisten publik belum dikonfigurasi.", 503);
 if (Number(c.req.header("content-length") ?? 0) > 4096) return sendError(c, "VALIDATION_FAILED", "Request too large.", 422);
 let body: unknown;
 try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Invalid JSON body.", 400); }
 const parsed = assistantInputSchema.safeParse(body);
 if (!parsed.success) return sendError(c, "VALIDATION_FAILED", "Invalid assistant request.", 422);
 const { question, eventSlug, location, from, to } = parsed.data;
 const db = c.get("db");
 const retrieve = async (): Promise<AssistantSource[]> => {
  const conditions = [inArray(events.status, eventSlug ? ["published", "active", "completed"] : ["published", "active"]), sql`(${events.isSimulation} IS DISTINCT FROM FALSE OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = ${events.organizationId} AND o.has_operational_authority = TRUE))`];
  if (eventSlug) conditions.push(eq(events.publicSlug, eventSlug));
  if (location) conditions.push(sql`(lower(${events.venueName}) = lower(${location}) OR lower(${organizations.village}) = lower(${location}) OR lower(${organizations.district}) = lower(${location}))`);
  if (from) conditions.push(gte(events.endsAt, new Date(from)));
  if (to) conditions.push(lte(events.startsAt, new Date(to)));
  const rows = await db.select({ slug: events.publicSlug, title: events.title, venueName: events.venueName, village: organizations.village, district: organizations.district, status: events.status, isSimulation: events.isSimulation, startsAt: events.startsAt, endsAt: events.endsAt }).from(events).innerJoin(organizations, eq(events.organizationId, organizations.id)).where(and(...conditions)).orderBy(asc(events.startsAt)).limit(10);
  return rows.filter(r => r.slug !== null).map(r => ({ sourceId: `event:${r.slug}`, publicUrl: `/events/${encodeURIComponent(r.slug!)}`, title: r.title, venueName: r.venueName, village: r.village, district: r.district, status: r.status, isSimulation: r.isSimulation !== false, startsAt: r.startsAt?.toISOString() ?? null, endsAt: r.endsAt?.toISOString() ?? null, observedAt: null, expiresAt: null }));
 };
 const sources = await retrieve();
 const providerSelection = await selectAssistantSources(question, sources, c.env.GEMINI_API_KEY.trim(), c.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_NAME);
 const selected = validateSelection(providerSelection, sources, question);
 if (!selected && providerSelection !== null) console.warn("assistant_provider_failure", { reason: "selection_invalid" });
 if (!selected) return sendError(c, "DEPENDENCY_UNAVAILABLE", "Asisten tidak dapat memproses pertanyaan. Gunakan pencarian kegiatan.", 503);
 if (selected.intent === "route_help") {
  const abstain = (answer: string) => c.json({ status: "abstained", intent: "route_help", answer, sources: [], searchUrl: "/events", mapUrl: "/peta" });
  if (!selected.origin || !selected.destination) return abstain("Sebutkan lokasi asal dan tujuan secara jelas, lalu coba lagi.");
  if (c.env.NETWORK_ROUTING_ENABLED === "true" && c.env.ORS_API_KEY?.trim()) {
   const evidence = await routeEvidence(db, selected.origin, selected.destination, c.env.ORS_API_KEY.trim());
   if (evidence.kind === "ambiguous") return abstain("Lokasi asal atau tujuan tidak ditemukan secara unik. Sebutkan nama dan wilayah yang lebih lengkap, lalu coba lagi.");
   if (evidence.kind === "success") {
    const warning = "Ini hanya persilangan geometris pada satu rute mobil dari OpenRouteService, bukan navigasi aman atau penghindaran penutupan; data dapat tidak lengkap dan status kedaluwarsa tidak terkonfirmasi.";
    return c.json({ status: evidence.rows.length ? "answered" : "abstained", intent: "route_help", answer: `Lokasi yang cocok: ${evidence.originLabel} ke ${evidence.destinationLabel}. Periksa kecocokan lokasi ini. ${evidence.rows.length ? "Berikut ruas publik yang berpotongan dengan rute tersebut." : "Tidak ditemukan persilangan pada data publik yang tersedia; kondisi jalan tidak dapat dipastikan."} ${evidence.truncated ? "Hasil dibatasi dan tidak lengkap. " : ""}${warning}`, sources: evidence.rows, searchUrl: "/events", mapUrl: "/peta" });
   }
  }
  const current = await retrieve();
  const matched = current.filter(s => selected.sourceIds.includes(s.sourceId) || [selected.origin, selected.destination].some(p => p && [s.title, s.venueName, s.village, s.district].some(f => f?.toLowerCase().includes(p.toLowerCase()))));
  if (matched.length) return c.json({ status: "answered", intent: "route_help", answer: "Perhitungan rute otomatis belum tersedia; berikut data kegiatan publik terkait. Periksa peta dan konfirmasi kondisi jalan kepada petugas setempat.", sources: matched, searchUrl: "/events", mapUrl: "/peta" });
  return abstain("Pemeriksaan rute belum tersedia. Periksa peta dan konfirmasi kondisi kepada petugas setempat.");
 }
 const current = await retrieve();
 const result = current.filter(source => selected.sourceIds.includes(source.sourceId));
 if (selected.intent === "event_lookup" && result.length) return c.json({ status: "answered", intent: selected.intent, answer: "Berikut data kegiatan yang dipilih. Periksa kesesuaian sumber; status kegiatan bukan status jalan.", sources: result, searchUrl: "/events" });
 if ((selected.intent === "road_status" || selected.intent === "cleanup_summary") && result.length) {
  const internal = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  internal.use("*", async (context, next) => { context.set("db", db); context.set("requestId", c.get("requestId")); await next(); });
  internal.route("/", publicRouter);
  const facts: Array<Record<string, unknown>> = [];
  for (const event of result.slice(0, 3)) {
   const slug = event.sourceId.slice(6);
   const suffix = selected.intent !== "cleanup_summary" ? "roads" : "cleanup-summary";
   const response = await internal.request(`http://internal/events/${encodeURIComponent(slug)}/${suffix}`, {}, c.env);
   if (!response.ok) continue;
   const payload: unknown = await response.json();
   if (selected.intent !== "cleanup_summary") {
    const shape = z.object({ isSimulation: z.boolean(), roads: z.array(z.object({ id: z.string(), displayName: z.string(), plannedFrom: z.string().nullable().optional(), plannedTo: z.string().nullable().optional(), operationalStatus: z.object({ effectiveStatus: z.string(), observedAt: z.string().nullable(), expiresAt: z.string().nullable() }) })).max(500) }).safeParse(payload);
    if (!shape.success) continue;
    for (const road of shape.data.roads.slice(0, 20)) facts.push({ sourceId: `road:${road.id}`, publicUrl: `${event.publicUrl}`, title: road.displayName, startsAt: road.plannedFrom ?? null, endsAt: road.plannedTo ?? null, eventStatus: event.status, isSimulation: shape.data.isSimulation, status: freshRoadStatus(road.operationalStatus.effectiveStatus, road.operationalStatus.expiresAt), observedAt: road.operationalStatus.observedAt, expiresAt: road.operationalStatus.expiresAt });
   } else {
    const shape = z.object({ isSimulation: z.boolean(), summary: z.object({ totalTasks: z.number().int().nonnegative(), verifiedTasks: z.number().int().nonnegative(), submittedTasks: z.number().int().nonnegative(), inProgressTasks: z.number().int().nonnegative(), todoTasks: z.number().int().nonnegative(), reopenedTasks: z.number().int().nonnegative() }) }).safeParse(payload);
    if (shape.success) facts.push({ sourceId: `cleanup:${slug}`, publicUrl: event.publicUrl, title: event.title, status: event.status, isSimulation: shape.data.isSimulation, observedAt: null, expiresAt: null, summary: shape.data.summary });
   }
  }
  if (selected.intent !== "cleanup_summary") for (const fact of facts) fact.status = freshRoadStatus(String(fact.status), typeof fact.expiresAt === "string" ? fact.expiresAt : null);
  if (facts.length) return c.json({ status: "answered", intent: selected.intent, answer: selected.intent === "road_status" ? "Status jalan berikut berasal dari laporan publik; status kedaluwarsa tidak terkonfirmasi dan jalan terbuka belum tentu lancar." : "Berikut ringkasan tugas kebersihan publik. Verifikasi kebersihan tidak membuka jalan secara otomatis.", sources: facts, searchUrl: "/events" });
 }
 return c.json({ status: "abstained", intent: selected.intent, answer: "Informasi yang diminta belum dapat dijawab. Cari kegiatan atau konfirmasi kepada petugas setempat.", sources: [], searchUrl: "/events" });
});
