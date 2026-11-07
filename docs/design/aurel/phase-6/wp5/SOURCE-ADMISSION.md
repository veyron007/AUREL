# WP5 Raindrop and Catchment Pulse — source admission

Reviewed 7 November 2026 against the [FREE-DATA-PLAN.md §6](../../FREE-DATA-PLAN.md)
checklist. No accounts were created, no credentials were read or written, and no
paid endpoint is used. Probes were small, bounded Dehradun samples. The two
HydroSHEDS archives were downloaded with the owner's approval ("Yes, download",
relayed by the orchestrating session) into a scratch folder outside the
repository; only a derived subset is committed.

| Source                                                                         | Use                               | Key             | Decision                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| Re:Earth / Mapterhorn quantized mesh (`mapterhorn-egm08`, layer version 5)     | DEM for D8                        | No              | **Admitted** (existing terrain, new numeric use)                             |
| HydroSHEDS HydroRIVERS v1.0 Asia                                               | Far-field network, handoff, names | No              | **Admitted** as a bundled derived subset                                     |
| HydroSHEDS HydroBASINS v1c level 12 Asia                                       | Basin id and upstream area        | No              | **Admitted** as a bundled derived subset                                     |
| OpenStreetMap named waterways (one Overpass extract)                           | River names in the Doon window    | No              | **Admitted** at build time only                                              |
| NASA GIBS `IMERG_Precipitation_Rate_30min` + `GPM_Precipitation_Rate` colormap | Basin-mean rain, 1/3/24 h         | No              | **Admitted**; numeric values read through the published colormap             |
| GES DISC IMERG Early (numeric files)                                           | —                                 | Earthdata login | **No-go** (needs a login)                                                    |
| NASA PPS PMM publisher / GIBS WMS GetFeatureInfo                               | —                                 | —               | **No-go** (see item 4.2)                                                     |
| Open-Meteo forecast, hourly `precipitation`                                    | Polygon forecast                  | No              | **Admitted** (Phase 3 source, new variable and multi-point shape)            |
| Open-Meteo Flood API, GloFAS v4 `river_discharge`                              | Percentile rank at the outlet     | No              | **Admitted**                                                                 |
| Copernicus DEM GLO-30                                                          | —                                 | No              | **Not used.** WP1 owns the GLO-30 spike; no WP1 record existed while WP5 ran |

## 1. Re:Earth / Mapterhorn terrain mesh

1. **Identity and use.** `https://terrain.reearth.land/cesium-mesh/ellipsoid`,
   `layer.json` name "mapterhorn-egm08 / cesium-mesh / ellipsoid", version 5,
   quantized-mesh-1.0, TMS EPSG:4326, levels 0–14. Already admitted and rendered
   by the globe (Phase 3 profile heights come from the same tileset). New use:
   AUREL decodes level-12 tiles itself (`src/hydro/quantizedMesh.js`) and samples
   a regular 3″ grid. The `/api/terrain/heights` proxy was not used for grids: it
   serves 64 points per call at about 0.1 s per point upstream, so a 65,536-cell
   window would take minutes.
2. **Geography and Dehradun sample.** Rajpur (78.08 E, 30.36 N): decoded mesh
   743.7 m ellipsoidal at levels 12, 13 and 14; `heights.json` 742.69 m
   ellipsoidal, geoid −41.89 m (EGM2008). Bundled EGM96 gives −42.77 m, a 0.9 m
   residual that is smooth across a window and does not change slopes. A level-12
   tile is 0.044° and held 3,159 vertices at Rajpur (about 80–90 m effective
   spacing). The bundled Doon grid covers 77.60–78.32 E, 29.98–30.56 N
   (864 × 696 cells), built from 252 tiles on 2026-11-07, 0 failed tiles,
   0 missing cells, 1,202,688 bytes, SHA-256
   `6dfd900d2544bc3c08fe270fe99dfd83bba35cdf3b5831de92a69a3a82823412`.
3. **Authentication and quota.** Keyless. No published quota (**verify**). Live
   windows are bounded to 49 tiles (256 × 256 cells), four concurrent requests,
   30-day `Cache-Control` from the server.
4. **Attribution and redistribution.** CC BY 4.0 per the existing AUREL credit
   (Re:Earth Terrain, Mapterhorn, EGM2008/NGA). Mapterhorn merges sources under
   their own licences (**verify** per-source terms for redistribution of a derived
   grid). Attribution is in the method card and `public/hydro/HYDROSHEDS-NOTICE.txt`.
