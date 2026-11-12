# Governance phase design draft

Status: approved user decisions captured. Candidate boundary datasets are identified, but their actual geometry has not been downloaded or authority-verified. This work does not duplicate teammate-owned public map/location/routing behavior.

## Confirmed scope and ownership

Map road-layer option, user-location tracking, alternative-route display/behavior, and all-page map health are owned by teammate. No duplicate implementation. Coordinator next-phase scope: superadmin/users/org applications and jurisdiction-bound road-review/spatial authorization; coordinate map-facing contract with teammate later.

User chooses BOTH onboarding paths:
1. Register identity -> apply organization -> pending status -> superadmin review -> approved or rejected with reason/reapply.
2. Superadmin creates organization and prepares organizer activation invitation; user sets own password through one-use expiring activation link. Admin never chooses or sees password. Email is optional; manual copied activation link can be distributed by authorized human, not sent by agent tools.

Normal signup grants no organization privileges. Pending applicants can log in and see /onboarding/status. GET/api/me/organization-applications is scoped to current user; in-app status is primary notification, optional email secondary. Poll60seconds only while visible and pending, manualcheck, recheckonlogin; no websocket infrastructure required. Approved creates membership atomically and idempotently with application decision and audit. Rejected retains reason/history and allows revised application. Retry must not grant duplicate membership or organization.

## Identity and permission model

Keep organization membership organizer/officer with event assignment traffic/cleanup permissions. Superadmin and government reviewer are platform/jurisdiction privileges, not extra organization roles masquerading as organizer. Public remains anonymous/read-only. Existing user may hold privileges in different scopes; explicit server checks decide, never frontend role selector.

Superadmin can bootstrap additional authorized admins, create/manage organizations, invite/assign/suspend organizer/reviewer/officer access and set verified territories. Bootstrap is a secured operational procedure, not default public admin/password. Activation/rolechanges must be audited and cannot silently reset an existing account password. Organizer may invite/manage members only within own organization and assign officer permissions to own events. No grant of platformadmin or governmentreviewer by organizer. Avoid deactivating shared user identity when only organization membership should be suspended; final management semantics to document per action.

Admin surfaces: /admin overview; /admin/organizations (applications/create/details/territory); /admin/users (invite/assign/suspend, modal creation); /admin/reviewers (jurisdiction assignment). Same approved workspace design tokens/profile/sidebar conventions. Governmentreviewer needs a separate scoped review queue with proposed UI contract, not an admin navigation disguised as organizer.

## Independent approval lifecycles (user confirmed)

Organization approval grants organizer membership, not road closure approval. Reviewed event information may be published while road request is pending. Pending/rejected/unapproved proposed closure geometry/status must not appear as approved operational closure on public APIs/maps or assistant. Published event may explicitly say road information not confirmed, without fabricating OPEN.

Real operational authority remains distinct from application simulation approval. Reviewer accounts/demo decisions are labeled simulation until verified authorization/official cooperation. App decision is not claimed as a police permit; approving an organization or a simulated review must not silently set has_operational_authority=true.

Proposed implementation boundary for next discussion: road request binds event, exact segment geometry/version, impact type and approved timewindow. Reviewer scope is checked against assigned jurisdiction server-side. Critical changes after approval require a new review; cannot reuse approval for different location/time. Authorized field officer status updates remain assigned, auditable and expire; cleanup and AI never reopen roads. Exact decision/revoke/expiry lifecycle will be specified before implementation.

## Spatial authorization

Only superadmin assigns/changes organization territory; source/provenance/version and audit required. Frontend map cannot be sole constraint. Road/area mutation and approval must check correct territory and jurisdiction in PostGIS using stored, validated coordinates; administrative names or venue point alone do not establish a whole road lies inside territory. Territory missing/invalid means no operational closure, with explicit configuration path.

Candidate source metadata is provided for Kemendagri 2025 and BIG 2026, but actual resource contents and customary authority are not verified. Do not invent or auto-verify polygons or treat decorative district shapes as legal jurisdiction. Cross-territory requests are blocked for manual handling in this MVP; teammate owns public map presentation/location/routing.

## Verification required in future implementation

