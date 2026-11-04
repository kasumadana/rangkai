# Issue tracker: Local Markdown

Issues and specs live under `.scratch/<feature-slug>/` in this repository.

- Spec, when needed: `spec.md`. Reuse existing authoritative requirements rather than duplicate them.
- Tickets: one file each at `issues/<NN>-<slug>.md`, numbered blockers-first.
- Every ticket records What to build, Status, Blocked by, requirement/source references and verifiable acceptance criteria. Use triage-labels.md for status vocabulary.
- Append discussion under Comments. Do not close/change parent issues without authorization.
- Publish means write the approved local file. Fetch means read its exact referenced file and comments.
- Work only tickets whose genuine blockers are resolved. External real-data acceptance may be deferred only by explicit user instruction and must remain visible separately from software acceptance.
- Existing native Orca batches may retain their explicitly supplied shared absolute ticket paths until completed. Use their Run spec as locator, avoid duplicate tickets, and preserve their history.

For wayfinding, use `map.md` plus one numbered decision ticket per file. Each records Type, Status and Blocked by. Claim before work; resolve with an Answer and a linked decision on the map. to-tickets output is already agent-ready and is not sent through triage again.

Do not create remote issues, contact others or update spreadsheet statuses merely because this local tracker is configured.
