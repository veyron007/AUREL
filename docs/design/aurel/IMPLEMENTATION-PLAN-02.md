# AUREL — Phase 6 implementation plan

**Prepared 7 November 2026.**

**Baseline:** the AUREL working tree on upstream gods-eye-view `a33bc379` (the local branch also carries the Lamplight commit `67fb2325`).
**Operating constraint:** no additional paid APIs or hosting. Claude and Codex are build tools only; no workflow in this plan depends on a hosted model at run time.
**Inputs:** the Phase 6 ideation synthesis (44 feature ideas and one naming brief, each scored by four judging lenses: wow, free-feasible, useful, honest), the eight Phase 6 work packages, [COVERAGE-DEHRADUN.md](COVERAGE-DEHRADUN.md), [the Lamplight record](lamplight/README.md), and the prior plan set: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md), [FEATURE-SPECS.md](FEATURE-SPECS.md), [FREE-DATA-PLAN.md](FREE-DATA-PLAN.md), [Phase 0](PHASE-0.md) to [Phase 5](PHASE-5.md).

How to read the numbers in this document: test counts, byte counts and check counts are copied from the phase delivery records. Judged scores are copied from the ideation ranking. Values inside the "demo moment" strings (peak heights, distances, times, rainfall totals) are illustrative target copy from the ideation pass; none of them has been computed by AUREL yet, and each must be produced and checked by the implementation before it appears in the product. Anything that could not be confirmed from the repository or an official source is marked **verify**.

---

## 1. Status today

### 1.1 What Phases 0–5 delivered

| Phase                             | Delivered                                                                                                                                                                                                                                                                                                              | Recorded verification                                                                                                                  | Record                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0. Free-only foundation           | Free-only is the default in dev, preview and browser builds. Google direct, Cesium ion, OpenAI, Gemini, TomTom and OpenSky are paused; saved keys are preserved but never activate a capability by themselves. Unknown imagery resolution and collection time are shown as unknown. Natural Earth II offline overview. | 11,024 tests, 11,021 passed, 3 skipped, 0 failures; 11 locale catalogs complete (2,958 messages).                                      | [PHASE-0.md](PHASE-0.md) |
| 1. Coherent workspace             | Persistent place and coordinate search, four task destinations (Explore, Compare, Plan, Library), one contextual inspector, Observatory/Field/Instrument appearances, mobile sheet, local licensed fonts.                                                                                                              | 11,044 tests, 0 failures; 23 browser assertions with external requests blocked; 15 attribution tests and 26 rendered layout states.    | [PHASE-1.md](PHASE-1.md) |
| 2. Lens and Fieldbook             | Lens dossier (Overview, Evidence, Notes); Fieldbook projects, places, notes, evidence, routes, drawings and attachments in IndexedDB with atomic revision checks; JSON backup and import; deterministic briefs.                                                                                                        | 12/12 offline browser checks; 23/23 workspace checks; 11 catalogs at 3,136 messages.                                                   | [PHASE-2.md](PHASE-2.md) |
| 3. India field workflow           | Planner with bounded 48 h Open-Meteo weather and CAMS context, route profiles on Mapterhorn EGM2008 heights (128 samples, three checkpoints), daylight with explicit IANA timezone, bounded FIRMS area observations, immutable analysis snapshots.                                                                     | 11/11 browser checks; 33 focused planner, adapter and panel checks.                                                                    | [PHASE-3.md](PHASE-3.md) |
| 4. Chronicle and bounded research | Dated imagery search and A/B comparison through the existing NASA CMR/GIBS owner; Sentinel-2 L2A NDVI on 128² or 256² native-grid crops from Earth Search COGs with exact HTTP ranges.                                                                                                                                 | 10 Chronicle/Research browser checks; science admission recorded.                                                                      | [PHASE-4.md](PHASE-4.md) |
| 5. Offline, automation, hardening | Dehradun core region pack (8,647 features, 3,368,870 bytes), FIRMS Watchlists (eight definitions, four active, 30 min minimum interval), deterministic Local commands, Pause feeds, managed local launcher. The optional local model failed its quality gate and is not enabled.                                       | Final run 11,446 tests: 11,442 passed, 0 failed, 4 skipped; 73/73 responsive and accessibility checks; 6/6 resource-stress assertions. | [PHASE-5.md](PHASE-5.md) |

The F11 Labs from [FEATURE-SPECS.md](FEATURE-SPECS.md) (terrain-only viewshed, solar/photography, drainage/catchment learning and the rest) were explicitly left outside the Phase 5 release. Phase 6 delivers three of them as full instruments (WP1, WP5) rather than as separate Labs, and does not re-propose anything Phases 0–5 shipped.

### 1.2 Lamplight restyle

Lamplight, shipped 7 November 2026, is the VisionQuest-derived theme chosen by a judged design tournament: oxblood command glass, petrol information surfaces, a measured lightness ladder and brass `#d6ab55` as the only interactive colour, all held in `src/ui/styles/lamplight.css`. It passed `npm test` (11,446 tests, 0 failed), `format:check` and `check:boundaries`, with browser checks at 1440×900 and 390×844; see [lamplight/README.md](lamplight/README.md) and [README.md](README.md).

### 1.3 Dehradun coverage verdict

AUREL runs anywhere on Earth but does not cover everywhere equally. For Dehradun (30.32 N, 78.03 E) the globe, terrain, imagery, place search, routing, weather forecast, fires, quakes, satellites, launches, wildlife and the offline region pack work; live traffic, street imagery and aircraft work partially; CCTV, transit, bikeshare, ALPR, rain radar, lightning, cyclones, station air quality, drone airspace and fire perimeters show nothing because no Indian provider is registered. That empty state is honest, not a bug, and the Free-only working tree runs keyless. Google Photorealistic 3D has no mesh over Dehradun even with a key, and the current unavailability message wrongly suggests a key or quota problem.

**Free actions that extend India coverage (from the coverage audit, ordered by payoff):**

1. Set `RADIO_PRIORITY_COUNTRIES=IN` in `.env`: zero cost, reserves up to 40 Indian HTTPS stations.
2. Add a free `MAPILLARY_CLIENT_TOKEN`: unlocks the only street-level provider with any Dehradun coverage and lets KartaView construct.
3. Register an India air-quality adapter on the existing provider seam (`src/layers/airQuality/model.js`): OpenAQ or CPCB via OGD India for Dehradun's CAAQMS stations (WP2).
4. Add Indian transit feeds that pass the keyless, open-licence admission rule (`transitFeeds.js`); candidates are BMTC Bengaluru, Kochi Metro and Chennai MTC if they expose GTFS-RT (**verify**). Delhi OTD fails the keyless rule. None of this helps Dehradun, which publishes no GTFS-RT.
5. Run an RTL-SDR in Dehradun with `LOCAL_RECEIVER_FEEDS`: the only route to reliable low-level aircraft.
6. Configure `OVERPASS_UPSTREAMS` (self-hosted or a permitted instance): turns on OSM Places, voice outlines and the Overpass ALPR source.
7. Regenerate the region pack for a larger Dehradun extent with `scripts/build-region-pack.mjs`, within the 10 km, 10,000-feature and 4 MiB caps.
8. Evaluate DGCA Digital Sky (drone airspace), IMD RSMC (North Indian Ocean cyclones) and Google News `IN:en` / `hi` editions; each needs a licensing check before admission.
9. Set `NOMINATIM_URL` to an authorised instance for district and ward outlines.

The audit's two housekeeping items (the Google 3D message in `src/maps/availability.js`, and `server/standalone/free-only-status.js` listing `launch-library` as blocked while launches still work keyless) are scheduled in WP8.

---

## 2. The recommendation

AUREL becomes an honest personal spatial research desk: one place to find, inspect, compare, plan and remember real places, without a paid service in the loop. The globe stays the primary workspace, and Phase 6 adds instruments that answer questions no free consumer globe answers (what is on my horizon, where does this rain go, which satellite will image this valley next, does a second source agree). Every number keeps one of four classes, observed, modelled, derived or simulated, plus its source, unit and applicable time, so an instrument never sounds more certain than its data. Dehradun is the reference workflow because its ridges, monsoon, rivers and institutions stress every instrument, and a feature that is honest in the Doon will be honest elsewhere. It stays free forever: new sources pass the admission checklist, keys never activate a capability by themselves, and computation happens on the owner's machine.

---

## 3. Feature portfolio

Scores are the judged averages from the ideation ranking (wow / free-feasible / useful / honest, each out of 10). Effort uses the repository's S/M/L/XL scale. "WP" names the Phase 6 work package that delivers the feature; "none" means the feature is recorded but not scheduled.

### 3.1 Six signature features

#### 3.1.1 Kshitij Horizon Engine: terrain skyline, named peaks, true sunrise, sun and shadow lab

Score 8.5 (9 / 9 / 7 / 9), rank 1 of 44. Delivered by **WP1**.

**What it is.** Click any point and get the real 360° terrain horizon (a DEM ray-march with stated refraction), which Himalayan peaks break the skyline and at what azimuth and distance, the minute the Sun or Moon actually clears the Mussoorie ridge rather than the flat-horizon astronomical time, a date and hour shadow sweep over the Doon valley, and a gnomon-shadow prediction. It is exposed as one `horizon_at(lat, lon, observerHeight, date)` function used by Planner, Lens, Fieldbook, Sky Pointer, Orbit Witness and a new MCP tool. It delivers the unshipped F11 "terrain-only viewshed" and "solar/photography" rows as one instrument instead of two Labs.

**Demo moment (illustrative).** At Lal Tibba the owner drops a pin; an amber ring draws on the globe with "Bandarpunch 6,316 m · 68 km · az 41° · geometric, if clear" and "Nanda Devi: marginal, clears nearer ridge by <0.1°". The sunrise card reads "astronomical 06:41 IST; Sun clears ridge 07:08 (terrain-only)". A Class 7 teacher sets 21 Dec 12:30 at the school and gets a solar elevation and a 1 m gnomon shadow length; the class measures the real shadow and files prediction against observation in Fieldbook.

**Free data.**

- Copernicus DEM GLO-30 on AWS Open Data, free with attribution: https://registry.opendata.aws/copernicus-dem/ (admission spike first).
- Existing Mapterhorn/EGM2008 heights (CC BY 4.0) via `src/data/terrainHeights.js` for the near field.
- OSM `natural=peak` with `name`, `name:hi`, `ele` from the Geofabrik India extract (ODbL) through `scripts/build-region-pack.mjs`; GeoNames feature class T as fallback (CC BY 4.0).
- Solar and lunar ephemeris computed locally: NOAA solar equations, or `astronomy-engine` (MIT) / `suncalc` (BSD-2); refraction constant k = 0.13 stated on the card.
- Open-Meteo cloud cover and visibility (already admitted, CC BY 4.0) as a separate "will it be clear" card.

