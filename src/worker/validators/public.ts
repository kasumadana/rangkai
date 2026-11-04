import { z } from "zod";
import { isoDateSchema } from "./events";

export const publicEventsQuerySchema = z.object({
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
