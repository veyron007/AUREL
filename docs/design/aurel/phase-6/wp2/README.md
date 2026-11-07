# WP2 Breath — Indian station air quality

Delivered 7 November 2026 on branch `claude/wp2-breath-air-quality-8267dd`,
following [IMPLEMENTATION-PLAN-02.md §6 WP2](../../IMPLEMENTATION-PLAN-02.md).
Source decisions are in [SOURCE-ADMISSION.md](SOURCE-ADMISSION.md).

## What it does

Breath puts monitoring-station air beside the existing CAMS model without ever
merging them. In Lens, a selected place gets a **Check air here** button. One
press makes one same-site station request and one field-context (CAMS) request;
nothing is requested on load, on selection, or when a watch is saved. The card
shows four separate tiers, each with its class:

| Tier                           | Class    | Source                                    | What is shown                                                                                                                                         |
| ------------------------------ | -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monitoring stations            | observed | OpenAQ v3 reference monitors (CPCB/UKPCB) | Up to three nearest monitors within 25 km: name, distance, network, licence; each pollutant's latest hourly value with unit and UTC measurement time. |
| Indices for the chosen station | derived  | AUREL calculation from station hours      | NAQI (India) and US AQI: value, category, dominant pollutant, averaging basis and its end time, and per-pollutant sub-indices with hours of data.     |
| Citizen sensors (uncalibrated) | observed | sensor.community, ODbL                    | PM2.5 and PM10 five-minute means, distance and time. Never used for an index.                                                                         |
| CAMS model (not a measurement) | modelled | Open-Meteo `cams_global` (Phase 3 route)  | PM2.5, PM10 and US AQI for the model hour containing now, the ~45 km grid, attribution and licence.                                                   |

On the globe, the existing **Air quality** layer now registers an India provider
beside ECCC. When the view centre is inside India and the view spans at most
3°, it shows the nearest monitors' latest hourly particulate value in neutral
grey, labelled "Latest hourly value, not an index". The readout states both
coverages. The layer never colours an hourly value with index bands.

**Watch condition.** From the index card, **Watch this station** saves a
Watchlist entry of the new type `aq-station-threshold`: one monitor, one
pollutant, one NAQI category (Satisfactory to Severe). It is evaluated on that
pollutant's CPCB averaging period (24 h, or 8 h for CO and O3) with the same
completeness rule as the index. It notes a crossing once (below → at or above),
re-arms only after dropping below, honours a six-hour cooldown, deduplicates by
station id and observation hour, starts with a silent baseline, and treats a
data gap as no change, never as a crossing. Monitoring still starts only when
the owner presses Start, pauses while the app is hidden, and checks every
60 min by default (one OpenAQ request per check, cached for an hour).

## States, never "clean"

| Station state                                     | Card copy                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `no-monitor`                                      | "No monitor within 25 km. This does not mean the air is clean."                       |
| `no-data`                                         | "Monitors nearby have reported nothing in the last 24 hours." (monitors still listed) |
| `stale`                                           | "Readings are more than 3 hours old or come from an earlier retrieval."               |
| `partial`                                         | "Some station readings could not be retrieved."                                       |
| `needs-key`                                       | "Add the free OpenAQ key in Provider Settings to see monitoring stations."            |
| `blocked`                                         | "Today's OpenAQ request budget is used up. Try again tomorrow."                       |
| `rate-limited`, `unavailable`, `invalid-response` | "Rate limited" / "Station readings are unavailable right now."                        |

