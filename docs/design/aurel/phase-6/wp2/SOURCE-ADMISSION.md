# WP2 Breath — source admission

Reviewed 7 November 2026 against the checklist in
[FREE-DATA-PLAN.md §6](../../FREE-DATA-PLAN.md). This record separates public
provider documentation, small public-endpoint probes made during this work, and
application policy. No account was created, no terms were accepted, and no key
was read, printed, saved or changed. `.env` was not opened.

| Source                                | Verdict                                       | Key                            | Dehradun evidence                                                  |
| ------------------------------------- | --------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| OpenAQ v3 (reference monitors)        | **Admitted, gated on the owner's free key**   | `OPENAQ_API_KEY` (not present) | **Unverified**: no key was available, so no Dehradun sample exists |
| data.gov.in real-time AQI (CPCB)      | **Not admitted** (no adapter built)           | Required, none                 | None: the API refuses keyless requests                             |
| sensor.community (citizen PM sensors) | **Admitted** as a separate, uncalibrated tier | None                           | Probed: **no sensor reporting** within 25, 100 or 250 km           |

## 1. OpenAQ v3

**Identity and use.** OpenAQ, `https://api.openaq.org/v3`, documented at
<https://docs.openaq.org/>. Capability used: reference-grade monitor locations
near a point (`/v3/locations?coordinates=&radius=&monitor=true`), each
location's latest values (`/v3/locations/{id}/latest`), and hourly aggregates
per sensor (`/v3/sensors/{id}/hours`). Intended use: a personal research desk
showing CPCB/UKPCB monitors beside the separate CAMS model card. Policy review
date: 7 November 2026.

**Probe.** A keyless request to `/v3/locations?coordinates=30.3165,78.0322&radius=25000`
returned HTTP 401 with "A valid API key must be provided in the X-API-Key
header." The published OpenAPI document (`https://api.openaq.org/openapi.json`,
version 3.0.0) was read for parameter bounds: `radius` maximum 25,000 m,
`coordinates` truncated to four decimals, `monitor` and `limit` filters.

