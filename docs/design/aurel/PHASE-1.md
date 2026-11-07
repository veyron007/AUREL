# Phase 1 — coherent workspace

AUREL now has a persistent place/coordinate search, four task destinations and one contextual inspector. Existing tool owners still execute every action. No provider, renderer, scene-document or credential migration was introduced.

## What changed

- Explore opens data layers and exposes context, cameras and street imagery. Compare opens existing recent imagery when available, otherwise explains how to enable it. Plan opens directions, drawing and imports. Library retains existing scene authoring; richer projects belong to Phase 2.
- All tools remains available from every destination, including the existing location tray and visual presets. Existing keyboard, tracking, cockpit, recording and scene owners remain in control.
- Observatory is the selected daily workspace. Field provides light reading surfaces; Instrument retains a more compact technical appearance. The isolated `aurel.workspace.appearance.v1` preference cannot change keys, map sources, renderer styles or scene documents. Blocked browser storage falls back to a working session preference.
- Mobile uses one inspector with minimized, half and full presentations. Panels stay mounted, preserving edits. Short landscape uses a compact header and bounded, scrollable reading area. Task navigation retains visible keyboard focus.
- Restored older layouts can contain several open panels. The workspace shows one at a time without rewriting the saved disclosure state; selecting another tool brings it forward.
- The existing Manrope, JetBrains Mono, Inter, Arabic and Material Symbols fonts are local licensed assets. Font loading no longer depends on Google Fonts. [Provenance and licenses](phase-1/fonts.md).

[Three design studies and acceptance contract](phase-1/CONTRACT.md) explain the selected layout. [Interactive exploration sheet](phase-1/explorations.html) compares schematic examples; those drawings are explicitly not geographic evidence.

## Validation

The repeatable browser test is `node scripts/qa-aurel-workspace.mjs` with the local development server on port 4173 (or `QA_BASE_URL`). It uses a fresh browser profile and blocks all external requests. It exercises coordinate search, all four destinations, existing scene capture/reload, appearance persistence and isolation, mobile sheet sizes, narrow/short layouts, keyboard activation/focus, inline errors, legacy panel restoration and Free-only status. Screenshots and check results live in [phase-1/evidence](phase-1/evidence).

`node scripts/qa-workspace-attribution.mjs` separately checks credit visibility and clearance across desktop/phone dimensions and sheet states. Its synthetic credit line tests geometry, not provider licensing. Actual Natural Earth attribution also appears in the workspace captures.

Focused new state tests cover invalid preferences, blocked storage, owner disposal, navigation delegation, retained panel state and restored-layout presentation. Workspace preference/navigation-store coverage is 100% of lines and 93.75% of branches; this is not a whole-repository coverage claim.

## Recorded release checks

- Full unit/integration runner: **11,044 tests, 11,041 passed, zero failures, three skips**. The runner also skips two allocation probes calibrated for Node 24; this machine runs Node 26.13.0.
- Browser workspace acceptance: **23 assertions passed**, with external requests blocked and no runtime errors. Laptop and loading-state captures supplement the scripted viewport sweep.
- Attribution: **15 focused tests and 26 rendered layout states passed**. A final short-screen change removed duplicate basic panel headers; its affected CSS tests passed and the short screen was rendered again.
- Production build, import/package boundaries, formatter and all **11 locale catalogs (2,975 messages each)** pass. The build retains the existing large-chunk warning.
- Performance runner: both benchmarks passed with the test server stopped. The first run missed one unchanged wildlife pipeline slice budget narrowly (4.044 ms against 4 ms); the isolated rerun measured a 1.977 ms maximum slice. No timing threshold was relaxed.
- Private configuration hashes are unchanged. The temporary development server and headless browser processes were closed.

## Boundaries

Free-only enforcement remains active, and private configuration integrity is checked without printing its contents. Existing keys are preserved. No new paid API, account, model, hosting service or package dependency was added.

The bundled overview is intentionally coarse. It does not provide street-level Dehradun imagery or dated evidence. The browser captures use that overview to verify the interface with external network access disabled; they do not certify live provider coverage. This phase does not claim a full accessibility certification or implement the later Lens, Fieldbook, Chronicle or offline region-pack features.