- Signup has no automatic organizer access; pending status only self; approve/reject idempotency and atomic membership; revoked/suspended grants denied.
- Invite wrongidentity/reuse/expiry/revocation denied; existingaccount not password-reset by admin.
- Cross-org and reviewer-jurisdiction isolation; organizer cannot grantplatformroles or overwriteterritory.
- Public event content can publish independently while unapproved roadproposal remains private/notoperational; source assistant follows samefilters.
- Missing/outside/crossborder territory rejected per approvedpolicy; update approval invalidation; no cleanup/AI status writes; source/provenance retained.
- Audit actor/time/resource/decision/reason and no token/password/privatepayload logging.
- Safe additive migrations with explicit existingorg/account conversion plan before execution; no blind autoapproval of old organizations or destructive production migration.

The territory import/verification API, admin editor and full-geometry checks are being implemented under issue 05. Road-review lifecycle and final integration remain for issues 06–07.

## Verified references and approved territory rules — 2026-11-12

User authorizes implementation of this territory scope AFTER current UI batch, alongside agreed governance work. GeoJSON import and manual drawing in superadmin organization territory editor with polygon preview, provenance and verification state. This is not permission to start duplicate public map/location/routing features owned by teammate.

Sources inspected (metadata only, no actual dataset geometry downloaded or validated):
- Kemendagri candidate https://data.go.id/dataset/dataset/peta-batas-adiministrasi-desa-desa-adat-2025 — catalog title2025, descriptionJuly2025, published/modified08October2026; lists GeoJSON resource and SDI-process notice. Source label alone is not desa-adat/banjar authority proof.
- BIG candidate https://data.go.id/dataset/dataset/batas_desakel_ar1 — catalog namesJune2026 edition, published/modified21August2026; includes definitive/indicative material and documented limitations. Not blanket verified authority for traditional organizations.
- https://postgis.net/docs/ST_CoveredBy.html — checks all points of A in interior OR boundary of B. Invalid geometry must be rejected first.
- https://postgis.net/docs/ST_IsValid.html — validation of geometry in2D; do not silently repair submitted boundaries into different authority areas.

Confirmed rules:
1. All imported/manually drawn boundaries start pending_verification. Organizer cannot import/verify own authority. Only superadmin verifies, with actor/time/reason/source/evidence; record version and content hash. No auto-verify from provider/dataset name or geometry validity.
2. Accept validated Polygon/MultiPolygon, explicit lon/lat EPSG4326, finite coordinates, nonempty rings, valid topology. Reject invalid/unsupported/ambiguousCRS rather than guessing; show actionable errors. Limit upload/features/vertices consistently with current runtime and productneeds; determine concrete limits during spec planning with current official runtime docs, no rememberedquotas.
3. MVP one pilot polygon labeled SIMULASI with isSimulation true and explanatory not-official-boundary text. Verification confirms reviewed use for simulation, not legal authority. Do not relabel generated pilot as Kemendagri/BIG extractedgeometry or officialdesa-adat boundary; preserve actualsource type. No dataset authenticity claim without download/provenance validation.
4. Organization without verified territory may work on drafts/simulations, including road drafts clearly notoperational; it cannot submit/publish actualoperational closure. After verification, ordinary closure submission must be fully covered by its exact verified territory version. Simulation/demo uses same spatial checks against simulated pilot for test/demo submissions; simulation never creates realoperationalpublication rights.
5. Server enforces ST_CoveredBy(fullRoadGeometry, verifiedTerritoryGeometry), never centroid/midpoint/boundingbox only. LineString/MultiLineString valid geometry supported consistently with roadcontract. Geometry on territory boundary is covered perfunction semantics; this is geometric eligibility only, not closurepermit. Any segment extending outside verifiedterritory is rejected for ordinary request with explicit cross-territory approval-needed message; no automaticclipping/splitting/buffer tolerance or silentterritoryunion.
6. Cross-territory approval implementation is OUT of MVP ordinarysubmission. Show honest blockedreason and admincontact/manualreviewpath, not a fake enabled multisignatureapprovalbutton. Overlapping/disputed/jurisdiction ownership is flagged for humanverification, not inferred by polygoncontainment alone.
7. Verify selectedorg membership, exactevent/road ownership, territoryversion/state and reviewerjurisdiction server-side. Recheck atsubmission, approval and operationalpublication; sourcegeometry/territory/time changes cannot reuse stale approval. Bindapproval to resourceversions and audit; transactionally guard against concurrentchanges. A boundary edit creates a pendingversion, not in-place mutation of verifiedgeometry. Keep old history, clearly mark affected approvals for revalidation before newoperationalchanges; define effective-status handling in rolloutplan, do not mass-reopen roads.
8. Audit boundary create/import/draw/edit/verify/revoke and organization/roaddecisions with actor, UTCtime, object/version, action/reason, requestId. Never log activationtoken/password/privateuploadedcontent. Importing arbitrary user-supplied URL is not part of GeoJSONupload; source URL is provenance text, not automatic serverfetch.
9. Eventinfo publication remains separate; pendingclosure not shown as activeclosedroad through publicAPI/map/assistant. Existing authoritygate remains; simulated reviewer approval or verifiedSIMpolygon does not set actualauthority=true. AI/cleanup never changesroadstatus.

