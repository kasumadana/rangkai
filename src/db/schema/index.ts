import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	customType,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";

// ponytail: PostGIS geometry custom types mapping directly to typed geometries in PostGIS
export const lineStringGeometry = customType<{ data: string; driverData: string }>({
	dataType() {
		return "geometry(LineString, 4326)";
	},
});

export const pointGeometry = customType<{ data: string; driverData: string }>({
	dataType() {
		return "geometry(Point, 4326)";
	},
});

// Domain finite value enumerations & types (AGENTS.md §13)
export const MEMBERSHIP_ROLES = ["organizer", "officer"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const EVENT_STATUSES = [
	"draft",
	"review",
	"published",
	"active",
	"completed",
	"cancelled",
	"archived",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const AI_EXTRACTION_STATUSES = [
	"pending",
	"processing",
	"completed",
	"failed",
] as const;
export type AiExtractionStatus = (typeof AI_EXTRACTION_STATUSES)[number];

export const IMPACT_TYPES = [
	"closure",
	"intermittent",
	"narrowing",
	"procession",
] as const;
export type ImpactType = (typeof IMPACT_TYPES)[number];

export const ROAD_STATUSES = [
	"open",
	"intermittent",
	"closed",
	"unknown",
] as const;
export type RoadStatus = (typeof ROAD_STATUSES)[number];

export const CLEANUP_STATUSES = [
	"todo",
	"in_progress",
	"submitted",
	"verified",
	"reopened",
] as const;
export type CleanupStatus = (typeof CLEANUP_STATUSES)[number];

export const CLEANUP_STAGES = ["before", "after"] as const;
export type CleanupStage = (typeof CLEANUP_STAGES)[number];

export const WASTE_CATEGORIES = ["organic", "recyclable", "residual"] as const;
export type WasteCategory = (typeof WASTE_CATEGORIES)[number];

export const MEASUREMENT_METHODS = ["weighed", "estimated"] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];

export const INVITATION_ROLES = ["officer", "organizer"] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export const INVITATION_STATUSES = [
	"pending",
	"accepted",
	"revoked",
	"expired",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const organizations = pgTable("organizations", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	village: text("village"),
	district: text("district"),
	hasOperationalAuthority: boolean("has_operational_authority").default(false).notNull(),
	operationalAuthorityGrantedAt: timestamp("operational_authority_granted_at", { withTimezone: true }),
	operationalAuthorityGrantedBy: text("operational_authority_granted_by"),
	operationalAuthorityProvenance: text("operational_authority_provenance"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
	"memberships",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").$type<MembershipRole>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("memberships_org_user_unique").on(table.organizationId, table.userId),
		check(
			"memberships_role_check",
			sql`role IN ('organizer', 'officer')`,
		),
	],
);

export const events = pgTable(
	"events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		title: text("title").notNull(),
		category: text("category"),
		description: text("description"),
		venueName: text("venue_name"),
		startsAt: timestamp("starts_at", { withTimezone: true }),
		endsAt: timestamp("ends_at", { withTimezone: true }),
		status: text("status").$type<EventStatus>().default("draft").notNull(),
		publicSlug: text("public_slug").unique(),
		permitReference: text("permit_reference"),
		processionDescription: text("procession_description"),
		trafficImpactDescription: text("traffic_impact_description"),
		organizerName: text("organizer_name"),
		cleanupLocationNotes: text("cleanup_location_notes"),
		contactInformation: text("contact_information"),
		verifiedBy: text("verified_by"),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		isSimulation: boolean("is_simulation").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check(
			"events_ends_at_after_starts_at",
			sql`ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at`,
		),
		check(
			"events_status_check",
			sql`status IN ('draft', 'review', 'published', 'active', 'completed', 'cancelled', 'archived')`,
		),
		index("events_org_starts_at_idx").on(table.organizationId, table.startsAt),
		index("events_status_starts_at_idx").on(table.status, table.startsAt),
	],
);

export const documents = pgTable(
	"documents",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		eventId: uuid("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		uploadedBy: text("uploaded_by")
			.notNull()
			.references(() => user.id),
		r2Key: text("r2_key").notNull().unique(),
		originalName: text("original_name").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		visibility: text("visibility").default("private").notNull(),
		aiConsentBy: text("ai_consent_by"),
		aiConsentAt: timestamp("ai_consent_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("documents_event_id_idx").on(table.eventId)],
);

export const aiExtractions = pgTable(
	"ai_extractions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		modelName: text("model_name").notNull(),
		promptVersion: text("prompt_version").notNull(),
		schemaVersion: text("schema_version").notNull(),
		outputJson: jsonb("output_json"),
		status: text("status").$type<AiExtractionStatus>().default("pending").notNull(),
		errorCode: text("error_code"),
		latencyMs: integer("latency_ms"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	() => [
		check(
			"ai_extractions_status_check",
			sql`status IN ('pending', 'processing', 'completed', 'failed')`,
		),
	],
);

export const roadSegments = pgTable(
	"road_segments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		displayName: text("display_name").notNull(),
		geom: lineStringGeometry("geom").notNull(),
		coverageArea: text("coverage_area").notNull(),
		verifiedBy: text("verified_by"),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("road_segments_geom_gist_idx").using("gist", table.geom)],
);

export const roadImpacts = pgTable(
	"road_impacts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		eventId: uuid("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		roadSegmentId: uuid("road_segment_id")
			.notNull()
			.references(() => roadSegments.id, { onDelete: "restrict" }),
		plannedFrom: timestamp("planned_from", { withTimezone: true }).notNull(),
		plannedTo: timestamp("planned_to", { withTimezone: true }).notNull(),
		impactType: text("impact_type").$type<ImpactType>().notNull(),
		diversionNote: text("diversion_note"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check("road_impacts_time_check", sql`planned_to > planned_from`),
		check(
			"road_impacts_type_check",
			sql`impact_type IN ('closure', 'intermittent', 'narrowing', 'procession')`,
		),
		index("road_impacts_event_id_idx").on(table.eventId),
		index("road_impacts_segment_planned_idx").on(
			table.roadSegmentId,
			table.plannedFrom,
		),
	],
);

export const roadStatusUpdates = pgTable(
	"road_status_updates",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// ponytail: restrict deletion to preserve immutable append-only road status history
		roadImpactId: uuid("road_impact_id")
			.notNull()
			.references(() => roadImpacts.id, { onDelete: "restrict" }),
		status: text("status").$type<RoadStatus>().notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by")
			.notNull()
			.references(() => user.id),
		note: text("note"),
		mutationId: uuid("mutation_id").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check(
			"road_status_updates_status_check",
			sql`status IN ('open', 'intermittent', 'closed', 'unknown')`,
		),
		index("road_status_updates_impact_created_idx").on(
			table.roadImpactId,
			table.createdAt.desc(),
		),
	],
);

export const eventAssignments = pgTable(
	"event_assignments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		eventId: uuid("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		canUpdateTraffic: boolean("can_update_traffic").default(false).notNull(),
		canUpdateCleanup: boolean("can_update_cleanup").default(false).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("event_assignments_event_user_unique").on(
			table.eventId,
			table.userId,
		),
	],
);

export const invitations = pgTable(
	"invitations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		eventId: uuid("event_id").references(() => events.id, {
			onDelete: "cascade",
		}),
		invitationRole: text("invitation_role")
			.$type<InvitationRole>()
			.notNull(),
		recipientEmail: text("recipient_email").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		canUpdateTraffic: boolean("can_update_traffic").default(false).notNull(),
		canUpdateCleanup: boolean("can_update_cleanup").default(false).notNull(),
		status: text("status")
			.$type<InvitationStatus>()
			.default("pending")
			.notNull(),
		invitedBy: text("invited_by")
			.notNull()
			.references(() => user.id),
		acceptedBy: text("accepted_by").references(() => user.id),
		acceptedAt: timestamp("accepted_at", { withTimezone: true }),
		revokedBy: text("revoked_by").references(() => user.id),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check(
			"invitations_role_check",
			sql`invitation_role IN ('officer', 'organizer')`,
		),
		check(
			"invitations_status_check",
			sql`status IN ('pending', 'accepted', 'revoked', 'expired')`,
		),
		index("invitations_token_hash_idx").on(table.tokenHash),
		index("invitations_org_status_idx").on(table.organizationId, table.status),
		index("invitations_email_idx").on(table.recipientEmail),
	],
);

