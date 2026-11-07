# AUREL data quality plan: detail, freshness, live feeds, precision, smoothness

**Prepared 7 November 2026.**

**Baseline:** `main` at `c1a7eba7` (Phase 6 WP1 to WP8 merged), CesiumJS 1.138.0 and satellite.js 6.0.2 as installed in `node_modules`, Free-only mode on (`server/standalone/free-only.js:6-13`).
**Operating constraint:** no paid API, no paid hosting. Every source below is keyless or uses a free account, and every new adapter passes the admission checklist in [FREE-DATA-PLAN.md section 6](FREE-DATA-PLAN.md).
**Inputs:** [COVERAGE-DEHRADUN.md](COVERAGE-DEHRADUN.md), [FREE-DATA-PLAN.md](FREE-DATA-PLAN.md), [IMPLEMENTATION-PLAN-02.md](IMPLEMENTATION-PLAN-02.md), the Phase 6 records under `docs/design/aurel/phase-6/`, a read of the working tree, and live probes run on 7 November 2026 (section 3).

How to read this document. File references are `path:line` against the baseline. "Probe" means a single bounded request made on 7 November 2026 to a public endpoint; results are a snapshot, not a guarantee. Anything not confirmed from the repository, a probe, or an official page is marked **verify**. This plan does not repeat delivered work: GLO-30 horizon (WP1), OpenAQ stations (WP2), mountain weather and IMERG (WP3), Orbit Witness and STAC polling (WP4), EMSC/GEOFON/adsb.fi corroboration cards (WP7) and Hindi presets (WP8) are treated as existing seams.

---

## 1. Direct answer: is it using stale map data?

Yes and no. The default satellite basemap (Esri World Imagery, `src/maps/imagery.js:29-38`, chosen by `src/maps/defaultSources.js:40` whenever Google 3D is unavailable, which is always under Free-only) is a static mosaic of commercial scenes, not a live feed, and each place has its own capture date. Over Dehradun it is fresher than most people expect: Esri's own metadata, probed on 7 November 2026, dates the sub-metre imagery at the Clock Tower, Rajpur Road and Mussoorie to **16 April 2026** (0.34 m, stated accuracy 5 m, Vantor "Vivid"), Chakrata to 14 May 2026, Kedarkantha to 15 February 2026 (snow season), Jolly Grant to 2 December 2025, Tehri dam to 7 November 2025 and Rishikesh to **13 December 2024**, so the imagery on screen is between 6 and 23 months old depending on where you look, and older still in places nobody has re-flown. The app does not know any of this: it never asks for the capture date (`enablePickFeatures: false` at `src/maps/imagery.js:35`, and no reference to `SRC_DATE`, Wayback or imagery metadata exists anywhere in `src/` or `server/`), the only on-screen text is a static credit that still names "Maxar" (`src/maps/imagery.js:34`) although the service now credits Vantor, and nothing tells the user that the picture is months old, that its detail stops at map level 18, or that it can be offset by up to about 5 m from the vector layers. The terrain under it is also old: the keyless mesh is Mapterhorn over Copernicus GLO-30, a surface model built from 2011 to 2015 radar passes. The live layers are a separate story, covered in section 2: aircraft are deliberately drawn 30 s behind real time, satellites are propagated from elements cached for up to 6 h, fires arrive about 3 h after the satellite pass and the only cloud imagery that covers India is an hourly mosaic that is 2 to 3 h late. Most of this can be made fresher, and all of it can be made honest, for free.

---

## 2. Per-layer audit

### 2.1 Audit table

"Cadence" is the app's own refresh (client poll / server cache). "Latency" is from the real-world event to pixels on screen. "Age shown" means the user can see how old the data is, not merely when the app last fetched it.