**Builds on.** `src/planner/daylight.js`, `src/planner/profile.js`, `src/planner/routeSampling.js`, `src/data/terrainHeightsProxy.js`, `src/celestialRing.js`, `src/app/plannerTools.js`, the region-pack builder (new `peaks` theme), the F04 golden-hour slice, the F11 viewshed and solar rows, Fieldbook analysis snapshots (`src/fieldbook/analysis.js`).

**Effort.** L (DEM sampler plus worker ray-march M; peak gazetteer theme S; sunrise/shadow cards and Fieldbook record S; MCP tool and tests S).

**Honesty guardrails.** Every result is labelled "geometric visibility, terrain-only": trees, buildings and haze are not modelled. 30 m DEM voids and refraction shift ridge-clearing by minutes, so results round to 1° and to the minute and show the DEM source and void count. OSM peak names and elevations can be wrong: show OSM `ele` beside the DEM height and let the user flag a mismatch into Fieldbook. Gnomon shadows ignore buildings; the device clock is shown as the time source. No "guaranteed view" wording anywhere.

#### 3.1.2 Sky Pointer and Summit Glass: phone-in-hand identifier for aircraft, satellites and peaks

Score 8.0 (9 / 8 / 8 / 7), rank 2. **No Phase 6 work package**; it depends on WP1 and is the first candidate for a follow-on package (see §8).

**What it is.** Hold the phone up. DeviceOrientation, Geolocation and the feeds the app already has name the aircraft or satellite in that direction with range, altitude, callsign and seconds since last fix, or draw the Horizon Engine ridgeline with named peaks and the Sun position over the live camera feed. No AR SDK, no cloud, no image recognition: a canvas overlay and look-angle maths. A manual "drag to align on a known peak" step turns the alignment into dated Fieldbook evidence.

**Demo moment (illustrative).** Dusk on the Mussoorie road, a contrail crosses: "A320 at FL360, 41 km, last fix 12 s ago (adsb.lol), reported route DEL–DED". Tilt south-west: "Starlink-30112, 19° elevation, sunlit, predicted (TLE epoch 2 days)". Dawn on Nag Tibba: an amber horizon line with "Swargarohini · 92 km · OSM", "Kedarnath: behind nearer ridge per DEM", "compass ±8°, drag to align". Once aligned on Bandarpunch the frame saves as "viewpoint confirmed 06:41 IST, alignment manual".

**Free data.**

- Existing adsb.lol (ODbL), OpenSky (terms pending per FREE-DATA-PLAN), local dump1090/WebUSB (`src/layers/localAdsb`); adsbdb route enrichment already used in `src/data/aircraftMeta.js`.
- Existing CelesTrak GP elements (`server/providers/space/celestrak.js`) with satellite.js SGP4 (`src/layers/satellites/orbits.js`).
- Horizon Engine profile (3.1.1) cached for a 150 km radius around the device.
- World Magnetic Model 2025 coefficients (NOAA/BGS, public domain) through the `geomagnetism` npm package (MIT) for declination: **verify** package licence and WMM2025 availability.
- Browser APIs only: `getUserMedia`, `DeviceOrientationEvent` (absolute where available), `Geolocation`, Canvas.

**Builds on.** `src/layers/flights`, `src/layers/localAdsb`, `src/layers/satellites/{orbits,tracking}.js`, `src/data/satellitePass.js`, `src/ui/mobileShell`, `public/manifest.webmanifest`, Fieldbook evidence references (F03, Phase 2).

**Effort.** L (orientation, declination and look-angle core M; camera overlay and alignment UX M; Fieldbook capture S; iOS permission paths and tests S).

**Honesty guardrails.** Phone compasses can be 5–15° off and iOS exposes only relative heading in some contexts: always draw a confidence cone, show calibration state, and never say a peak is "identified" without the manual alignment. ADS-B positions can be 30 s stale: show "extrapolated N s", never a crisp present-tense position. Routes are crowd-sourced and labelled "reported". "Not visible per DEM" is not proof. The device never "sees" anything; the UI says "in this direction".

#### 3.1.3 Altitude Ensemble and Rain Lane: mountain forecast with model disagreement

Score 7.5 (5 / 8 / 8 / 9), rank 3. Delivered by **WP3**.

**What it is.** Planner checkpoints become a mountain-weather sheet resampled at the checkpoint's real elevation (freezing level, snowfall, cloud layers, visibility, CAPE, 700/500 hPa wind) with ICON, GFS and IFS side by side, a 51-member ECMWF ENS fan for precipitation, 7-day antecedent totals, and IMERG observed rain drawn against IMD intensity category lines. Cloudburst risk lives in the ensemble tails and in how wet the ground already is.

**Demo moment (illustrative).** Planning Kedarkantha 13–15 Dec: "Freezing level 2,900 m Fri → 2,100 m Sat (IFS)"; "Snowfall Sat: ICON 4 cm · GFS 1 cm · IFS 6 cm"; "ENS: 38/51 members ≥1 mm at the summit cell". An August district brief: antecedent 7-day total (ERA5-Land), ENS median for tomorrow, the share of members above the IMD "very heavy" line, run time and cell size, and "IMD remains the warning authority".

**Free data.**

- Open-Meteo forecast with `elevation=`, `models=`, `freezing_level_height`, `snowfall`, cloud layers, `cape`, pressure-level wind (CC BY 4.0, already admitted): https://open-meteo.com/en/docs
- Open-Meteo Ensemble API (ECMWF ENS, GFS ENS, ICON-EPS): https://open-meteo.com/en/docs/ensemble-api (**verify** that ensemble calls count as multiple weighted units against the 10,000/day ledger and size the budget accordingly).
- ECMWF Open Data ENS GRIB2 via `.index` byte ranges (CC BY 4.0) using the existing reader, if Open-Meteo's ensemble weight proves too costly.
- Open-Meteo Historical (ERA5-Land) for antecedent totals: https://open-meteo.com/en/docs/historical-weather-api
- NASA GIBS IMERG precipitation (keyless); IMD rainfall category definitions (public) as cited reference lines.

**Builds on.** F04 Planner checkpoints, the Open-Meteo ledger in `server/providers/field-context.js` and `field-context-budget.js`, `server/providers/wind/{ifs,gfs,decode,grid}.js`, `src/layers/wind/model.js`, the F06 morning brief, the Chronicle forecast lane, Fieldbook snapshots.

**Effort.** L (ensemble adapter and ledger weighting M; checkpoint sheet UI M; IMERG/IMD overlay S; fixtures and budget tests S).

**Honesty guardrails.** Elevation downscaling is statistical, not a summit observation; 0.25° cells smear ridges and cannot resolve a 5 km cloudburst, and the card says so. Run time and lead are always shown. Model disagreement is information; no go/no-go wording, no "safe" or "dangerous". IMD categories describe observed totals, not warnings. Each ensemble call is logged against the free ledger before dispatch.

#### 3.1.4 Orbit Witness and Overpass Oracle: predict the pass, watch for the scene, ride the satellite

Score 7.25 (9 / 8 / 5 / 7), rank 6. Delivered by **WP4**.

**What it is.** For the place on screen: when Sentinel-2, Landsat and the ISS next pass over it (TLE swath, cross-checked against published acquisition plans and the cloud forecast), a Watchlist rule that polls the open STAC catalogues and fires once when the real scene lands, and a Scene Director shot that rides the propagated orbit to the acquisition second while the real footprint drops onto the globe. Four honest lanes: predicted pass, planned acquisition, available product, dramatised ride.

**Demo moment (illustrative).** After the first winter storm: "Mussoorie next imaged: S2A, 11 Nov (predicted, plan-confirmed); Landsat 9, 13 Nov; cloud forecast per pass". Days later the watch fires "S2A L2A 2026-11-11 available, cloud %" and opens in Chronicle beside the pre-storm scene. "Ride this pass" on the Phase 4 scene `S2B_43RGP_20261025_0_L2A` (acquired 2026-10-25T05:40:34Z) lifts the camera along the orbit, crosses the Doon at the acquisition second, and the NDVI crop lands below with "Orbit: modelled from TLE epoch X · Image: observed".

**Free data.**

- CelesTrak GP for Sentinel-2A/B/C, Landsat 8/9 and ISS (existing cache); local SGP4 swath footprint from mission facts (786 km altitude and 290 km swath for Sentinel-2; cite ESA).
- ESA Sentinel-2 acquisition plans (KML): https://sentinels.copernicus.eu/web/sentinel/copernicus/sentinel-2/acquisition-plans ; USGS Landsat acquisition calendar: https://landsat.usgs.gov/landsat_acq (**verify** KML format stability and redistribution terms before bundling).
- Earth Search STAC v1 (keyless, already admitted in Phase 4 for Sentinel-2 L2A COGs): https://earth-search.aws.element84.com/v1 ; NASA CMR-STAC LPCLOUD for HLS; Copernicus Data Space STAC (free account).
- Open-Meteo cloud cover (existing ledger).

**Builds on.** `src/layers/satellites/{orbits,tracking,records}.js`, `src/data/satellitePass.js`, Watchlist (`src/app/watchlistTools.js`) as its second watch type after FIRMS, Chronicle scene search (`src/app/chronicleTools.js`, `src/layers/recentImagery/catalog.js`), `src/director/{playback,camera,timeline}.js`, recording mode, `src/data/dataCredits.js`.

**Effort.** L (swath prediction and plan cross-check M; STAC watch S; director ride shot M; tests S).

**Honesty guardrails.** A pass is not an acquisition: duty cycle, downlink and processing decide, L2A latency is hours to days, and a catalogue outage reads "unknown", never "no scene". Satellite position is SGP4 from an epoch that may be far from the acquisition: label "propagated, epoch X" and call the ride a dramatisation in the HUD and in exports. Never say "your house was photographed" from a pass alone.

#### 3.1.5 Raindrop and Catchment Pulse: where water goes, and what fell on it

Score 7.25 (8 / 8 / 6 / 7), rank 5. Delivered by **WP5**.

