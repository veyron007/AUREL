# WP1 — Kshitij Horizon Engine

Delivered 7 November 2026 on branch `claude/wp1-horizon-engine-14f40d` (from `main` `45efecdc`, merged with `ef0eae9f`). Plan: [IMPLEMENTATION-PLAN-02.md §6 WP1](../../IMPLEMENTATION-PLAN-02.md). Sources: [SOURCE-ADMISSION.md](SOURCE-ADMISSION.md).

## What it does

`horizon_at(lat, lon, observerHeight, date)` returns, for one point:

- the **360° terrain horizon**: 720 rays at 0.5°, from 60 m to 200 km, with refraction k = 0.13 folded into an effective Earth radius;
- the **named peaks** on that horizon: OSM `natural=peak` with azimuth, distance, apparent elevation, DEM summit height beside OSM `ele`, and a state (on the skyline, below farther terrain, marginal within 0.1°, or hidden);
- **astronomical against terrain-clipped** sunrise, sunset and moonrise for a local date, plus direct-sun minutes;
- a **gnomon shadow** for a chosen local time: Sun elevation and azimuth, terrain shadow state, shadow length and direction.

Every result is labelled "geometric visibility, terrain-only". Azimuths are rounded to 1° and times to the minute. The DEM source, applicable time, void count, absent tiles, refraction and attribution are shown. No "guaranteed view" wording appears anywhere.

### Surfaces

| Surface | Where | Behaviour |
| --- | --- | --- |
| Planner card | Plan → Field planner, place scope | Date, shadow time, eye height above the DEM surface, gnomon height, IANA zone; explicit **Compute horizon**, cancellable; nothing is computed on mount or on selection |
| Lens card | Lens → Overview | The same card and owner; one result is shared by both cards |
| Globe | `CustomDataSource('kshitij-horizon')` | Brass (`#d6ab55`) ground-clamped skyline trace, one vertex per ray at its blocking terrain, the observer point, and up to six skyline peak markers whose names ("Name · km · az ° · terrain-only") go through the shared world-overlay host, never Cesium labels; cleared when the place changes |
| Fieldbook | Library → Saved analyses | New analysis kind `horizon` on the observed place: 360 whole-degree angles and distances, Sun/Moon times, shadow, up to 20 peaks, DEM and gazetteer provenance, a fixed class table; strict validation; reopening never refreshes |
| MCP | `horizon_at` (MCP only, voice off) | Returns the `aurel.horizon` provenance envelope: every number is `{ value, unit, class, source, applicableTime }`; see [TOOLS.md](../../../../TOOLS.md) and [MCP_SETUP.md](../../../../MCP_SETUP.md) |

### Architecture

| Layer | Files |
| --- | --- |
| Pure engine (`src/horizon/`) | `constants.js`, `geodesy.js` (radial schedule, destination/bearing), `rayMarch.js`, `ephemeris.js` (NOAA Sun, Almanac Moon, Saemundsson refraction), `events.js` (terrain-clipped rise/set, shadow), `peaks.js` (matching), `grid.js` (polar grid codec and strict payload validation), `compute.js` (one computation), `envelope.js` (rounding and provenance), `snapshot.js` (Fieldbook projection), `service.js` (the `horizon_at` capability), `horizon.worker.js` + `workerRunner.js` (Web Worker in the browser, inline in Node) |
| DEM provider (`server/providers/horizon/`) | `glo30.js` (bounded keyless COG range reads, disk and memory cache), `sampler.js` (max-pooled polar sampler over three DEM levels), `index.js` (`/api/horizon/terrain`, same-site, rate limited) |
| Gazetteer | `src/regions/peaks.js` (admission), `scripts/regions/peaks.py` + `scripts/build-region-pack.mjs --theme peaks` (offline build), `public/regions/dehradun-peaks/` |
| UI owner/store/view | `src/ui/horizonController.js`, `src/ui/stores/horizon.js`, `src/ui/views/panels/HorizonCard.vue`, `src/ui/views/panels/FieldbookHorizon.vue`, `src/ui/styles/horizon.css` (Lamplight `--workspace-*` tokens only), `src/app/horizonTools.js` (globe ring, service, Fieldbook save) |
| Registration seams | `server/providers/local.js`, `src/app/tools.js`, `src/tools/{index,services,surfaces}.js`, `src/tools/queries/horizon.js`, `src/fieldbook/{analysis,document,operations,horizonAnalysis}.js`, `src/ui/{fieldbookController,fieldbookPresentation}.js`, `LensPanel.vue`, `PlannerPanel.vue`, `FieldbookPanel.vue`, `aurel.css`, `scripts/package-boundaries.json`, 11 locale catalogs |

The server only samples the DEM. It ships a polar elevation grid that does not depend on observer height or refraction (≈ 1.0 MB). The ray-march, ephemeris and peak matching run in a browser Web Worker, or inline for MCP. Changing the eye height therefore never refetches the DEM. Lamplight and Cyber theme files are unchanged.

## Lal Tibba result (live GLO-30, 21 December 2026, pin 30.4597 N 78.1058 E, eye 1.7 m)

