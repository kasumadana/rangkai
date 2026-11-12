# Entity Relationship Diagram — Rangkai

Version: 0.1.0
Database: Neon PostgreSQL + PostGIS
ORM: Drizzle

## 1. Entity Relationship Diagram

```mermaid
erDiagram
  USERS ||--o{ MEMBERSHIPS : belongs
  ORGANIZATIONS ||--o{ MEMBERSHIPS : contains
  ORGANIZATIONS ||--o{ EVENTS : organizes
  USERS ||--o{ EVENTS : creates
  EVENTS ||--o{ DOCUMENTS : includes
  DOCUMENTS ||--o{ AI_EXTRACTIONS : produces
  EVENTS ||--o{ EVENT_ASSIGNMENTS : assigns
  USERS ||--o{ EVENT_ASSIGNMENTS : receives
  EVENTS ||--o{ ROAD_IMPACTS : affects
  ROAD_SEGMENTS ||--o{ ROAD_IMPACTS : referenced
  ROAD_IMPACTS ||--o{ ROAD_STATUS_UPDATES : records
  EVENTS ||--o{ CLEANUP_TASKS : contains
  CLEANUP_TASKS ||--o{ CLEANUP_EVIDENCE : has
  EVENTS ||--o{ WASTE_RECORDS : records
  CLEANUP_TASKS o|--o{ WASTE_RECORDS : associated
  ORGANIZATIONS ||--o{ AUDIT_LOGS : scopes
  EVENTS o|--o{ AUDIT_LOGS : traces
```

Better Auth also maintains its own account, session,
and verification tables. Those are omitted from this
domain diagram for clarity.

## 2. Core Tables

### organizations

- id: uuid PK
- name: text NOT NULL
- village: text NULL
- district: text NULL
- has_operational_authority: boolean DEFAULT false
- created_at: timestamptz

### memberships

- id: uuid PK
- organization_id: uuid FK
- user_id: text FK to auth user
- role: organizer | officer
- created_at: timestamptz

UNIQUE (organization_id, user_id)

### events

- id: uuid PK
- organization_id: uuid FK
- created_by: text FK
- title: text NOT NULL
- category: text NULL
- description: text NULL
- venue_name: text NULL
- venue_location: geometry(Point, 4326) NULL, organizer-selected; longitude/latitude. Existing events remain NULL until explicitly set.
- starts_at: timestamptz
- ends_at: timestamptz
- status: draft | review | published |
  active | completed | cancelled | archived
- public_slug: text UNIQUE NULL
- permit_reference: text NULL
- verified_by: text NULL
- verified_at: timestamptz NULL
- published_at: timestamptz NULL
- is_simulation: boolean DEFAULT true
- created_at: timestamptz
- updated_at: timestamptz

CHECK (ends_at > starts_at) when both values exist.

### documents

- id: uuid PK
- event_id: uuid FK
- uploaded_by: text FK
- r2_key: text UNIQUE
- original_name: text
- mime_type: text
- size_bytes: integer
- visibility: private
- created_at: timestamptz

### ai_extractions

- id: uuid PK
- document_id: uuid FK
- model_name: text
- prompt_version: text
- schema_version: text
- output_json: jsonb NULL
- status: pending | processing |
  completed | failed
- error_code: text NULL
- latency_ms: integer NULL
- created_at: timestamptz

### road_segments

- id: uuid PK
- display_name: text
- geom: geometry(LineString, 4326)
- coverage_area: text
- organization_id: uuid FK NULL (set for simulation drafts)
- source_type: catalog | simulation_draft
- created_by: text FK NULL
- verified_by: text NULL
- verified_at: timestamptz NULL
- created_at: timestamptz

### road_impacts

- id: uuid PK
- event_id: uuid FK
- road_segment_id: uuid FK
- planned_from: timestamptz
- planned_to: timestamptz
- impact_type: closure | intermittent |
  narrowing | procession
- diversion_note: text NULL
- created_at: timestamptz

CHECK (planned_to > planned_from).

### road_status_updates

- id: uuid PK
- road_impact_id: uuid FK (ON DELETE RESTRICT - preserves append-only operational history)
- status: open | intermittent | closed | unknown
- observed_at: timestamptz
- expires_at: timestamptz
- updated_by: text FK
- note: text NULL
- mutation_id: uuid UNIQUE
- created_at: timestamptz

Latest status is derived from the newest accepted update.
If expires_at has passed, public status is UNCONFIRMED.
Do not silently insert an OPEN update on expiry.

### event_assignments

- id: uuid PK
- event_id: uuid FK
- user_id: text FK
- can_update_traffic: boolean
- can_update_cleanup: boolean
- created_at: timestamptz

UNIQUE (event_id, user_id)

### invitations

- id: uuid PK
- organization_id: uuid FK
- event_id: uuid FK NULL
- invitation_role: organizer | officer
- recipient_email: text NOT NULL
- token_hash: text UNIQUE
- can_update_traffic: boolean DEFAULT false
- can_update_cleanup: boolean DEFAULT false
- status: pending | accepted | revoked | expired
- accepted_by: text FK NULL
- revoked_by: text FK NULL
- invited_by: text FK
- accepted_at: timestamptz NULL
- revoked_at: timestamptz NULL
- expires_at: timestamptz
- created_at: timestamptz
- updated_at: timestamptz

### activation_invitations

