import { z } from "zod";
import { BALI_GEOGRAPHIC_BOUNDS } from "./bali-bounds";

export const venueLocationSchema = z.object({
	type: z.literal("Point"),
	coordinates: z.tuple([
		z.number().finite().min(BALI_GEOGRAPHIC_BOUNDS.minLng).max(BALI_GEOGRAPHIC_BOUNDS.maxLng),
		z.number().finite().min(BALI_GEOGRAPHIC_BOUNDS.minLat).max(BALI_GEOGRAPHIC_BOUNDS.maxLat),
	]),
}).strict();
