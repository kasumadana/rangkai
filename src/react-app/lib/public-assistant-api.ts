import { z } from "zod";
import { apiFetch } from "./api-client";

const base = z.object({ sourceId: z.string(), publicUrl: z.string().regex(/^\/events\/[a-zA-Z0-9%_-]+$/), title: z.string(), status: z.string(), isSimulation: z.boolean(), observedAt: z.string().nullable(), expiresAt: z.string().nullable() });
const source = z.union([
 base.extend({ sourceId: z.string().startsWith("event:"), startsAt: z.string().nullable(), endsAt: z.string().nullable() }),
 base.extend({ sourceId: z.string().startsWith("road:"), eventStatus: z.string() }),
 base.extend({ sourceId: z.string().startsWith("cleanup:"), summary: z.object({ totalTasks: z.number(), verifiedTasks: z.number(), submittedTasks: z.number(), inProgressTasks: z.number(), todoTasks: z.number(), reopenedTasks: z.number() }) }),
]);
const response = z.object({ status: z.enum(["answered", "abstained"]), intent: z.string(), answer: z.string(), sources: z.array(source), searchUrl: z.literal("/events") });
export type AssistantQuestion = { question: string; eventSlug?: string; location?: string };
export async function askPublicAssistant(body: AssistantQuestion, signal?: AbortSignal) {
 return response.parse(await apiFetch<unknown>("/api/public/assistant/questions", { method: "POST", body, signal }));
}