Acceptance additions: spatialtests entireinside/outside, midpointinsidebutendoutside, concavepolygonexit/reentry, boundarytouch, holes, multipolygons/disconnectedroads, invalid/nonfinite/CRS/axisorder, missing/pending/simulatedterritory, crossorg/reviewerdenials, staleversion/concurrency/rollback, verificationrole/audit and eventpublic-withclosurepending. PostGIS actualintegration tests must execute PostGIS functions on guardeddevelopmentDB or localtestDB, not merely inspectSQL text. Data/UI fixtures remain SYNTHETIC_TEST_DATA; public realclosure and officialauthority acceptance separate.

The approved scope below supersedes earlier planning-only statements. Keep the source caveats above visible throughout implementation.

## Execution plan — approved 2026-11-12

Use one Codex session for planning, execution and self-review. Run focused local tests before review. No automatic worker creation; additional workers only for a concrete need. No worktree deletion or merge without explicit approval. Public map/location/routing features remain teammate-owned.

Implementation order and acceptance:

1. Platform authorization and additive schema: separate platform grants from organizer/officer memberships; add organization applications and platform audit history. Deny by default. Cover absent, suspended and revoked grants and cross-organization access. Document bootstrap without default passwords. No production migration execution.
2. Organization applications: authenticated self-only submission/list/status, rejection reason and resubmission history; superadmin approval creates organization/membership/decision/audit atomically and idempotently. Ordinary registration grants no organizer privileges. Existing organization rollout must be explicit, without mass approval.
3. Admin account activation: one-use expiring hashed invitations, scoped roles and reviewer jurisdictions, revoke and wrong-identity protection; never set/reset existing passwords. Distinguish global suspension from organization membership suspension. No automatic email/WhatsApp sending.
4. Territory versions: validated GeoJSON import/manual polygon editor and preview, provenance, pending verification and superadmin-only verification. One explicitly synthetic pilot. Execute real PostGIS tests for full-geometry ST_CoveredBy, holes, crossing and invalid geometry before claiming spatial enforcement verified.
5. Road review: bind decisions to immutable geometry/time/territory versions and assigned reviewer scope, transactionally reject stale decisions. Reviewed event information can publish separately; unapproved operational road proposals remain private across public endpoints and assistant. Cross-territory requests require explicit manual handling, with no fake approval path.
6. Frontend integration: onboarding status with visible pending polling at 60 seconds and manual refresh; four admin screens and scoped reviewer queue; preserve current design system, mobile usability, honest loading/error/empty states. No public role dropdown granting privileges.
7. Local verification then self-review: authorization negatives, activation expiry/reuse, concurrent approval and rollback, API/public filtering, focused browser user journeys, typecheck, lint and build. Reuse unchanged evidence; no paid AI calls. Record actual test results and remaining development PostGIS/runtime gates separately.

Current implementation status (2026-11-13): tickets 04–06 are implemented locally. Guarded development migrations 0011–0013 were applied only to Neon branch br-wandering-paper-aogdxs48. Focused activation, territory and road-review integration plus readiness batches pass; SIMULASI road status requires event-scoped authorization but is exempt from reviewer approval, while real-event updates require current version-bound approval. Public APIs retain labeled SIMULASI data and filter unapproved real-event road impacts. The 10 critical Chromium journeys, typecheck and changed-file lint passed; a final unit/integration regression batch and self-review are recorded in the QA checkpoint. No production migration or deployment was performed.

