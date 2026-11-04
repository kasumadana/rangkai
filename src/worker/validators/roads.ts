import { z } from "zod";
import { IMPACT_TYPES, ROAD_STATUSES } from "../../db/schema";
import { isoDateSchema, uuidParamSchema } from "./events";

export const roadSegmentsQuerySchema = z.object({
	bbox: z.string().refine(
		(val) => {
			const parts = val.split(",").map((s) => Number(s.trim()));
			if (parts.length !== 4 || parts.some((n) => isNaN(n) || !isFinite(n))) {
				return false;
			}
			const [minLng, minLat, maxLng, maxLat] = parts;
			if (
				minLng < -180 ||
				minLng > 180 ||
				maxLng < -180 ||
				maxLng > 180 ||
				minLat < -90 ||
				minLat > 90 ||
				maxLat < -90 ||
				maxLat > 90
			) {
				return false;
			}
			return minLng <= maxLng && minLat <= maxLat;
		},
		{
			message:
				"Invalid bbox parameter. Format must be 'minLng,minLat,maxLng,maxLat' with valid numeric coordinate bounds (-180..180, -90..90) where min <= max.",
		},
	),
});

export const createRoadImpactSchema = z
	.object({
		roadSegmentId: uuidParamSchema,
		plannedFrom: isoDateSchema,
		plannedTo: isoDateSchema,
		impactType: z.enum(IMPACT_TYPES),
		diversionNote: z.string().trim().max(1000).optional().nullable(),
	})
	.refine(
		(data) => new Date(data.plannedTo) > new Date(data.plannedFrom),
		{
			message: "plannedTo must be strictly after plannedFrom",
			path: ["plannedTo"],
		},
	);

export const updateRoadImpactSchema = z
	.object({
		roadSegmentId: uuidParamSchema.optional(),
		plannedFrom: isoDateSchema.optional(),
		plannedTo: isoDateSchema.optional(),
		impactType: z.enum(IMPACT_TYPES).optional(),
		diversionNote: z.string().trim().max(1000).optional().nullable(),
	})
	.refine(
		(data) => {
			if (data.plannedFrom && data.plannedTo) {
				return new Date(data.plannedTo) > new Date(data.plannedFrom);
			}
			return true;
		},
		{
			message: "plannedTo must be strictly after plannedFrom",
			path: ["plannedTo"],
		},
	);

export const createRoadStatusSchema = z.object({
	status: z.enum(ROAD_STATUSES),
	observedAt: isoDateSchema,
	mutationId: uuidParamSchema,
	note: z.string().trim().max(500).optional().nullable(),
});