**Geography, scale, time.** Point query, 25 km radius (OpenAQ's maximum), the
three nearest reference monitors (`isMonitor: true`, not mobile). Low-cost
sensors that OpenAQ also lists never enter this tier. Values are concentrations
in the unit the sensor reports; times are UTC hour ends. **Dehradun station
presence and freshness are unverified** because no key was available. Until the
owner adds a key, Breath shows "needs key", never "clean".

**Authentication, entitlement, quota.** A free API key from
`explore.openaq.org/register` (owner's action, listed first in
IMPLEMENTATION-PLAN-02 §4.3). OpenAQ's rate-limit page publishes free general
use at **60 requests/minute and 2,000/hour**, with `x-ratelimit-*` headers and
HTTP 429 on exhaustion. The key is configured through the existing Provider
Settings path (`src/keySetupCore.mjs`, entry `openaq`, env var
`OPENAQ_API_KEY`, tier `free`), is read only on the server, and travels only
in the `X-API-Key` header. It never reaches the browser or a URL.

**Local ledger (refusal before dispatch).** `server/providers/air-quality/openaq.js`
reuses the durable field-context ledger implementation with its own file,
`.gev-cache/openaq-budget.json`: **100 requests/day, 2,000/month,
10/minute**, each reserved before dispatch, retries and failed attempts
included. A refused reservation returns the typed state `blocked` with the
ledger's reason and makes no request. A 429 starts a cooldown from
`Retry-After` or `x-ratelimit-reset` (60 s to 1 day). A rejected key is
`needs-key`, not an outage.

**Attribution, cache, redistribution.** OpenAQ's terms require source
attribution and forbid using the hosted API to build a product that duplicates
OpenAQ's own offering; a personal desk does not. Licences are per location:
each station card prints the licence names OpenAQ returns (CC BY 4.0 per the
plan; the per-location field is authoritative). Cache: locations 12 h, latest
values 1 h, hourly series 1 h, in memory only; a failed refresh may serve the
cached value for up to 6 h, marked `stale`. Nothing is exported or
redistributed.

**Refresh, bounds, cancellation.** Minimum interval is set by the caches (one
request per resource per hour). Each lookup costs at most 1 + 3 requests; a
Lens index adds at most 7 (one per NAQI pollutant), requested sequentially so a
ledger refusal stops further dispatch. Response bodies are capped at 512 KiB,
requests at 10 s, redirects are rejected, and one retry follows a 500/502/503/504
or network failure. The globe layer asks only when the view centre is inside
India and the view spans at most 3°, so a space-level view spends nothing.

**Tests.** `server/providers/air-quality/openaq.test.mjs` (16 tests) covers no
key, ledger refusal before dispatch (stub and the real durable ledger), monitors
only and nearest first, key only in a header, cache reuse, no-monitor, stale
after 3 h, no-data after 24 h, partial, retry, 429 cooldown, rejected key,
malformed payload, stale cache fallback, per-pollutant series and a mid-series
budget refusal.

**User-facing explanation and fallback.** Typed states each have their own copy
(`no-monitor` says "This does not mean the air is clean"). The free fallback
is the existing CAMS model card, always labelled modelled and never merged.

## 2. data.gov.in real-time AQI (CPCB) — not admitted

**Identity.** Catalog "Real time Air Quality Index from various locations",
Ministry of Environment, Forest and Climate Change, CPCB
(<https://www.data.gov.in/catalog/real-time-air-quality-index>), licence
Government Open Data License – India. The catalog page fetched today shows
"Updated On: 07/11/2026" and, in its footer, still states: "This is a sandbox
environment created for testing and demonstration purposes only. The content,
data, and functionality may be incomplete or inaccurate." The resource page did
not expose a production API resource identifier in its HTML.

**Probe.** A keyless request to the commonly cited resource path
`api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69` returned HTTP
400 "Authorization field missing". The portal's published demonstration key was
not used. No sample, no quota figure and no field semantics (in particular
whether `avg` is a 24 h mean) could be verified.

**Verdict.** Not admitted and **no adapter was built**, following the plan's
out-of-scope rule ("enabling OGD India before its production resource is
verified"). To reopen: the owner creates a data.gov.in key, confirms the
production resource id and that the sandbox notice no longer applies, records
the quota and a bounded Dehradun sample, then an adapter can join
`server/providers/air-quality/` behind the same ledger pattern.

## 3. sensor.community — admitted as an uncalibrated citizen tier

**Identity and use.** sensor.community (Luftdaten) data API,
`https://data.sensor.community/airrohr/v1/filter/area={lat},{lon},{km}`, five
minute means from low-cost optical particle counters (for example SDS011).
Licence ODbL 1.0 (<https://sensor.community/>), attributed on the card.
Intended use: a separate "citizen sensors (uncalibrated)" card. Never an input
to NAQI or US AQI, never coloured as an index, never merged with station cards.

**Probe evidence.**

| Query                                        | HTTP | Rows                   | Newest                  |
| -------------------------------------------- | ---- | ---------------------- | ----------------------- |
| `area=30.3165,78.0322,25` (Dehradun)         | 200  | 0                      | n/a                     |
| `area=30.3165,78.0322,100`                   | 200  | 0                      | n/a                     |
| `area=30.3165,78.0322,250`                   | 200  | 0                      | n/a                     |
| `area=28.6139,77.2090,30` (Delhi)            | 200  | 0                      | n/a                     |
| `country=IN`                                 | 200  | 0                      | n/a                     |
| `area=48.7758,9.1829,5` (Stuttgart, control) | 200  | 254 rows, 67 locations | 2026-11-07 04:10:58 UTC |

The endpoint works (Stuttgart control) but **no sensor in India reported in the
current window**. Dehradun therefore reads "No citizen sensor within 25 km";
that is the honest state, not a fault.

**Authentication and quota.** Keyless; no published quota was found
(**verify**). The adapter caches each 0.001° cell for 5 minutes (the data's
own cadence), caps bodies at 2 MiB and requests at 10 s, honours 429 with a
cooldown, and serves a cached value for up to 2 h marked `stale`.

**Tests.** `server/providers/air-quality/sensor-community.test.mjs` (6 tests):
outdoor-only, nearest first, PM2.5/PM10, cache, `no-sensor`, `stale`,
upstream failure, 429 cooldown, malformed payload, stale fallback, radius
filter.

## No-charge denial

No source in this package has a paid tier on the request path. OpenAQ's paid
"custom" tier is never contacted; the ledger keeps local use far below the free
limits. Free-only policy needs no change: none of the new routes is a blocked
capability, and no saved credential activates anything by itself (no key means
`needs-key`, and with a key the ledger still applies).
