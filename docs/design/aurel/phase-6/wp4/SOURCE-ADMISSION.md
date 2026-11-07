# WP4 Orbit Witness: source admission

Verified 7 November 2026 against the live services from this machine. No account, key or paid capability was used. Every item follows the [FREE-DATA-PLAN.md §6](../../FREE-DATA-PLAN.md) checklist: (1) identity, capability, use, review date; (2) geography, scale and time semantics with a Dehradun sample; (3) authentication, entitlement, quota, exhaustion; (4) attribution, cache, export and redistribution; (5) refresh, bounds, payload, cancellation, retry and backoff; (6) tests; (7) user-facing explanation and fallback.

Reference place for every sample: Mussoorie, 30.4598 N 78.0644 E.

## Summary

| Source | Decision | Use in AUREL |
| --- | --- | --- |
| CelesTrak GP `active` group (existing proxy and disk cache) | Admitted (existing source, new use) | SGP4 elements for Sentinel-2A/B/C, Landsat 8/9, ISS |
| ESA Sentinel-2 acquisition plans (KML) | Admitted **only as an owner-supplied local file**; automatic fetching **no-go** | Plan cross-check lane |
| USGS Landsat acquisition calendar | **No-go** (stale, not a stable machine interface) | Landsat plan lane reads "no admissible published plan" |
| Element 84 Earth Search STAC v1 | Admitted (Phase 4 source, new polling use) | Available-product lane, scene watch |
| NASA CMR-STAC LPCLOUD (HLS) | Admitted (Phase 4 CMR owner, new STAC use) | Available-product lane, scene watch, Chronicle handoff |
| Open-Meteo forecast, `cloud_cover` | Admitted on the existing field-context ledger | Cloud forecast per pass |
| Copernicus Data Space STAC | Not used | Needs a free account; WP4 acceptance does not depend on it |
| Mission facts (swath, altitude) | Cited constants | Swath footprint |

## CelesTrak GP elements

1. **Identity.** CelesTrak GP data, `https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle`, read only through the existing `/api/celestrak/active` proxy, which already caches to `.gev-cache/celestrak-active.json` with a 6 h TTL and serves the last copy when upstream fails (`x-tle-cache: STALE-ERROR`). Orbit Witness adds no new upstream request shape. Reviewed 2026-11-07.
2. **Semantics and sample.** Element sets are mean elements for SGP4 at an epoch; positions away from the epoch are propagations (class `modelled`). Sample, catalog numbers 40697, 42063, 60989, 39084, 49260 and 25544, epochs 2026-11-06 11:57 (ISS) to 20:45 UTC. Back-propagated 12 days, SGP4 put Sentinel-2B's swath crossing over Mussoorie at **2026-10-25T05:40:29Z**, 58 km left of the ground track. Earth Search's record for the Phase 4 scene `S2B_43RGP_20261025_0_L2A` is 05:40:34.715Z (tile-centre time). Landsat 8 was predicted at 2026-10-24 05:18:27Z (catalogued `LC08_L2SP_146039_20261024_02_T1` at 05:18:29.5Z), and Landsat 9 at 2026-11-01 05:18:30Z (catalogued at 05:18:32.8Z).
3. **Access.** Keyless. CelesTrak asks clients not to poll GP data more often than about every two hours; the existing 6 h cache satisfies that, and the controller reuses parsed sets for one hour.
4. **Attribution.** "Satellites (TLEs): CelesTrak, Dr. T.S. Kelso" is already in the attribution popover; Orbit Witness adds its own credit entry naming CelesTrak. Element lines are included in the exported ride record so a reader can reproduce the propagation.
5. **Bounds.** Pass search is at most 14 days, 30 s coarse steps, 60,000 propagations and 40 passes per spacecraft (tested). ISS sky passes are limited to three days and twelve passes.
6. **Tests.** `src/orbitWitness/swath.test.mjs`, `src/orbitWitness/sources.test.mjs` (stale header, failure).
7. **Explanation.** Every spacecraft card shows "propagated, epoch <UTC>", the epoch age in days and a confidence band (within 3 days, 3–7 days, over 7 days). The bands are presentation thresholds, not a published accuracy figure. Fallback: when elements are missing the card says so; when CelesTrak is down the cached copy is used and labelled.

