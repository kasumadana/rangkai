# UX and Information Architecture — Rangkai

Version: 0.1.0
Primary mode: Operate
Design principles: Pramana, progressive disclosure

## 1. Design Objective

Help users complete operational tasks with minimal
navigation, ambiguity, and unnecessary data entry.

Avoid decorative AI chatbots and unused dashboard widgets.

## 2. Information Architecture

Public:

- /
- /events
- /events/:slug
- /events/:slug/map

Authenticated:

- /dashboard
- /dashboard/events
- /dashboard/events/new
- /dashboard/events/:id
- /dashboard/events/:id/document
- /dashboard/events/:id/review
- /dashboard/events/:id/roads
- /dashboard/events/:id/cleanup
- /dashboard/events/:id/team
- /field/events/:id
- /settings

## 3. Main Screens

### A. Public Event List

Show:

- Event name
- Location
- Date and time
- Operational status
- Last update timestamp

Filters:

- Date
- Area
- Current/upcoming/completed

Do not show unpublished events.

### B. Public Event Detail

Top section:

- Event title
- Organizer attribution
- Time window
- Information verification label
- Last updated time

Middle:

- Road-impact map
- List of affected segments
- Current status for each segment

Bottom:

- Event context
- Public guidance
- Data limitation note

If map tiles fail, show the road list.

### C. Organizer Dashboard

Show:

- Draft events
- Upcoming published events
- Events requiring review
- Assigned field officers
- Unverified cleanup tasks

Primary CTA: Create Event.

### D. Create Event

Step 1: Basic details.
Step 2: Upload announcement.
Step 3: Extract with AI.
Step 4: Review and correct fields.
Step 5: Select road segments.
Step 6: Configure cleanup tasks.
Step 7: Review and publish.

Allow save as draft at every step.

### E. AI Review Screen

Two-panel layout on desktop:

- Left: original document preview.
- Right: extracted fields.

On mobile:

- Document preview collapses into a drawer.
- Fields remain editable.

Field indicators:

- Extracted
- Missing
- Needs review
- Corrected
- Confirmed

Never represent AI output as final before review.

### F. Field Officer Screen

Show only assigned events and allowed actions.

Traffic officer:

- Segment name
- Current effective status
- OPEN / INTERMITTENT / CLOSED buttons
- Last update
- Confirmation dialog
- Submission result

Cleanup officer:

- Assigned tasks
- Start task
- Upload before/after photo
- Submit for verification
- Record waste quantities

### G. Cleanup Review

Organizer sees:

- Task location
- Assigned officer
- Before/after evidence
- Status
- Verify or reopen action

Verification requires explicit human action.

## 4. User Journey: Organizer

1. Sign in.
2. Create event draft.
3. Upload announcement.
4. Review AI result.
5. Resolve ambiguous locations.
6. Add road impacts.
7. Add cleanup responsibilities.
8. Publish.
9. Monitor field updates.
10. Close event.

Success state:

- Public link is available.
- Publication time is recorded.

## 5. User Journey: Field Officer

1. Open assigned event.
2. Review authorized actions.
3. Select segment or cleanup task.
4. Submit update.
5. Wait for server confirmation.
6. See updated state and timestamp.

Failed update:

- Preserve form values.
- Show retry action.
- Do not display false success.

## 6. User Journey: Public

1. Open shared link or event directory.
2. Identify event time and location.
3. Inspect affected roads.
4. Read latest confirmed status.
5. See uncertainty if data is stale.

No login, account creation, or app download required.

## 7. Empty and Error States

No events:
"Belum ada kegiatan yang dipublikasikan."

No matching road:
"Ruas jalan belum ditemukan. Pilih secara manual."

AI unavailable:
"Ekstraksi otomatis belum tersedia. Isi data secara manual."

Stale status:
"Status terakhir belum dikonfirmasi ulang."

Map unavailable:
"Peta tidak tersedia. Informasi jalan tetap dapat dibaca."

Upload failed:
"Dokumen belum tersimpan. Coba unggah kembali."

## 8. Accessibility

- WCAG 2.2 AA target.
- Keyboard navigation.
- Visible focus indicators.
- Sufficient text contrast.
- Large touch targets.
- Labels on every input.
- Status text in addition to color.
- Screen-reader announcements for critical updates.
- Avoid map-only communication.

## 9. Visual Direction

Tone:

- Civic utility
- Calm and trustworthy
- Culturally respectful
- Mobile-first

Use a restrained visual system.
Prioritize readable typography and functional maps.

Do not add ceremonial imagery to every screen.
Cultural context belongs in event information,
not in decorative UI that slows task completion.
