# WP4 Orbit Witness and Overpass Oracle: delivery record

Branch `claude/wp4-orbit-witness-8e169b`, built on `main` `45efecdc` (merged with `main` at `ef0eae9f` for the unit-test runner fix). Plan: [IMPLEMENTATION-PLAN-02.md §3.1.4 and §6 WP4](../../IMPLEMENTATION-PLAN-02.md). Sources: [SOURCE-ADMISSION.md](SOURCE-ADMISSION.md).

## What it does

For the place selected in Lens, **Orbit Witness** (Compare destination, its own rail tool) answers "when do Sentinel-2A/B/C, Landsat 8/9 and the ISS next pass over here, and has anything landed?" in four lanes that are never merged:

| Lane | Class | Source | What it says |
| --- | --- | --- | --- |
| Predicted pass | modelled | CelesTrak GP elements, SGP4 | Time of the swath crossing, cross-track distance and side, off-nadir angle, sun elevation, node, "propagated, epoch <UTC>", epoch age and a confidence band. ISS: sky passes ≥ 10° elevation. |
| Planned acquisition | derived | ESA Sentinel-2 plan files the owner downloads and loads | Plan-confirmed (datatake id and window), contradicted (plan covers the time, no nominal datatake here), or no plan loaded. Landsat: no admissible published plan. |
| Available product | observed | Earth Search STAC v1, NASA CMR-STAC | The catalogued scene for a past pass (id, scene-wide cloud %), "not catalogued yet" (under five days), "no matching product", "future pass", or **unknown** when a catalogue did not answer completely. |
| Dramatised ride | simulated | Scene Director | "Ride this pass": a director scene along the propagated orbit to the crossing second, then down to the place, with the footprint on the globe. |

Each imaging pass also carries the **cloud forecast** (modelled, Open-Meteo, % total cloud at the nearest forecast hour, or "beyond the 14-day forecast").

Opening the panel requests nothing. **Predict passes** reads the existing CelesTrak `active` cache (reused for an hour), one catalogue search (last 10 UTC days, ±0.05° box) and one cloud forecast (14 days, charged to the existing Open-Meteo field-context ledger). Loading or clearing plan files re-checks passes without new requests.

**Show footprint** draws the nominal swath around the predicted crossing (dashed brass, "Predicted swath (modelled)"), and the catalogued scene footprint when there is one (petrol, observed). **Export record** downloads the pass's lanes, the TLE lines, the epoch, the footprint ring and the ride label as JSON.

### Scene watch: the second Watchlist type

**Watch for the real scene** (or Watchlists ▸ Add a watch area ▸ "A new satellite scene") saves a scene watch for the place. It reuses the FIRMS watch's lease, heartbeat, cooldown, hidden-page pause, the four-active and eight-definition limits, and explicit start. Each check is one bounded search of Earth Search and CMR-STAC over the watch area for the last 10 UTC days. The first answer from each catalogue is a quiet baseline; afterwards every new scene id (`<catalogue>:<item id>`) is announced exactly once, and ids are retained while the window can still return them. A catalogue outage, refusal or repeated cached answer reads "Catalogues unreachable · availability unknown" and announces nothing. The minimum interval is 60 minutes, and HTTP `Retry-After` is honoured.

Each announced scene has **Open beside the previous scene in Chronicle**. That selects the watch's place in Lens, opens Compare, searches Chronicle's 31-day window ending on the scene's day, chooses the previous same-product HLS day as A and the scene's day as B, and compares. If HLS has not caught up with the source scene, it says so and compares nothing. **Deliberate choice:** this opens on the owner's click rather than automatically when the watch fires, matching the Watchlist's explicit-action rule (monitoring never moves the camera or panels by itself).

### Ride this pass

The ride adds one scene (id prefix `orbit-witness-ride-`, replacing any earlier ride) to the director project through the validated snapshot path, then starts it in the director's preview (recording) mode. It has three moving shots placed 90, 60, 30 and 0 s before the crossing, behind the propagated satellite at orbital height, then a drop to 140 km above the place, pitch −90°, holding for 6 s. Every shot title, the scene title and the exported scene JSON carry:

> Dramatised ride · orbit propagated, epoch YYYY-MM-DD HH:MM UTC · Image: observed <scene id> | Image: none catalogued

The same line appears in a caption fixed at the top of the screen for the whole ride, which stays visible in recording mode (class label SIMULATED, with Stop ride). The exported record also states the pacing: about 8× faster than the orbit, beside a modelled position.

## Files

New: `src/orbitWitness/{missions,swath,tle,plan,lanes,predict,catalogueModel,sources,sceneWatch,ride,overlay}.js`, `src/orbitWitness/testFixtures.mjs`, `server/providers/orbit-witness/index.js`, `src/app/orbitWitnessTools.js`, `src/ui/orbitWitnessController.js`, `src/ui/stores/orbitWitness.js`, `src/ui/views/panels/OrbitWitnessPanel.vue`, `src/ui/styles/orbit-witness.css`, `scripts/qa-aurel-orbit-witness.mjs`, tests beside each module.