5. **Bounds.** Grid ceiling 1.2 M cells; tile ceiling 49 live, 400 for the build;
   a window with more than 20 % missing cells is refused.
6. **Tests.** `src/hydro/analysis.test.mjs` (synthetic tiles, failed tiles,
   tile ceiling, encoding), `src/hydro/d8.test.mjs`.
7. **User-facing fallback.** Inside the Doon grid the drop works offline. Outside
   it, offline, the panel says Raindrop needs terrain and nothing else is tried.

## 2. HydroSHEDS HydroRIVERS v1.0 and HydroBASINS v1c

1. **Identity.** WWF HydroSHEDS v1 products, https://www.hydrosheds.org/.
   `HydroRIVERS_v10_as_shp.zip` (90,510,995 bytes, SHA-256
   `29780b0a75f90024f22e7e2029e5e3045f7325cda0528db65c5cc4c864b98525`) and
   `hybas_as_lev12_v1c.zip` (80,155,135 bytes, SHA-256
   `05e98a001fc526cd5fcdbbc8144fe0aa3ce6712c35624f72e4728b219193fdb9`),
   both from https://data.hydrosheds.org/file/, retrieved 2026-11-07.
2. **Geography and sample.** `scripts/build-hydro-farfield.mjs` keeps every reach
   touching the Doon window (381) plus every reach downstream of them by
   `NEXT_DOWN` to an outlet: 1,316 reaches, 6,137 vertices, 298,639 bytes
   (`public/hydro/rivers.json`), and the 55 level-12 basin units touching the
   window (82,900 bytes, `public/hydro/basins-doon.json`). Geometry is simplified
   (0.0002° in the window, 0.002° downstream). Rajpur's drop hands off 334 m from
   the D8 exit onto a reach draining 23,099 km² and reaches the HydroRIVERS ocean
   outlet in the Meghna estuary (90.63 E, 23.22 N) after 2,146 km.
3. **Authentication.** None; static download.
4. **Licence.** The HydroSHEDS v1 License Agreement (Technical Documentation v1.4,
   Appendix A): free for non-commercial and commercial use; distribution only
   when incorporated into a derivative product, never stand-alone; Exhibit B
   attribution statement required. The statement and both citations are in
   `public/hydro/HYDROSHEDS-NOTICE.txt` and condensed in the method card.
   **Verify** with the owner that committing the derived subset to the private
   `aurel` remote is acceptable under "no stand-alone distribution" (it is only
   used inside AUREL).
5. **Bounds.** Static files, loaded once per session, capped at 2 MiB each.
6. **Tests.** `src/hydro/data.test.mjs` (handoff, NEXT_DOWN chain, no reach in
   radius, invalid subset), `src/hydro/analysis.test.mjs` (Rajpur and Selaqui
   acceptance on the real subset, the no-subset fallback).
7. **Fallback.** Without the subset the trace stops at the edge of the sampled
   terrain and the card says the river network is not loaded.

## 3. OpenStreetMap waterway names (build time only)

One Overpass query on 2026-11-07 (`way[waterway~"river|stream"][name]` in the
Doon window, base timestamp 2026-11-07T07:36:08Z) returned 95 named ways
(Song, Saswa Nadi, Rispana, Bindal Rao, Tons Nadi, Yamuna, Ganga and others). A
reach takes an OSM name when at least half its vertices lie within 300 m of a
way of that name. A second query found no named Asan waterway, only the Asan
Barrage dam (30.437 N, 77.666 E); **OSM names the channel above the barrage
"Tons Nadi"**. Three curated anchors fill gaps and are labelled `curated`: Asan
(barrage reach, 678.9 km²), Padma (Hardinge Bridge), Meghna (below Chandpur).
Names of reaches draining at least 300 km² continue downstream until another
named reach. ODbL 1.0, © OpenStreetMap contributors. No Overpass request is made
at run time.

## 4. NASA GIBS IMERG and the numeric question

1. **Identity.** WMTS `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/`,
   layer `IMERG_Precipitation_Rate_30min` (`2km` matrix set, level 5, 512 px
   tiles spanning 9°, palette PNG). Layer metadata names GPM_3IMERGHHE (Early,
   NRT) and GPM_3IMERGHH (Final), V07, 0.1°. Colormap
   `colormaps/v1.3/GPM_Precipitation_Rate.xml`: 222 entries — no data, an
   "insignificant" class `[-INF, 0.1)` mm/h, and 220 log-spaced rate classes to
   `[53.0884, +INF)` mm/h.
