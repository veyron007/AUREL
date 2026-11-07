# WP3 — Altitude Ensemble and Rain Lane: source admission

Reviewed 7 November 2026 (probes between 03:40 and 04:30 UTC). This record
follows the [FREE-DATA-PLAN §6](../../FREE-DATA-PLAN.md) checklist for every
source WP3 adds. No account, key, credential, paid endpoint or provider setting
was created, read or changed. Every probe below was a single keyless public
request over Kempty (30.49 N, 78.04 E) or Dehradun (30.3165 N, 78.0322 E);
response bodies were inspected and discarded.

## Summary

| Source                                                                                    | Verdict                                                | Class in the sheet            | Local ledger cost                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- | ------------------------------------------------- |
| Open-Meteo forecast, `models=icon_seamless`, `gfs_seamless`, `ecmwf_ifs025`, `elevation=` | Admitted                                               | modelled                      | 1.3 units per model call (13 variables, 7 days)   |
| Open-Meteo Ensemble API, `ecmwf_ifs025` (51 members), precipitation                       | Admitted                                               | modelled                      | 5.1 units per call                                |
| Open-Meteo Historical API, `era5_land` + `era5`, hourly precipitation                     | Admitted (ERA5 used; ERA5-Land currently returns null) | modelled                      | 1 unit per call                                   |
| Open-Meteo model run metadata (`/data/<model>/static/meta.json`)                          | Admitted                                               | note (run time)               | 1 unit each by local policy, stored with its data |
| NASA GIBS `IMERG_Precipitation_Rate_30min` WMTS tiles + published colormap                | Admitted for colormap-class reads                      | observed (satellite estimate) | 1 request each on a separate GIBS ledger          |
| IMD rainfall categories (SOP, March 2021)                                                 | Admitted as a cited static reference                   | note                          | none                                              |
| ECMWF Open Data ENS GRIB2                                                                 | Not needed (fallback documented)                       | —                             | —                                                 |

## 1. Open-Meteo forecast at the checkpoint's elevation

**Identity and use (item 1).** `https://api.open-meteo.com/v1/forecast`, CC BY 4.0,
already admitted in Phase 3 for the field-context card. WP3 adds fixed request
shapes: one call per model (`icon_seamless`, `gfs_seamless`, `ecmwf_ifs025`), 13
hourly variables (`temperature_2m`, `freezing_level_height`, `snowfall`,
`precipitation`, `cloud_cover_low/mid/high`, `visibility`, `cape`,
`wind_speed_700hPa`, `wind_direction_700hPa`, `wind_speed_500hPa`,
`wind_direction_500hPa`), `forecast_days=7`, `timezone=GMT`,
`wind_speed_unit=ms`, `elevation=<50 m band>`. Use: personal, non-commercial.

**Geography, scale, time (item 2).** Probe at Kempty, `elevation=2000`:
HTTP 200, 16,762 bytes for three models in one call. Observed facts:

- `elevation=` is applied: GFS 2 m temperature at 00 UTC was 10.8 °C with the
  provider's default height (1,446 m, its 90 m DEM) and 7.2 °C at 2,000 m. Open-
  Meteo documents this as statistical downscaling (lapse-rate adjustment plus
  land-cell selection); precipitation, cloud and wind are not adjusted.