| Layer | Source (Free-only, Dehradun) | Cadence (client / server) | Latency, event to screen | Resolution | Motion between updates | Age shown to user | Evidence |
|---|---|---|---|---|---|---|---|
| Basemap: Esri World Imagery (default) | ArcGIS `World_Imagery/MapServer`, keyless | Tiles on demand; browser cache only | 6 to 23 months at probed points (section 3.1) | 0.31 to 0.34 m source, levels 12 to 18; 15 m TerraColor below level 12 | n/a | **No.** Static credit only, names "Maxar" | `src/maps/imagery.js:29-38`; `src/maps/defaultSources.js:40,106-118`; `src/maps/catalog.js:26-32` |
| Basemap: OSM raster | `tile.openstreetmap.org` | Tiles on demand | Minutes to days (re-render on demand; **verify** tile expiry) | Cartographic, z0 to z19 | n/a | No | `src/maps/imagery.js:22-27` |
| OpenFreeMap vectors (roads, military, outlines; not a basemap) | `tiles.openfreemap.org/planet` | Tile JSON resolved per session; 192-entry decoded cache | Weekly planet build, so up to about 7 days behind OSM | OpenMapTiles schema, z0 to z14 | n/a | No | `src/sources/openFreeMap.js:352-388` |
| Basemap: Natural Earth II | Cesium bundled | Static | Years | Max level 2 | n/a | Credit says "offline overview" | `src/maps/imagery.js:10-16` |
| Terrain mesh | Re:Earth quantized mesh of Mapterhorn + EGM2008 | Tiles on demand, retry policy | GLO-30 acquisitions 2011 to 2015 | `maxzoom` 14 (probe of `layer.json`), about 30 m source | n/a | No (credit only) | `src/maps/terrain.js:4-6,50-63` |
| Terrain point heights (Planner) | Re:Earth `heights.json` | 30-day disk cache | As mesh | About 30 m | n/a | No | `server/providers/terrain.js:16-59` |
| Horizon DEM (WP1) | Copernicus GLO-30 COGs on AWS | Range reads, byte budget | 2011 to 2015 | 1 arc-second, DSM (includes canopy and buildings) | n/a | Yes, DEM source in card | `server/providers/horizon/glo30.js:15-22`; `src/horizon/snapshot.js:14-27` |
| Recent Imagery | NASA GIBS HLS S30/L30 30 m, VIIRS NOAA-21 250 m; CMR | User-initiated; 30-day catalog | HLS about 3 days (latest GIBS date 4 Nov on 7 Nov); VIIRS daily NRT | 30 m / 250 m | n/a | **Yes**, dated per product | `src/layers/recentImagery/model.js:11-71` |
| Research (Sentinel-2 NDVI) | Earth Search STAC, `sentinel-cogs` | User-initiated | Hours to days after pass (**verify**) | 10 m | n/a | Yes, `acquiredAt` | `server/providers/research/metadata.js:77-98` |
| Aircraft | adsb.lol `/v2/lat/{lat}/lon/{lon}/dist/250` (OpenSky blocked) | 30 s / 12 s cache per 0.25 deg anchor | **30 s by design** (render-behind) plus poll phase; fixes median 1 s old at source | ADS-B position, about 10 m class | Render 30 s behind and interpolate between bracketing fixes; turn-rate arc extrapolation when no bracket; 900 ms step blending; fleet ticks at 80 ms (12.5 Hz), tracked aircraft per frame | Partly: row shows source snapshot age (`ingestion.js:58-61`); **no** "drawn 30 s behind" disclosure; adsb.lol always labelled FALLBACK | `src/layers/flights/queries.js:308`; `src/layers/flights/policy.js:139-148,195,280`; `server/providers/aircraft/opensky.js:156-163,387`; `src/data/motionModel.js:1-9,354`; `src/data/feedState.js:36-42` |
| Military aircraft | adsb.lol `/v2/mil` | 15 s | Render-behind as flights | As flights | As flights | As flights | `src/layers/military/queries.js:235`; `src/layers/military/policy.js:12-13` |
| Local receiver | RTL-SDR / dump1090 on LAN | Per message | About 1 s | As ADS-B | Per-frame extrapolation from last heard fix | Yes, per contact | `src/layers/localAdsb/index.js:380`; `server/providers/local-receivers.js:8-31` |
| Vessels | AISStream websocket, whole-globe box | 60 s client / 15 s server tick; 30 min retention | Message to screen up to about 75 s | AIS GNSS position | **None**: drawn at last reported fix, jumps each poll | Row "ago" only | `src/layers/vessels/policy.js:10`; `src/layers/vessels/rendering.js:49-53`; `server/providers/vessels/ais-live.js:18-23,48`; `server/providers/vessels/ais-store.js:3` |
| Satellites | CelesTrak `gp.php?FORMAT=tle`, SGP4 in browser | 5 min client / **6 h** server TTL (CelesTrak updates every 2 h) | Elements up to 6 h + upstream age old; position computed live | SGP4 from GP elements: about 1 km at epoch, growing with element age (**verify** per class) | Re-propagated every 1 s (untracked: a LEO point steps about 7.5 km per second), 200 ms when tracked | **No** element epoch or age shown | `src/layers/satellites/policy.js:30`; `src/layers/satellites/rendering.js:181-190`; `src/layers/satellites/controls.js:100-102`; `server/providers/space/celestrak.js:19,27` |
| Earthquakes | USGS `all_day.geojson`, browser-direct | 60 s | USGS posts in minutes for large events; feed regenerated every minute | Catalogue epicentre | n/a | Row "ago" is **fetch time**, not feed time | `src/layers/earthquakes/source.js:2-3`; `src/layers/earthquakes/index.js:40,165` |
| Fires | FIRMS VIIRS NOAA-20/21/SNPP + MODIS NRT, `world/2` | 10 min / 30 min TTL | NRT about 3 h after pass; URT not available for India | 375 m VIIRS, 1 km MODIS | n/a | Acquisition age in card; row says "**LIVE** · updated Xm ago" | `server/providers/firms.js:132-160,215`; `src/layers/firms/policy.js:7`; `src/layers/firms/queries.js:244-270` |
| Satellite clouds | NOAA nowCOAST global longwave mosaic | 120 s client | Hourly, 2 to 3 h late (app copy says so) | About 3 km (app copy) | Frame swap | **Yes**, "typically 2 to 3 h delayed" | `server/providers/weather.js:33-42`; `src/layers/weather/index.js:281,652,719` |
| Radar, lightning, GOES | nowCOAST CONUS / Americas | 120 s / 600 s | n/a | n/a | n/a | n/a: no coverage over India | `server/providers/weather.js:7-52` |
| Current weather (cockpit) | Open-Meteo `current=` | 30 min TTL | Model, not observation; India "current" interpolated from hourly (Open-Meteo docs) | Model grid, cached in 0.1 deg cells | n/a | Class shown as model in field context | `server/providers/regional/weather.js:6-16`; `server/providers/field-context.js:13-14` |
| Mountain weather (WP3) | Open-Meteo forecast, ensemble, historical | Per request, weighted ledger | Run time shown | Model | n/a | Yes, run time and lead | `server/providers/mountain-weather/openMeteo.js:51,64` |
| Wind | NOAA GFS 0.25 deg on AWS, ECMWF IFS open data | 1 h | GFS cycle every 6 h, published 3.5 to 5 h after cycle (**verify**) | 0.25 deg (about 25 km) | Particle animation | Cycle id in data | `server/providers/wind.js:16,102`; `src/layers/wind/index.js:112` |
| Air quality (WP2) | OpenAQ v3 stations; CAMS via Open-Meteo | 20 min client / 1 h server | Hourly averages; stale after 3 h | Station / 45 km model | n/a | **Yes**, measurement time and stale state | `server/providers/air-quality/openaq.js:22-34`; `src/layers/airQuality/index.js:60` |
| Traffic | OpenFreeMap roads + simulation (TomTom blocked) | Simulation per frame | n/a, **simulated** | OSM road classes | Simulated particles | Labelled simulated | `server/standalone/free-only.js:11`; `src/layers/traffic/roadModes.js:63-66,263-274` |
| Transit | GTFS-RT allow-list (none in India) | 15 s, ETag-aware | Feed lag shown | Vehicle GNSS | Interpolated behind feed lag | **Yes**, "shown N s behind" (the model to copy) | `src/layers/transit/policy.js:23,217,452-468`; `src/sources/transitService.js:45,157,199` |
| CCTV | 25 Western/Asian packs (none in India) | 10 s stills | Camera-dependent | Image | n/a | Per-camera | `src/layers/cctv/policy.js:14` |

### 2.2 How motion is handled today

The aircraft pipeline is already sophisticated, so the improvements in section 4 refine it rather than replace it.

- **Render-behind clock.** The fleet is drawn at `now - RENDER_DELAY_SEC` with `RENDER_DELAY_SEC = 30`, "one poll interval", so positions interpolate between two known fixes instead of extrapolating and snapping back (`src/layers/flights/policy.js:139-148`). Every consumer (labels, HUD, detection) shares this delayed clock. Consequence: an airliner at 250 m/s is drawn about 7.5 km behind where it is now, and nothing in the UI says so.
- **Extrapolation.** When no bracketing pair exists (warm-up, a missed poll) the model integrates a constant-rate turn arc from estimated turn rate (`src/data/motionModel.js:1-9`, state `EXTRAPOLATING` at `:354`), with speed-dependent course blending and slew caps for slow aircraft and helicopters (`:95-138`).
- **Step absorption.** A discontinuity at hand-off or after a feed glitch is turned into a correction offset that decays over 900 ms (`src/layers/flights/policy.js:271-280`).
- **Tick rate.** Untracked aircraft are dead-reckoned every 80 ms (12.5 Hz, `policy.js:195`), tracked ones every frame. At close zoom a jet moves 20 m per tick, which can read as stepping.
- **Fix time.** Each fix is timestamped from `seen_pos`, not from receipt (`src/sources/live/aircraft.js:64-69`; `src/layers/flights/records.js:251-273`), and a snapshot older than 120 s is marked stale (`aircraft.js:124`).
- **Eviction.** Three missed polls, one for likely-landed aircraft (`src/layers/flights/recordPolicy.js:8-10`).
- **Vessels** have no interpolation at all (`src/layers/vessels/rendering.js:49-53`). **Satellites** are re-propagated once a second when untracked (`src/layers/satellites/policy.js:30`). **Transit** interpolates behind a measured feed lag (`src/layers/transit/policy.js:26,217`). **Local ADS-B** extrapolates per frame (`src/layers/localAdsb/index.js:380`).

### 2.3 What the UI says about age today

- The Layers panel row reads `{source} · {ago}`, `STALE · {source} · {ago}` or `FALLBACK · {source} · {detail}` (`src/ui/layerPanel.js:700-777`). `ago` is whatever the layer reports as `lastUpdate`.
- Flights report the source snapshot epoch (good, `src/layers/flights/ingestion.js:58-61`). Earthquakes report the browser fetch time (`src/layers/earthquakes/index.js:165`), so "just now" can describe a feed generated a minute earlier and events hours old.
- `layerFeedState` labels any adsb.lol source as `fallback` (`src/data/feedState.js:36-42`). Under Free-only adsb.lol is the only civil aircraft source, so the chip permanently says FALLBACK for a healthy feed.
- FIRMS says "LIVE · updated Xm ago" (`src/layers/firms/queries.js:268`) for detections that are about 3 h old at best, against FREE-DATA-PLAN's own rule not to label them live.
- Satellites show no element epoch. Imagery shows no capture date. Terrain shows no epoch.
- Good examples to copy: transit's "shown N s behind" (`src/layers/transit/policy.js:468`), weather's "typically 2 to 3 h delayed" (`src/layers/weather/index.js:652`), OpenAQ's measurement time and stale state, Recent Imagery's dated products.