2. **Numeric product without a login (verified).** GES DISC IMERG Early files
   need an Earthdata login (no-go). The PMM publisher OpenSearch URL now returns
   an HTML viewer, not data (no-go). GIBS WMS capabilities contain no
   `GetFeatureInfo` (0 occurrences). The admitted route is the plan's own rule:
   read the visual tile **through the published colormap**. Each pixel's palette
   colour is matched exactly to a colormap entry; nothing is inferred from colour
   distance. Across three real tiles every sampled pixel matched an entry
   (0 unknown). A value is therefore an interval about 6 % wide; the card prints
   ranges and labels the class `derived`.
3. **Dehradun sample.** Cell 2580:1203 (78.05 E, 30.35 N), 2026-09-15T12:00Z:
   1.4125–1.4962 mm/h. Latest published step on 2026-11-07 ≈04:30Z was
   2026-11-06T22:30Z (window end 23:00Z), about 5.5 h of latency; the time
   domain comes from the DescribeDomains endpoint. A future time returns 404,
   never a substitute time.
4. **Attribution and cache.** NASA open data; "NASA GIBS / GPM IMERG" in the card
   with a link to the colour legend. Tiles cached 6 h (Early can be replaced by
   later runs), colormap 24 h, time domain 10 min.
5. **Bounds.** ≤ 24 IMERG cells inside 2° per request, ≤ 48 half-hours, 192
   decoded tiles in memory, 512 KiB per tile, 20 s deadline, 20 requests/min per
   client. Not on the Open-Meteo ledger.
6. **Tests.** `src/hydro/data.test.mjs` (colormap, real tile, addressing,
   basin mean with missing cells, accumulation with missing steps);
   `server/providers/hydro/hydro.test.mjs` (ready, partial, unavailable,
   refusals).
7. **Fallback.** Unpublished steps are shown as missing half-hours; an outage
   reads "Unavailable"; offline reads "Unavailable offline". Missing cells are
   excluded and the covered share of the basin is printed.

## 5. Open-Meteo forecast and Flood API (GloFAS v4)

1. **Identity.** `api.open-meteo.com/v1/forecast` with `hourly=precipitation`,
   `forecast_hours=48`, at most three area-weighted points per request;
   `flood-api.open-meteo.com/v1/flood` with `daily=river_discharge`,
   `past_days=91`, `forecast_days=7`. Terms: https://open-meteo.com/en/terms;
   flood docs: https://open-meteo.com/en/docs/flood-api.
2. **Dehradun sample.** Forecast, two points (30.36, 78.08 and 30.30, 78.05):
   grid 30.3339 N, 78.0774 E, elevation 792 m. Flood API at 30.05 N, 78.20 E:
   snapped to the 0.05° cell 30.025 N, 78.175 E (elevation 353 m), 99 days for
   `past_days=92`. GloFAS cells are model river pixels; the nearest one may
   carry a larger river than the clicked stream, which the card states by
   printing the cell.
3. **Quota.** Keyless, public limits 10,000/day, 5,000/hour, 600/minute,
   300,000/month in weighted units. Both routes reserve on the **same local
   ledger as the Planner** (`.gev-cache/field-context-budget.json`, 100/day,
   10/minute) before dispatch: one unit per forecast point; seven units for
   GloFAS (98 days ÷ 14). The exact Flood API weighting is **verify**; seven is
   the conservative reading. GloFAS is fetched only when the owner presses its
   button, which states the cost.
4. **Attribution.** Open-Meteo, CC BY 4.0; GloFAS v4 is a Copernicus Emergency
   Management Service product (**verify** the exact attribution string Open-Meteo
   asks for flood data).
5. **Bounds.** Same-site GET only, strict query shapes, 256 KiB bodies, 20 s
   deadline, caches of 30 min (forecast) and 6 h (GloFAS), coalesced in-flight.
6. **Tests.** `server/providers/hydro/hydro.test.mjs`: ready, cached, blocked
   before dispatch (no network call), rate-limited, upstream failure, refusals.
   `src/hydro/data.test.mjs`: percentile rank, polygon weighting, gaps.
7. **Fallback and honesty.** GloFAS is shown only as a percentile rank inside the
   returned 91 days, never as a discharge; the card says it is not a flow, a
   water level or a warning, and that skill in small mountain basins is poor.
   IMD and CWC are linked as the authority.
