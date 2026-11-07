# WP1 Kshitij — source admission

Reviewed 7 November 2026 against the [FREE-DATA-PLAN.md §6](../../FREE-DATA-PLAN.md) checklist. No account, key, saved credential, paid endpoint or `.env` value was read or changed. Probes were small, keyless HTTPS requests from the build machine.

| Source                                     | Decision                                                | Used for                                                     |
| ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ |
| Copernicus DEM GLO-30 Public (AWS Open Data) | **Go**: admitted                                        | Near and far field of the horizon (0–200 km)                 |
| OSM `natural=peak` via Geofabrik Central Zone | **Go**: new `peaks` theme on the Phase 5 admitted extract | Naming summits on the skyline                                |
| Local ephemeris (NOAA solar equations, Almanac lunar series) | **Go**: no dependency added                  | Sun and Moon positions, rise/set, shadow                     |
| Mapterhorn / EGM2008 point heights         | Unchanged (Phase 3); **not** used by the horizon        | Planner route profiles only                                  |
| GeoNames feature class T                   | **Not used** in WP1                                     | Fallback gazetteer was not needed for Dehradun               |
| Open-Meteo cloud cover / visibility        | **Not delivered** in WP1                                | The separate "will it be clear" card is left for later        |

## 1. Copernicus DEM GLO-30 Public

### 1. Identity, capability, intended use

- Dataset: Copernicus DEM, instance GLO-30 Public (COP-DEM_GLO-30-DGED, 2021 release), a radar **digital surface model** derived from WorldDEM (TanDEM-X acquisitions 2011–2015). Registry entry: <https://registry.opendata.aws/copernicus-dem/>; bucket readme: <https://copernicus-dem-30m.s3.amazonaws.com/readme.html>; managed by Sinergise for AWS Open Data.
- Capability used: keyless HTTPS byte-range reads of Cloud Optimized GeoTIFFs. The bucket answers unauthenticated `GET` with `Accept-Ranges: bytes` and S3 ETags.
- Intended use: a personal, local horizon computation. Derived horizon angles, times and peak classifications are shown and saved; raw tiles are cached locally and never redistributed.

### 2. Geography, scale, time; Dehradun sample

- Tiles are 1° × 1°, named by the south-west corner: `Copernicus_DSM_COG_10_N30_00_E078_00_DEM/Copernicus_DSM_COG_10_N30_00_E078_00_DEM.tif`. Below 50° latitude a tile is 3600 × 3600 float32 pixels at 1″ (≈ 30 m), origin at the north-west corner (`[78, 31]` for N30E078), WGS 84 geographic, heights in metres (EGM2008 geoid per the product specification). Above 50° the column count shrinks (2400, 1800, 1200, 720, 360) as listed in the readme; the sampler takes the band from the tile's latitude.
- Each COG has three overviews (½, ¼, ⅛ = 1800, 900, 450 px), **averaged**. Measured: the level-3 pixel at (200, 100) of N30E078 equals the mean of its 8 × 8 level-0 block (1554.35 m); its max was 1602 m. Internal tiling is 1024 px; DEFLATE with floating-point predictor (Compression 8, Predictor 3).
- No GDAL nodata is declared. The readme states that ocean tiles do not exist and should be read as 0 m; GLO-30 Public also omits tiles the programme has not released (Armenia, Azerbaijan and Moldova were released in the 2023_1 delivery).
- Applicable time: the TanDEM-X acquisition period 2011–2015, not the retrieval date. Every result states this.