### 2.4 Known staleness, in order of how much a Dehradun user would notice

1. Basemap imagery 6 to 23 months old, undisclosed, with sub-metre detail ending at level 18.
2. Aircraft drawn 30 s behind, with only 18 aircraft in 250 nm from adsb.lol in the probe and none below 10,000 ft (section 3.2).
3. Cloud imagery hourly and 2 to 3 h late, while a 15-minute product about 25 minutes old exists (section 3.3).
4. Fires about 3 h after the pass, presented as LIVE.
5. Satellite elements cached 6 h against a 2 h upstream cycle, in the TLE format (see risk R5).
6. Earthquakes limited to the last 24 h, fetch-time "ago".
7. Terrain from 2011 to 2015 radar (reservoir levels, landslides, new road cuts are absent).
8. OSM vectors up to a week behind, region pack frozen at its extract date.

---

## 3. Probes run for this plan (7 November 2026)

### 3.1 Esri World Imagery capture dates

`World_Imagery/MapServer/identify` on `services.arcgisonline.com`, keyless, returns `DATE (YYYYMMDD)`, `RESOLUTION (M)`, `ACCURACY (M)`, `SOURCE_INFO`, `SOURCE`, `MinMapLevel`, `MaxMapLevel` and `ReleaseName` per point and scale, and answers with `Access-Control-Allow-Origin: *`.

| Point | Capture date | Resolution | Stated accuracy | Product / vendor | Levels |
|---|---|---|---|---|---|
| Clock Tower (30.3245, 78.0322) | 2026-04-16 | 0.34 m | 5 m | Vivid / Vantor (block `Vivid_Standard_IN01_26Q2`, release 2026.R07) | 12 to 18 |
| Rajpur Road (30.355, 78.061) | 2026-04-16 | 0.34 m | 5 m | Vivid / Vantor | 12 to 18 |
| Mussoorie (30.4599, 78.0664) | 2026-04-16 | 0.34 m | 5 m | Vivid / Vantor | 12 to 18 |
| Chakrata (30.70, 77.87) | 2026-05-14 | 0.31 m | 5 m | Vivid / Vantor | 12 to 18 |
| Kedarkantha (31.02, 78.17) | 2026-02-15 | 0.34 m | 5 m | Vivid / Vantor | 12 to 18 |
| Jolly Grant (30.1897, 78.1803) | 2025-12-02 | 0.31 m | 5 m | Vivid / Vantor | 12 to 18 |
| Tehri dam (30.378, 78.48) | 2025-11-07 | 0.31 m | 5 m | Vivid / Vantor | 12 to 18 |
| Rishikesh (30.0869, 78.2676) | 2024-12-13 | 0.34 m | 5 m | Vivid / Vantor | 12 to 18 |
| Below level 12 (all points) | undated | 15 m | 12 m | TerraColor NextGen / Earthstar | 0 to 11 |

The Wayback configuration (`waybackconfig.json`) lists 198 dated releases, newest WB_2026_R10 of 29 October 2026, each with a per-release metadata service.

### 3.2 ADS-B around Dehradun (250 nm, one request each, 17:4x UTC)