- id: uuid PK
- token_hash: text UNIQUE NOT NULL (SHA-256; plaintext exists only in the one-time response)
- recipient_email: text NOT NULL
- role: organizer | officer | government_reviewer
- organization_id: uuid FK NULL
- event_id: uuid FK NULL
- can_update_traffic: boolean DEFAULT false
- can_update_cleanup: boolean DEFAULT false
- status: pending | accepted | revoked
- expires_at: timestamptz
- created_by: text FK
- accepted_by: text FK NULL
- accepted_at: timestamptz NULL
- created_at: timestamptz

Scope CHECK constraints require organizer to target one organization, officer to target an event in that organization with at least one field permission, and government reviewer to have no organization/event scope. Expired status is derived from `expires_at`; the pending row is retained for history. The activation flow is one-use and does not change credentials for an existing identity.

### platform_grants

- id: uuid PK
- user_id: text FK
- role: superadmin | government_reviewer
- status: active | suspended | revoked
- created_at: timestamptz

UNIQUE (user_id, role). Platform grants are separate from organization memberships. Reviewer jurisdiction is stored separately from this account-activation grant.

### platform_audit

- id: uuid PK
- actor_id: text FK
- action: text
- application_id: uuid FK NULL
- entity_type: text NULL
- entity_id: text NULL
- reason: text NULL
- request_id: text
- created_at: timestamptz

Activation creation, acceptance and revocation record actor, action, invitation identity, role/scope summary and request ID. Raw activation tokens and passwords are never stored in audit data.

### cleanup_tasks

- id: uuid PK
- event_id: uuid FK
- title: text
- description: text NULL
- location: geometry(Point, 4326) NULL
- assigned_user_id: text NULL
- status: todo | in_progress |
  submitted | verified | reopened
- due_at: timestamptz NULL
- verified_by: text NULL
- verified_at: timestamptz NULL
- created_at: timestamptz
- updated_at: timestamptz

### cleanup_evidence

- id: uuid PK
- task_id: uuid FK
- uploaded_by: text FK
- r2_key: text UNIQUE
- stage: before | after
- created_at: timestamptz

### waste_records

- id: uuid PK
- event_id: uuid FK
- task_id: uuid NULL FK
- category: organic | recyclable | residual
- quantity_kg: numeric(10,2) NULL
- sack_count: integer NULL
- measurement_method: weighed | estimated
- destination: text NULL
- recorded_by: text FK
- recorded_at: timestamptz

At least one quantity field must be present.
An estimated sack count must not be displayed as
a measured weight.

### audit_logs

- id: uuid PK
- organization_id: uuid FK
- event_id: uuid NULL FK
- actor_id: text NULL
- action: text
- entity_type: text
- entity_id: text
- before_json: jsonb NULL
- after_json: jsonb NULL
- created_at: timestamptz

Audit logs are append-only at application level.

## 3. Database Indexes

- events (organization_id, starts_at)
- events (status, starts_at)
- events (public_slug) UNIQUE
- documents (event_id)
- road_impacts (event_id)
- road_impacts (road_segment_id, planned_from)
- road_status_updates (road_impact_id, created_at DESC)
- cleanup_tasks (event_id, status)
- audit_logs (event_id, created_at DESC)

Spatial indexes:

- GIST on road_segments.geom
- GIST on cleanup_tasks.location

## 4. Integrity Rules

- Organization membership is required for organizer access.
- Field assignments cannot grant permissions outside
  the assigned event.
- Road impacts reference only reviewed road segments.
- A document belongs to exactly one event.
- Event publication requires reviewed core information.
- Deleting a user must not destroy historical audit records.
- Road-status history is append-only: road_status_updates cannot be deleted or cascadingly deleted via road_impacts (ON DELETE RESTRICT).
- Finite domain values are enforced via CHECK constraints on memberships (role), events (status), ai_extractions (status), road_impacts (impact_type), road_status_updates (status), cleanup_tasks (status), cleanup_evidence (stage), and waste_records (category, measurement_method).
- Private file objects must never be exposed through
  public event API responses.

## 5. Migration Strategy

Use Drizzle Kit for ordinary schema changes.
Use SQL migrations for PostGIS and geometry indexes.

Example:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE INDEX road_segments_geom_idx
ON road_segments
USING GIST (geom);
```

Run migrations against a development Neon branch first.

- 0000_premium_wallflower.sql: Initial baseline schema, PostGIS extension, spatial & B-tree indexes, Better Auth tables.
- 0001_eager_ben_urich.sql: Additive follow-up applying finite domain CHECK constraints and altering road_status_updates.road_impact_id to ON DELETE RESTRICT.

## 6. Important Design Decisions

- Store timestamps in UTC.
- Render event dates in Asia/Makassar.
- Store road geometry as LineString, not a guessed polygon.
- Use immutable road-status history.
- Derive the current status from history.
- Keep waste measurements separate from AI predictions.
- Keep document content private by default.

## Organization governance (approved 2026-11-12)

`platform_grants` associates a user with a distinct superadmin or government_reviewer role and active, suspended or revoked state; user and role are unique. `organization_applications` records applicant, proposed name/village/district, pending/approved/rejected decision, reason, decision actor/time and resulting organization; one pending application per applicant is enforced by a partial unique index. `platform_audit` records actor, action, application, reason, request ID and UTC timestamp. Foreign keys preserve relationships. Existing memberships and organizations are not backfilled or automatically approved.
