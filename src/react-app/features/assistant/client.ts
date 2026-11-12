import { z } from "zod";
import { apiFetch } from "../../lib/api-client";
const path = z.string().regex(/^\/(?!\/)[a-zA-Z0-9%_/?=&.-]*$/);
const base = { sourceId: z.string(), title: z.string(), url: path };
const sim = z.boolean(); const time = z.string().nullable();
const source = z.discriminatedUnion("kind", [
 z.object({ ...base, kind: z.literal("event"), facts: z.object({ status: z.string(), startsAt: time, endsAt: time, isSimulation: sim }) }),
 z.object({ ...base, kind: z.literal("road"), facts: z.object({ status: z.string(), observedAt: time, expiresAt: time, isSimulation: sim }) }),
 z.object({ ...base, kind: z.literal("cleanup"), facts: z.object({ status: z.string(), dueAt: time, isSimulation: sim }) }),
 z.object({ ...base, kind: z.literal("waste"), facts: z.object({ category: z.string(), measurementMethod: z.string(), quantityKg: z.string().nullable(), sackCount: z.number().nullable(), isSimulation: sim }) }),
 z.object({ ...base, kind: z.literal("help"), facts: z.object({}) }),
]);
const response = z.object({ status: z.enum(["answered", "abstained", "selection_required"]), scope: z.enum(["internal", "help"]), intent: z.string(), answer: z.string(), sources: z.array(source), searchUrl: path });
export type InternalResponse = z.infer<typeof response>;
export async function askInternal(body: { question: string; organizationId?: string; eventId?: string; helpTopic?: "event" | "traffic" | "cleanup" }, signal: AbortSignal) {
 return response.parse(await apiFetch<unknown>("/api/assistant/questions", { method: "POST", body, signal }));
}
