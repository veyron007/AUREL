# WP3 — Altitude Ensemble and Rain Lane

Delivered 7 November 2026 on branch `claude/wp3-altitude-ensemble-8656b5`.
Sources and their admission: [SOURCE-ADMISSION.md](SOURCE-ADMISSION.md).

## What it does

A Planner checkpoint can open a **mountain-weather sheet**. Nothing is fetched
on mount or on analysis: each checkpoint has an "Open mountain sheet" button,
and the help text under it states the cost (about 14 free Open-Meteo units and
up to 50 NASA GIBS requests).

The sheet, resampled at the checkpoint's elevation:

- **Height.** The route profile's evidenced Mapterhorn/EGM2008 height for that
  checkpoint; for a single place, one terrain lookup; otherwise the provider's
  own 90 m DEM. The source is named on the card, and the request is rounded to a
  50 m band (also the cache key with a 0.01° cell).
- **Three models side by side** (DWD ICON, NOAA GFS, ECMWF IFS 0.25°) at the
  focus hour: temperature at the height, freezing level, low/mid/high cloud,
  visibility, CAPE, 700 and 500 hPa wind (speed and direction), and
  precipitation and snowfall over the following 24 h (Open-Meteo values are
  hour-ending sums, so the total is the 24 stamps after the focus hour). The
  focus hour is the start of the fetched 24 h window: the departure hour when a
  full day after it lies inside the 7-day request (today 00 UTC onward),
  otherwise the current hour, and then the card says "The departure is outside
  the forecast range, so this sheet shows the 24 h from …". Values, totals,
  leads and the ensemble focus day always describe that same window.
  Each column shows its own **run time (UTC)** and **lead**. A variable a model
  does not provide reads "Not provided by this model"; a failed model reads
  "Model missing". A **Spread** column shows the difference between models, with
  the line "Disagreement is information about uncertainty, not a verdict".
- **ECMWF ENS fan** (51 members): per 24 h window ending 03:00 UTC (IMD's
  observation day), median, 10th–90th percentile and "N of 51 members at or
  above X mm on the focus day", with X chosen from 1 mm and the IMD category
  lower bounds (2.5, 15.6, 64.5, 115.6, 204.5 mm).
- **Rain lane**: the three models' 24 h totals, the ENS 10th–90th band with its
  median, the IMERG 24 h observed range and the wettest reanalysis day on one
  square-root axis, against dashed IMD category lines. Observed bars use the
  information colour; modelled bars use brass.
- **Antecedent rainfall, 7 days**: seven complete IMD days from ERA5-Land when
  available, otherwise ERA5 (0.25°), with the window and the reanalysis lag.
- **Observed satellite rain (IMERG)**: the last 24 h for the 0.1° cell, as a
  range read from the published GIBS colormap classes, its IMD daily category
  (or category range), the peak 30-minute rate with its IMD spell category, and
  the count of half-hours without an estimate.
- **Limits on the card**: "Elevation downscaling is statistical … not a summit
  observation"; "Model cells of 0.25° (about 25 km) smooth ridges and cannot
  resolve a cloudburst a few kilometres across"; "IMD categories describe
  observed 24 h totals; they are not warnings. IMD remains the warning
  authority", with links to IMD and to the cited category definitions.
- **Sources, classes and licences** disclosure: every part carries source,
  class (observed | modelled | note), licence, attribution, retrieval time and
  state (ready, partial, stale, empty, blocked, unavailable).

Saving the Planner snapshot stores the sheet with its checkpoint. Fieldbook
renders the same sheet from the saved payload without refetching, and validates
it strictly on save and import (no extra fields, sheet must belong to its
checkpoint, elevation source must match the request). Chronicle gains a fifth
lane, **Precipitation**, listing each saved sheet's IMERG window (observed),
antecedent window (modelled reanalysis) and ENS focus day (modelled) for the
selected place.

No go/no-go, "safe" or "dangerous" wording appears; a unit test scans the sheet
sources for those words and the QA script scans the rendered sheet.

## Ledger weights decided

From Open-Meteo's own `calculateQueryWeight` (commit `cfb443ac`):
`max(1, V/10, V/10 × days/14)`, V = variables × ensemble members.

