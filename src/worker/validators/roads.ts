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

export const createRoadSegmentSchema = z
	.object({
		displayName: z
			.string()
			.trim()
			.min(3, "Nama ruas jalan minimal 3 karakter.")
			.max(200, "Nama ruas jalan maksimal 200 karakter."),
		coverageArea: z
			.string()
			.trim()
			.min(2, "Nama kawasan/banjar minimal 2 karakter.")
			.max(150, "Nama kawasan/banjar maksimal 150 karakter."),
		coordinates: z
			.array(
				z.tuple([
					z.number().min(-180).max(180),
					z.number().min(-90).max(90),
				]),
			)
			.min(2, "Tandai minimal 2 titik koordinat di peta untuk membentuk garis ruas jalan.")
			.max(100, "Maksimal 100 titik koordinat per ruas jalan."),
		humanVerified: z.boolean().refine((val) => val === true, {
			message: "Konfirmasi verifikasi Prajuru/Panitia diperlukan untuk mendaftarkan ruas jalan.",
		}),
	})
	.refine(
		(data) => {
			const [firstLng, firstLat] = data.coordinates[0];
			return data.coordinates.some(
				([lng, lat]) =>
					Math.abs(lng - firstLng) > 0.00001 ||
					Math.abs(lat - firstLat) > 0.00001,
			);
		},
		{
			message: "Titik awal dan titik akhir ruas jalan tidak boleh berada di satu titik yang sama.",
			path: ["coordinates"],
		},
	);

export const createSimulationRoadImpactSchema = createRoadSegmentSchema.and(
	z.object({
		mutationId: uuidParamSchema,
		plannedFrom: isoDateSchema,
		plannedTo: isoDateSchema,
		impactType: z.enum(IMPACT_TYPES),
		diversionNote: z.string().trim().max(1000).optional().nullable(),
	}).refine((data) => new Date(data.plannedTo) > new Date(data.plannedFrom), {
		message: "plannedTo must be strictly after plannedFrom",
		path: ["plannedTo"],
	}),
);