| Source | Aircraft | With position | Median `seen_pos` | p90 `seen_pos` | Below 10,000 ft | Snapshot lag |
|---|---|---|---|---|---|---|
| adsb.lol (the app's endpoint) | 18 | 18 | 1.0 s | 28.7 s | 0 | 0.5 s |
| adsb.fi `/api/v3/lat/lon/dist` | 53 | 53 | 0.4 s | 25.1 s | 9 | 0.7 s |

A second sample by the research pass at 17:41 UTC gave 58 against 16. One evening sample is not a coverage study, but the gap is large and consistent: adsb.fi currently sees about three times as many aircraft near Dehradun, including the low-level traffic adsb.lol misses. airplanes.live answered API calls with a "contact us" error and is excluded.

### 3.3 Other probes

- **METAR** (aviationweather.gov Data API): `VIDN` (Jolly Grant) and `VIDP` (Delhi) both return observed reports; the latest VIDN report was 15:00 UTC, consistent with an airport that does not report overnight (**verify** VIDN hours).
- **EUMETView WMS** (`view.eumetsat.int/geoserver/wms`): Meteosat IODC layers (`msg_iodc:ir108`, `rgb_airmass`, `rgb_convection`, `rgb_dust`, `fire` and others) every 15 minutes; latest frame about 25 minutes old.
- **GIBS:** HLS S30/L30 latest date 4 November on 7 November; Himawari AHI layers every 10 minutes, about 1 h old, but 78 E is about 76 degrees off the Himawari nadir, so the view of India is very oblique.
- **Re:Earth terrain `layer.json`:** `mapterhorn-egm08`, quantized mesh, `maxzoom` 14.

---

## 4. Improvement catalogue

Effort: **S** up to 2 days, **M** up to 1 week, **L** more than 1 week. "Gain" is what the Dehradun user sees.

### 4.1 Detail

| ID | Improvement | Free source | Expected gain | Cost and limits | Effort |
|---|---|---|---|---|---|
| D1 | Render at device pixels on HiDPI screens with an adaptive resolution governor | CesiumJS `useBrowserRecommendedResolution: false`, `resolutionScale` ([Viewer](https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html)) | Today the viewer renders at CSS pixels (option unset at `src/app/viewer.js:337-357`, Cesium default `true`), so a Retina screen shows imagery, labels and icons at half the linear resolution; the app instead offers a sharpen post-process (`src/ui/visualSettings.js:203-205`). Native resolution roughly doubles linear detail | Up to 4x fragment work with MSAA 4 on; needs the governor in D1/S1 to step down under load | S |
| D2 | Crisp vector labels and road casings over imagery, with `name:hi` where present | OpenFreeMap (already decoded for traffic) ([openfreemap.org](https://openfreemap.org/)); OpenMapTiles schema ([schema](https://openmaptiles.org/schema/)) | Street and locality names readable at any zoom over Esri imagery, in Hindi or English; today imagery has no labels at all under Free-only | Weekly OSM lag; label decluttering cost; reuse the shared decoded tile cache (`src/sources/openFreeMap.js:360-388`) | M |
| D3 | 3D buildings extruded from OSM footprints | OpenFreeMap `building` layer `render_height`, `render_min_height`, `hide_3d` ([schema](https://openmaptiles.org/schema/)); Overture buildings regional extract ([guide](https://docs.overturemaps.org/guides/buildings/)) | A built city in 3D where Google 3D has no India mesh | Most Dehradun buildings have no height tag, so heights default to an estimate and must be labelled "estimated"; Overture India height coverage **verify**; ODbL attribution | L |
| D4 | Dated sub-metre history: Esri World Imagery Wayback picker | `waybackconfig.json` ([config](https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json)); per-release metadata, e.g. [2026 R10](https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r10/MapServer) | See Dehradun in each distinct capture since 2014, with dates; useful for "what changed" | Esri Master License Agreement, no offline export ([item](https://www.arcgis.com/sharing/rest/content/items/10df2279f9684e4a9f6a7f08febac2a9?f=json)); keyless use on the same footing as the existing basemap (**verify**) | M |
| D5 | "Beyond source detail" cue when zoom exceeds the imagery's `MaxMapLevel` | Esri identify (section 3.1) | Users stop reading upsampled pixels as detail | One cached identify per view cell | S |
| D6 | Larger Dehradun region pack | Geofabrik extract, `scripts/build-region-pack.mjs` (existing) | Offline roads, buildings, Hindi names beyond the 3 km box | Existing caps (10 km, 10,000 features, 4 MiB) | S |

### 4.2 Freshness

| ID | Improvement | Free source | Expected gain | Cost and limits | Effort |
|---|---|---|---|---|---|
| F1 | Latest cloud-free 10 m Sentinel-2 true colour for a bounded box, dated | Earth Search STAC v1 `sentinel-2-l2a`, `query: {"eo:cloud_cover": {"lt": N}}`, `visual` COG ([Earth Search](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a)) via the existing range reader (`server/providers/research/rangeSource.js`) | Imagery days old instead of months, at 10 m: monsoon landslides, river channels, new construction | 10 m is not sub-metre; clouds; acquisition-to-catalog latency **verify**; Sentinel legal notice attribution | M |
| F2 | Dated annual cloudless mosaic as an alternative basemap | EOX Sentinel-2 cloudless `s2cloudless-2025` WMTS ([capabilities](https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml), [licence](https://cloudless.eox.at/documentation/license)) | A seamless, consistently dated 10 m layer when the Esri date is old | CC BY-NC-SA 4.0, non-commercial only (fits personal use); attribution string required | S |
| F3 | Choose among VIIRS NOAA-20, NOAA-21 and SNPP for the daily overview | GIBS ([visualisations](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/)) | Three passes a day instead of one, more chance of a clear view; NRT within 3.5 h | None beyond existing GIBS use | S |
| F4 | Earthquakes: add `all_week` M2.5+ beside `all_day`, and use feed `metadata.generated` | USGS GeoJSON feeds, "updated every minute" ([feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)) | Last week's Garhwal events visible; honest feed time | Larger payload (filter by view) | S |
| F5 | Satellites: align the cache to CelesTrak's 2 h cycle and switch to OMM JSON | CelesTrak GP ([formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php), [usage policy](https://celestrak.org/usage-policy.php)); `json2satrec` present in satellite.js 6.0.2 | Elements at most about 2 h behind CelesTrak instead of 6 h; no dependence on the 5-digit TLE catalogue field | Policy: download once per update, stop on non-200 | S |
| F6 | Record and show OSM extract date; weekly rebuild hint for the region pack | Geofabrik ([India](https://download.geofabrik.de/asia/india.html)) | Users know how current roads and buildings are | Manual rebuild | S |

### 4.3 Live feeds

| ID | Improvement | Free source | Expected gain | Cost and limits | Effort |
|---|---|---|---|---|---|
| L1 | Merge adsb.fi into the fleet beside adsb.lol (union by ICAO hex, newest position wins) | adsb.fi open data `/api/v3/lat/{lat}/lon/{lon}/dist/{nm}` ([README](https://github.com/adsbfi/opendata)); adsb.lol ([OpenAPI](https://api.adsb.lol/api/openapi.json)) | About 3x aircraft near Dehradun in the probe, including low-level traffic | adsb.fi: 1 request/s per IP, errors count toward a block, personal non-commercial use, link credit; already admitted for hex lookups (`docs/design/aurel/phase-6/wp7/SOURCE-ADMISSION.md:12`); adsb.lol plans to require a feeder key (**verify** timing) | M |
| L2 | Push earthquakes from the EMSC websocket via a server relay and SSE | EMSC Seismic Portal `wss://www.seismicportal.eu/standing_order/websocket`, CC BY 4.0 ([realtime](https://www.seismicportal.eu/realtime.html)) | New regional events appear within seconds of EMSC publication instead of up to 60 s plus USGS lag; WP7 matching already pairs them with USGS | One long-lived server connection; reconnect with backoff; reuse the SSE pattern in `src/layers/ghostMaps/source.js:17-60` | M |
| L3 | 15-minute satellite clouds for India | EUMETView WMS, Meteosat IODC `msg_iodc:ir108`, `rgb_airmass`, `rgb_convection`, `rgb_dust` ([WMS](https://view.eumetsat.int/geoserver/wms)); EUMETSAT data policy allows WMS visualisations with attribution ([policy PDF](https://www-cdn.eumetsat.int/files/2026-01/45173%20-%20Data_Policy.pdf)) | Frame age about 25 min instead of 2 to 3 h; 15-minute loop of monsoon convection | IODC satellite end date and replacement **verify**; about 3 km at sub-satellite point, coarser at 78 E | M |
| L4 | Observed weather at Jolly Grant and Delhi beside the Open-Meteo model | aviationweather.gov Data API METAR ([API](https://aviationweather.gov/data/api/)) | The only free *observation* of Dehradun weather in the app: visibility, haze, wind, cloud base | VIDN reports only in operating hours; request limit **verify**; US government public data | S |
| L5 | Satellite elements from operator ephemerides where available | CelesTrak SupGP: Starlink, OneWeb, Kuiper, ISS, GPS and others ([SupGP](https://celestrak.org/NORAD/elements/supplemental/)) | Tighter positions for the ISS and the constellations that dominate the night sky | Same 2 h download policy | S |
| L6 | Promote the local receiver: siting guide, feed-to-aggregators note, coverage polygon from its own messages | Existing `server/providers/local-receivers.js`; [docs/LOCAL-RECEIVERS.md](../../LOCAL-RECEIVERS.md) | The only path to reliable low-level traffic at Jolly Grant; feeding adsb.fi/adsb.lol improves everyone's map | A one-off RTL-SDR dongle and antenna (owner's choice, not a service fee) | S |
| L7 | IMD radar as a link-out card, not an overlay | mausam.imd.gov.in radar pages (Surkanda Ji, Lansdowne, Mukteshwar) | One click to the authoritative local radar | Reuse terms not found, so no ingestion (**verify** before any overlay) | S |

### 4.4 Precision and accuracy

| ID | Improvement | Free source | Expected gain | Cost and limits | Effort |
|---|---|---|---|---|---|
| P1 | Cut aircraft display lag from 30 s to about 10 s: poll 10 s, render delay tied to measured fix spacing, extrapolation bounded and blended | Existing motion model; adsb.lol + adsb.fi | Position drawn about 2.5 km behind a cruising jet instead of 7.5 km; turn and climb visible sooner | 3x poll rate per anchor; shared server cache keeps upstream at most 1 request per anchor per 10 s per source | M |
| P2 | Measured extrapolation error harness | Recorded Dehradun fixtures from P1 sources | A number for "how wrong is the drawn position", tracked in CI | None | S |
| P3 | Vessel dead reckoning from SOG/COG with the aircraft step-blending | AIS fields already ingested | Ships glide instead of jumping up to about 600 m every 60 s | Inland Dehradun has no AIS; benefit is at Indian ports | S |
| P4 | Per-frame satellite interpolation between 1 s SGP4 samples | Existing propagation (`src/layers/satellites/rendering.js:145-190`) | No 7.5 km stepping of LEO points when zoomed in | Small per-frame cost (linear in visible points) | S |
| P5 | Element-age error estimate per satellite | GP epoch from OMM | Card says "elements 9 h old, position uncertainty about N km" (**verify** growth model per orbit class) | None | S |
| P6 | Bare-earth terrain option for ground clamping and hydrology inside the region pack | FABDEM, GLO-30 with buildings and forest removed, CC BY-NC-SA 4.0 (**verify** licence and access route) | Pins, routes and Raindrop traces sit on the ground, not on canopy tops | Non-commercial; bounded regional extract only; still 2011 to 2015 | M |
| P7 | Show imagery horizontal accuracy and vendor block | Esri identify `ACCURACY (M)` | Explains offsets of up to about 5 m between imagery and roads | None | S |

### 4.5 Smoothness and performance

| ID | Improvement | Free source | Expected gain | Cost and limits | Effort |
|---|---|---|---|---|---|
| S1 | Frame-time governor for D1: step `resolutionScale` down when p95 frame time is high, back up when idle | CesiumJS `Viewer.resolutionScale` | Native sharpness when there is headroom, smooth motion when there is not | Must co-exist with the idle render governor (`src/renderGovernor.js:42-72`) | S |
| S2 | Per-frame dead reckoning for on-screen aircraft within a near radius; keep 80 ms ticks for the rest | `FLEET_DR_INTERVAL_MS` seam (`src/layers/flights/policy.js:195`) | No 20 m stepping of nearby jets at close zoom | Bounded by a per-frame budget (count cap) | S |
| S3 | Larger tile cache and sibling preload during camera flights | `Globe.tileCacheSize` (default 100), `preloadSiblings` (default false) ([Globe](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html)) | Fewer grey or blurry tiles when panning back or during Director shots | Memory (measure); more upstream tile requests, so preload only during flights | S |
| S4 | Jittered polling with exponential backoff and conditional requests in the layer scheduler | `src/data/lifecycle.js:545-596` (fixed `setInterval`, visibility pause); ETag pattern from `src/sources/transitService.js:157-199` | Layers stop polling in lock-step; failing upstreams are backed off uniformly; 304s save bandwidth | Small refactor of a shared file | M |
| S5 | One server SSE stream for push-capable feeds (quakes, AIS deltas, aircraft deltas) | Node SSE, existing ghostMaps pattern | Lower latency and fewer requests than per-layer polling | Proxy timeouts; reconnect logic | M |
| S6 | Optional, labelled terrain exaggeration (1.0 to 2.0) | `scene.verticalExaggeration` | Readable Doon valley relief from orbit heights | Must show "relief exaggerated x1.5" whenever not 1.0 | S |

### 4.6 Honesty in the UI

| ID | Improvement | Source | Expected gain | Effort |
|---|---|---|---|---|
| H1 | Imagery capture-date badge for the view centre: date, age, resolution, accuracy, vendor; "date unknown" when offline | Esri identify (section 3.1) | Answers "how old is this picture?" everywhere, permanently | S |
| H2 | "Drawn N s behind" chip on aircraft rows, cards and HUD, from the actual render delay | `RENDER_DELAY_SEC`, transit wording | Users understand why the plane is not where it is | S |
| H3 | adsb.lol (and adsb.fi) are primary under Free-only, not FALLBACK | `src/data/feedState.js:36-42` | A healthy feed stops looking degraded | S |
| H4 | FIRMS row: "NRT · newest detection Xh ago" instead of "LIVE" | `src/layers/firms/queries.js:268` | Matches FREE-DATA-PLAN's own rule | S |
| H5 | Satellite card: element epoch and age; layer row: oldest element age | OMM `EPOCH` | Propagated positions are visibly model output | S |
| H6 | "Observed N s ago" chip per selected entity (aircraft position age, vessel report age, quake origin and publication time) | Existing per-record times | Distinguishes data age from fetch age | S |
| H7 | Coverage layers: observed ADS-B coverage polygon from the last hour of positions; "blank is not none" note | Merged aircraft history | Users stop reading empty sky as no traffic | M |
| H8 | Credit text from the service (Vantor), not hard-coded "Maxar" | Esri identify `SOURCE` | Correct attribution | S |

---

## 5. Phased implementation plan

Each work package becomes one build session in its own git worktree, on its own branch from `main`, under the shared rules of [IMPLEMENTATION-PLAN-02.md section 6](IMPLEMENTATION-PLAN-02.md) (Free-only default, admission record in `docs/design/aurel/data-quality/<wp>/SOURCE-ADMISSION.md`, every number with source, unit, time and class, new modules with tests, registration-only edits to shared files, `npm run i18n`, targeted then full `npm test`, `npm run format:check`, `npm run check:boundaries`) and the verification gate of its section 7. Two additions for this plan:

- **Measurement first.** Every package that claims a latency, error or frame-time number ships the script that measures it, under `scripts/qa-aurel-dq-<wp>.mjs`, with fixtures recorded once and replayed offline. A claim without its script fails the gate.
- **Polite upstreams.** Every new poll is shared server-side per view anchor, respects the provider's published rate, carries an identifying User-Agent and stops on repeated non-200 answers.

### Phase A: quick wins, this week

#### DQ1: Imagery capture-date badge (size S)

- **Goal.** For the view centre, show the Esri imagery capture date, its age, source resolution, stated accuracy and vendor; flag zoom beyond the source's `MaxMapLevel`; take the credit vendor from the service.
- **Files and seams.** `src/maps/imagery.js` (credit text, H8), `src/maps/controller.js` (active stack id and camera settle), `src/maps/credits.js`, the HUD map chip, `src/ui/layerPanel.js` (no change beyond a registration line if a row is used).
- **New modules.** `src/maps/imageryMetadata.js` (identify request builder, response parser, cell cache keyed by 0.01 deg cell and zoom band, request de-duplication), `src/maps/imageryMetadata.test.mjs`, a small view component for the badge.
- **Data.** `services.arcgisonline.com/.../World_Imagery/MapServer/identify`, keyless, CORS open (section 3.1). Only when the active stack is `esri-imagery`.
- **Acceptance.** After the camera settles, the badge shows "Imagery 16 Apr 2026 · 6 months old · 0.34 m · ±5 m · Vantor" for the Clock Tower within 1 s at p95 on a warm connection (measured over 20 settles); a return to an already-seen cell issues 0 network requests; no more than 1 identify per settle and 30 per minute; above level 18 the badge adds "beyond source detail"; offline or on error it reads "capture date unknown", never a guessed date; with OSM or Natural Earth active the badge says those maps carry no capture date.
- **Tests.** Parser against recorded Dehradun, Rishikesh and 15 m TerraColor responses; cell and zoom-band keying; settle debounce; rate cap; error and malformed payloads; stack switch cancels in-flight requests; age wording at month and year boundaries; i18n strings including `hi`.
- **Out of scope.** Wayback history (DQ7); caching tiles; any claim about imagery outside Esri.

#### DQ2: Freshness honesty pass (size S)

- **Goal.** Make every age the user sees describe the data, not the fetch, and stop mislabelling healthy or delayed feeds.
- **Files and seams.** `src/data/feedState.js` (H3: adsb sources are primary when Free-only blocks OpenSky), `src/layers/firms/queries.js` (H4), `src/layers/earthquakes/index.js` and `records.js` (F4: `metadata.generated`, per-event origin and publication time), `src/layers/flights/queries.js` and cards (H2, H6), `src/layers/military/queries.js` (H2), `src/layers/satellites/*` cards (H5 via existing TLE fields until DQ5 lands).
- **New modules.** `src/data/freshness.js` (one formatter for "observed N s ago", "drawn N s behind", "elements N h old"; reused by all layers), tests.
- **Data.** None new.
- **Acceptance.** Under Free-only with a healthy adsb.lol feed the Flights row shows no FALLBACK state; the Flights row and card show "drawn 30 s behind" equal to the live `RENDER_DELAY_SEC`; the FIRMS row never contains "LIVE" and shows the newest acquisition age within 1 minute of the true value; the earthquake row age equals `now - metadata.generated` to within 1 s; a satellite card shows its element epoch; a grep-based copy check finds no "live" wording on FIRMS, satellites or imagery.
- **Tests.** `layerFeedState` truth table with Free-only on and off; formatter units and rounding; quake generated-time parsing; FIRMS label states (fresh, stale cache, empty); copy check for forbidden words.
- **Out of scope.** Changing poll rates or motion (DQ6); new sources.

#### DQ3: Sharp rendering on HiDPI screens (size S)

- **Goal.** Render at device pixels when the GPU has headroom, step down smoothly when it does not.
- **Files and seams.** `src/app/viewer.js:337-370` (`useBrowserRecommendedResolution: false`), `src/renderGovernor.js` (governor stays authoritative for idle mode), `src/ui/visualSettings.js` (sharpen default revisited once native resolution is on; a "Resolution: auto / native / battery" setting).
- **New modules.** `src/app/resolutionGovernor.js` (rolling frame-time window, hysteresis, steps 1.0, 0.75, 0.5 of device pixels, never below CSS pixels), tests.
- **Data.** None.
- **Acceptance.** On a DPR 2 display at 1440x900 CSS pixels with no layers, the drawing buffer is 2880x1800 while p95 frame time over 120 frames stays at or under 16.7 ms; with flights, satellites and wind on, scale steps down within 2 s when p95 exceeds 25 ms and returns within 5 s of recovering; in idle mode no extra frames are rendered (governor request count unchanged against baseline over 60 s parked); `tileCacheSize` raised only if the memory script shows under 300 MB extra GPU memory on the reference route (S3 measured here, enabled in DQ8).
- **Tests.** Governor hysteresis and bounds on synthetic frame-time series; interaction with `holdContinuousRender` and idle mode; setting persistence; screenshot pair at 1440x900 and 390x844 filed.
- **Out of scope.** FXAA (off by default in Cesium 1.138; MSAA 4 stays); changing `maximumScreenSpaceError` before tile-count measurements exist.

#### DQ4: Second fleet source, adsb.fi (size M)

- **Goal.** Show the union of adsb.lol and adsb.fi aircraft in the 250 nm view anchor, with per-aircraft source and position age.
- **Files and seams.** `server/providers/aircraft/opensky.js` (anchor cache at `:152-163,370-440`), `server/providers/aircraft/adsb-lol.js`, `src/sources/live/aircraft.js` (parser is readsb-compatible), `src/layers/flights/records.js` (merge keyed by hex, newest `positionTimeMs` wins), `src/corroboration/dependencies.js` (shared-feeder note stays honest: a union is not corroboration).
- **New modules.** `server/providers/aircraft/adsb-fi.js` (v3 area endpoint, 1.1 s spacing, error-aware backoff, shared per-anchor cache), `server/providers/aircraft/merge.js`, tests, `docs/design/aurel/data-quality/dq4/SOURCE-ADMISSION.md` (extends WP7's adsb.fi admission from hex lookups to the area endpoint; personal non-commercial; link credit).
- **Data.** adsb.fi open data v3; adsb.lol v2 (the app's current `lat/lon/dist` path, **verify** it stays supported against `/v2/point` in the OpenAPI spec).
- **Acceptance.** On the recorded Dehradun fixture the merged set equals the union of hex ids with 0 duplicates; when both sources hold the same hex the newer position is drawn and the card names both sources; upstream request rate to adsb.fi never exceeds 1 per second per server and 1 per anchor per poll; with adsb.fi failing, the layer shows adsb.lol alone and the row says "1 of 2 sources"; attribution lists both.
- **Tests.** Merge rules (newer fix wins, missing positions, conflicting altitudes); rate spacing and backoff after 429 and 5xx; outage of each source; credit text; Free-only admission (no OpenSky request ever).
- **Out of scope.** airplanes.live (API answered with a contact-us error); OpenSky; MLAT-only targets; any commercial reuse.

### Phase B: next two to four weeks

#### DQ5: Fresher sky: 15-minute clouds, observed weather, orbital elements (size M)

- **Goal.** Replace the hourly, 2 to 3 h late cloud mosaic over India with Meteosat IODC every 15 minutes; add METAR observations; move satellites to OMM with a 2 h cache and SupGP where available.
- **Files and seams.** `server/providers/weather.js` (new product entries beside `global_longwave_imagery_mosaic`), `src/layers/weather/*` (product choice by view longitude, frame timestamp), `server/providers/space/celestrak.js` (`FORMAT=json`, `TLE_TTL_MS` to 2 h aligned to upstream, SupGP groups), `src/layers/satellites/orbits.js` (`json2satrec`), `server/providers/field-context.js` (METAR card beside the model card, never merged).
- **New modules.** `server/providers/eumetview.js` (WMS GetMap proxy with time dimension, cache by frame time), `server/providers/metar.js` (aviationweather.gov, station list VIDN and VIDP, 10 min cache), tests, admission records for EUMETView, aviationweather.gov and CelesTrak SupGP.
- **Data.** EUMETView `msg_iodc:ir108` and RGB composites; aviationweather.gov METAR; CelesTrak GP JSON and SupGP.
- **Acceptance.** Over Dehradun the cloud layer's frame time is shown and its median age over a 24 h soak is at or under 40 minutes (today 2 to 3 h); attribution reads "Contains modified EUMETSAT Meteosat data 2026"; the METAR card shows "Observed at VIDN HH:MM UTC, N min ago" and switches to "no recent report" after 3 h; satellite elements are never more than 2 h 15 min behind the last successful CelesTrak download and CelesTrak is not contacted more than once per 2 h per group; SupGP ISS position differs from GP by a logged amount in the evidence file.
- **Tests.** WMS URL builder and time snapping to 15 minutes; frame-age labelling; METAR parsing (variable wind, CAVOK, missing groups); OMM parsing and epoch extraction; CelesTrak policy (stop on non-200, once per update); model and observation cards never combined.
- **Out of scope.** Himawari for India (too oblique); INSAT via MOSDAC (registration, 3-day delay for general users, terms **verify**); IMD radar overlay (link-out only, L7); nowcasting.

#### DQ6: Motion v2: lower lag, measured error, smooth ships and satellites (size M)

- **Goal.** Cut aircraft display lag to about 10 s with a measured error budget, add vessel dead reckoning and per-frame satellite interpolation.
- **Files and seams.** `src/layers/flights/policy.js` (`RENDER_DELAY_SEC` becomes derived from measured fix spacing with a floor and ceiling; `FLEET_DR_INTERVAL_MS` near-radius per-frame path, S2), `src/layers/flights/queries.js:308` (poll 10 s), `src/data/motionModel.js` (extrapolation horizon cap and confidence), `src/layers/military/*` (same clock), `src/layers/vessels/rendering.js:49-53` (DR from SOG/COG with step blending), `src/layers/satellites/rendering.js:145-215` (per-frame interpolation of cached positions and velocities).
- **New modules.** `scripts/qa-aurel-dq-motion.mjs` (replays recorded fixes: for each aircraft with fixes at t and t+10 s, extrapolates from t and reports horizontal error against the t+10 s fix), `src/data/motionBudget.js`, tests.
- **Data.** Recorded adsb.lol and adsb.fi snapshots around Dehradun and Delhi (fixtures, no live calls in CI).
- **Acceptance.** Display lag on the Flights row reads at most 12 s with a healthy feed; on the replay set, median horizontal error versus the next fix is under 150 m at 10 s extrapolation and p90 under 400 m; no on-screen position step over 50 m is applied in under 600 ms; a turning aircraft's drawn heading lags the reported track by under 5 degrees at p90; vessels moving over 2 kn advance every frame and the correction at the next report is under 100 m at p90 on the AIS fixture; untracked LEO satellites move every frame with under 1 px step at 1 km camera range; upstream request rate per anchor stays within DQ4's limits.
- **Tests.** Replay harness determinism; delay derivation bounds; extrapolation cap; blending; vessel DR with turns and stationary vessels; satellite interpolation against direct SGP4 at mid-interval (error under 10 m); render-governor holds unchanged.
- **Out of scope.** Predicting manoeuvres beyond the current turn; filed flight plans; any paid feed.

#### DQ7: Imagery through time: Wayback and dated alternatives (size M)

- **Goal.** Let the user pick a dated sub-metre release (only releases where the view actually changed), or a dated 10 m alternative, always with the date on screen.
- **Files and seams.** `src/maps/catalog.js` and `src/maps/defaultSources.js` (new stacks: `esri-wayback`, `eox-s2cloudless-2025`), `src/maps/imageryComparison.js` (before/after already leases the map), DQ1's badge.
- **New modules.** `src/maps/wayback.js` (config fetch, per-release metadata identify for the view centre, collapse of releases with the same capture date), `src/maps/eoxCloudless.js`, tests, admission records (Esri MLA wording, EOX CC BY-NC-SA).
- **Data.** `waybackconfig.json` and per-release metadata services; EOX WMTS.
- **Acceptance.** For the Clock Tower the picker lists distinct capture dates, not 198 releases, each verified by its release's metadata; switching releases updates the badge to that release's capture date within 1 s; the EOX layer always shows "Sentinel-2 cloudless 2025 (10 m)" and the CC BY-NC-SA credit; no Wayback or EOX tile is written to any offline pack or export.
- **Tests.** Release collapsing on recorded metadata; picker ordering; badge sync; export and pack guards; attribution strings.
- **Out of scope.** Tile caching or offline packaging of Esri or EOX imagery; change detection algorithms.

#### DQ8: Push and transport (size M)

- **Goal.** Push-capable feeds arrive by server-sent events; polled feeds back off with jitter and use conditional requests.
- **Files and seams.** `src/data/lifecycle.js:545-596` (jitter, exponential backoff on consecutive failures, ETag/If-Modified-Since hand-through), `src/layers/earthquakes/*` (EMSC events), server middleware registration.
- **New modules.** `server/providers/push/emsc-relay.js` (one websocket, reconnect with backoff, de-duplication by EMSC id, bounded queue), `server/providers/push/sse.js` (one `/api/push` stream, per-topic subscription), `src/sources/pushClient.js`, tests, EMSC admission record (CC BY 4.0).
- **Data.** EMSC websocket; USGS feeds unchanged.
- **Acceptance.** An EMSC message reaches the globe within 5 s of the relay receiving it at p95 (relay and replay fixture); WP7 pairs it with USGS when USGS catches up; with the relay down the layer falls back to polling and says so; across 10 enabled layers no two poll within 500 ms of each other more than 5% of the time over 30 minutes; a failing upstream is retried at 1, 2, 4, 8 up to 15 minutes; 304 responses are counted in diagnostics.
- **Tests.** Relay reconnect and de-duplication; SSE subscribe and unsubscribe; jitter distribution; backoff schedule; conditional request headers; fallback to polling.
- **Out of scope.** Websocket from the browser to third parties; AIS or aircraft deltas over SSE (Phase C if measured worthwhile).

### Phase C: later, larger

#### DQ9: Labels and 3D buildings over imagery (size L)

- **Goal.** Readable Hindi and English labels and road casings over satellite imagery; extruded OSM buildings with honest heights.
- **Files and seams.** `src/sources/openFreeMap.js` (new projection of the shared decoded tile for `transportation_name`, `place`, `building`), `src/regions/pack.js` (building heights in the pack), WP8's `name:hi` handling.
- **New modules.** `src/layers/basemapLabels/` (decluttered label collection, zoom-banded), `src/layers/buildings3d/` (extrusion from `render_height`, default estimate when absent, flagged per feature), tests, Overture admission record if Overture heights are used.
- **Data.** OpenFreeMap OpenMapTiles layers; Overture buildings regional extract (optional).
- **Acceptance.** At Rajpur Road at 1,500 m camera height, at least 90% of OSM named primary and secondary roads in view carry a label without overlap; Hindi labels appear where `name:hi` exists and fall back to English; building tops with a tagged height render within 1 m of the tag; untagged buildings render at the documented estimate with an "estimated height" note in their card; p95 frame time stays under 25 ms on the reference route with labels and buildings on.
- **Tests.** Label decluttering, fallback order, extrusion heights, estimate flagging, memory caps.
- **Out of scope.** Photogrammetry; inventing heights from imagery shadows; Google 3D.

#### DQ10: Bare-earth terrain and coverage maps (size M)

- **Goal.** Region-pack bare-earth DEM for clamping and Raindrop; observed ADS-B coverage polygon; terrain epoch shown.
- **Files and seams.** `scripts/build-region-pack.mjs`, `src/regions/pack.js`, `src/hydro/*` (WP5), `src/layers/flights/*` (coverage from merged history).
- **New modules.** `src/coverage/adsbCoverage.js`, a FABDEM extract step, tests, FABDEM admission record.
- **Data.** FABDEM (**verify** licence and download route); merged aircraft positions.
- **Acceptance.** Inside the pack, ground pins sit within 3 m of the bare-earth surface where GLO-30 is over 10 m above it under forest; the coverage polygon of the last hour is drawn with "coverage observed, not guaranteed"; the terrain credit shows "surface 2011 to 2015".
- **Tests.** DEM swap inside and outside pack bounds; coverage hull from fixtures; copy check.
- **Out of scope.** A global bare-earth mesh; survey-grade claims.

#### DQ11: Receiver and local station kit (size S)

- **Goal.** Make the owner's own RTL-SDR the best aircraft source over Jolly Grant: siting guidance, health, coverage ring, and instructions to feed adsb.fi and adsb.lol.
- **Files and seams.** `docs/LOCAL-RECEIVERS.md`, `src/layers/localAdsb/status.js`.
- **New modules.** None beyond a coverage ring helper shared with DQ10.
- **Data.** Local receiver only.
- **Acceptance.** With a receiver configured, local contacts below 5,000 ft AGL within 30 km appear with under 2 s age; the coverage ring reflects the last hour of messages.
- **Tests.** Status and ring on recorded receiver output.
- **Out of scope.** Buying hardware; MLAT servers.

### Dependencies and order

| Package | Depends on | Notes |
|---|---|---|
| DQ1, DQ2, DQ3 | none | Independent; ship first. |
| DQ4 | none | DQ6 measures against its merged feed. |
| DQ5 | none | Weather, METAR and CelesTrak parts are separable. |
| DQ6 | DQ4 (fixtures), DQ2 (freshness formatter) | Lag claim must use DQ2's chip. |
| DQ7 | DQ1 | Shares the badge and metadata parser. |
| DQ8 | none | Touches `src/data/lifecycle.js`; merge alone. |
| DQ9 | DQ3 (frame budget) | Heaviest GPU cost; measure after DQ3. |
| DQ10, DQ11 | DQ4 | Coverage uses merged history. |

---

## 6. Risks and open checks

| ID | Risk | Why it matters | Mitigation |
|---|---|---|---|
| R1 | Esri terms for keyless use | Basemap, identify and Wayback all rest on the Esri Master License Agreement, which forbids offline export; whether keyless non-commercial use is permitted is **verify** | Same footing as today's basemap; no caching or packaging; OSM and EOX remain fallbacks; record the decision in DQ1's admission file |
| R2 | adsb.fi and adsb.lol terms change | adsb.lol says a feeder key will be required later; adsb.fi is personal non-commercial with a strict 1 request/s | Union design degrades to one source; DQ11 makes the owner a feeder, which is how keys are earned |
| R3 | One-evening ADS-B sample | The 3x gap could vary by hour | DQ4 records a 24 h comparison before claiming the gain in copy |
| R4 | Meteosat IODC lifetime | Meteosat-9 at 45.5 E has a finite service life; replacement **verify** | Keep nowCOAST as fallback; product chosen by capability check, not hard-coded |
| R5 | TLE catalogue numbers | New objects beyond the 5-digit catalogue field cannot be expressed in TLE format (**verify** CelesTrak's current status) | DQ5 moves to OMM JSON |
| R6 | HiDPI cost on older GPUs | Device-pixel rendering with MSAA can halve frame rate | DQ3 governor with hysteresis and a battery setting |
| R7 | Lower aircraft lag increases snap risk | Less render-behind means more extrapolation | DQ6 error harness gates the change; delay derived from measured fix spacing |
| R8 | Sentinel-2 latency and clouds | "Latest" can be a week old in monsoon or winter haze | Always dated; "no clear scene in N days" state |
| R9 | Upstream politeness | More sources and faster polls | Server-side shared caches per anchor, published limits, stop on repeated errors |
| R10 | FABDEM licence | Non-commercial; access route **verify** | Region pack only; GLO-30 remains default |

---

## 7. What cannot be made live for free

- **Sub-metre imagery that is days old.** All sub-metre satellite imagery is commercial (Vantor, Airbus, Planet SkySat); free mosaics like Esri's are months to years old. The best free "recent" view is Sentinel-2 at 10 m every few days, or HLS at 30 m.
- **Live road traffic in India.** TomTom is blocked by Free-only and no free open traffic feed exists; the traffic layer stays simulated and labelled.
- **Live CCTV in Dehradun.** No public camera feed with a redistribution licence was found.
- **Low-level aircraft without a receiver.** Mountain terrain shadows Jolly Grant approaches; only a local receiver (DQ11) fixes that.
- **Weather radar overlay for India.** IMD radar exists, but reuse terms were not found; link-out only.
- **Observed weather between airports.** METAR covers VIDN and VIDP; IMD automatic weather stations have no open API found.
- **Fires faster than about 3 h.** FIRMS ultra-real-time covers the US and Canada only; geostationary fire hints are coarse and need validation.
- **Small Garhwal earthquakes.** India's NCS catalogue is "All Rights Reserved" with no open feed; USGS reliably lists about M4.5 and above in the region ([COVERAGE-DEHRADUN.md](COVERAGE-DEHRADUN.md)); EMSC adds some smaller events.
- **Ships inland.** AIS is coastal; nothing moves on AIS near Dehradun.
- **Bare-earth terrain newer than 2015, or survey-grade heights.** Free global DEMs are 30 m and a decade old.
- **Photorealistic 3D city mesh.** Google's mesh has no India coverage and is blocked; OSM extrusions are the free substitute.

---

## Appendix A: top ten by impact

| Rank | Item | Package | Effort |
|---|---|---|---|
| 1 | Imagery capture-date badge (answers "is it stale?" on screen) | DQ1 | S |
| 2 | adsb.fi merged with adsb.lol (about 3x aircraft near Dehradun) | DQ4 | M |
| 3 | Aircraft lag 30 s to about 10 s with measured error | DQ6 | M |
| 4 | Native-resolution rendering on HiDPI with a frame governor | DQ3 | S |
| 5 | Meteosat IODC clouds every 15 min, about 25 min old | DQ5 | M |
| 6 | Freshness honesty pass (FALLBACK, LIVE, quake time, TLE epoch, "drawn N s behind") | DQ2 | S |
| 7 | Latest dated 10 m Sentinel-2 and EOX 2025 cloudless | DQ7, F1 | M |
| 8 | Wayback dated sub-metre history | DQ7 | M |
| 9 | EMSC websocket push and `all_week` quakes | DQ8, DQ2 | M |
| 10 | METAR observed weather at Jolly Grant beside model weather | DQ5 | S |

## Appendix B: sources read for this plan

- Esri World Imagery service: <https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer>; Wayback config: <https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json>; release metadata: <https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r10/MapServer>; Clarity metadata (status **verify**): <https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Clarity_Metadata/MapServer>.
- Earth Search: <https://earth-search.aws.element84.com/v1/>; Copernicus Data Space quotas: <https://documentation.dataspace.copernicus.eu/Quotas.html>; EOX cloudless: <https://cloudless.eox.at/documentation/license>.
- NASA GIBS: <https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/>; HLS low latency (in development): <https://www.earthdata.nasa.gov/data/projects/nsite/solutions/hls>.
- Copernicus DEM: <https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM>, <https://registry.opendata.aws/copernicus-dem/>; ALOS AW3D30: <https://www.eorc.jaxa.jp/ALOS/en/dataset/aw3d30/aw3d30_e.htm>; Mapterhorn: <https://mapterhorn.com/data-access/>.
- OpenFreeMap: <https://openfreemap.org/>; Protomaps builds: <https://docs.protomaps.com/basemaps/downloads>; Overture buildings: <https://docs.overturemaps.org/guides/buildings/>.
- adsb.lol: <https://api.adsb.lol/api/openapi.json>; adsb.fi: <https://github.com/adsbfi/opendata>; AISStream: <https://aisstream.io/documentation>; AISHub: <https://www.aishub.net/join-us>.
- CelesTrak: <https://celestrak.org/NORAD/documentation/gp-data-formats.php>, <https://celestrak.org/NORAD/elements/supplemental/>, <https://celestrak.org/usage-policy.php>.
- USGS feeds: <https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php>; EMSC: <https://www.seismicportal.eu/realtime.html>, <https://www.seismicportal.eu/fdsn-wsevent.html>.
- FIRMS: <https://www.earthdata.nasa.gov/data/tools/firms/faq>, <https://firms.modaps.eosdis.nasa.gov/api/area/>.
- Open-Meteo: <https://open-meteo.com/en/docs>, <https://open-meteo.com/en/terms>; aviationweather.gov: <https://aviationweather.gov/data/api/>.
- IMD radar: <https://mausam.imd.gov.in/responsive/radar.php>; MOSDAC policy: <https://www.mosdac.gov.in/data-access-policy>.
- EUMETView: <https://view.eumetsat.int/geoserver/wms>; EUMETSAT data policy: <https://www-cdn.eumetsat.int/files/2026-01/45173%20-%20Data_Policy.pdf>.
- CesiumJS reference: <https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html>, <https://cesium.com/learn/cesiumjs/ref-doc/Globe.html>, <https://cesium.com/learn/cesiumjs/ref-doc/SampledPositionProperty.html>.