## ESA Sentinel-2 acquisition plans

1. **Identity.** ESA Sentinel Online, "Sentinel-2 acquisition plans", <https://sentinels.copernicus.eu/copernicus/sentinel-2/acquisition-plans>. One KML per satellite (S2A, S2B, S2C), each covering about 15–18 days, republished about weekly. Reviewed 2026-11-07.
2. **Format and sample.** The current files were downloaded once for this spike (not committed). `S2C_MP_ACQ__KML_20261029T120000_20261116T150000.kml` is 2,205,530 bytes (`application/vnd.google-earth.kml+xml`, last-modified 3 Nov 2026) with 942 placemarks. Each `Placemark` has `TimeSpan begin/end`, `ExtendedData` (`ID`, `Mode`, `ObservationTimeStart`, `ObservationTimeStop`, `OrbitAbsolute`, `OrbitRelative`, `Scenes`), and a `Polygon` in lon,lat. Times carry no zone suffix and are UTC. Modes seen: NOBS (885), VIC (50), DARK-O (4), RAW (2), SUN (1); ESA states that only nominal datatakes are distributed. Point-in-polygon checks over Mussoorie, all nominal, relative orbit 105:
   - S2A (`…20261029T150000_20261116T180000`): 2026-11-11 05:32:46–05:45:56.
   - S2B (`…20261022T120000_20261109T150000`): 2026-10-25 05:29:04–05:51:40, 2026-11-04 05:30:02–05:51:40.
   - S2C (`…20261029T120000_20261116T150000`): 2026-10-30 05:30:04–05:52:11, 2026-11-09 05:30:58–05:52:15.
   SGP4 also predicts S2A on 2026-11-01 05:40:34Z, but no S2A datatake covers Mussoorie then, and Earth Search has no S2A scene for that day. This is the expected "contradicted" case: S2A's extension campaign acquires less than its orbit allows. Format stability: the schema matched across all three files; the parser refuses any file without ESA's name pattern and `S2 Planned Observations` document name.
