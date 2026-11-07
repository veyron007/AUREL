# WP5 — Raindrop and Catchment Pulse

Delivered 7 November 2026 on branch `claude/wp5-raindrop-catchment-62efc0`.
Sources and their admission: [SOURCE-ADMISSION.md](SOURCE-ADMISSION.md).
QA evidence: [evidence/](evidence/).

## What it does

**Plan → Raindrop.** Press _Drop on the globe_ and click, or select a place with
search or Lens and press _Use selected place_.

1. **Downhill path (simulated).** The click is routed by D8 on a terrain grid and
   drawn on the globe in the information colour; an animated drop runs down it.
   Where the grid ends, the drop hands off to the bundled HydroSHEDS HydroRIVERS
   network (dashed) and follows `NEXT_DOWN` to the ocean or an inland sink. The
   panel lists named rivers in order, for example
   _Rispana → Saswa Nadi → Song → Ganga → Padma → Meghna_.
2. **Catchment (derived).** The land on the grid that drains past the click,
   outlined and lightly filled in brass, with its area. A click within 250 m of a
   stronger flow line snaps to it, and the panel says so. A catchment that touches
   the window edge is flagged as a lower bound; the HydroBASINS level-12 unit and
   its upstream area are shown alongside.
3. **Method and limits.** Terrain source, grid spacing in metres, datum, routing
   method, the number of cells raised by sink filling and the deepest raise, the
   number of ambiguous steps on this path, and the statement that culverts, storm
   drains, embankments, bridges and buildings are not in the terrain.
4. **Satellite rain estimate (derived).** IMERG basin means for the last 1, 3 and
   24 h as ranges in mm, read from NASA GIBS through the published colormap, with
   the window end, latency, basin coverage and a legend link.
5. **Forecast rain on this catchment (modelled).** Open-Meteo hourly
   precipitation for the next 1, 3 and 24 h at up to three area-weighted points,
   with retrieval time and the local ledger units used.
6. **River model rank (derived).** On request only (seven Open-Meteo units, stated
   on the button): today's GloFAS v4 value ranked within the previous 91 days at
   the nearest 0.05° model cell. Shown as a percentile, never as a discharge.
7. **Authority.** IMD and CWC are linked for warnings and river conditions.
8. **Basin rain watch (local).** _Notify once when the IMERG 3 h basin mean
   exceeds X mm._ Checks every 30 minutes while AUREL is open and the page is
   visible; fires once per crossing (compares the lower bound of the range),
   re-arms only after the mean falls below 80 % of the threshold, waits a 6 h
   cooldown, and never fires twice for the same basin, window and window end.
   Basin id is `hybas12:<HydroBASINS id>:<outlet>` or the D8 outlet. Up to four
   watches, stored in this browser's localStorage. _Pause feeds_ pauses checks
   until _Resume_.

## How it works