**What it is.** Click anywhere and watch a drop trace down the DEM into the Rispana, the Song, the Ganga and the sea; outline the upstream catchment draining past the click; read IMERG basin-mean rain for 1, 3 and 24 h, the Open-Meteo forecast for the same polygon, and the GloFAS discharge percentile at the nearest reach. It works offline inside the region pack. It is the F11 "drainage/catchment learning" row grown into an instrument, and the hydrological complement to Planner's terrain profile.

**Demo moment (illustrative).** A student at Rajpur watches the path run down Rispana Rao into the Song, join the Ganga at Raiwala and travel to the Bay of Bengal; a Selaqui student's drop goes west into the Asan and the Yamuna, so the class discovers Dehradun straddles the Ganga–Yamuna divide. On a September night a coordinator clicks the Sahastradhara bridge and reads the sub-basin area (D8 on a 30 m DEM), the IMERG Early basin-mean for 3 h marked "satellite estimate" with its latency, the 24 h forecast for the polygon, and a GloFAS percentile. A watch fires once when the 3 h basin mean crosses the owner's threshold.

**Free data.**

- Copernicus GLO-30 (AWS Open Data) or existing Mapterhorn samples for local D8 flow in a Web Worker; sink filling disclosed.
- HydroSHEDS HydroRIVERS and HydroBASINS v1 (free, attribution): https://www.hydrosheds.org/
- NASA GIBS `IMERG_Precipitation_Rate` (keyless) for display; GES DISC IMERG Early (free Earthdata login) for numeric basin means (**verify** which product gives a numeric value without an Earthdata account; GIBS visual tiles must be read through the published colormap or WMS GetFeatureInfo, never guessed from pixels).
- Open-Meteo forecast (admitted) and Flood API GloFAS v4 (CC BY 4.0): https://open-meteo.com/en/docs/flood-api
- Region-pack OSM waterways (ODbL).

**Builds on.** `server/providers/terrain.js`, `src/planner/profile.js`, `src/planner/routeSampling.js`, the GIBS adapter in `src/layers/recentImagery`, the `server/providers/field-context.js` ledger, `src/app/watchlistTools.js`, `src/data/bhoteKoshiFloodPath.js` and Scene Director for the animated trace, the F06 Environment brief.

**Effort.** L (D8 worker and catchment polygon M; drop animation S; IMERG/GloFAS cards M; watch condition and tests S).

**Honesty guardrails.** A 30 m DEM ignores culverts, storm drains, embankments and buildings; D8 is ambiguous on flat Doon fans, and the method card says so. IMERG under-catches orographic bursts and arrives late; GloFAS skill in small mountain basins is poor, so it is shown as a percentile, not a flow. No flood depth, no discharge claim, no evacuation guidance; IMD and CWC remain the authority and are linked from the card.

#### 3.1.6 Agent Field Kit: MCP tools that act, with typed evidence envelopes

Score 7.25 (5 / 9 / 6 / 9), rank 7. Delivered by **WP6**.