Citizen states are `no-sensor`, `stale` (over an hour old) and the same failure
states. An index with too little data says so ("CPCB needs 16 of 24 hours and
three pollutants including PM2.5 or PM10") instead of guessing.

## Index maths (`src/airQuality/naqi.js`)

- **NAQI**: CPCB 2014 breakpoints for PM10, PM2.5, NO2, SO2, NH3 (24 h means)
  and CO, O3 (8 h means; CO in mg/m³). Linear interpolation inside a band;
  concentrations are rounded to the table's precision first so the published
  gaps (30 → 31) cannot strand a value. A sub-index needs 16 of 24 hours
  (CPCB); the index needs three sub-indices including PM2.5 or PM10 (CPCB).
  "Severe" has no published upper concentration, so it is open-ended and shown
  as `401+` rather than an invented number.
- **US AQI**: EPA 2024 breakpoints (PM2.5 0–9.0 for Good), with EPA truncation:
  24 h PM, 8 h O3 and CO, the newest single hour of NO2 and SO2. 8 h O3 above
  0.200 ppm and 1 h SO2 above 304 ppb are reported as outside the table, as EPA
  defines. This is a trailing 24 h mean, **not** the NowCast and not a calendar
  day.
- **Units**: µg/m³, mg/m³, ppm and ppb; gases convert at 25 °C and 1 atm
  (24.45 L/mol) with stated molecular weights, and the card says so whenever a
  conversion was used.
- **Window**: every pollutant's period ends at the station's newest valid hour;
  flagged, negative, off-hour and duplicate hours are dropped; missing hours
  are never filled.
- **AUREL choices, stated**: the 8 h completeness rule (6 of 8 hours) and the
  trailing-window basis.

## Server (`server/providers/air-quality/`)

- `openaq.js`: keyed adapter with a bounded 25 km, three-station query
  (monitors only), the durable ledger (100/day, 2,000/month, 10/minute,
  reserved before dispatch), one retry on 5xx or network failure, 429 cooldown,
  caches (12 h locations, 1 h latest, 1 h hours), 6 h stale fallback and typed
  states.
- `openaq-model.js`: payload normalizers.
- `sensor-community.js`: keyless citizen adapter, 25 km, 5 min cache.
- `cache.js`: shared TTL cache with coalescing and stale fallback.
- `index.js`: same-site `GET /api/air-quality/near` and
  `/api/air-quality/sensor`, strict query validation and an incoming rate
  limit; registered in `server/providers/local.js`.
- No OGD India adapter: not admitted (sandbox notice, unverified resource).

## Client and UI

- `src/airQuality/stations.js` (payload validation, readings, indices),
  `indiaLayerSource.js` (India provider and composite source), `watch.js`
  (condition, reducer, watch source).
- `src/sources/airQualityStations.js`: same-origin client.
- `src/ui/breathController.js`, `src/ui/stores/breath.js`,
  `src/ui/views/panels/BreathCard.vue`, `src/app/breathTools.js`,
  `src/ui/styles/breath.css` (workspace tokens only; theme files untouched).
- Registration seams touched: `src/layers/airQuality/{model,index}.js`,
  `src/sources/reference.js`, `src/watchlists/model.js`,
  `src/ui/watchlistController.js`, `src/app/{tools,watchlistTools}.js`,
  `src/ui/views/panels/{LensPanel,WatchlistPanel}.vue`,
  `src/ui/styles/aurel.css`, `src/keySetupCore.mjs` (OpenAQ key entry),
  `.env.example` (documentation only), `scripts/package-boundaries.json`,
  `scripts/format-scope.json`, and the 11 locale catalogs (65 new messages
  each).

## Verification

`scripts/qa-aurel-breath.mjs` runs the real UI against a dev server
(`QA_ORIGIN`, default `http://127.0.0.1:4173`) in a fresh browser profile,
serves `/api/air-quality/near` and `/api/field-context` from labelled synthetic
fixtures, aborts every non-local request, and checks 16 behaviours at 1440×900
and 390×844: no request on mount or selection, one request pair per check,
pollutant/unit/time/class on station rows, the NAQI basis text, US AQI shown
separately, citizen sensors labelled uncalibrated, CAMS separate and modelled,
four tiers, a saved watch with no request, selection reset, the "no monitor,
not clean" state, no phone overflow, no request to OpenAQ, data.gov.in or
sensor.community, and no runtime errors. Results and screenshots are in
[`evidence/`](evidence/).

A live keyless call to the running dev server's `/api/air-quality/near` for
30.3165 N, 78.0322 E returned stations `needs-key` (reason `no-key`) and
citizen `no-sensor` from the real sensor.community API.

The gate results (full suite, format, boundaries, i18n) are recorded in
[GATE.md](GATE.md).

## Limits

- **OpenAQ was not exercised live**: no key was available. Dehradun monitor
  presence, freshness and the exact OpenAQ provider and licence names for CPCB
  data are unverified. OpenAQ behaviour is proven against fixtures shaped from
  the published OpenAPI schema.
- sensor.community currently has no reporting sensor anywhere in India.
- OGD India / CPCB direct is not admitted.
- Hourly values on the globe carry no index; indices exist only on the Lens
  card, for one station at a time.
- The watch evaluates one pollutant's sub-index, not the overall NAQI (which
  would cost up to seven requests per check).
- No health advice is given beyond the standard category names; no surface is
  interpolated between stations; citizen sensors are never treated as
  regulatory.