3. **Access.** Keyless public download; no quota applies to a file the owner downloads.
4. **Terms (decisive).** The Sentinel Online terms (<https://sentinels.copernicus.eu/terms-conditions>) let users download and copy material for non-commercial use, but ESA "does not grant the right to resell or redistribute any information … or to compile or create derivative works", and other uses need prior written authorisation. Therefore AUREL **does not** bundle, fetch, proxy, cache or export the plan files. The owner downloads them from ESA and loads them into the panel. They are parsed in memory for the session and never written to storage, and exports carry only the matched datatake id and times for the owner's own record. The on-screen credit "© European Space Agency - ESA" is shown beside the loader. Automatic fetching stays **no-go** unless ESA grants written authorisation (contact EOSupport@copernicus.esa.int); this is an open item for the owner.
5. **Bounds.** At most 6 files, 8 MiB per file, 5,000 placemarks, 512 ring points; refused files are named in the panel.
6. **Tests.** `src/orbitWitness/plan.test.mjs` (matching, missing, contradicting, non-nominal, refused files, unmatched planned takes), `src/ui/orbitWitnessController.test.mjs`. Fixtures are synthetic files in ESA's schema; no ESA content is in the repository.
7. **Explanation.** The planned lane reads "Plan-confirmed: ESA datatake …", "no nominal datatake … predicted, not planned" or "No loaded ESA plan covers this time". Fallback: without a plan the predicted lane still stands, labelled as a prediction.

## USGS Landsat acquisition calendar

1. **Identity.** <https://landsat.usgs.gov/landsat_acq>, an interactive page; the data behind it is `…/landsat_acq/assets/json/cycles_full.json` (537,752 bytes, last-modified 6 Jan 2025).
2. **Finding.** The JSON maps calendar days to WRS-2 path lists and **ends on 31 December 2025**. The page itself carries a USGS notice dated 21 September 2026 that pending-acquisition information is not updating. There is no documented, stable machine interface.
3. –5. Not applicable after the no-go.
6. **Tests.** `plan.test.mjs` asserts Landsat never reads as plan-confirmed.
7. **Decision and explanation.** **No-go.** The Landsat planned lane says "No admissible published plan: the USGS acquisition calendar ends on 31 December 2025." Landsat 8/9 still get the predicted lane and the product lane. Revisit if USGS restores a current, documented feed.

## Element 84 Earth Search STAC v1

1. **Identity.** <https://earth-search.aws.element84.com/v1>, `GET /search`, collections `sentinel-2-l2a` and `landsat-c2-l2`. Admitted for Sentinel-2 L2A COG reads in Phase 4 ([SCIENCE-ADMISSION.md](../../phase-4/SCIENCE-ADMISSION.md)); this package adds metadata search and polling only, with no asset downloads. Reviewed 2026-11-07.
2. **Sample.** bbox 77.96,30.36,78.16,30.56, 2026-10-20 to 2026-11-07, limit 50: `numberMatched` 12, all returned. Ten Sentinel-2 L2A items on tiles 43RGP and 44RKU dated 10-20, 10-22, 10-25, 10-30 and 11-04 (for example `S2B_43RGP_20261104_0_L2A`, 05:40:35.189Z, `eo:cloud_cover` 0.146; `S2C_43RGP_20261030_0_L2A`, 95.86), plus `LC08_L2SP_146039_20261024_02_T1` and `LC09_L2SP_146039_20261101_02_T1`. `properties.platform` is present (`sentinel-2b`, `landsat-9`). Cloud cover is scene-wide, not local.
3. **Access.** Keyless; no published quota. AUREL's own durable ledger, `.gev-cache/orbit-witness-stac-budget.json` (100/day, 2,000/month, 10/minute, the existing ledger implementation's caps), is reserved before every upstream request and fails closed.
4. **Attribution.** Credit entry "scene records from Element 84 Earth Search". Only item metadata (id, collection, platform, datetime, cloud cover, a ≤64-point footprint) is kept, in the local watch runtime.
5. **Bounds.** One request per check per catalogue, `limit=100`, bbox ≤ 2° per side, 1–14 past UTC days, 2 MiB response cap, 15 s deadline, 10 min response cache, 6 requests per client per minute, `Retry-After` honoured (1 min to 24 h) on 429. Scene watches poll no more often than hourly and only while the app is open and visible, on the FIRMS watch's lease and hidden-page pause.
6. **Tests.** `server/providers/orbit-witness/index.test.mjs` (two fixed hosts, ledger refusal before dispatch, partial/truncated, 429 cooldown, malformed and network failures, query bounds), `src/orbitWitness/sceneWatch.test.mjs` (quiet baseline, dedupe by scene id, outage as unknown, cached repeat, pruning, row bounds), `src/ui/watchlistSceneWatch.test.mjs`.
7. **Explanation.** A missing product reads "not catalogued yet" (under five days) or "no matching product catalogued; a pass is not an acquisition". An outage or partial answer reads "unknown", never "no scene".

## NASA CMR-STAC LPCLOUD (HLS)

