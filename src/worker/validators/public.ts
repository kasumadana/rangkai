import { z } from "zod";
import { isoDateSchema } from "./events";

export const publicEventsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	status: z.enum(["published", "active", "completed"]).optional(),
	from: isoDateSchema.optional(),
	to: isoDateSchema.optional(),
	bbox: z
		.string()
		.refine(
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
					"Invalid bbox parameter. Format must be 'minLng,minLat,maxLng,maxLat'.",
			},
		)
		.optional(),
});

export const publicRoadImpactsQuerySchema = z
	.object({
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(200).default(50),
		status: z.enum(["published", "active", "completed"]).optional(),
		from: isoDateSchema.optional(),
		to: isoDateSchema.optional(),
		bbox: z
			.string()
			.refine(
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
						"Invalid bbox parameter. Format must be 'west,south,east,north' with ordered finite coordinates.",
				},
			)
			.optional(),
	})
	.refine(
		(data) => {
			if (data.from && data.to) {
				return new Date(data.to) >= new Date(data.from);
			}
			return true;
		},
		{
			message: "'to' timestamp must be equal to or after 'from' timestamp.",
			path: ["to"],
		},
	);

