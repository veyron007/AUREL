# Phase 2 — Lens and Fieldbook

Implemented and verified 7 November 2026. This phase extends the Phase 1 workspace; later roadmap phases remain separate work.

## Delivered

- **Lens:** geographic search/selection dossier with Overview, Evidence and Notes. Existing search now publishes its resolved coordinates and extent, without changing camera behavior. Unknown observation dates, image resolution, coverage and uncertainty remain unknown. Layer-wide counts are not presented as local results. Source updates cannot revive an old selection.
- **Fieldbook:** local projects, places, notes, source evidence, routes, manual drawings, passive local-file attachments and scene-document associations. Save actions from Lens commit before announcing success. Library retains access to the existing scene authoring tools.
- **Persistence:** native IndexedDB with atomic revision comparisons across tabs, explicit unsaved/error states, and separate active/protected draft recovery. Corrupt records remain available for recovery. Strict bounded documents reject unknown fields, unsafe references and invalid geometry. Wrapped geographic extents are supported.
- **Portability:** previewed JSON backup and import as a separate project. Existing project IDs are preserved by ordinary save/reopen; duplication/import copies remap their internal references. Scene schema version 6 and existing scene/share storage remain unchanged. Attachments are passive bytes; online scene assets are references, not secretly downloaded content.
- **Brief:** deterministic summaries of saved facts and notes, with missing information explicitly retained. No model or paid API is used.

The application composition passes named existing-owner interfaces into these controllers. Disposal removes subscriptions, aborts pending renderer work and closes project storage. No new package dependency or provider credential was added. The existing private configuration hash was verified unchanged.

## Verification

- Full regression run: **11,151 tests**, initially 11,136 passed, 3 skipped and 12 failed. Eleven failures were the two final untranslated messages; the other was a pre-existing parser deadline under parallel CPU load. After translations, the affected catalog/parser suites passed **65/65** in isolation, without changing the deadline.
- Final focused controller, presentation and attribution regression checks: **74/74 passed**. Additional native Chromium IndexedDB tests cover two-connection conflicts, reopen persistence and corrupt-record recovery. New data modules exceed 98% line/85% branch coverage; controller/helper coverage exceeds 93% lines. Existing allocation microbenchmarks remain calibrated to Node 24 rather than this machine's Node 26.
- Actual offline browser workflow: **12/12 checks**, including search, place/note persistence, reload, download, import as a copy, mobile/landscape, zero runtime errors and no billable-provider host attempts.
- Existing workspace/scene workflow: **23/23 checks**, including scene creation/capture/reload, share-state preservation, keyboard focus and short-screen controls.
- Production build, complete package-boundary checks, formatting scope (1,887 files) and all 11 translation catalogs (3,136 messages each) pass. The build retains the repository's large-chunk warning.
- [Design contract](phase-2/CONTRACT.md), [browser checks](phase-2/evidence/checks.json), and [rendered evidence](phase-2/evidence/design-evidence.json) record the actual UI. Screenshots were inspected; the evidence checker passes. This is scoped accessibility acceptance, not a full WCAG certification.

## Boundaries

Fieldbook storage belongs to this browser origin/device. Exported backups are the portable copy. Clearing browser storage can remove local projects. Large original file imports are not automatically bundled; the explicit attachment action accepts bounded supported files. Saved scene assets remain references. The bundled Natural Earth map is an overview, not detailed offline Dehradun imagery.

Live weather forecasts, route profiles/daylight, area-aware thermal detections, dated comparison and region packs belong to subsequent phases. No claim is made here that these are already implemented. Validation servers and browser processes were stopped after this phase; later validation may start a temporary project-owned server again.