1. **Identity.** <https://cmr.earthdata.nasa.gov/stac/LPCLOUD>, `GET /search`, collections `HLSS30_2.0` and `HLSL30_2.0`. The CMR owner was admitted in Phase 4; search needs no Earthdata login. Reviewed 2026-11-07.
2. **Sample.** Same bbox and window: 10 items, for example `HLS.S30.T43RGP.2026298T052909.v2.0` (2026-10-25T05:40:34.715Z, cloud 1) and `HLS.L30.T43RGP.2026305T051832.v2.0` (2026-11-01). No `numberMatched`; a `next` link marks truncation. There is no `platform` property; the product is derived from the id. HLS for the 10-30 and 11-04 Sentinel-2 acquisitions was not yet present, confirming the latency the panel describes.
3. **Access.** Keyless search; no published quota; same local ledger as Earth Search.
4. **Attribution.** Credit entry "NASA CMR-STAC"; NASA open data.
5. **Bounds.** Same as Earth Search.
6. **Tests.** As Earth Search; `src/app/orbitWitnessTools.test.mjs` covers the Chronicle handoff, including "HLS not in CMR yet".
7. **Explanation.** When a scene watch fires, "Open beside the previous scene in Chronicle" runs the existing Chronicle search (31-day window), picks the previous same-product day and the new day, and compares them. If HLS has not caught up, it says so and compares nothing.

## Open-Meteo cloud cover

1. **Identity.** <https://api.open-meteo.com/v1/forecast>, `hourly=cloud_cover`, `forecast_days=14`, `timezone=GMT`. The forecast API was admitted in Phase 3 ([SOURCE-ADMISSION.md](../../phase-3/SOURCE-ADMISSION.md)). Reviewed 2026-11-07.
2. **Sample.** latitude 30.46, longitude 78.06 returned the grid cell 30.4745 N 78.1551 E (elevation 2,041 m), 336 hourly values from 2026-11-07T00:00 to 2026-11-20T23:00 in %, 7,430 bytes. Values at 05:00 UTC were 2% on 9 Nov, 0% on 11 Nov and 89% on 14 Nov. Class `modelled`; it describes the forecast hour, not the scene.
3. **Access.** Keyless, CC BY 4.0, 10,000 calls/day free tier. One variable over at most 14 days keeps the call at one unit. Each call reserves one entry in the **existing** field-context ledger (`.gev-cache/field-context-budget.json`, 100/day, 2,000/month, 10/minute), shared with the Planner; refusal happens before dispatch.
4. **Attribution.** "cloud forecast Open-Meteo (CC BY 4.0)" in the credit entry and on every cloud line's source.
5. **Bounds.** Points rounded to 0.01° for cache and reservation, 60 min cache, stale copy ≤ 6 h on failure (labelled stale), 9 s deadline, 2 MiB cap, `Retry-After` honoured.
6. **Tests.** `server/providers/orbit-witness/index.test.mjs` (one variable, 14 days, cache by kilometre, ledger refusal), `src/orbitWitness/predict.test.mjs` (nearest-hour join, beyond-forecast, unknown).
7. **Explanation.** "{value}% total cloud at <hour UTC>", "Beyond the 14-day forecast" or "Unknown".

## Mission facts

| Spacecraft | NORAD | Swath | Altitude | Citation |
| --- | --- | --- | --- | --- |
| Sentinel-2A/B/C | 40697 / 42063 / 60989 | 290 km | 786 km mean | ESA SentiWiki, [S2 mission](https://sentiwiki.copernicus.eu/web/s2-mission) |
| Landsat 8 / 9 | 39084 / 49260 | 185 km | 705 km | USGS [Landsat 8](https://www.usgs.gov/landsat-missions/landsat-8), [Landsat 9](https://www.usgs.gov/landsat-missions/landsat-9) (**verify** the 705 km figure on the USGS page; the search used here confirmed the 185 km swath from secondary sources) |
| ISS | 25544 | none (no open imaging product) | n/a | NASA |

Sentinel-2A operates in ESA's temporary extension campaign, announced to run to the end of 2026 ([ESA notice](https://sentinels.copernicus.eu/-/sentinel-2a-extension-campaign-prolonged-until-the-end-of-2026)). The footprint uses the nominal swath centred on the propagated ground track; real product edges follow the tiling grid and can stop short of it. The altitude in the HUD and the ride comes from SGP4, not from this table.

## Copernicus Data Space STAC

Not used. It needs a free account, which the plan lists as optional for WP4, and Earth Search plus CMR-STAC proved sufficient for Mussoorie. No account was created.