**What it is.** Today the MCP server is read-only plus `show_in_gods_eye_view`; its catalog exposes `search_places`, `plan_route`, `get_weather`, `get_weather_map`, `get_wind`, `get_earthquakes`, `get_active_fires`, `get_recent_imagery`, `get_regional_brief`, `find_aircraft`, `find_vessel`, `find_infrastructure`, `find_radio_stations`, `get_transit_vehicles`, `get_bike_share`, `get_cctv_snapshot` and `get_hud_caption`, with no terrain tool. The Field Kit lets an agent do what an analyst does: `fieldbook_add_place`, `fieldbook_add_note` (with evidence references), `draw_area`, `run_mission_template`, `register_watch`, `render_view` (a PNG of the current globe with a legend of each layer's class and time), `horizon_at`, and `get_free_budget` (estimated remaining units per provider ledger, so an agent can predict a refusal). Every result is wrapped in a provenance envelope: `observed | modelled | derived | simulated | note`, with source, acquisition time and licence, which agents can cite verbatim.

**Demo moment (illustrative).** From Claude Code: "Prepare a Fieldbook for a Mussoorie sunrise shoot on Sunday." The agent calls `get_free_budget`, `plan_route`, `horizon_at`, `get_weather`, adds two places and a note citing the horizon result, draws the viewpoint area, registers a cloud-cover watch and returns a `render_view` PNG. Library entries read "by agent · claude-code · <time>". Nothing was written until the owner flipped the per-session "Allow agent writes" toggle.

**Free data.** Local only: the existing Fieldbook repository and schema (`src/fieldbook/repository.js`, `document.js`), the MCP transport (`src/tools/mcp`, `server/mcp/server.js`), canvas capture through the existing panel bridge, MCP image content and tool annotations (https://modelcontextprotocol.io/specification), the STAC Item spec (Apache-2.0) as the evidence export shape (https://stacspec.org), and the Free-only ledgers from Phases 0–5.

**Builds on.** `src/tools/{catalog,schema,functions,panel,globePanel}.js`, `server/mcp/{server,plugin}.js`, `src/app/{watchlistTools,plannerTools,localCommandTools}.js`, `feedProvenanceEnvelope` in `src/data/layerSnapshot.js`, `src/agent/worldPacket.js`, `src/fieldbook/brief.js`, F08 mission templates, F12 briefs.

**Effort.** M (envelope and schema S; write tools behind the opt-in toggle with revision checks M; `render_view` and `get_free_budget` S; tests S).

**Honesty guardrails.** Agent notes are untrusted text, author-tagged and never executed. Writes need the explicit per-session opt-in and fail on revision conflict. `render_view` always lists each visible layer's class and timestamp because the frame may contain simulated traffic. Budget answers are "estimated remaining", never a guarantee of free dispatch.

### 3.2 High-value features

**Breath: real Indian station air beside the model (M; 7.25; WP2).** Put CPCB/UKPCB monitors on the globe through OpenAQ v3 (free key, CC BY 4.0: https://docs.openaq.org/; **verify** Dehradun station presence) and data.gov.in's real-time AQI catalog (GODL, free key; production resource ID and sandbox disclaimer still unverified per FREE-DATA-PLAN §3), compute Indian NAQI and US AQI exactly as the standards define (24 h means for NAQI, stated), keep the CAMS model card separate, add sensor.community citizen sensors (ODbL) labelled uncalibrated, and add a station-threshold watch. Extends the provider seam in `src/layers/airQuality/{model,source}.js` and the Phase 3 CAMS cards. A missing station reads "no monitor", never "clean".

**Second Source: automatic corroboration cards (L; 7.0; WP7).** For any live object or event, fetch an independent free source and show agree / disagree / single-source with time offset and position residual, plus an explicit dependency graph so shared feeders are not counted twice. Quakes from EMSC (https://www.seismicportal.eu/fdsnws/event/1/query) and GFZ GEOFON beside USGS; FIRMS VIIRS NOAA-20 against MODIS as "two sensors"; adsb.fi (ODbL) against adsb.lol and the local dongle. Builds on `src/data/feedState.js`, `layerSnapshot.js`, `src/layers/earthquakes`, the FIRMS adapters, `src/layers/localAdsb` and the Lens Evidence tab. India NCS terms are unverified (**verify**). Disagreement is normal and agreement is not truth, and the card says both.

**Ridgeline Sky Almanac and Sky-clock (L; 7.0; none).** Predict ISS, Starlink and bright-satellite passes clipped against the Horizon Engine's DEM horizon with Moon glare, twilight and modelled cloud bands; replay the exact sky for a claimed time and heading to check "lights over the hills" clips; log observed or not observed into Fieldbook. CelesTrak GP plus supplemental TLEs, SATCAT RCS class instead of fabricated magnitudes (https://celestrak.org/satcat/), bundled Yale BSC (`src/sky/stars.js`), `astronomy-engine`, Launch Library (`server/providers/space/launch-library.js`). Builds on `src/data/satellitePass.js`, `src/layers/satellites/orbits.js`, `src/celestialRing.js` and the F11 "Sky notebook" row. When nothing matches, the card says "no catalogued object matches", never "unidentified object".

**Snowline Watch (XL; 7.0; none).** Daily MODIS/VIIRS NDSI snow cover from GIBS (keyless), a derived snowline altitude from snow mask × DEM stated with aspect and percentile, Sentinel-2 NDSI/NDWI crops in the existing research worker (`server/providers/research/sentinel.worker.mjs`, admitting B03/B11 beside NDVI in `src/research/ndvi.js`'s registry), RGI 7.0 glacier outlines (CC BY 4.0: https://www.glims.org/rgi_user_guide/), ICIMOD glacial-lake inventories (CC BY 4.0: https://rds.icimod.org; **verify** per-dataset licence), and the NASA Global Landslide Catalog and LHASA nowcast (https://gpm.nasa.gov/landslides/). Chronicle lanes and a Watchlist condition for lake-area change. Cloud and shadow stay "unknown", never "no snow"; lake growth is never a GLOF forecast.

**Field Capture and Trip Replay (M; 7.0; none).** One tap captures photo, GPS fix with accuracy, heading and timestamp into Fieldbook as "observed by me", a fourth honesty tier; import GPX, Google Takeout or geotagged photos to replay a trip with the Sun where it was, ERA5-Land weather and the nearest dated scene; snap repeated Vikram tempo rides into a local GTFS-lite atlas labelled "observed by you, N trips, not an official schedule". OSM Notes (API 0.6) are drafted locally and posted only by the user. Builds on `src/fieldbook/capture.js`, `src/data/geoFileImport.js`, `src/director/clock.js`, `src/layers/transit`. Delhi Open Transit Data (https://otd.delhi.gov.in/) requires registration and so fails the keyless transit rule in `transitFeeds.js`; it must be admitted through the checklist, not by exception.

**Nonvisual Dehradun (L; 7.0; none).** A keyboard map cursor that speaks what is under it from the region pack and sonifies terrain and routes (Web Audio); the morning brief, Lens dossier and watch notifications read by locally installed Hindi or English voices only (`voice.localService === true`); any selected area exported as a braille-labelled tactile SVG (liblouis tables, LGPL-2.1+; BANA guidelines) and an STL relief. Dehradun hosts NIEPVD, so a real user base is close to the owner. Builds on `src/planner/profile.js`, `src/regions/pack.js`, `src/data/feedState.js`, `src/fieldbook/brief.js`, the aria-live discipline in `src/splitFlap.js`, `scripts/qa-aurel-hardening.mjs`. Every spoken string keeps "modelled", "acquired", "not verified"; Hindi braille ships "under review" until a native reader verifies it.

**Horizon Match: skyline and shadow photo geolocation workbench (XL; 6.75; none).** Trace the ridgeline and one shadow in a photo; a worker scores a bounded candidate grid against DEM horizons and inverts shadow geometry into a date-time band, all local, filed as a Fieldbook card with residuals. It is the ridgeline-plus-sun-position method made bounded and private. Builds on the Horizon Engine, `src/annotations` draw tools, the research `workerRunner.js` pattern and `src/fieldbook/comparisonSchema.js` (observed / inferred / unresolved). Output is a candidate band with residuals, never a pin or the word "geolocated"; search areas beyond the sample budget are refused.

**Monsoon Memory (M; 6.75; none).** For any place: decades of daily ERA5 rain for the cell (Open-Meteo Historical), a transparent locally derived onset per year ("our criterion, not IMD's declaration"), this season's cumulative total against a CHIRPS 1991–2020 climatology (https://data.chc.ucsb.edu/products/CHIRPS-2.0/), an animated IMERG advance of the monsoon across India, a Chronicle precipitation lane and a Watchlist rule on a forecast rainfall threshold. IMD Pune gridded rainfall stays a user import with its research-only licence shown. Builds on Watchlist, `field-context.js`, `src/layers/weather` playback, Lens, the F06 brief. The three lanes (reanalysis, blend, forecast) never merge into one line.

**World Subscriptions and Ops Sitrep (M; 6.75; none).** Extend Watchlist from FIRMS-only to box subscriptions for new quakes, fire detections, aircraft or vessel geofence transitions, new cloud-free Sentinel-2/HLS scenes, OpenAQ thresholds and rain-window changes, delivered as MCP resource notifications and a local SSE stream deduplicated by source IDs; turn a Fieldbook into a timestamped sitrep whose observed, modelled and derived sections are separated automatically and whose stale sources are listed as known unknowns. Builds on `src/app/watchlistTools.js` (lease, cooldown, hidden-page pause), `server/mcp`, `src/layers/awareness`, `src/fieldbook/brief.js`. Gaps during sleep are reported as "gap in monitoring"; there is no background daemon, and the sitrep header says so. (WP2, WP4 and WP5 each add one watch condition; this feature is the general framework and is not scheduled.)

**Glass Box: egress ledger and evidence notary (M; 6.75; none).** A live, exportable record of every outbound request made on the user's behalf (provider, location precision sent, key name but never value, bytes, admitting policy, blocked rows included), SHA-256 hashing of every captured evidence item into an append-only log, optional OpenTimestamps anchoring (free calendars) and self-signed C2PA manifests on exported images via c2pa-js (Apache-2.0). Builds on `server/standalone/free-only.js`, `free-only-status.js`, `server/providers/common/*`, `src/app/sources.js`, the F12 privacy preview. Scope note "observed by this app" because Cesium worker fetches may bypass the observer; a timestamp proves a hash existed, not that content is true.

**Night Ledger (M; 6.5; none).** A dated night-radiance lane for Chronicle and Lens: GIBS VIIRS DNB and Black Marble layers (keyless), Moon-phase and cloud flags computed locally, a derived brightened/dimmed overlay between two years, and a dark-sky site ranking within driving range that uses the terrain horizon. Builds on `src/layers/recentImagery`, `server/providers/imagery-history.js`, Chronicle lanes, the research worker for raster differences, and a Watchlist radiance-drop condition. Quantitative claims need VNP46A2 (free Earthdata login); a dark night is "no clear observation", not "lights off"; radiance is not population or celebration.

**Shaking Desk (M; 6.5; none).** Extend the 24-hour quake feed into a seismology workspace: USGS ShakeMap and PAGER products via ComCat, the Himalayan Frontal and Main Boundary Thrusts from GEM Global Active Faults (CC BY-SA 4.0), a bounded 100-year catalog, the USGS Vs30 slope proxy, P/S-wave arrival rings showing how many seconds Dehradun had, and a radius watch rule. Builds on `src/layers/earthquakes`, `get_earthquakes`, Watchlist and the region-pack importer for fault GeoJSON. ShakeMaps show version and "estimated"; the seismic gap is a hypothesis, never a probability; rings are education, not early warning.

### 3.3 Moonshots

Each hinges on one enabling trick the repository already half-owns. None is scheduled before Sprint C, and each would ship as a Lab behind a flag.

**Himalaya Rising: a 4D plate-tectonics lane (6.75).** Scrub from 140 Ma to the present and watch India leave Gondwana and collide with Asia, then hand over to today's observed GNSS convergence arrows and a USGS hypocentre cross-section under Dehradun. Trick: bundle about 20 reconstructed snapshots from the GPlates Web Service (EarthByte models, CC BY 4.0: https://gws.gplates.org/) at build time, so there is no live call; Nevada Geodetic Laboratory velocities (free with citation) and Bird (2003) boundaries are static files; the cross-section reuses Planner transect sampling. Guardrail: a separate deep-time clock that can never coincide with the live clock, the model version named, and the GNSS reference frame shown.

**Valley Breath and Wind Journeys (6.5).** Render the winter inversion lid over the Doon as a translucent 3D surface from model boundary-layer height, release virtual parcels forward or backward on GFS/IFS pressure-level winds, and show upwind FIRMS clusters and GIBS aerosol so November haze has a visible, labelled explanation. Trick: `server/providers/wind/{gfs,ifs}.js` already reads GRIB2 by byte range; pressure levels and an RK4 worker are incremental, and Open-Meteo exposes `boundary_layer_height`. Guardrail: "simulated single-level advection, no vertical motion" on every frame; co-occurrence with fires is never attribution.

**Through-the-Clouds: Sentinel-1 SAR change lens (5.75).** Compare two radar acquisitions through monsoon cloud and compute a bounded log-ratio change map with DEM layover and shadow masks when optical Chronicle is blind. Trick: the research pipeline (`rangeSource.js`, `sentinel.worker.mjs`, `decode.js`) already does exact-range COG reads; SAR is new bands and a `logRatio.js` beside `ndvi.js`. Sources: Copernicus Data Space S1 GRD (free account), ASF HyP3 RTC free monthly credits (**verify** current quota), Planetary Computer `sentinel-1-rtc` (**verify** availability and terms). Guardrail: output is a candidate-change mask, never "flood extent"; same orbit direction only.

**Reachability and Go-bag (6.25).** Build a routable graph from the region pack in a worker, compute minute-isochrones from hospitals and relief-camp schools, cut edges the user draws (bridge out) and see which wards fall out of reach with GHS-POP counts, plus a deliberately bounded offline kit (facilities, terrain-only height-above-river shading, bundled helplines, saved routes) that works when the valley loses network. Trick: Phase 5's `src/regions/pack.js` already carries the highway graph geometry; Dijkstra in a Web Worker needs no service, and `server/standalone` keeps it running on a laptop hotspot. Guardrail: "planning exercise", never "evacuation plan"; height-above-river says nothing about flood depth.

**Mirror: who can see this place? (6.0).** Flip the god's-eye view: for a point or saved route, show which mapped cameras (OSM `man_made=surveillance` with direction tags), published Sentinel/Landsat acquisition plans and dated street-imagery captures can plausibly observe it, with terrain line-of-sight wedges. Trick: a recombination of `src/layers/cctv/headingConfidence`, `src/layers/alpr` wedges, `src/layers/streetLevel` capture dates and the Horizon Engine; no new feed. Guardrail: "mapped is not verified", commercial constellations are explicitly unknown, categories and wedges only, never stream URLs.

### 3.4 Dehradun-first

**Shines because the geography is extreme.** The Horizon Engine, Sky Pointer, Sky Almanac and Night Ledger become far more useful where half the sky is ridge: a flat-horizon pass prediction is simply wrong in the Doon. Altitude Ensemble and Monsoon Memory matter because the monsoon is the year's organising event; Raindrop makes the Ganga–Yamuna divide a classroom fact. Snowline Watch and Shaking Desk reflect Uttarakhand's identity (Kedarnath, Chamoli, the central seismic gap).

**Shines because the city has the institutions.** Dehradun hosts the Survey of India, the Indian Institute of Remote Sensing, the Wadia Institute of Himalayan Geology, the Forest Research Institute and NIEPVD. Each of the following has a named local user:

| Idea                            | Size | One line                                                                                                                                                      |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nonvisual Dehradun              | L    | See §3.2.                                                                                                                                                     |
| Lesson Packs and Projector Mode | M    | Teacher-authored sequences of places, evidence cards and quiz checkpoints, with a high-contrast projector view.                                               |
| Fire Season Desk                | L    | Local FWI from Open-Meteo inputs, a 2012-to-present FIRMS fire-day climatology for the Rajaji and Mussoorie divisions, dNBR on the existing research adapter. |
| River Corridor Watch            | L    | GHSL built-up inside a Rispana–Bindal buffer per epoch, Sentinel-2 water-index extent, JRC Global Surface Water baseline.                                     |

**Shines because the data exists and no one has assembled it.**

| Idea                 | Size | One line                                                                                                                                                                                                                                                                  |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breath               | M    | CPCB/UKPCB stations (WP2).                                                                                                                                                                                                                                                |
| Hazard Desk          | L    | GDACS, EONET, Copernicus EMS and ReliefWeb filtered to the region; NDMA SACHET CAP alerts rendered verbatim in Devanagari with issuer and expiry (**verify** SACHET endpoint and terms via an admission spike); LHASA and the Global Landslide Catalog on a Planner lane. |
| Trek Readiness       | M    | OSM `sac_scale`, springs, shelters, road-head distance, terrain line of sight to OpenCellID towers.                                                                                                                                                                       |
| Corridor Pack        | L    | A 10 km × 10 km trek corridor with locally built GLO-30 terrain tiles and an in-browser routable graph.                                                                                                                                                                   |
| Sugam Routes         | M    | Step-free and heat-aware walking audit with coverage shown first.                                                                                                                                                                                                         |
| Rooftop Sun          | S    | PVGIS 5.3 and NASA POWER yield on a region-pack footprint with the Mussoorie ridge horizon applied.                                                                                                                                                                       |
| Valley Airport Desk  | M    | NOAA AWC METAR/TAF for VIDN, OurAirports runways, observed approach corridors.                                                                                                                                                                                            |
| NavIC and GAGAN Desk | M    | IRNSS/NVS TLEs, IGSO figure-eights, DOP above the terrain horizon.                                                                                                                                                                                                        |
| Desi Clue Decoder    | M    | On-device Tesseract hin+eng OCR of PIN codes, STD codes, RTO prefixes and ward numbers into map areas.                                                                                                                                                                    |
| Hindi-first AUREL    | M    | Full Hindi workflow, lakh/crore grouping, IST, OSM `name:hi`, Hinglish-to-Devanagari search; the repo ships 11 locales and none for India (WP8).                                                                                                                          |
| Doon Time Machine    | L    | GHSL 1975 to 2030 extruded over terrain, Landsat C2 L2 back to 1982 with an LST lane, Census 2011 PCA ward tables beside modelled population.                                                                                                                             |

**Data gaps that remain, stated plainly.**

- No open live river gauge API: India-WRIS and CWC carry no open licence, so River Corridor Watch and Raindrop show extent, never stage; link CWC FFS only.
- No Indian GTFS-RT passes the keyless rule, and Dehradun publishes no GTFS at all. Field Capture's GTFS-lite is the only path.
- No official Indian alert source is admitted: SACHET CAP, IMD nowcasts and FSI Van Agni alerts all need a licence gate; FSI data cannot be redistributed.
- City-list layers (CCTV, bikeshare, ALPR, rain radar, lightning, cyclones, drone airspace, fire perimeters) stay empty in Dehradun until an Indian provider is admitted; DGCA Digital Sky and IMD RSMC are unverified candidates.
- Street imagery needs a free Mapillary token; Google Street View stays blocked under Free-only.
- Low-level aircraft coverage is sparse until someone runs an RTL-SDR in the valley (Receiver Atlas and Regional Flight Archive, M, would make that dongle a terrain-aware instrument).
- Census 2011 is the last headcount; 2018 ward geometry is not open; Bhuvan and OGD station resources remain feasibility spikes.
- Terrain today is Mapterhorn; GLO-30 integration is a prerequisite for the Horizon Engine far field, Corridor Pack and Raindrop, which is why WP1 opens with the GLO-30 admission spike.

---

## 4. Free data and credentials

### 4.1 New sources the scheduled work packages need

"Admitted" means recorded through the [FREE-DATA-PLAN.md §6](FREE-DATA-PLAN.md) checklist in an earlier phase. "Proposed" means not yet admitted. A quota cell reads "not published, verify" where neither the repository nor the ideation found a stated figure; no figure is assumed.

| Source                                                                                   | Licence                                               | Key needed?                    | Quota                                                                                                 | WP             | Verification status                                                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| Copernicus DEM GLO-30 (AWS Open Data), https://registry.opendata.aws/copernicus-dem/     | Free with attribution (**verify** exact licence text) | No                             | Not published, verify                                                                                 | WP1, WP5       | Proposed; admission spike is WP1's first task, fallback to Mapterhorn         |
| Mapterhorn / EGM2008 heights via `/api/terrain/heights`                                  | CC BY 4.0                                             | No                             | Existing provider limits                                                                              | WP1, WP5       | Admitted (Phase 3)                                                            |
| OSM `natural=peak` (Geofabrik India extract)                                             | ODbL                                                  | No                             | Extract file, no API quota                                                                            | WP1            | Geofabrik extract admitted (Phase 5 region pack); `peaks` theme proposed      |
| GeoNames feature class T (fallback peaks)                                                | CC BY 4.0                                             | No for dump files (**verify**) | Not published, verify                                                                                 | WP1            | Proposed                                                                      |
| NOAA solar equations, or `astronomy-engine` / `suncalc`                                  | Public equations; MIT / BSD-2 packages                | No                             | Local computation                                                                                     | WP1            | Proposed; a new package dependency needs review, the NOAA equations need none |
| OpenAQ v3, https://docs.openaq.org/                                                      | CC BY 4.0                                             | Yes, free key                  | Not published here, verify                                                                            | WP2            | Proposed; **verify** Dehradun station presence                                |
| data.gov.in real-time AQI catalog                                                        | GODL                                                  | Yes, free key                  | Unverified (FREE-DATA-PLAN §3)                                                                        | WP2 (spike)    | Not admitted; production resource ID and sandbox disclaimer unverified        |
| sensor.community citizen sensors                                                         | ODbL                                                  | No                             | Not published, verify                                                                                 | WP2            | Proposed; labelled uncalibrated                                               |
| Open-Meteo forecast with `elevation=` and `models=`                                      | CC BY 4.0                                             | No                             | 10,000/day, 5,000/hour, 600/minute, 300,000/month, weighted units                                     | WP3            | Forecast admitted (Phase 3); new variables and models proposed                |
| Open-Meteo Ensemble API, https://open-meteo.com/en/docs/ensemble-api                     | CC BY 4.0                                             | No                             | Same ledger; per-call weight **verify**                                                               | WP3            | Proposed                                                                      |
| Open-Meteo Historical (ERA5-Land), https://open-meteo.com/en/docs/historical-weather-api | CC BY 4.0                                             | No                             | Same ledger                                                                                           | WP3            | Proposed                                                                      |
| ECMWF Open Data ENS GRIB2 (fallback)                                                     | CC BY 4.0                                             | No                             | Not published, verify                                                                                 | WP3            | Proposed; only if the ensemble weight is too costly                           |
| NASA GIBS `IMERG_Precipitation_Rate`                                                     | NASA open data                                        | No                             | Not published, verify                                                                                 | WP3, WP5       | GIBS admitted (Phase 4); IMERG layer proposed                                 |
| GES DISC IMERG Early (numeric)                                                           | NASA open data                                        | Free Earthdata login           | Not published, verify                                                                                 | WP5            | **Verify** whether any numeric IMERG product needs no login                   |
| IMD rainfall category definitions                                                        | Public reference, cited                               | No                             | None (static reference)                                                                               | WP3            | Proposed; cite the definition document                                        |
| Open-Meteo Flood API (GloFAS v4), https://open-meteo.com/en/docs/flood-api               | CC BY 4.0                                             | No                             | Same ledger                                                                                           | WP5            | Proposed                                                                      |
| HydroSHEDS HydroRIVERS / HydroBASINS v1, https://www.hydrosheds.org/                     | Free with attribution (**verify** licence text)       | No                             | Static download                                                                                       | WP5            | Proposed; fallback for the D8 trace                                           |
| ESA Sentinel-2 acquisition plans (KML)                                                   | **Verify** redistribution terms                       | No                             | Static file                                                                                           | WP4            | Proposed; **verify** format stability                                         |
| USGS Landsat acquisition calendar, https://landsat.usgs.gov/landsat_acq                  | **Verify**                                            | No                             | Not published, verify                                                                                 | WP4            | Proposed                                                                      |
| Earth Search STAC v1, https://earth-search.aws.element84.com/v1                          | Per collection (Sentinel-2 L2A open)                  | No                             | Not published, verify                                                                                 | WP4            | Admitted for NDVI (Phase 4); polling use proposed                             |
| NASA CMR-STAC LPCLOUD (HLS)                                                              | NASA open data                                        | No for search                  | Not published, verify                                                                                 | WP4            | CMR owner admitted (Phase 4); STAC polling proposed                           |
| Copernicus Data Space STAC                                                               | Copernicus open licence                               | Free account                   | Sentinel Hub general user: 10,000 requests and 10,000 processing units/month; other services separate | WP4 (optional) | Proposed; not required for WP4 acceptance                                     |
| EMSC fdsnws event, https://www.seismicportal.eu/fdsnws/event/1/query                     | **Verify** terms                                      | No                             | Not published, verify                                                                                 | WP7            | Proposed                                                                      |
| GFZ GEOFON event service                                                                 | **Verify** terms                                      | No                             | Not published, verify                                                                                 | WP7            | Proposed                                                                      |
| adsb.fi                                                                                  | ODbL                                                  | No (**verify**)                | Not published, verify                                                                                 | WP7            | Proposed                                                                      |
| FIRMS MODIS product beside VIIRS NOAA-20                                                 | NASA open data                                        | Existing `FIRMS_MAP_KEY`       | 5,000 transactions per ten minutes                                                                    | WP7            | FIRMS admitted; second product query proposed                                 |
| OSM `name:hi`                                                                            | ODbL                                                  | No                             | Region pack / existing geocoder                                                                       | WP8            | Admitted data; new use in search and labels                                   |

WP6 needs no new external source: it uses the MCP specification and the STAC Item specification (Apache-2.0) as shapes, and the existing ledgers as its budget source.

### 4.2 Sources needed only by unscheduled features

| Source                                                                                                    | Feature                 | Licence / access                                                  | Status                                      |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| World Magnetic Model 2025 via `geomagnetism` (npm)                                                        | Sky Pointer             | Public domain coefficients; MIT package                           | **Verify** licence and WMM2025 availability |
| CelesTrak SATCAT, Yale BSC (bundled), Launch Library                                                      | Sky Almanac             | Existing or bundled                                               | Existing sources; SATCAT use proposed       |
| GIBS MODIS/VIIRS NDSI, RGI 7.0, ICIMOD lake inventories, NASA GLC and LHASA                               | Snowline Watch          | Keyless; CC BY 4.0; CC BY 4.0 (**verify** per dataset); NASA open | Proposed                                    |
| CHIRPS 2.0 climatology                                                                                    | Monsoon Memory          | Open download                                                     | Proposed                                    |
| GIBS VIIRS DNB and Black Marble; VNP46A2                                                                  | Night Ledger            | Keyless; free Earthdata login for VNP46A2                         | Proposed                                    |
| USGS ShakeMap/PAGER via ComCat; GEM Global Active Faults; USGS Vs30                                       | Shaking Desk            | USGS public; CC BY-SA 4.0; USGS public                            | Proposed                                    |
| GPlates Web Service (build-time snapshots); Nevada Geodetic Laboratory velocities; Bird (2003) boundaries | Himalaya Rising         | CC BY 4.0; free with citation; static file                        | Proposed                                    |
| Copernicus Data Space S1 GRD; ASF HyP3 RTC; Planetary Computer `sentinel-1-rtc`                           | Through-the-Clouds      | Free account; free monthly credits (**verify**); **verify** terms | Proposed                                    |
| GHS-POP                                                                                                   | Reachability and Go-bag | Copernicus GHSL open data                                         | Proposed                                    |
| OpenTimestamps calendars; c2pa-js                                                                         | Glass Box               | Free calendars; Apache-2.0                                        | Proposed                                    |
| liblouis tables                                                                                           | Nonvisual Dehradun      | LGPL-2.1+                                                         | Proposed                                    |
| Delhi Open Transit Data                                                                                   | Field Capture           | Registration required; fails the keyless transit rule             | Not admissible as-is                        |
| NDMA SACHET CAP, GDACS, EONET, Copernicus EMS, ReliefWeb                                                  | Hazard Desk             | SACHET **verify**; others public                                  | Proposed; SACHET needs an admission spike   |
| PVGIS 5.3, NASA POWER                                                                                     | Rooftop Sun             | Public services                                                   | Proposed                                    |
| NOAA AWC METAR/TAF, OurAirports                                                                           | Valley Airport Desk     | Public; public domain                                             | Proposed                                    |
| OpenCellID                                                                                                | Trek Readiness          | **Verify** key and licence                                        | Proposed                                    |

### 4.3 Accounts worth creating

A deliberately short list, in order. The owner creates each account; no build session creates accounts, accepts terms or handles credential values.

| Order | Account                         | Unlocks                                                | When                                                                  |
| ----- | ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| 1     | OpenAQ API key                  | WP2 station observations                               | Before WP2's admission spike                                          |
| 2     | Copernicus Data Space account   | Optional STAC for WP4; Sentinel-1 for the SAR moonshot | When WP4 starts, only if Earth Search and CMR-STAC prove insufficient |
| 3     | OGD India (data.gov.in) API key | WP2's CPCB spike                                       | After the production resource ID is confirmed                         |
| 4     | Mapillary client token          | Street imagery in Dehradun (`MAPILLARY_CLIENT_TOKEN`)  | Any time; coverage action 2                                           |

A NASA Earthdata login is deferred: it is needed only if WP5 finds no keyless numeric IMERG product, or for Night Ledger's VNP46A2.

**Rule: no key activates a capability by itself.** A saved key only makes a source eligible for admission. The capability turns on when its `SOURCE-ADMISSION.md` is complete, its ledger exists, and the Free-only policy lists it as allowed. This is the Phase 0 principle extended to every new source.

---

## 5. Product naming

The ideation scored 45 name candidates; the top eight carry the synthesis notes below. Collision notes are from memory and are not search results.

| #   | Name        | Score | Meaning                                                                                                                                                             | Tagline                                          | Collision note                                                                                                                                              |
| --- | ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Alidade** | 8.0   | The sighting rule on a surveyor's plane table, the part you look along to fix a bearing to a real thing on the ground (Arabic _al-idada_, "the ruler"). AL-ih-dade. | Sight it. Fix it. Know it.                       | Low. Obscure surveying term, scattered small commercial uses, no notable software product (from memory). **Verify** alidade.app / .dev and the GitHub org.  |
| 2   | Tellurion   | 7.5   | Clockwork instrument showing Earth's position relative to the Sun (Latin _tellus_). teh-LOOR-ee-on.                                                                 | The Earth, as it is right now.                   | Low to medium. Tellurium is a spelling distraction; a few niche products use the word (**verify**).                                                         |
| 3   | Verascope   | 7.0   | Coined: _vera_ (true) + scope.                                                                                                                                      | See it. Then see how you know it.                | Medium to low. The 1890s Richard Verascope camera is lineage; Truescope is a neighbour. **Verify** verascope.com / .app.                                    |
| 4   | Jharokha    | 7.0   | Hindi/Urdu: the carved overhanging balcony-window of a haveli. jhuh-ROH-kha.                                                                                        | Your window on the whole world.                  | No major software product; hotel, jewellery and handicraft brands use it. Needs a pronunciation hint. Repo name appeared free on a spot check (**verify**). |
| 5   | Jatayu      | 6.5   | The vulture king of the Ramayana who witnessed from the sky and reported what he saw.                                                                               | The eyewitness in the sky.                       | Medium. Jatayu Earth's Center (Kerala), drone and defence startups, a Hindi film.                                                                           |
| 6   | Basira      | 6.5   | Arabic: insight, discernment. ba-SEE-ra.                                                                                                                            | Insight, not just sight.                         | Low to medium. Small consultancies, an AI startup or two, a given name. Avoid "Al-Basir".                                                                   |
| 7   | Deodar      | 6.5   | _Cedrus deodara_, the Himalayan cedar of the Doon and Mussoorie ridges. DEE-oh-dar.                                                                                 | Rooted in the foothills. Reaching the whole sky. | Moderate. Many Indian businesses and a small GitHub language project.                                                                                       |
| 8   | Dharti      | 6.5   | Hindi: the earth underfoot. DHAR-tee.                                                                                                                               | Talk to the ground you stand on.                 | Moderate. Generic Hindi noun used by a film, agritech brands and NGOs.                                                                                      |

The next four in the ranking, each at 6.0, were Drishti, Sanjaya, Armillary and Lucerna; they were not carried into the synthesis.

**Recommendation: Alidade.** It is the only name on the list that is a literal field instrument for looking from a known point at a real feature, which is the honesty rule in one word: a bearing is observed, not imagined. It fits Fieldbook, Planner, the Horizon Engine and Sky Pointer without metaphor, carries the brass-instrument register Lamplight already uses, and reads the same in Dehradun and elsewhere. It has a quiet local truth: Dehradun has been home to the Survey of India since the nineteenth century, so a surveyor's instrument is the city's own vocabulary. Keep AUREL as the fallback mark, and consider Jharokha as the name of the Lens workspace if an Indian-language word is wanted inside the product.

**Owner action.** Trademark searches, domain availability, app-store name checks and GitHub organisation checks have **not** been done. No Phase 6 work package renames anything: code, locale strings, icons, manifest titles and storage keys keep the AUREL identity until the owner completes those checks and decides. A rename would be its own later package touching `index.html`, `public/manifest.webmanifest`, `public/icons/*`, the 11 (12 after WP8) locale catalogs and docs, with upstream authorship and licensing retained.

---

## 6. Work packages WP1–WP8

Each package becomes one build session in its own git worktree, on its own branch from `main`.

**Shared rules for every package.**

- Free-only stays the default: no paid API, no hosting.
- Every new data adapter passes the admission checklist in [FREE-DATA-PLAN.md §6](FREE-DATA-PLAN.md) and records it in `docs/design/aurel/phase-6/<wp>/SOURCE-ADMISSION.md`.
- Every number carries source, unit, applicable time and class (`observed | modelled | derived | simulated | note`).
- New code lands in new modules (`src/<feature>/`, `server/providers/<feature>/`) with tests; shared files (layer catalog, tools catalog, locales, workspace views) are touched only at the registration seam.
- UI uses existing tokens from `src/ui/styles/lamplight.css` and the owner/store/view pattern in `docs/UI-OWNERSHIP.md`. Cyber and Lamplight theme files are not changed.
- i18n strings go through `npm run i18n`.
- During work run targeted `node --import=./build/registerVue.js --test <files>`; before finishing run the full `npm test`, `npm run format:check` and `npm run check:boundaries` once.
- Commit on the worktree branch with conventional commits. Never print `.env` values.

### WP1: Kshitij Horizon Engine (size L)

- **Goal.** `horizon_at(lat, lon, observerHeight, date)` returns a 360° terrain horizon, named peaks on the skyline (azimuth, distance, elevation), terrain-clipped sunrise, sunset and moonrise, and a shadow prediction; surfaced as Planner and Lens cards and as an MCP tool.
- **Scope.** GLO-30 admission spike first; DEM sampler; ray-march in a worker with refraction k = 0.13; local ephemeris; `peaks` region-pack theme; horizon ring on the globe; peaks list; sunrise card (astronomical against ridge-clearing); shadow card; Fieldbook analysis snapshot; MCP `horizon_at`.
- **Seams.** `src/planner/daylight.js`, `src/planner/profile.js`, `src/planner/routeSampling.js`, `src/data/terrainHeights.js`, `src/data/terrainHeightsProxy.js`, `server/providers/terrain.js`, `src/celestialRing.js`, `src/app/plannerTools.js`, `scripts/build-region-pack.mjs` (new `peaks` theme from OSM `natural=peak` with `name`, `name:hi`, `ele`), `src/tools` (new `horizon_at` tool).
- **New modules.** `src/horizon/` (sampler, ray-march worker, refraction, ephemeris via local NOAA solar equations or `astronomy-engine`), `src/horizon/*.test.mjs`, `docs/design/aurel/phase-6/wp1/`.
- **Data.** Existing Mapterhorn heights for the near field; Copernicus GLO-30 for the far field (fall back to existing heights if not admitted); OSM peaks via the region pack; Open-Meteo cloud and visibility on the existing ledger.
- **Acceptance.** A Lal Tibba pin yields a horizon ring and a peaks list with azimuth and distance labelled "geometric, terrain-only"; the sunrise card shows astronomical against ridge-clearing time; a shadow card for a chosen date and time; DEM source and void count shown; MCP `horizon_at` returns a provenance envelope.
- **Tests.** Ray-march on a synthetic DEM with a known horizon; refraction correction; peak matching (name, azimuth, distance) against fixtures; ephemeris against reference values; void handling; envelope shape; the `peaks` theme build within region-pack caps.
- **Out of scope.** Buildings, trees and haze in visibility; any "guaranteed view" wording; the phone camera overlay (Sky Pointer); viewshed polygons beyond the 360° horizon line; Horizon Match.

### WP2: Breath, Indian station air quality (size M)

- **Goal.** Real CPCB/UKPCB monitors beside the CAMS model card; Indian NAQI and US AQI computed per standard; a station-threshold watch.
- **Scope.** OpenAQ v3 adapter with a budget ledger; OGD India adapter as a spike; sensor.community as a separately labelled citizen tier; NAQI and US AQI calculators; station cards in Lens; one new Watchlist condition type.
- **Seams.** `src/layers/airQuality/{model,source}.js` (provider seam), `server/providers/field-context.js` (the CAMS card stays separate), `src/app/watchlistTools.js` (new condition type), Lens cards.
- **New modules.** `server/providers/air-quality/openaq.js`, `server/providers/air-quality/ogd-india.js` (spike), `src/airQuality/naqi.js`, tests, `docs/design/aurel/phase-6/wp2/SOURCE-ADMISSION.md` (OpenAQ v3 free key; data.gov.in real-time AQI catalog under GODL; sensor.community labelled uncalibrated).
- **Data.** OpenAQ v3, data.gov.in real-time AQI, sensor.community.
- **Acceptance.** Dehradun stations render with pollutant, unit, 24 h NAQI basis and timestamp; the "no monitor" state is distinct from "no data"; CAMS and station cards never merge; the watch fires once per crossing with cooldown; a budget ledger exists for OpenAQ.
- **Tests.** NAQI and US AQI breakpoints against the published tables; 24 h averaging with missing hours; "no monitor" against "no data" against stale; ledger refusal before dispatch; watch crossing, cooldown and dedupe; malformed and partial payloads.
- **Out of scope.** Health advice; interpolated pollution surfaces between stations; treating citizen sensors as regulatory; enabling OGD India before its production resource is verified.

### WP3: Altitude Ensemble and Rain Lane (size L)

- **Goal.** Planner checkpoints become a mountain-weather sheet at the checkpoint's elevation (freezing level, snowfall, cloud layers, visibility, CAPE, 700/500 hPa wind) with ICON, GFS and IFS side by side, an ECMWF ENS fan for precipitation, 7-day antecedent totals (ERA5-Land), and IMERG observed rain against IMD intensity categories.
- **Scope.** Forecast with `elevation=` and `models=`; ensemble adapter; historical adapter; weighted ledger units; checkpoint sheet and view; IMERG overlay via GIBS; Chronicle forecast lane entry; Fieldbook snapshot.
- **Seams.** `server/providers/field-context.js` and `field-context-budget.js` (weighted Open-Meteo units), `server/providers/wind/*.js`, `src/planner/*`, `src/layers/weather`, the Chronicle forecast lane, Fieldbook snapshots.
- **New modules.** `server/providers/mountain-weather/` (forecast, ensemble API, historical API), `src/planner/checkpointSheet.js` and its view, IMERG via GIBS, tests, `docs/design/aurel/phase-6/wp3/SOURCE-ADMISSION.md` (**verify** ensemble call weighting against the 10,000/day ledger).
- **Data.** Open-Meteo forecast, Ensemble and Historical APIs; ECMWF Open Data ENS as fallback; GIBS IMERG; IMD category definitions.
- **Acceptance.** A Kedarkantha checkpoint shows run time, lead, three models and an ENS member count at or above a threshold; an antecedent-total card; no go/no-go wording; the ledger refuses before dispatch when exhausted.
- **Tests.** Unit weighting for variable count, forecast length and ensemble members; refusal before dispatch; model-disagreement presentation; missing-model partial state; run-time and lead labelling; copy check that rejects "safe", "dangerous", "go" and "no-go".
- **Out of scope.** Warnings or advisories; downscaling beyond the provider's `elevation=` adjustment; nowcasting; IMD data ingestion beyond cited category definitions.

### WP4: Orbit Witness and Overpass Oracle (size L)

- **Goal.** The next Sentinel-2, Landsat or ISS pass over the place on screen (SGP4 swath, published acquisition plans and cloud forecast), a Watchlist rule that fires once when the scene lands in Earth Search or CMR-STAC, and a Scene Director "ride this pass" shot.
- **Scope.** Swath footprint prediction; acquisition-plan cross-check; cloud forecast per pass; STAC poll as the second watch type after FIRMS; director shot template; four labelled lanes.
- **Seams.** `src/layers/satellites/{orbits,tracking,records}.js`, `src/data/satellitePass.js`, `src/app/watchlistTools.js`, `src/app/chronicleTools.js`, `src/layers/recentImagery/catalog.js`, `src/director/{playback,camera,timeline}.js`.
- **New modules.** `src/orbitWitness/` (swath footprint, plan cross-check, STAC poll), a director shot template, tests, `docs/design/aurel/phase-6/wp4/SOURCE-ADMISSION.md` (ESA acquisition-plan KML terms, USGS calendar, keyless Earth Search STAC).
- **Data.** CelesTrak GP; ESA Sentinel-2 acquisition plans; USGS Landsat calendar; Earth Search STAC v1; NASA CMR-STAC; Open-Meteo cloud cover.
- **Acceptance.** Four lanes labelled predicted pass, planned acquisition, available product and dramatised ride; the watch dedupes by scene id; the ride shows "propagated, epoch X" in the HUD and in exports.
- **Tests.** Swath geometry against a fixture orbit; plan cross-check with matching, missing and contradicting plans; STAC poll dedupe, catalogue outage as "unknown", cooldown; HUD and export labels for the ride.
- **Out of scope.** Commercial constellations; claiming a pass is an acquisition; tasking; downloading full scenes (Chronicle and Research keep their Phase 4 bounds).

### WP5: Raindrop and Catchment Pulse (size L)

- **Goal.** Click, and a drop traces down the DEM to the sea; an upstream catchment polygon; IMERG basin-mean rain for 1, 3 and 24 h; an Open-Meteo forecast for the polygon; a GloFAS discharge percentile; works offline inside the region pack; a watch on a basin-mean threshold.
- **Scope.** D8 flow in a worker with disclosed sink filling; catchment delineation; HydroSHEDS fallback beyond the local DEM; drop animation; rain, forecast and GloFAS cards; method card; one watch condition.
- **Seams.** `server/providers/terrain.js`, `src/planner/{profile,routeSampling}.js`, the GIBS adapter in `src/layers/recentImagery`, the field-context ledger, `src/app/watchlistTools.js`, `src/director` (animated trace), region-pack waterways.
- **New modules.** `src/hydro/` (D8 worker, catchment delineation, HydroSHEDS fallback), cards, tests, `docs/design/aurel/phase-6/wp5/SOURCE-ADMISSION.md` (HydroRIVERS and HydroBASINS, Open-Meteo Flood API GloFAS, an IMERG numeric product that needs no Earthdata login: **verify**).
- **Data.** GLO-30 or Mapterhorn; HydroSHEDS; GIBS IMERG and possibly GES DISC IMERG Early; Open-Meteo forecast and Flood API; region-pack OSM waterways.
- **Acceptance.** A Rajpur drop reaches the Song and then the Ganga; a Selaqui drop goes to the Asan and the Yamuna; the method card states DEM resolution and D8 ambiguity; no flood-depth or evacuation wording; the watch fires once.
- **Tests.** D8 on synthetic DEMs (slope, pit, flat); sink filling disclosure; catchment polygon on a fixture basin; handoff from local DEM to HydroRIVERS; basin-mean arithmetic with missing cells; watch crossing and dedupe; copy check rejecting flood-depth and evacuation wording.
- **Out of scope.** Flood depth or inundation extent; discharge values; river stage (no open gauge API); evacuation guidance.

### WP6: Agent Field Kit, MCP write tools with evidence envelopes (size M)

- **Goal.** MCP tools `fieldbook_add_place`, `fieldbook_add_note`, `draw_area`, `run_mission_template`, `register_watch`, `render_view`, `get_free_budget` (and `horizon_at` once WP1 lands), every result wrapped in a provenance envelope; writes gated by a per-session "Allow agent writes" toggle; agent notes author-tagged and never executed.
- **Scope.** Envelope schema; write tools with revision checks; the toggle and its typed refusal; `render_view` with a class-and-time legend; `get_free_budget` from the existing ledgers; documentation.
- **Seams.** `src/tools/{catalog,schema,functions,panel,globePanel}.js`, `server/mcp/{server,plugin}.js`, `src/fieldbook/{repository,document}.js`, `src/app/{watchlistTools,plannerTools,localCommandTools}.js`, `feedProvenanceEnvelope` in `src/data/layerSnapshot.js`, `src/agent/worldPacket.js`, `docs/MCP_SETUP.md`, `docs/TOOLS.md`.
- **New modules.** Envelope and write-tool modules under a new feature directory, tests, `docs/design/aurel/phase-6/wp6/`.
- **Data.** None external.
- **Acceptance.** With the toggle off every write tool returns a typed refusal; with it on, writes succeed with revision checks and show "by agent · <client> · time" in Library; the `render_view` PNG lists each visible layer's class and timestamp; `get_free_budget` returns estimated remaining units per ledger.
- **Tests.** Envelope schema; refusal paths (toggle off, revision conflict, invalid geometry, unknown fields); author tagging; agent note text never interpreted as a command; `render_view` legend completeness; budget answer wording.
- **Out of scope.** Any hosted model; agent-initiated provider calls that bypass the Free-only gate; deleting Fieldbook data through MCP; persisting the write toggle across sessions.

### WP7: Second Source, corroboration cards (size L)

- **Goal.** For quakes, fires and aircraft, fetch an independent free source and show agree, disagree or single-source with time offset and position residual, plus a dependency graph so shared feeders are not double-counted.
- **Scope.** EMSC and GEOFON beside USGS; FIRMS VIIRS NOAA-20 against MODIS; adsb.fi against adsb.lol and the local dongle; matching and residuals; dependency graph; Lens Evidence cards; budget-bounded polling.
- **Seams.** `src/data/feedState.js`, `src/data/layerSnapshot.js`, `src/layers/earthquakes`, the FIRMS adapters (`server/providers/firms.js`), `src/layers/localAdsb` and flights, the Lens Evidence tab.
- **New modules.** `server/providers/second-source/` (EMSC fdsnws, GFZ GEOFON, adsb.fi), `src/corroboration/` (matching, residuals), cards, tests, `docs/design/aurel/phase-6/wp7/SOURCE-ADMISSION.md` (ODbL for adsb.fi; EMSC and GEOFON terms).
- **Data.** EMSC, GEOFON, adsb.fi, existing FIRMS products.
- **Acceptance.** A USGS event shows EMSC/GEOFON agreement with magnitude, time and position deltas; FIRMS shows "two sensors" when VIIRS NOAA-20 and MODIS both detect; disagreement is labelled normal; polling is budget-bounded.
- **Tests.** Matching windows and tolerances on fixtures; residual arithmetic; shared-feeder detection in the dependency graph; single-source state; outage of the second source; polling budget.
- **Out of scope.** Declaring truth by vote; India NCS until its terms are verified; corroboration for layers other than quakes, fires and aircraft.

### WP8: Hindi-first AUREL and Dehradun presets (size M)

- **Goal.** A complete `hi` locale (lakh/crore grouping, IST, optional Devanagari numerals); OSM `name:hi` in search results and labels where present; a Hinglish-to-Devanagari search aid; Indian city presets (Dehradun, Mussoorie, Rishikesh, Delhi, Mumbai, Bengaluru, Chennai, Kolkata) in `src/cityPois.js` and the Location tray; `RADIO_PRIORITY_COUNTRIES=IN` documented and surfaced in provider settings; a coverage-aware message in `src/maps/availability.js` when Google 3D is unavailable over India; the Free-only status list made consistent with behaviour (`launch-library`).
- **Scope.** The locale, number and time formatting, search, presets, two housekeeping fixes and translator documentation.
- **Seams.** `src/i18n/locales/*.json` and `scripts/i18n.mjs`, `src/search/*`, `src/cityPois.js`, `src/ui/views` (Location tray), `src/maps/availability.js`, `server/standalone/free-only-status.js`, `docs/TRANSLATORS.md`.
- **New modules.** `src/i18n/locales/hi.json`, a transliteration helper under `src/search/`, tests.
- **Data.** OSM `name:hi` (region pack and existing geocoder results).
- **Acceptance.** `npm run i18n` reports `hi` complete; searching "देहरादून" and "dehradun" both resolve; presets fly to the right coordinates; Google 3D failure over Dehradun says "outside Google's photorealistic coverage"; locale tests pass.
- **Tests.** Lakh/crore grouping; IST formatting; transliteration cases; preset coordinates; the availability message by region and credential state; the Free-only status list against actual policy.
- **Out of scope.** Other Indian languages; Hindi braille (Nonvisual Dehradun); any product rename; enabling Google 3D.

### Dependencies and merge order

| Package                 | Depends on                | Notes                                                                                           |
| ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| WP1                     | none                      | First of the terrain family; owns the DEM sampler and the GLO-30 decision.                      |
| WP5                     | WP1                       | Uses WP1's DEM sampler; starts after WP1 merges, or develops against its interface and rebases. |
| WP6                     | WP1 for `horizon_at` only | The envelope, toggle and other write tools are independent; `horizon_at` lands after WP1.       |
| WP2, WP3, WP4, WP7, WP8 | none                      | Independent of each other and of WP1.                                                           |

Each WP lands on its own branch from `main` and is merged by the orchestrating session only after its verification gate (§7) passes. Shared registration files (`src/tools/catalog.js`, locale catalogs, the layer catalog, workspace views) will conflict; the orchestrator merges in sprint order, re-runs `npm run i18n` after each merge, and asks the package's session to rebase when a conflict touches more than a registration line. WP8 adds `hi.json`, so packages merged after WP8 must also supply Hindi strings for their new messages, or the orchestrator records them as untranslated and blocks the gate until they are filled.

---

## 7. Verification gate per WP

A package is mergeable only when every row below passes and its evidence is filed under `docs/design/aurel/phase-6/<wp>/`.

| Check                      | Pass condition                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                 | Full suite, zero failures; skips listed with their reason (the Node 24 allocation probes on Node 26 are the known case).                                                                   |
| `npm run format:check`     | Passes.                                                                                                                                                                                    |
| `npm run check:boundaries` | Import directions and package boundaries pass.                                                                                                                                             |
| `npm run i18n`             | Every catalog complete, including `hi` once WP8 has merged.                                                                                                                                |
| Targeted QA script         | A new `scripts/qa-aurel-<feature>.mjs` following the `qa-aurel-planner.mjs` pattern: fresh browser profile, external requests blocked or served by labelled fixtures, zero runtime errors. |
| Browser check              | The feature's workflow at 1440×900 and 390×844, screenshots inspected and filed.                                                                                                           |
| `SOURCE-ADMISSION.md`      | All seven checklist items for every new source, with an actual bounded Dehradun sample where Dehradun coverage is claimed, or a recorded no-go.                                            |
| Free-only                  | No request to a disallowed billable capability observed during the QA run, even with saved credentials present.                                                                            |
| Honesty copy               | Every number has source, unit, applicable time and class; the package's forbidden words (listed in its Out of scope) appear in no string.                                                  |
| Configuration integrity    | `.env` hash unchanged against the pre-work baseline; no key values in any artifact.                                                                                                        |

The orchestrating session re-runs the full suite on `main` after each merge, because two green branches can still fail together.

---

## 8. Sequencing

### Sprint A: WP1, WP2, WP8, and WP6 scaffolding

WP1 opens with the GLO-30 admission spike because three later instruments depend on terrain. WP2 and WP8 are independent and close the most visible India gaps (station air, Hindi, presets, the wrong Google 3D message). WP6 builds the envelope schema, the write toggle, the typed refusals and `get_free_budget` without `horizon_at`.

**Dehradun demo script, end of Sprint A.**

1. Switch the interface to Hindi; search "देहरादून", then "dehradun"; both resolve. Choose the Mussoorie preset.
2. Turn on Google 3D: the message says Dehradun is outside Google's photorealistic coverage, not a key problem.
3. Open Breath: Dehradun station cards show pollutant, unit, NAQI basis and timestamp beside the separate CAMS card; a location without a monitor reads "no monitor".
4. Drop a pin at Lal Tibba: the horizon ring, the peaks list with "geometric, terrain-only", the sunrise card with both times, the DEM source and void count. Save the analysis to Fieldbook.
5. From an MCP client with writes off, call `fieldbook_add_place`: a typed refusal. Turn writes on, retry: the place appears in Library as "by agent".

### Sprint B: WP3, WP4, WP5, WP7, and WP6 completion

WP5 starts once WP1's sampler has merged. WP6 adds `horizon_at` and the remaining write tools. WP3, WP4 and WP7 run in parallel.

**Dehradun demo script, end of Sprint B.**

1. Plan a route to the Kedarkantha road-head; open the summit checkpoint sheet: run time, lead, ICON/GFS/IFS side by side, the ENS member count, the antecedent total, no go/no-go wording.
2. Over Mussoorie, open Orbit Witness: the next Sentinel-2 and Landsat passes in four labelled lanes; register a scene watch; ride the Phase 4 scene's pass with "propagated, epoch X" in the HUD.
3. Click Rajpur: the drop reaches the Song and the Ganga. Click Selaqui: the drop goes to the Asan and the Yamuna. Read the method card.
4. Open the latest Himalayan quake in Lens: EMSC and GEOFON deltas, or "single source". Open a Doon fire detection: "two sensors" when both detect.
5. Ask an agent to prepare a sunrise Fieldbook: it calls `get_free_budget`, `horizon_at` and `render_view`, and every result carries an envelope.

### Sprint C: moonshots as Labs behind flags

Moonshots ship only as Labs, off by default, each behind its own flag, each with its own admission record and a proof-of-value before promotion, following the F11 rule. Order is the owner's choice by usefulness; the judged order is Himalaya Rising (6.75), Valley Breath (6.5), Reachability and Go-bag (6.25), Mirror (6.0), Through-the-Clouds (5.75). Sky Pointer (signature, 8.0) and the high-value features in §3.2 are not in Phase 6; Sky Pointer is the first candidate for a follow-on package because WP1 supplies its horizon.

**Dehradun demo script, end of Sprint C (for whichever Labs are built).**

1. Himalaya Rising: scrub the deep-time clock from 140 Ma; it never shares the live clock; hand over to the GNSS arrows and the cross-section under Dehradun.
2. Valley Breath: on a November morning, show the modelled inversion lid and a back-trajectory with "simulated single-level advection" on every frame.
3. Reachability: cut a bridge on the Song and read which wards lose access, labelled "planning exercise".

---

## 9. Risks and open checks

| Risk                        | Why it matters                                                                                                                                                                                                                         | Mitigation                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open-Meteo quota weighting  | Requests exceeding ten variables or two weeks can count as multiple or fractional units against 10,000/day (FREE-DATA-PLAN §3); a mountain sheet with many variables and models can consume units faster than its call count suggests. | WP3 measures the weight of each request shape in its admission record, extends `field-context-budget.js` to count weighted units, reserves a margin, and refuses before dispatch.       |
| Ensemble unit cost          | The weight of an Ensemble API call with many members is unverified; it could exhaust the shared ledger used by Planner and Raindrop.                                                                                                   | Measure on a bounded probe; cap members and variables per sheet; cache per run; if the cost is too high, switch to ECMWF Open Data ENS GRIB2 byte ranges through the existing reader.   |
| GLO-30 admission            | WP1's far field, WP5 and the Corridor Pack assume it; its licence text, access route and request costs are unverified here.                                                                                                            | WP1's first task is the spike with a go/no-go record; on no-go, WP1 and WP5 ship on Mapterhorn with the far field limited and labelled, and HydroSHEDS covers WP5 beyond the local DEM. |
| STAC latency                | Sentinel-2 L2A appears hours to days after acquisition; catalogues have outages; a watch could report "no scene" wrongly.                                                                                                              | Four separate lanes; outage reads "unknown"; the watch dedupes by scene id, uses a cooldown and pauses with the page, as the FIRMS watch does.                                          |
| Phone compass error         | Phone compasses can be 5–15° off and iOS may expose only relative heading; this affects Sky Pointer and any phone-held heading.                                                                                                        | Confidence cone, calibration state, manual alignment before any peak is "identified"; Sky Pointer is not in Phase 6, so WP1 avoids depending on device heading.                         |
| Indian alert licensing      | SACHET CAP, IMD nowcasts and FSI Van Agni alerts have no verified open licence; FSI data cannot be redistributed.                                                                                                                      | No Phase 6 package ingests Indian alerts. Hazard Desk stays unscheduled until a SACHET admission spike succeeds; cards link to the authority instead.                                   |
| OpenAQ coverage in Dehradun | WP2's headline depends on Dehradun stations being present and fresh.                                                                                                                                                                   | **Verify** with a bounded probe at the start of WP2; if absent, WP2 ships the seam, the calculators and the honest "no monitor" state, and records the gap.                             |
| Parallel merge conflicts    | Eight branches touch the same registration files and locale catalogs.                                                                                                                                                                  | Registration-only edits to shared files; orchestrator merges in sprint order, re-runs `npm run i18n` and the full suite after each merge.                                               |
| New package dependencies    | `astronomy-engine`, `suncalc` or `geomagnetism` would be new runtime dependencies, as Phase 4's `geotiff` and `proj4` were, and each needs a recorded review.                                                                          | Prefer in-house NOAA equations; any dependency is recorded with licence and version in the package's admission record and checked by the production dependency audit.                   |

---

## Appendix: judged ranking of the scheduled features

| Feature                           | Judged average | WP  | Size |
| --------------------------------- | -------------- | --- | ---- |
| Kshitij Horizon Engine            | 8.5            | WP1 | L    |
| Altitude Ensemble and Rain Lane   | 7.5            | WP3 | L    |
| Breath                            | 7.25           | WP2 | M    |
| Raindrop and Catchment Pulse      | 7.25           | WP5 | L    |
| Orbit Witness and Overpass Oracle | 7.25           | WP4 | L    |
| Agent Field Kit                   | 7.25           | WP6 | M    |
| Second Source                     | 7.0            | WP7 | L    |
| Hindi-first AUREL                 | 6.25           | WP8 | M    |
