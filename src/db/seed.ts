import * as dotenv from "dotenv";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { assertDevBranch, sanitizeDatabaseError } from "./guard";
import { getDb } from "./index";
import { PILOT_ROAD_SEGMENTS } from "./fixtures/road-segments";
import {
	cleanupTasks,
	eventAlternativeRoutes,
	eventAssignments,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadSegments,
	roadStatusUpdates,
} from "./schema";
import { account, user } from "./auth-schema";

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
		unassignedOfficer: {
			id: "usr_simulated_unassigned_01",
			name: "Simulated Unassigned Officer",
			email: "unassigned.simulated@rangkai.local",
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
		verifiedBy: null,
		verifiedAt: null,
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
			{
				id: SIMULATED_DATA.users.unassignedOfficer.id,
				name: SIMULATED_DATA.users.unassignedOfficer.name,
				email: SIMULATED_DATA.users.unassignedOfficer.email,
				emailVerified: SIMULATED_DATA.users.unassignedOfficer.emailVerified,
			},
		])
		.onConflictDoUpdate({
			target: user.id,
			set: { name: sql`EXCLUDED.name` },
		});

	// Seed Better Auth accounts with deterministic default passwords matching E2E test fixtures
	const organizerPassword =
		process.env.SEED_ORGANIZER_PASSWORD || "SimulatedOrganizer123!";
	const officerPassword =
		process.env.SEED_OFFICER_PASSWORD || "SimulatedOfficer123!";
	const unassignedPassword =
		process.env.SEED_UNASSIGNED_PASSWORD || "SimulatedUnassigned123!";

	const hashedOrganizerPassword = await hashPassword(organizerPassword);
	const hashedOfficerPassword = await hashPassword(officerPassword);
	const hashedUnassignedPassword = await hashPassword(unassignedPassword);

	await db
		.insert(account)
		.values([
			{
				id: "acc_simulated_organizer_01",
				accountId: SIMULATED_DATA.users.organizer.id,
				providerId: "credential",
				userId: SIMULATED_DATA.users.organizer.id,
				password: hashedOrganizerPassword,
			},
			{
				id: "acc_simulated_officer_01",
				accountId: SIMULATED_DATA.users.officer.id,
				providerId: "credential",
				userId: SIMULATED_DATA.users.officer.id,
				password: hashedOfficerPassword,
			},
			{
				id: "acc_simulated_unassigned_01",
				accountId: SIMULATED_DATA.users.unassignedOfficer.id,
				providerId: "credential",
				userId: SIMULATED_DATA.users.unassignedOfficer.id,
				password: hashedUnassignedPassword,
			},
		])
		.onConflictDoNothing();

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
			{
				organizationId: SIMULATED_DATA.organization.id,
				userId: SIMULATED_DATA.users.unassignedOfficer.id,
				role: "officer",
			},
		])
		.onConflictDoNothing();

	// Clean up any legacy road impact referencing the unverified simulated road segment
	await db
		.delete(roadImpacts)
		.where(eq(roadImpacts.roadSegmentId, SIMULATED_DATA.roadSegment.id));

	// 4. Seed simulated road segment as strictly UNVERIFIED (AGENTS.md §13, docs/03-ARCHITECTURE.md §8)
	await db
		.insert(roadSegments)
		.values({
			id: SIMULATED_DATA.roadSegment.id,
			displayName: SIMULATED_DATA.roadSegment.displayName,
			geom: sql`ST_GeomFromEWKT(${SIMULATED_DATA.roadSegment.geom})`,
			coverageArea: SIMULATED_DATA.roadSegment.coverageArea,
			verifiedBy: null,
			verifiedAt: null,
		})
		.onConflictDoUpdate({
			target: roadSegments.id,
			set: {
				displayName: sql`EXCLUDED.display_name`,
				geom: sql`EXCLUDED.geom`,
				coverageArea: sql`EXCLUDED.coverage_area`,
				verifiedBy: null,
				verifiedAt: null,
			},
		});

	// 4b. Seed pilot road segments (Catur Muka) preserving truthful verification metadata
	for (const segment of PILOT_ROAD_SEGMENTS) {
		if (segment.id === SIMULATED_DATA.roadSegment.id) continue;
		await db
			.insert(roadSegments)
			.values({
				id: segment.id,
				displayName: segment.displayName,
				geom: sql`ST_GeomFromEWKT(${segment.geom})`,
				coverageArea: segment.coverageArea,
				verifiedBy: segment.verifiedBy,
				verifiedAt: segment.verifiedAt,
			})
			.onConflictDoUpdate({
				target: roadSegments.id,
				set: {
					displayName: sql`EXCLUDED.display_name`,
					geom: sql`EXCLUDED.geom`,
					coverageArea: sql`EXCLUDED.coverage_area`,
					verifiedBy: sql`EXCLUDED.verified_by`,
					verifiedAt: sql`EXCLUDED.verified_at`,
				},
			});
	}

	// 5. Seed simulated event (draft only)
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

	// 8. Demote leftover unverified synthetic E2E test rows to draft so public maps stay clean
	await db.execute(
		sql`UPDATE events SET status = 'draft' WHERE title LIKE '%Synthetic%' OR title LIKE '%SYNTHETIC_TEST_DATA%' OR title LIKE '%Test%' OR public_slug LIKE 'p1-test%' OR public_slug LIKE 'sanur-operations-%' OR public_slug LIKE 'melasti-sanur-%'`,
	);

	// 9. Seed 3 complete [SIMULATED] published ceremonies across Bali with venueLocation,
	// verified road segments, active roadStatusUpdates, and road-following alternativeRoutes
	const now = new Date();
	const startsAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
	const endsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
	const statusExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

	const extraOrgs = [
		{
			id: "11111111-1111-4111-8111-111111111102",
			name: "Desa Adat Ubud (Simulasi)",
			village: "Ubud",
			district: "Kecamatan Ubud, Kabupaten Gianyar",
		},
		{
			id: "11111111-1111-4111-8111-111111111103",
			name: "Desa Adat Intaran Sanur (Simulasi)",
			village: "Sanur",
			district: "Kecamatan Denpasar Selatan, Kota Denpasar",
		},
	];

	for (const org of extraOrgs) {
		await db
			.insert(organizations)
			.values(org)
			.onConflictDoUpdate({
				target: organizations.id,
				set: {
					name: sql`EXCLUDED.name`,
					village: sql`EXCLUDED.village`,
					district: sql`EXCLUDED.district`,
				},
			});
		await db
			.insert(memberships)
			.values([
				{
					organizationId: org.id,
					userId: SIMULATED_DATA.users.organizer.id,
					role: "organizer",
				},
				{
					organizationId: org.id,
					userId: SIMULATED_DATA.users.officer.id,
					role: "officer",
				},
			])
			.onConflictDoNothing();
	}

	const extraVerifiedSegments = [
		{
			id: "22222222-2222-4222-8222-000000000021",
			displayName: "[SIMULATED] Jl. Raya Ubud (Simpang Puri Saren - Pasar Ubud)",
			geom: "SRID=4326;LINESTRING(115.2598 -8.5066, 115.2625 -8.5069, 115.2654 -8.5072)",
			coverageArea: "Kecamatan Ubud - Kawasan Puri Saren",
			verifiedBy: "Okta",
			verifiedAt: new Date("2026-11-04T20:34:00+08:00"),
		},
		{
			id: "22222222-2222-4222-8222-000000000022",
			displayName:
				"[SIMULATED] Jl. Danau Tamblingan (Simpang Segara Ayu - Pasar Sindhu Sanur)",
			geom: "SRID=4326;LINESTRING(115.2616 -8.6882, 115.2619 -8.6913, 115.2622 -8.6948)",
			coverageArea: "Denpasar Selatan - Kawasan Sanur",
			verifiedBy: "Okta",
			verifiedAt: new Date("2026-11-04T20:34:00+08:00"),
		},
	];

	for (const seg of extraVerifiedSegments) {
		await db
			.insert(roadSegments)
			.values({
				id: seg.id,
				displayName: seg.displayName,
				geom: sql`ST_GeomFromEWKT(${seg.geom})`,
				coverageArea: seg.coverageArea,
				verifiedBy: seg.verifiedBy,
				verifiedAt: seg.verifiedAt,
			})
			.onConflictDoUpdate({
				target: roadSegments.id,
				set: {
					displayName: sql`EXCLUDED.display_name`,
					geom: sql`EXCLUDED.geom`,
					coverageArea: sql`EXCLUDED.coverage_area`,
					verifiedBy: sql`EXCLUDED.verified_by`,
					verifiedAt: sql`EXCLUDED.verified_at`,
				},
			});
	}

	const publishedShowcaseEvents = [
		{
			id: "33333333-3333-4333-8333-000000000001",
			organizationId: SIMULATED_DATA.organization.id,
			title: "[SIMULATED] Pawai Ogoh-Ogoh & Pengerupukan Catur Muka Denpasar",
			category: "pengerupukan",
			description:
				"Simulasi koordinasi pengalihan arus lalu lintas dan penutupan koridor Catur Muka Denpasar saat prosesi Pengerupukan.",
			venueName: "Simpang Patung Catur Muka Denpasar",
			venueLocationEwkt: "SRID=4326;POINT(115.2169 -8.6559)",
			publicSlug: "simulasi-pengerupukan-catur-muka-denpasar",
			impactId: "55555555-5555-4555-8555-000000000001",
			roadSegmentId: "22222222-2222-4222-8222-000000000001",
			impactType: "closure" as const,
			operationalStatus: "closed" as const,
			diversionNote:
				"Pengendara dari arah Gajah Mada dialihkan melalui Jl. Kartini - Jl. Pulau Sulawesi - Jl. Sumatra.",
			altRouteId: "66666666-6666-4666-8666-000000000001",
			altRouteName: "Jalur Pengalihan Jl. Kartini – Jl. Pulau Sulawesi – Jl. Sumatra",
			altRouteDesc:
				"Jalur alternatif terbuka mengitari penutupan koridor Catur Muka Denpasar.",
			altRouteEwkt:
				"SRID=4326;LINESTRING(115.2175116 -8.6491073, 115.2135509 -8.6474272, 115.2131184 -8.6553752, 115.2130287 -8.6563553, 115.2133182 -8.6585869)",
		},
		{
			id: "33333333-3333-4333-8333-000000000002",
			organizationId: "11111111-1111-4111-8111-111111111102",
			title: "[SIMULATED] Karya Agung & Prosesi Puri Saren Agung Ubud",
			category: "karya",
			description:
				"Simulasi penutupan bertahap koridor Jl. Raya Ubud di depan Puri Saren Agung dan Pasar Seni Ubud.",
			venueName: "Catus Pata Puri Saren Agung Ubud",
			venueLocationEwkt: "SRID=4326;POINT(115.2625 -8.5069)",
			publicSlug: "simulasi-karya-agung-puri-ubud",
			impactId: "55555555-5555-4555-8555-000000000002",
			roadSegmentId: "22222222-2222-4222-8222-000000000021",
			impactType: "closure" as const,
			operationalStatus: "closed" as const,
			diversionNote:
				"Arus kendaraan dialihkan memutar melalui koridor Jl. Suweta - Jl. Sri Wedari - Jl. Sandat.",
			altRouteId: "66666666-6666-4666-8666-000000000002",
			altRouteName: "Jalur Alternatif Utara Ubud (Jl. Suweta – Jl. Sri Wedari – Jl. Sandat)",
			altRouteDesc:
				"Rute pengalihan kendaraan roda dua dan roda empat mengitari penutupan Jl. Raya Ubud.",
			altRouteEwkt:
				"SRID=4326;LINESTRING(115.2598 -8.5066, 115.2601 -8.5038, 115.2626 -8.5039, 115.2655 -8.5042, 115.2654 -8.5072)",
		},
		{
			id: "33333333-3333-4333-8333-000000000003",
			organizationId: "11111111-1111-4111-8111-111111111103",
			title: "[SIMULATED] Prosesi Melasti Desa Adat Intaran Sanur",
			category: "melasti",
			description:
				"Simulasi buka-tutup dan pengalihan arus koridor Jl. Danau Tamblingan selama iring-iringan Melasti menuju Pantai Segara Sanur.",
			venueName: "Pura Agung Intaran & Pantai Segara Sanur",
			venueLocationEwkt: "SRID=4326;POINT(115.2619 -8.6913)",
			publicSlug: "simulasi-melasti-intaran-sanur",
			impactId: "55555555-5555-4555-8555-000000000003",
			roadSegmentId: "22222222-2222-4222-8222-000000000022",
			impactType: "intermittent" as const,
			operationalStatus: "intermittent" as const,
			diversionNote:
				"Kendaraan melintas diarahkan menuju koridor Jl. Bypass Ngurah Rai Sanur.",
			altRouteId: "66666666-6666-4666-8666-000000000003",
			altRouteName: "Jalur Pengalihan Jl. Bypass Ngurah Rai Sanur",
			altRouteDesc:
				"Koridor utama yang tetap terbuka selama buka-tutup prosesi Melasti di Jl. Danau Tamblingan.",
			altRouteEwkt:
				"SRID=4326;LINESTRING(115.2616 -8.6882, 115.2572 -8.6884, 115.2575 -8.6915, 115.2578 -8.6949, 115.2622 -8.6948)",
		},
	];

	for (const item of publishedShowcaseEvents) {
		await db
			.insert(events)
			.values({
				id: item.id,
				organizationId: item.organizationId,
				createdBy: SIMULATED_DATA.users.organizer.id,
				title: item.title,
				category: item.category,
				description: item.description,
				venueName: item.venueName,
				venueLocation: sql`ST_GeomFromEWKT(${item.venueLocationEwkt})`,
				status: "published",
				isSimulation: true,
				publicSlug: item.publicSlug,
				startsAt,
				endsAt,
				publishedAt: now,
			})
			.onConflictDoUpdate({
				target: events.id,
				set: {
					title: sql`EXCLUDED.title`,
					description: sql`EXCLUDED.description`,
					venueName: sql`EXCLUDED.venue_name`,
					venueLocation: sql`EXCLUDED.venue_location`,
					status: sql`EXCLUDED.status`,
					startsAt: sql`EXCLUDED.starts_at`,
					endsAt: sql`EXCLUDED.ends_at`,
					publishedAt: sql`EXCLUDED.published_at`,
				},
			});

		await db
			.insert(eventAssignments)
			.values({
				eventId: item.id,
				userId: SIMULATED_DATA.users.officer.id,
				canUpdateTraffic: true,
				canUpdateCleanup: true,
			})
			.onConflictDoNothing();

		await db
			.insert(roadImpacts)
			.values({
				id: item.impactId,
				eventId: item.id,
				roadSegmentId: item.roadSegmentId,
				plannedFrom: startsAt,
				plannedTo: endsAt,
				impactType: item.impactType,
				diversionNote: item.diversionNote,
			})
			.onConflictDoUpdate({
				target: roadImpacts.id,
				set: {
					plannedFrom: sql`EXCLUDED.planned_from`,
					plannedTo: sql`EXCLUDED.planned_to`,
					impactType: sql`EXCLUDED.impact_type`,
					diversionNote: sql`EXCLUDED.diversion_note`,
				},
			});

		await db
			.insert(roadStatusUpdates)
			.values({
				roadImpactId: item.impactId,
				status: item.operationalStatus,
				updatedBy: SIMULATED_DATA.users.officer.id,
				observedAt: now,
				expiresAt: statusExpiresAt,
				mutationId: item.impactId,
				note: item.diversionNote,
			})
			.onConflictDoUpdate({
				target: roadStatusUpdates.mutationId,
				set: {
					status: sql`EXCLUDED.status`,
					observedAt: sql`EXCLUDED.observed_at`,
					expiresAt: sql`EXCLUDED.expires_at`,
				},
			});

		const routeSourceSnapshotHash = createHash("sha256")
			.update(
				JSON.stringify([
					{
						id: item.impactId,
						plannedFrom: startsAt.toISOString(),
						plannedTo: endsAt.toISOString(),
						impactType: item.impactType,
					},
				]),
			)
			.digest("hex");

		await db
			.insert(eventAlternativeRoutes)
			.values({
				id: item.altRouteId,
				eventId: item.id,
				organizationId: item.organizationId,
				name: item.altRouteName,
				description: item.altRouteDesc,
				geom: sql`ST_GeomFromEWKT(${item.altRouteEwkt})`,
				status: "approved",
				createdBy: SIMULATED_DATA.users.organizer.id,
				approvedBy: SIMULATED_DATA.users.organizer.id,
				approvedAt: now,
				expiresAt: endsAt,
				sourceSnapshotHash: routeSourceSnapshotHash,
			})
			.onConflictDoUpdate({
				target: eventAlternativeRoutes.id,
				set: {
					name: sql`EXCLUDED.name`,
					description: sql`EXCLUDED.description`,
					geom: sql`EXCLUDED.geom`,
					status: sql`EXCLUDED.status`,
					sourceSnapshotHash: sql`EXCLUDED.source_snapshot_hash`,
					approvedAt: sql`EXCLUDED.approved_at`,
					expiresAt: sql`EXCLUDED.expires_at`,
				},
			});
	}

	return { success: true };
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
	seedDatabase()
		.then(() => {
			console.log("Safe simulated development fixtures successfully seeded.");
		})
		.catch((err: unknown) => {
			const msg = sanitizeDatabaseError(err);
			console.error("Seeding failed:", msg);
			process.exit(1);
		});
}