Registration seams touched: `server/providers/local.js` (one plugin), `src/app/tools.js` (composition), `src/app/watchlistTools.js` (pass-through), `src/watchlists/{model,repository}.js` (kind dispatch; FIRMS records keep their exact v1 shape), `src/ui/watchlistController.js` and `WatchlistPanel.vue` (second watch type), `src/ui/views/{LayerPanelsView,WorkspaceView}.vue`, `src/ui/{panelRailCatalog,panelChrome}.js`, `src/ui/stores/workspace.js`, `src/ui/styles/aurel.css` (one import), `src/data/dataCredits.js` (`ORBIT_WITNESS_CREDIT`), `scripts/package-boundaries.json`, the 11 locale catalogs, `src/i18n/same-as-english.json` (fr: "dramatisation", "note"), `DATA_SOURCES.md`. No theme file was changed.

## Verification

- **Geometry against reality.** With CelesTrak elements from 6 Nov 2026, the predicted crossings over Mussoorie fall within 10 s of the catalogued acquisitions: S2B 2026-10-25 05:40:29Z against `S2B_43RGP_20261025_0_L2A` at 05:40:34.7Z; L8 10-24, L9 11-01, S2C 10-20 and 10-30 likewise. With the real ESA plan files loaded, S2B 10-25 and 11-04, S2C 10-30 and 11-09, and S2A 11-11 read plan-confirmed. S2A 11-01 reads contradicted, and Earth Search indeed has no S2A scene that day.
- **Unit tests.** 65 new tests in 11 files (swath 8, plan 6, predict 7, sceneWatch 9, ride 5, sources 4, provider 10, controller 8, composition 4, Watchlist scene path 2, panel 2) plus the existing 34 Watchlist tests, all passing (99 in the targeted run). Full-suite counts are in the gate table below.
- **QA script.** `node scripts/qa-aurel-orbit-witness.mjs http://localhost:4184`: 18/18 checks, fresh browser profile, all external requests blocked, Orbit Witness routes served by labelled fixtures, zero runtime errors, no billable host attempted. Evidence: `evidence/checks.json`, `orbit-witness-desktop.png`, `orbit-witness-ride-desktop.png`, `watchlist-scene-desktop.png`, `orbit-witness-mobile.png`.
- **Live browser check** (port 4184; 4173 and 4183 were held by sibling sessions) over Mussoorie at 1440×900 and 390×844, against the real services. Both catalogues answered; S2B 11-04 showed `S2B_43RGP_20261104_0_L2A` at 0.1% scene cloud; S2A 11-11 showed a 2% cloud forecast for 06:00 UTC; the predicted swath and the observed 43RGP tile footprint drew on the globe (`evidence/live-footprint-1440.jpg`); the phone sheet scrolled with no horizontal overflow (`evidence/live-mobile-390.jpg`).
- **A bug found only live.** Earth Search and CMR-STAC both send a `next` link on a short final page, so the first version marked every answer partial and every recent product "unknown". Truncation now trusts `numberMatched`, else requires a full page plus `next`; a regression test covers it.

## Limits

- Swath edges are nominal (290 km, 185 km) around the SGP4 ground track; product tiles follow the MGRS/WRS grid and can stop short. Cross-track accuracy depends on the epoch distance; the confidence bands (3 / 7 days) are presentation thresholds, not a published error.
- Only daylight crossings are listed for optical missions; occasional Landsat night acquisitions are not.
- A pass is not an acquisition: duty cycle (S2A's extension campaign), downlink and processing decide. L2A latency is hours to days; HLS follows by further days.
- ESA plans are used only from files the owner loads, for the session; automatic fetching needs ESA's written authorisation. Landsat has no plan lane until USGS publishes a current calendar.
- Scene cloud % is scene-wide; the forecast is a model for the hour at one grid cell (2,041 m model elevation at Mussoorie), not the cloud in the scene.
- Scene watches run only while the app is open and visible, like FIRMS watches.

## Gate

| Check | Result |
| --- | --- |
| `npm test` | see the final report |
| `npm run format:check` | fails on `main` and here for the same pre-existing reason: `scripts/format-scope.json` lists `src/fieldbook/document.test.mjs` and `src/sources/firmsArea.test.mjs`, which do not exist at `45efecdc`. With those two entries excluded, every file passes. |
| `npm run check:boundaries` | passes |
| `npm run i18n` | all 11 catalogs complete at 3,726 messages |
| QA script | 18/18 |
| Browser check | 1440×900 and 390×844, live and fixture runs |
| `.env` | not read, printed or changed |