| Piece                                                                      | Module                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Grid geometry, cell areas                                                  | `src/hydro/grid.js`                                                                                                                |
| Quantized-mesh decoder (no Cesium)                                         | `src/hydro/quantizedMesh.js`                                                                                                       |
| Bounded DEM sampler, bundled-grid encoding                                 | `src/hydro/demSampler.js`                                                                                                          |
| Priority-Flood+ε fill, D8, accumulation, trace, upstream mask, outlet snap | `src/hydro/d8.js`                                                                                                                  |
| Mask outline and area                                                      | `src/hydro/catchment.js`                                                                                                           |
| One drop query on a routed grid                                            | `src/hydro/route.js`                                                                                                               |
| Routing worker and its in-thread fallback                                  | `src/hydro/hydro.worker.js`, `router.js`, `workerClient.js`                                                                        |
| Window choice, handoff, names, basin                                       | `src/hydro/analysis.js`, `farField.js`                                                                                             |
| IMERG colormap, palette PNG, basin mean, accumulation                      | `src/hydro/imerg.js`                                                                                                               |
| Card arithmetic (percentile, polygon forecast)                             | `src/hydro/cardsMath.js`, `rainCards.js`                                                                                           |
| Basin watch model                                                          | `src/hydro/basinWatch.js`                                                                                                          |
| Drop animation clip                                                        | `src/hydro/dropClip.js`                                                                                                            |
| Server routes `/api/hydro/{imerg,forecast,glofas}`                         | `server/providers/hydro/`                                                                                                          |
| Owner, store, view                                                         | `src/ui/raindropController.js`, `src/ui/stores/raindrop.js`, `src/ui/views/panels/RaindropPanel.vue`, `src/ui/styles/raindrop.css` |
| Globe adapters (pick, entities, clip playback, bundled loaders)            | `src/app/raindropTools.js`                                                                                                         |
| Bundled data                                                               | `public/hydro/doon/` (DEM), `public/hydro/rivers.json`, `public/hydro/basins-doon.json`, `public/hydro/HYDROSHEDS-NOTICE.txt`      |
| Build scripts                                                              | `scripts/build-hydro-doon.mjs`, `scripts/build-hydro-farfield.mjs`, `scripts/hydro-shapefile.mjs`                                  |
| QA                                                                         | `scripts/qa-aurel-raindrop.mjs`                                                                                                    |

**Terrain.** A click inside the bundled Doon grid (77.60–78.32 E,
29.98–30.56 N, 3″, 864 × 696 cells, 1.2 MB) uses it, so the drop works offline
there. Elsewhere a 256 × 256-cell window (about 21 × 24 km) is sampled live from
level-12 tiles of the keyless Re:Earth / Mapterhorn mesh (at most 49 tiles) and
converted to orthometric heights with the bundled EGM96 geoid. Windows are keyed
on a 0.05° lattice so nearby clicks reuse one fill. The point-height proxy is not
used for grids (64 points per call, about 0.1 s per point upstream).

**Routing.** Priority-Flood+ε (ε = 0.1 mm) fills depressions; heap cells of the
same height are expanded together, so flats drain to the nearest outlet. D8
steepest descent runs on the filled surface; window-edge cells always drain out.
A step is _ambiguous_ when the second-steepest descent is within 95 % of the
steepest, or when the descent exists only because of the fill. The worker keeps
up to three routed grids. On the bundled grid the fill raises 16,143 of 601,344
cells (deepest 59.25 m, an enclosed hollow) and marks 79,636 cells ambiguous.

**Names.** HydroRIVERS has none. Reaches in the window take OSM names (95 named
waterways, one build-time Overpass extract); three curated anchors add Asan,
Padma and Meghna. Names of reaches draining at least 300 km² continue downstream.
On the D8 path a point takes the nearest named reach within 600 m whose drainage
area is within a factor of three of the D8 area there, and a name must hold for
three consecutive samples.

## Verification