export const cleanupTasks = pgTable(
	"cleanup_tasks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		eventId: uuid("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description"),
		location: pointGeometry("location"),
		assignedUserId: text("assigned_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		status: text("status").$type<CleanupStatus>().default("todo").notNull(),
		dueAt: timestamp("due_at", { withTimezone: true }),
		verifiedBy: text("verified_by"),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check(
			"cleanup_tasks_status_check",
			sql`status IN ('todo', 'in_progress', 'submitted', 'verified', 'reopened')`,
		),
		index("cleanup_tasks_event_status_idx").on(table.eventId, table.status),
		index("cleanup_tasks_location_gist_idx").using("gist", table.location),
	],
);

export const cleanupEvidence = pgTable(
	"cleanup_evidence",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => cleanupTasks.id, { onDelete: "cascade" }),
		uploadedBy: text("uploaded_by")
			.notNull()
			.references(() => user.id),
		r2Key: text("r2_key").notNull().unique(),
		stage: text("stage").$type<CleanupStage>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	() => [
		check(
			"cleanup_evidence_stage_check",
			sql`stage IN ('before', 'after')`,
		),
	],
);

export const wasteRecords = pgTable(
	"waste_records",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		eventId: uuid("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		taskId: uuid("task_id").references(() => cleanupTasks.id, {
			onDelete: "set null",
		}),
		category: text("category").$type<WasteCategory>().notNull(),
		quantityKg: numeric("quantity_kg", { precision: 10, scale: 2 }),
		sackCount: integer("sack_count"),
		measurementMethod: text("measurement_method").$type<MeasurementMethod>().notNull(),
		destination: text("destination"),
		recordedBy: text("recorded_by")
			.notNull()
			.references(() => user.id),
		recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
	},
	() => [
		check(
			"waste_records_quantity_check",
			sql`quantity_kg IS NOT NULL OR sack_count IS NOT NULL`,
		),
		check(
			"waste_records_category_check",
			sql`category IN ('organic', 'recyclable', 'residual')`,
		),
		check(
			"waste_records_method_check",
			sql`measurement_method IN ('weighed', 'estimated')`,
		),
	],
);

export const auditLogs = pgTable(
	"audit_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		eventId: uuid("event_id").references(() => events.id, {
			onDelete: "set null",
		}),
		actorId: text("actor_id"), // preserved even if user is removed
		action: text("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id").notNull(),
		beforeJson: jsonb("before_json"),
		afterJson: jsonb("after_json"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("audit_logs_event_created_idx").on(
			table.eventId,
			table.createdAt.desc(),
		),
	],
);
