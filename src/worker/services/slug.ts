import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/index";
import { events } from "../../db/schema";

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, "")
		.replace(/[\s_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export async function generateUniquePublicSlug(
	db: DbClient,
	title: string,
): Promise<string> {
	const base = slugify(title) || "event";
	let slug = "";
	let attempts = 0;

	while (attempts < 10) {
		const suffix = crypto.randomUUID().slice(0, 6);
		slug = `${base}-${suffix}`;

		const existing = await db
			.select({ id: events.id })
			.from(events)
			.where(eq(events.publicSlug, slug))
			.limit(1);

		if (existing.length === 0) {
			return slug;
		}
		attempts++;
	}

	// Fallback to full UUID suffix if collisions occur
	return `${base}-${crypto.randomUUID()}`;
}
