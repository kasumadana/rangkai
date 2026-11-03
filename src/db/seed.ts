import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { assertDevBranch } from "./guard";
import { getDb } from "./index";
import {
	cleanupTasks,
	eventAssignments,
	events,
	memberships,
	organizations,
	roadSegments,
} from "./schema";
import { user } from "./auth-schema";

// ponytail: clearly simulated development fixtures without inventing real road closures or real credentials
dotenv.config({ path: ".dev.vars" });

export const SIMULATED_DATA = {
	users: {
		organizer: {
			id: "usr_simulated_organizer_01",
			name: "Simulated Organizer",
			email: "organizer.simulated@rangkai.local",
			emailVerified: true,
		},
		officer: {
			id: "usr_simulated_officer_01",
			name: "Simulated Field Officer",
			email: "officer.simulated@rangkai.local",
			emailVerified: true,
		},
	},
	organization: {
		id: "11111111-1111-4111-8111-111111111111",
		name: "Banjar Uji Coba (Simulasi)",
		village: "Desa Simulasi",
		district: "Kecamatan Simulasi",
	},
	roadSegment: {
		id: "22222222-2222-4222-8222-222222222222",
		displayName: "[SIMULATED] Jl. Uji Coba Segmen A",
		// Synthetic coordinates for testing spatial queries only; explicitly not real operational road geometry
		geom: "SRID=4326;LINESTRING(115.2166 -8.6500, 115.2170 -8.6510)",
		coverageArea: "Area Simulasi",
		verifiedBy: "system_fixture",
	},
	event: {
		id: "33333333-3333-4333-8333-333333333333",
		title: "[SIMULATED] Upacara Keagamaan Uji Coba",
		category: "upacara",
		description: "Data simulasi untuk verifikasi database dan pipeline pengujian.",
		venueName: "Balai Banjar Simulasi",
		status: "draft" as const,
		publicSlug: "simulated-upacara-uji-coba",
		startsAt: new Date("2026-11-10T08:00:00Z"),
		endsAt: new Date("2026-11-10T14:00:00Z"),
	},
	cleanupTask: {
		id: "44444444-4444-4444-8444-444444444444",
		title: "[SIMULATED] Pembersihan Area Pos Uji Coba",
		description: "Tugas pembersihan simulasi pasca kegiatan.",
		location: "SRID=4326;POINT(115.2166 -8.6500)",
		status: "todo" as const,
	},
};

export async function seedDatabase(databaseUrl?: string) {
	// Preflight guard: fail-closed if not targeting the authorized Neon development branch
	const { pinnedUrl } = await assertDevBranch(databaseUrl);
	const db = getDb(pinnedUrl);

	// 1. Seed simulated users
	await db
		.insert(user)
		.values([
			{
				id: SIMULATED_DATA.users.organizer.id,
				name: SIMULATED_DATA.users.organizer.name,
				email: SIMULATED_DATA.users.organizer.email,
				emailVerified: SIMULATED_DATA.users.organizer.emailVerified,
			},
			{
				id: SIMULATED_DATA.users.officer.id,
				name: SIMULATED_DATA.users.officer.name,
				email: SIMULATED_DATA.users.officer.email,
				emailVerified: SIMULATED_DATA.users.officer.emailVerified,
			},
		])
		.onConflictDoUpdate({
			target: user.id,
			set: { name: sql`EXCLUDED.name` },
		});

	// 2. Seed simulated organization
	await db
		.insert(organizations)
		.values({
			id: SIMULATED_DATA.organization.id,
			name: SIMULATED_DATA.organization.name,
			village: SIMULATED_DATA.organization.village,
			district: SIMULATED_DATA.organization.district,
		})
		.onConflictDoUpdate({
			target: organizations.id,
			set: { name: sql`EXCLUDED.name` },
		});

	// 3. Seed memberships
	await db
		.insert(memberships)
		.values([
			{
				organizationId: SIMULATED_DATA.organization.id,
				userId: SIMULATED_DATA.users.organizer.id,
				role: "organizer",
			},
			{
				organizationId: SIMULATED_DATA.organization.id,
				userId: SIMULATED_DATA.users.officer.id,
				role: "officer",
			},
		])
		.onConflictDoNothing();

	// 4. Seed simulated road segment with typed PostGIS geometry
	await db
		.insert(roadSegments)
		.values({
			id: SIMULATED_DATA.roadSegment.id,
			displayName: SIMULATED_DATA.roadSegment.displayName,
			geom: sql`ST_GeomFromEWKT(${SIMULATED_DATA.roadSegment.geom})`,
			coverageArea: SIMULATED_DATA.roadSegment.coverageArea,
			verifiedBy: SIMULATED_DATA.roadSegment.verifiedBy,
			verifiedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: roadSegments.id,
			set: { displayName: sql`EXCLUDED.display_name` },
		});

	// 5. Seed simulated event
	await db
		.insert(events)
		.values({
			id: SIMULATED_DATA.event.id,
			organizationId: SIMULATED_DATA.organization.id,
			createdBy: SIMULATED_DATA.users.organizer.id,
			title: SIMULATED_DATA.event.title,
			category: SIMULATED_DATA.event.category,
			description: SIMULATED_DATA.event.description,
			venueName: SIMULATED_DATA.event.venueName,
			status: SIMULATED_DATA.event.status,
			publicSlug: SIMULATED_DATA.event.publicSlug,
			startsAt: SIMULATED_DATA.event.startsAt,
			endsAt: SIMULATED_DATA.event.endsAt,
		})
		.onConflictDoUpdate({
			target: events.id,
			set: { title: sql`EXCLUDED.title` },
		});

	// 6. Seed event assignment
	await db
		.insert(eventAssignments)
		.values({
			eventId: SIMULATED_DATA.event.id,
			userId: SIMULATED_DATA.users.officer.id,
			canUpdateTraffic: true,
			canUpdateCleanup: true,
		})
		.onConflictDoNothing();

	// 7. Seed cleanup task with PostGIS point
	await db
		.insert(cleanupTasks)
		.values({
			id: SIMULATED_DATA.cleanupTask.id,
			eventId: SIMULATED_DATA.event.id,
			title: SIMULATED_DATA.cleanupTask.title,
			description: SIMULATED_DATA.cleanupTask.description,
			location: sql`ST_GeomFromEWKT(${SIMULATED_DATA.cleanupTask.location})`,
			status: SIMULATED_DATA.cleanupTask.status,
			assignedUserId: SIMULATED_DATA.users.officer.id,
		})
		.onConflictDoUpdate({
			target: cleanupTasks.id,
			set: { title: sql`EXCLUDED.title` },
		});

	return { success: true };
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
	seedDatabase()
		.then(() => {
			console.log("Safe simulated development fixtures successfully seeded.");
		})
		.catch((err) => {
			console.error("Seeding failed:", err.message);
			process.exit(1);
		});
}