| Check                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted tests (`src/hydro`, `server/providers/hydro`, controller, panel) | 41 tests, 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| UI, store, app and boundary test groups touched by the seams              | 356 tests, 0 failures (before the Raindrop tests were added)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Full `npm test`                                                           | 11,467 tests: 11,454 passed, 4 skipped (the known Node allocation probes), 9 failed, at load average 32 on 10 cores with seven sibling sessions running. One failure was real and is fixed: `navigationPolicyFrame.test.mjs` requires every explicit-navigation noun to have a Cockpit refusal, so Raindrop now uses the existing `route` noun (the file passes, 3/3). The other eight pass when rerun on their own: `analystEngine` budget, `geoFileImport` KML deadline, four `devCctv` launcher tests, `toolProjectRoot` launcher, `radioPanel` RTL-SDR card (all 30 s or time-budget tests). The full suite was not rerun after the one-word fix. |
| `npm run i18n`                                                            | 11 catalogs complete, 3,697 messages each (90 new messages translated into every catalog)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run check:boundaries`                                                | Passes after registering the new modules in `scripts/package-boundaries.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run format:check`                                                    | **Fails on `main` before any WP5 change:** `scripts/format-scope.json` lists `src/fieldbook/document.test.mjs`, which does not exist. Every file this package adds or changes passes `prettier --check`.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `scripts/qa-aurel-raindrop.mjs`                                           | 14/14 checks, fresh profile, all external hosts blocked, labelled fixtures for `/api/hydro/*`; [evidence/checks.json](evidence/checks.json), [desktop](evidence/raindrop-rajpur-desktop.png), [phone](evidence/raindrop-selaqui-mobile.png)                                                                                                                                                                                                                                                                                                                                                                                                           |
| Browser, 1440×900, live sources                                           | Rajpur Road (search _30.36, 78.08_ → _Use selected place_): Rispana → Saswa Nadi → Song → Ganga → Padma → Meghna, 63 km on the grid + 2,146 km on HydroRIVERS, ocean outlet. Selaqui (globe click at 30.37 N, 77.86 E): Tons Nadi → Asan → Yamuna → Ganga → Padma → Meghna, 33 km + 2,589 km, catchment 33 km². Live IMERG 24 h read 48 published half-hours in 6.7 s, latency 5 h 38 min, 100 % coverage; GloFAS percentile 0 at 30.375 N, 77.875 E; a 15 mm watch created and checked once.                                                                                                                                                         |
| Browser, 390×844                                                          | Raindrop opens in the Plan sheet, no horizontal overflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Acceptance from the plan: a Rajpur drop reaches the Song and then the Ganga; a
Selaqui drop goes to the Asan and the Yamuna (both asserted in
`src/hydro/analysis.test.mjs` and the QA script); the method card states DEM
resolution and D8 ambiguity; the panel and hydro modules contain no flood-depth,
inundation, stage, discharge-value or evacuation wording (asserted in
`raindropPanel.test.mjs`); the watch fires once (asserted in the model,
controller and QA tests).

## Limits

- A 3″ grid built from a simplified mesh misses small drains and channels in
  flat, built-up areas. Culverts, storm drains, embankments, bridges and
  buildings are ignored. About one step in six on the Rajpur path is ambiguous.
- A click on a hillslope delineates a small catchment (0.16 km² at the Rajpur
  Road point); the outlet snaps only within 250 m.
- Names are approximate. OSM calls the channel above the Asan Barrage "Tons
  Nadi", so the Selaqui path reads _Tons Nadi → Asan_. At the Song–Saswa
  confluence a Sahastradhara drop briefly lists Saswa Nadi between two Song
  entries. Names beyond the window come from propagation and three curated
  anchors.
- The HydroRIVERS outlet for the Ganga–Brahmaputra system is in the Meghna
  estuary near Chandpur (90.63 E, 23.22 N); that is where "ocean" is drawn.
- IMERG values are class ranges from a visual product, about 6 % wide; the
  "insignificant" class means 0–0.1 mm/h, so a dry day can show up to 2.4 mm
  for 24 h as its upper bound. IMERG under-catches short orographic bursts and
  arrives hours late.
- GloFAS is ranked only against the last 91 days of its own series at a 0.05°
  cell that may carry a larger river than the click; skill in small mountain
  basins is poor.
- Live windows outside the Doon need network terrain; offline outside the
  bundled grid the panel says so and does nothing else.
- The watch runs only while AUREL is open; it is not a background service and
  does not appear in the FIRMS Watchlist panel (that model is FIRMS-specific).
- The scene director is not used for the drop clip: `dropClip.js` is a small
  timed clip driven by `requestAnimationFrame` under a render-governor hold, with
  reduced-motion support.

## Rebuilding the bundled data

```bash
node scripts/build-hydro-doon.mjs
```

```bash
node --max-old-space-size=4096 scripts/build-hydro-farfield.mjs --rivers <dir>/HydroRIVERS_v10_as --basins <dir>/hybas_as_lev12_v1c --osm <doon-waterways.json>
```

The second command needs the two HydroSHEDS archives (owner-approved downloads)
unzipped outside the repository and an Overpass extract of named waterways in
the Doon window; see SOURCE-ADMISSION.md for the exact query.