- A multi-model call reports one grid coordinate (the first model's). WP3 makes
  one call per model so each column shows its own cell: ICON 30.5, 78.0;
  GFS 30.51741, 78.046875; IFS 30.5, 78.0.
- `ecmwf_ifs025` returns unit `undefined` and only nulls for
  `freezing_level_height` and `visibility`; `icon_seamless` returned null
  visibility for all 72 hours here. These are shown as "Not provided by this
  model", never as zero.
- The 9 km `ecmwf_ifs` model was probed and rejected for the sheet: it lacks the
  700/500 hPa winds. IFS is therefore the 0.25° product.
- Run times are not in the forecast response. `/data/<model>/static/meta.json`
  gives `last_run_initialisation_time` (probe: ICON 2026-11-07 00 UTC, GFS
  2026-11-06 18 UTC, IFS 0.25° 18 UTC, ENS 18 UTC). The sheet labels this as the
  provider's latest run at retrieval; a run that lands between the data request
  and the metadata request can make the label one cycle newer than the values.

**Authentication, quota, exhaustion (item 3).** Keyless. Published free limits:
10,000 calls/day, 5,000/hour, 600/minute, 300,000/month, with weighted units.
The weight formula was verified in the provider's source, not assumed:
`ForecastApiResult.calculateQueryWeight` in open-meteo/open-meteo (commit
`cfb443ac`, 29 July 2026):

    weight = max(1, V/10, V/10 × days/14) per location
    V = variables × Σ ensemble members (ForecastapiController: nVariables =
        params × domains.reduce(countEnsembleMember))

One forecast model call: V = 13, 7 days → 1.3 units.

**Attribution, cache, redistribution (item 4).** "Weather data by Open-Meteo;
DWD, NOAA and ECMWF models", CC BY 4.0, saved with every sheet. Cache 60 min per
model, cell (0.01°) and 50 m elevation band; stale fallback up to 6 h with the
original retrieval time. Saved Fieldbook sheets keep licence and attribution.

**Refresh, bounds, payload, retries (item 5).** On request only (one button per
checkpoint), never on mount or on a timer. One point, 7 days, 512 KiB cap,
9 s deadline per attempt, at most two attempts (network errors and HTTP 5xx
only), 400 ms between attempts, HTTP 429 starts a shared cooldown
(`Retry-After`, minimum 60 s). An upstream failure is remembered for two
minutes, so repeated sheets do not spend budget on it again. Redirects are
refused. Client-side: same-site
admission, 6 requests/minute per client, 12 globally, 256 KiB response cap.

**Tests (item 6).** `server/providers/mountain-weather/mountainWeather.test.mjs`:
weights, ledger refusal before dispatch, missing model → partial, retries and
429, stale, unit mismatch, unsupported variables, query refusal.

**User explanation and fallback (item 7).** The card states that downscaling is
statistical and that 0.25° cells cannot resolve a cloudburst. A missing model
leaves its column "Model missing"; the other two stay.

## 2. Open-Meteo Ensemble API

**Identity (1).** `https://ensemble-api.open-meteo.com/v1/ensemble`, CC BY 4.0,
`models=ecmwf_ifs025`, `hourly=precipitation`, `forecast_days=7`, `elevation=`.

**Sample (2).** Kempty: HTTP 200, 22,833 bytes, 51 series (`precipitation` plus
`precipitation_member01`–`50`), unit `mm`, grid 30.5, 78.0, 72 hours for a
3-day probe. Native step is 3 h (`meta.json` `temporal_resolution_seconds`
10,800); Open-Meteo returns hourly values. WP3 only sums 24 h windows.

**Quota weighting (3) — the open question in the plan, answered.** Ensemble
members multiply V: one variable × 51 members = 51 → **5.1 units per call**
(7 days < 14). Two variables would cost 10.2. This is affordable, so the ECMWF
Open Data GRIB2 fallback is not needed.

**Ledger sizing.** A fully uncached sheet costs 3 × 1.3 (forecast) + 5.1
(ensemble) + 1 (historical) + 4 × 1 (run metadata) = **14.0 units**; further
checkpoints within 5 minutes reuse the metadata (10 units). Metadata is read only
after its data arrives and is cached with that data, so a failed call spends no
metadata unit and cached values never borrow a newer run label. Mountain weather
has its own durable ledger, so it can never starve the Phase 3 field-context
card: `.gev-cache/mountain-weather-budget.json`, counted in tenths of a unit,
with fixed ceilings of **400 units/day, 6,000/month and 40/minute** (4% and 2%
of the published daily and monthly limits). Injected limits may lower, never
raise, them. A three-checkpoint route costs at most 34 units and fits in one
minute. Every attempt, including failed ones, is reserved before dispatch;
corrupt, locked or clock-reversed ledgers fail closed (the Phase 3 ledger code,
extended with a `units` argument). Together with the field-context ledger
(100/day) the local Open-Meteo ceilings stay at 5% of the upstream daily limit;
the older regional/weather-effects adapters remain outside both ledgers, as
Phase 3 recorded.

**Attribution, cache (4).** "Ensemble data by Open-Meteo; ECMWF". Cache 3 h per
cell and band. **Bounds (5)** as §1. **Tests (6)** ensemble refusal before
dispatch, 503 retried twice with both attempts reserved. **Explanation (7)**
the fan shows median, 10th–90th percentile and "N of 51 members at or above
X mm" for a chosen threshold; no probability-of-hazard wording.

## 3. Open-Meteo Historical API (antecedent rainfall)

**Identity (1).** `https://archive-api.open-meteo.com/v1/archive`, CC BY 4.0,
`models=era5_land,era5`, `hourly=precipitation`, fifteen whole UTC days ending
yesterday. Weight V = 1 × 2 = 2 → **1 unit**.

**Sample (2) — a finding.** ERA5-Land precipitation returned `null` for every
day probed: Kempty 1–7 Oct and 25 Oct–6 Nov 2026, 1–7 Aug 2026, 1–3 Aug 2024;
Dehradun Dec 2025, Feb and May 2026; and Berlin Oct 2026. ERA5-Land
`temperature_2m_mean` did return values (22.0 °C at Kempty, 1 Aug 2024), so the
gap is the precipitation variable, not the location. ERA5 (0.25°) returned
values through 1 Nov 2026 (10.7 mm on 29 Oct at Kempty) and null after, a lag
of about five days.

**Decision.** The adapter requests both datasets in one call and uses
ERA5-Land only when it has seven complete IMD days at least as recent as
ERA5's; otherwise ERA5. Days are never mixed between datasets. Totals use
24 h windows ending 03:00 UTC (IMD's observation day). Open-Meteo precipitation
is the sum over the preceding hour, so a window sums the stamps 04:00 … 03:00. The live Kempty sheet
of 7 Nov used ERA5: 17.5 mm for 25–31 Oct (IMD days).

**Quota (3)** 1 unit. **Attribution (4)** "Reanalysis data by Open-Meteo;
Copernicus Climate Change Service (ECMWF)", cache 12 h, stale up to 48 h.
**Bounds (5)** as §1. **Tests (6)** dataset choice both ways, 429 cooldown,
incomplete windows. **Explanation (7)** the card names the dataset and window
and says the most recent days are not yet in reanalysis.

## 4. NASA GIBS IMERG (observed satellite rain)

**Identity (1).** GIBS WMTS `IMERG_Precipitation_Rate_30min`, EPSG:4326 "best",
`2km` tile matrix set, level 5 (40 × 20 tiles of 9°, 512 px). Product: GPM IMERG
V07 half-hourly, Early run (`GPM_3IMERGHHE`) later replaced by Final
(`GPM_3IMERGHH`), 0.1° grid, mm/h. NASA open data, keyless. Display product.

**How values are read (the rule "never guessed from pixels").**

- GIBS WMS has GetFeatureInfo disabled (`WMS request not enabled`), and WMS
  GetMap returns RGBA where "no data" and "< 0.1 mm/h" are both fully
  transparent — unusable.
- WMTS tiles are **indexed-colour PNGs** (colour type 3) with a 222-entry
  palette. The palette index equals the `ref` of the published colormap
  `https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml`
  (ref 0 = no data, ref 1 = `[-INF,0.1)`, ref 2 = `[0.1,0.1059)` … ref 221 =
  `[53.0884,+INF)` mm/h). WP3 reads the palette index at the checkpoint's pixel,
  checks that the palette RGB equals the colormap RGB for that ref, and returns
  that class's interval. Any mismatch is unknown, never approximated.
- Totals are therefore intervals: Σ(low × 0.5 h) to Σ(high × 0.5 h) over 48
  half-hours. A missing half-hour makes the upper bound unknown.
- The latest half-hour comes from GIBS DescribeDomains (probe at 04:15 UTC:
  latest `2026-11-06T22:30:00Z`, about 5¾ h latency). Future times return 404.
- The daily layer `IMERG_Precipitation_Rate` was rejected: Worldview's own
  description says it is "a custom daily imagery product" with "not a specific
  data product that directly corresponds", so its value cannot back a 24 h total.

**Sample (2).** Level-5 tile 6/28 at 22:30 and 12:00 UTC on 6 Nov: HTTP 200,
about 1.6 KB each; the Kempty pixel (343, 313) was ref 1 (< 0.1 mm/h). The live
sheet read 48 tiles: 0–2.4 mm in 24 h for the 0.1° cell centred 30.45 N,
78.05 E (IMD "very light" at most).

**Quota (3).** GIBS publishes no quota. Separate durable ledger
`.gev-cache/gibs-imerg-budget.json`: 1,000 requests/day, 15,000/month, 120/minute.
One sheet uses up to 50 (48 tiles, DescribeDomains, colormap); tiles are cached
6 h and shared by every checkpoint in the same 9° tile, so a Dehradun–Mussoorie
route costs 50 once.

**Attribution (4).** "NASA GPM IMERG V07 … via NASA GIBS; values read from
published colormap classes"; no imagery is stored, only the class intervals.
**Bounds (5).** Four tiles in flight, 256 KiB per tile, 9 s deadline, two
attempts on 5xx; a budget refusal stops further tile requests.
**Tests (6).** Colormap parsing, exact-RGB classification, mismatch, PNG Up
filter, interval totals, missing half-hour → partial, GIBS ledger refusal.
**Explanation (7).** "Satellite estimate read from the published colormap
classes, so totals are ranges. It is not a rain-gauge reading."

## 5. IMD rainfall categories (cited reference lines)

Source: India Meteorological Department, _Standard Operation Procedure —
Weather Forecasting and Warning_, March 2021,
https://mausam.imd.gov.in/imd_latest/contents/pdf/forecasting_sop.pdf
(downloaded once, 22.5 MB, read with `pdftotext`, discarded).

- Table 1.5, "Terminology for intensity of 24 hour accumulated rainfall":
  very light trace–2.4 mm; light 2.5–15.5; moderate 15.6–64.4; heavy
  64.5–115.5; very heavy 115.6–204.4; extremely heavy ≥ 204.5 mm.
- Rainfall spell categories (§5, published in cm/hour; the table header says
  "Range of daily rainfall of a station" but its units are per hour): light
  1 cm/h, moderate 1–2, intense 2–3, very intense 3–5, extremely intense 5–10,
  cloud burst > 10 cm/hour.

These are definitions of observed totals, not warnings. The card links the IMD
site and says "IMD remains the warning authority". No IMD data is ingested.

## 6. Fallback not used: ECMWF Open Data ENS GRIB2

If Open-Meteo's ensemble weighting ever changes upward, the fallback is the
existing GRIB2 byte-range reader (`server/providers/wind/{ifs,decode,grid}.js`):
read the ECMWF Open Data `enfo` `.index` for `tp` at the needed steps, request
only those byte ranges for the 50 perturbed members and the control, and decode
with the existing eccodes path. Not built in WP3 because 5.1 units per call is
within budget.