**Dehradun sample (actual, 7 November 2026, empty cache).** Pin 30.4597 N, 78.1058 E (the brief's Lal Tibba coordinate), radius 200 km:

| Measure | Value |
| --- | --- |
| Tiles read | 25 (N28–N32 × E076–E080); 35 blocks across levels 0, 2 and 3 |
| Transfer | 34,836,928 bytes in 164 range requests; 65 s cold |
| Second read | 0 bytes, 0 requests (disk cache); 2.7 s, byte-identical grid |
| Local cache | 25 MB of Int16 blocks under `.gev-cache/horizon-dem/` |
| Void samples / absent tiles | 0 / 0 |
| DEM surface at the pin | 1,989 m (bilinear, level 0) |
| Highest DEM cell within ~2 km | 2,297 m at 30.4632 N, 78.0957 E: the given pin is about 1 km ESE of the Landour summit, on its slope |
| Sample ETag | `Copernicus_DSM_COG_10_N30_00_E077_00_DEM` → `"c006afc3205c54512de915c03c982c14"` |

### 3. Authentication, entitlement, quota

- No authentication, account or key. Public bucket; the data owner pays storage and egress under AWS Open Data. No quota is published. The app imposes its own ceilings (below) and a 12 requests/minute per-client route limit.
- Exhaustion behaviour: HTTP 429 or 503 from the host maps to a `rate-limited` error and a "try again later" message; there is no fallback that crosses a cost boundary.

### 4. Attribution, caching, redistribution

- Licence: the Copernicus DEM licence (free of charge, worldwide, any use including commercial) linked from the registry. Required notice for adapted data, shown on every result card, Fieldbook snapshot and MCP envelope: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".
- Cache: decoded Int16 blocks are kept on disk with no expiry (the 2021 release is static), bounded at 320 MB with oldest-first eviction, and in memory at 160 MB. Cached tiles are not exported, bundled or redistributed. Fieldbook stores only derived values (360 whole-degree angles and distances, times, peaks).

### 5. Refresh, bounds, payload, cancellation, retries

- Bounded query: one observer, radius 10–200 km (integer), coordinates within ±85° latitude, five-decimal rounding. Each request has a **96 MiB and 400-range budget**; a slice over 8 MiB is refused.
- Host allow-list: only `https://copernicus-dem-30m.s3.amazonaws.com/<tile>/<tile>.tif`, where the tile name matches `Copernicus_DSM_COG_10_[NS]dd_00_[EW]ddd_00_DEM`. Redirects are rejected. Only exact `206` responses with a matching `Content-Range` are accepted, and the first ETag is pinned with `If-Match`.
- Single-flight per block and per query, an eight-query memo, and no retry loop: a failed block fails the request with a stable error.
- Payload to the browser: a polar grid of 720 rays × 522 samples as base64 Int16 (≈ 1.0 MB JSON).

### 6. Tests

`server/providers/horizon/horizon.test.mjs` covers tile naming and URL admission, the byte budget, exact-206 acceptance and refusal of a `200` full-file answer, 404 → absent tile (remembered, nothing cached), block planning, the polar sampler with an absent tile read as 0 m and a max-pooled synthetic summit, strict query parsing, and middleware 400/405/503 mapping. `src/horizon/horizon.test.mjs` covers void handling in the ray-march.

### 7. User-facing explanation and fallback

The card states that the first horizon for an area reads about 30 MB of DEM tiles and later ones use the local cache. It shows the DEM source, applicable time, void count, absent-tile count and attribution. If the DEM cannot be read the card shows the error and nothing else changes; Planner, Lens and Fieldbook keep working. **Mapterhorn is not a usable fallback for the horizon.** Its point API serves 64 points per request at a measured 87–186 ms per point, and one horizon needs about 376,000 samples. The brief's fallback was considered and rejected on that measurement, and the Phase 3 Planner profile path is left unchanged.

## 2. OSM peaks theme (`public/regions/dehradun-peaks/`)

1. **Identity.** OpenStreetMap nodes tagged `natural=peak`, read from the Phase 5 admitted Geofabrik Central Zone extract (header `2026-11-05T21:23:02Z`, SHA-256 `b6eaf4f9…eaeb`, the same file as `dehradun-core`). Keys kept: `name` (or `name:en`), `name:hi`, `ele`.
2. **Geography.** Extent `[75.95, 28.5, 80.15, 32.15]`: Dehradun ± the 200 km horizon radius. Central Zone covers Uttarakhand and Uttar Pradesh, so Himachal Pradesh, Nepal and Tibet peaks are absent; this is listed in the manifest limitations. The actual build has 350 named peaks (210 with a usable metre `ele`, 6 with `name:hi`), plus 225 unnamed peaks counted but not listed, in 36,886 bytes. It includes Bandarpunch I (`ele` 6316), Swargarohini, Gangotri I–III, Jaonli, Kedarnath, Chaukhamba I–IV, Kamet and Nanda Devi (`ele` 7816, `name:hi` नंदा देवी).
3. **Authentication.** None; local file built offline. The builder never downloads.
4. **Licence.** ODbL 1.0, © OpenStreetMap contributors, with `LICENSE.txt` and manifest provenance beside the data. It is shown on every peaks list and envelope.
5. **Bounds.** The core pack's caps apply unchanged: 10,000 features and 4 MiB. The extent cap for this theme is 500 km per side, because a skyline gazetteer needs the horizon radius; the core pack keeps its 10 km side. `ele` is admitted only as an unambiguous metre number from -500 to 9000; feet, ranges and words become unknown.
6. **Tests.** `src/regions/peaks.test.mjs` covers reproducible hashes, caps, tamper, extent and out-of-extent refusal, and the bundled pack verifying with the expected extract hash and summits.
7. **Explanation.** OSM `ele` is shown beside the DEM summit height on every row. Names and elevations are labelled community data (class `note`). If the gazetteer cannot be verified the horizon still computes and the list reads "No peak gazetteer covers this place."

## 3. Local ephemeris

- Sun: NOAA solar calculator equations (after Meeus, *Astronomical Algorithms*). Moon: the Astronomical Almanac low-precision series (section D), with topocentric parallax. Refraction is Saemundsson's formula, scaled for observer altitude by a standard atmosphere for terrain-clipped events. Astronomical times use the Planner's existing `calculateDaylight` (USNO, standard −0.833°), so Planner and Kshitij agree.
- No package was added (`astronomy-engine` and `suncalc` were not needed), so `THIRD_PARTY_NOTICES.md` is unchanged.
- Reference checks in `src/horizon/ephemeris.test.mjs`: the Sun matches Meeus Example 25.a within 0.002° (measured: 1e-5°). The Moon matches Example 47.a within 0.3° in longitude (measured 0.09°). The solar altitude matches the existing USNO routine within 0.02° at Lal Tibba, and the equation of time matches its February and November extremes.