| Request                                                       | V   | Days | Units    |
| ------------------------------------------------------------- | --- | ---- | -------- |
| Forecast, one model, 13 variables                             | 13  | 7    | 1.3      |
| Ensemble, ECMWF 51 members, precipitation                     | 51  | 7    | 5.1      |
| Historical, ERA5-Land + ERA5 hourly precipitation             | 2   | 15   | 1.0      |
| Run metadata `meta.json` (local policy)                       | —   | —    | 1.0 each |
| **Uncached sheet** (3 forecasts, ENS, historical, 4 metadata) |     |      | **14.0** |

Mountain weather has its own durable ledger (`.gev-cache/mountain-weather-budget.json`,
counted in tenths): ceilings 400 units/day, 6,000/month, 40/minute. GIBS has a
separate request ledger (`.gev-cache/gibs-imerg-budget.json`): 1,000/day,
15,000/month, 120/minute. Every attempt reserves before dispatch, including
retries. The Phase 3 ledger (`field-context-budget.js`) gained a weighted
`reserve(units)`; its own ceilings, file format and behaviour are unchanged.

## Code

New modules:

- `server/providers/mountain-weather/` — `index.js` (route `/api/mountain-weather`,
  projection), `openMeteo.js` (forecast, ensemble, historical, run metadata,
  IMD windows, dataset choice), `imerg.js` (DescribeDomains, colormap, tiles),
  `png.js` (indexed-PNG palette read), `acquire.js` (ledger-first acquisition,
  bounded retries, cooldown, stale cache), `budget.js` (weights and ledgers),
  `mountainWeather.test.mjs`.
- `src/sources/mountainWeatherModel.js` (shared payload schema and validator),
  `src/sources/mountainWeather.js` (same-origin client).
- `src/planner/checkpointSheet.js` (sheet model, IMD categories, forbidden
  words), `checkpointSheetLoader.js` (height resolution, focus hour, immutable
  attach), `precipitationLane.js` (Chronicle rows), `checkpointSheet.test.mjs`.
- `src/fieldbook/mountainWeatherSnapshot.js`; `src/ui/views/panels/CheckpointSheet.vue`;
  `src/ui/styles/checkpoint-sheet.css` (Lamplight tokens only);
  `src/ui/plannerSheet.test.mjs`; `src/testSupport/mountainWeatherFixtures.mjs`;
  `scripts/qa-aurel-mountain-weather.mjs`.

Registration seams touched: `server/providers/local.js` (one plugin),
`server/providers/field-context-budget.js` (weighted reserve),
`src/app/plannerTools.js` (one binding), `src/ui/plannerController.js`
(`loadSheet` action), `PlannerPanel.vue` and `FieldbookAnalysis.vue` (render the
sheet), `src/fieldbook/analysis.js` and `analysisSources.js` (optional
`mountainWeather` on a checkpoint), `src/app/chronicleTools.js`,
`chronicleController.js`, `ChroniclePanel.vue` (precipitation lane),
`src/ui/styles/aurel.css` (one import), `scripts/package-boundaries.json`,
locale catalogs (80 messages × 11 locales). `lamplight.css` and `cyber.css`
are unchanged.

## Verification

VERIFICATION_PLACEHOLDER

## Limits

- Downscaling is Open-Meteo's statistical adjustment (temperature lapse rate
  and land-cell selection); cloud, wind and precipitation are model-cell values.
- IFS is the 0.25° product because the 9 km product has no 700/500 hPa wind;
  IFS has no freezing level or visibility in Open-Meteo; ICON returned no
  visibility over Dehradun in the probe.
- Run time comes from the provider's latest-run metadata, read right after the
  data it labels (metadata at most 5 minutes old) and cached with that data, not
  from the forecast response itself; a run published inside those minutes could
  still make the label one cycle newer than the values.
- A single client can spend the shared minute allowance (40 units) with about
  three uncached sheets; this is a personal tool, so other callers then see
  `minute-limit` until the next minute.
- ERA5-Land precipitation currently returns null from Open-Meteo, so antecedent
  totals use ERA5 (0.25°), about five days behind. The most recent days are
  missing from the antecedent total.
- IMERG values are colormap class intervals from a visualisation product, Early
  run (replaced by Final months later), about six hours behind; a 0.1° cell is
  not a gauge.
- ENS members are 0.25° and native 3-hourly; Open-Meteo's hourly values are
  summed only into 24 h windows.
- A saved sheet is about 1,850 JSON nodes; Fieldbook's 200,000-node document
  limit allows many, but very large projects could reach it.
- WP8's Hindi catalog is not on this branch; the orchestrator must add Hindi
  strings for the 80 new messages when WP8 merges.
