import { afterEach, describe, expect, it, vi } from "vitest";
import { assessPhotoQuality } from "../../src/worker/services/photo-quality";

const photo = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" };
const input = { taskId: "synthetic-task", apiKey: "synthetic-key", before: photo, after: photo };
afterEach(() => vi.unstubAllGlobals());
describe("photo quality synthetic provider", () => {
 it("returns server-controlled review and weight invariants", async () => {
  const result = { beforeReadable: true, afterReadable: false, sameAreaLikely: "uncertain", issues: ["blur"], observations: [] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }))));
  expect(await assessPhotoQuality(input)).toMatchObject({ ...result, taskId: "synthetic-task", wasteWeightKg: null, automaticallyVerified: false, requiresOrganizerReview: true });
 });
 it.each(["not json", JSON.stringify({ beforeReadable: true }), JSON.stringify({ beforeReadable: true, afterReadable: true, sameAreaLikely: "yes", issues: [], observations: [], wasteWeightKg: 12 })])("rejects malformed or extra provider output", async (text) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }))));
  expect(await assessPhotoQuality(input)).toBeNull();
 });
 it("returns null for provider failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic failure")));
  expect(await assessPhotoQuality(input)).toBeNull();
 });
});