| Item | Value |
| --- | --- |
| DEM surface at the pin | 1,989 m (the pin is about 1 km ESE of the 2,297 m DEM summit at 30.4632 N, 78.0957 E, so the hillside 90 m to the west raises the western horizon to 36°) |
| Astronomical sunrise / Sun clears the terrain | 07:10 IST / 07:56 IST (46 min later) |
| Astronomical sunset / Sun drops behind the terrain | 17:21 IST / 14:44 IST |
| Direct sun | 6 h 44 min |
| Moonrise, flat / over terrain | 14:32 / 15:23 IST |
| Shadow at 12:30 IST | Sun 36° at 184°; 1 m gnomon → 1.38 m toward 4° |
| Skyline peaks (9) | Nag Tibba (az 17°, 14.8 km), Bandarpunch I (az 35°, 74.1 km, DEM 6,213 m, OSM 6,316 m), Bandarpunch II, Swargarohini I–III (az 28°, ~81 km), Gangotri I and II (az 54–55°, 87.3 km), Srikantha (az 50°, 86.7 km) |
| Marginal (5) | Arjit mountain, Chagle, Uchalara, Tinthya, Bakria |
| Hidden | 329 named peaks in range, including Nanda Devi and Kamet, from this pin |
| DEM voids / absent tiles | 0 / 0 |

The plan's demo copy ("Bandarpunch 6,316 m · 68 km · az 41°", "astronomical 06:41 IST; clears ridge 07:08") was marked illustrative. The computed values above replace it.

## Verification

| Check | Result |
| --- | --- |
| Targeted tests while building | `src/horizon/*.test.mjs` (horizon, ephemeris, peaks, snapshot), `src/regions/peaks.test.mjs`, `server/providers/horizon/horizon.test.mjs`, `src/tools/queries/horizon.test.mjs`, `src/ui/horizonController.test.mjs`, `src/ui/views/panels/horizonCard.test.mjs`: all pass, plus the existing Fieldbook, tools, MCP, Planner, Lens and region-pack suites |
| `npm test` | **Not green on this machine.** Two full runs of 11,472 tests while seven other sessions were testing (load average 35–50). Run 1: 11,463 passed, 5 failed. One failure was WP1's (`noCesiumLabels.test.mjs`, Cesium labels on the ring), fixed in `3d4f4c76` by moving peak names to the world-overlay host. Run 2: 11,465 passed, 3 failed, 4 skipped. The 3 failures are process timeouts outside WP1 (`geoFileImport` KML deadline `spawnSync … ETIMEDOUT`, two `devCctv` launcher tests over their 30 s budget); their files pass 116/116 in isolation, and run 1's failing set differed. Skips: optional PyOsmium builder (needs `AUREL_PYOSMIUM`), the Windows DACL hardener, and two opt-in perf budgets. The orchestrator should re-run the suite on an idle machine |
| `npm run format:check` | Passes (2,028 files). `scripts/format-scope.json` on `main` listed two deleted tests (`src/fieldbook/document.test.mjs`, `src/sources/firmsArea.test.mjs`), which made `format:check` fail for every branch; those two lines are removed here |
| `npm run check:boundaries` | Passes |
| `npm run i18n` | 11 catalogs complete at 3,662 messages; no unmarked UI text |
| `scripts/qa-aurel-horizon.mjs` | 14/14 checks pass at 1440×900 and 390×844 (port 4187). External requests aborted; `/api/horizon/terrain` served by a labelled synthetic DEM; bundled peaks pack from the local server. Evidence: `evidence/checks.json`, `horizon-desktop*.png`, `horizon-mobile.png` |
| Live browser check | The Lal Tibba flow above against live GLO-30 through the dev server, external browser requests blocked: one terrain request, ring, observer point and six skyline peak markers drawn (names through the world-overlay host), 0 runtime errors, phone width 390 with no overflow. Evidence: `evidence/live-laltibba.json`, `live-laltibba-desktop.png`, `live-laltibba-desktop-peaks.png`, `live-laltibba-mobile.png` |
| Dev server port | 4173 was held by the WP2 session's server, so verification ran on **4187** |
| Free-only | No key, account or billable host. The DEM bucket is keyless AWS Open Data; the QA run never contacted it |
| `.env` | Not read, printed or changed |

## Limits

- Geometric visibility, terrain-only: trees, buildings, haze and cloud are not modelled. Copernicus DEM is a radar **surface** model, so forest canopy and large buildings are partly inside its heights, including at the observer.
- Far-field heights come from averaged overviews (¼ to 60 km, ⅛ beyond), so distant summits read lower than their surveyed height: Bandarpunch I is 103 m low. Samples are max-pooled per footprint to limit this. Adjacent summits closer than one footprint share a DEM height (Swargarohini I–III all read 6,118 m).
- Refraction is a single coefficient (k = 0.13) for terrain. Celestial refraction is a standard atmosphere scaled for the observer's altitude. Real refraction near the horizon varies, so ridge-clearing times can move by a few minutes.
- The Moon uses a low-precision series (≈ 0.3°), which can move lunar times by about one to two minutes.
- The gazetteer covers Uttarakhand and Uttar Pradesh (Geofabrik Central Zone) only; Himachal Pradesh, Nepal and Tibet summits are absent. OSM names and `ele` are community data. The plan's "flag a mismatch into Fieldbook" control is **not** built. The mismatch is shown on every row and saved in the snapshot (DEM and OSM heights side by side), but there is no separate flag action.
- The first horizon for an area downloads about 35 MB (measured 34.8 MB, 164 range requests, 65 s cold). Later ones read the local cache: 25 MB on disk, 2.7 s to sample.
- The globe ring is the trace of each ray's blocking point, so it jumps between near ridges and far summits. It is a skyline trace, not a viewshed polygon.
- Not delivered: the Open-Meteo "will it be clear" card, the date-and-hour shadow sweep over the valley (only the single-time shadow card is built), and the GeoNames fallback.
- Out of scope per the plan: buildings, trees and haze; Sky Pointer; viewshed polygons; Horizon Match.
