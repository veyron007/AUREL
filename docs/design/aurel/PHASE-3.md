# Phase 3 — India field workflow

Implemented 7 November 2026. The field planner builds an explicit selected-place or current-route snapshot using free sources and local calculations. Existing routing, scenes, saved credentials and share documents retain their owners.

## Delivered

- Bounded 48-hour Open-Meteo weather and CAMS global model context, with source units, requested versus model-grid coordinates, validity windows and partial/stale states. US AQI is explicitly distinguished from Indian station AQI. New requests have a conservative durable local ledger; existing weather-effects calls are outside this ledger.
- Route sampling capped at 128 terrain points and three forecast checkpoints. Profiles use verified Mapterhorn EGM2008 elevations and coordinate identity, retaining missing samples. No renderer fallback is presented as a measured height. Daylight uses an explicit IANA timezone and rejects ambiguous/nonexistent local times.
- Bounded FIRMS area observations using the preserved server-side key, a trailing 24-hour window, source-by-source coverage and key-wide rate-limit cooldown. Invalid thermal-power rows are rejected rather than represented as zero. No detections never means no fire.
- Immutable saved analysis snapshots in Fieldbook, with migration from older projects on read and atomic explicit saves. Reopening historical analysis does not refresh providers. Planner results are revealed after explicit Analyze; editing settings remains available and Cancel is not offered for a non-cancellable local save.

## Verification

The full regression run completed 11,236 tests: 11,232 passed, three skipped, and one newly added UI regression was still in its red phase while the run executed. The completed implementation subsequently passed all 33 focused planner, adapter and panel checks. Planner/core coverage exceeds 99% lines and 90% branches; provider and persistence tests cover bounded requests, metadata identity, partial data, cooldown and failed saves.

Actual browser acceptance passed 11/11 checks: no analysis acquisition on mount, selected-place versus route scope, bounded terrain/checkpoints, missing-height presentation, durable save, historical reopen without provider refresh, phone layout and no runtime errors. Browser data were explicit synthetic fixtures; actual bounded public-source probes are recorded separately in [source admission](phase-3/SOURCE-ADMISSION.md). Saved credentials were never used by these browser tests.

Production build, package boundaries and formatting passed at the phase gate. All 11 translation catalogs were complete before subsequent Phase 4 additions. The existing large-bundle warning remains. Later phases extend this same workspace and receive a combined final validation pass.

## Scope and limits

This is preparation and source inspection, not a route-safety or emergency-warning service. Weather is modelled; CAMS is coarse global context; terrain is not a surveyed walking surface. OGD/CPCB production station coverage remains unverified and is not enabled. The dated-imagery and region-pack spikes established feasible free inputs for the next phases; they were not misrepresented as already delivered here.
