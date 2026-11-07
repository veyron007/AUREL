# Phase 3 — no-charge source admission

Reviewed 7 November 2026. This record distinguishes public provider documentation,
small public-endpoint probes, and application policy. No accounts, credentials,
saved keys, paid endpoints, or provider account settings were changed.

## Admitted: selected-place weather and CAMS model context

The user's personal, noncommercial application qualifies for Open-Meteo's public
API. It uses no API key and never switches to a `customer-` endpoint. Official
[terms](https://open-meteo.com/en/terms) publish limits below 10,000 calls/day,
5,000/hour and 600/minute; the [pricing documentation](https://open-meteo.com/en/pricing)
also lists 300,000/month and weighted request units. More than ten variables,
multiple locations/models or long date ranges may consume multiple units.

The new `/api/field-context` route fixes each request to one location, 48 forecast
hours and one provider product. Weather asks for six variables: temperature,
precipitation, precipitation probability, wind speed, gusts and WMO weather code.
CAMS asks for three: PM2.5, PM10 and US AQI, explicitly selecting `cams_global`.
There are no user-controlled hosts, paths, variables, model names or date windows.
Redirects are rejected. There is no paid fallback.

### Hard local admission rules

- A shared, durable ledger reserves **each outbound attempt before dispatch**,
  including attempts that fail. Defaults: 100/day, 2,000/month, 10/minute. Injected
  limits can lower these ceilings, never raise them. UTC periods are explicit.
- Weather and CAMS share this ledger across new field-context middleware
  instances using the same cache path. **Existing regional/weather-effects
  Open-Meteo calls are outside this ledger.** Those adapters remain unchanged;
  all application calls still share the provider's upstream quota. The local
  allowance leaves substantial headroom but is not an all-application quota claim.
- The file `.gev-cache/field-context-budget.json` is atomically replaced after
  file sync; a filesystem lock serializes writers. Missing storage creates a
  ledger; corrupt, oversized or inaccessible existing storage fails closed
  without replacing it. Reversed clocks fail closed. A crash may leave a lock:
  this deliberately blocks new dispatch rather than risking double reservation.
  Remove an orphan lock only after verifying no application process is using it.
  Do not delete the ledger to clear a provider limit.
- The endpoint admits same-site requests only, applies an incoming rate limit,
  permits GET only, and validates bounded latitude/longitude/optional `aq=0|1`.
- Requests coalesce by source and coordinates rounded to five decimal places.
  The response separately retains the original `requested` coordinate, actual
  `queried` coordinate and returned model `grid` coordinate. Grid coordinates
  must not be represented as a surveyed point location.
- At most eight acquisitions are in flight, with a 64-entry bounded cache.
  Weather cache lifetime is 30 minutes; CAMS is 60 minutes. Failed refreshes may
  return explicitly stale data for at most six hours, preserving original
  retrieval and validity times. A stale forecast's individual hours may already
  have expired; consumers must select hours by validity, not by array position.
- Each acquisition and body read has a nine-second deadline and 256 KiB cap.
  No automatic retries. HTTP 429 starts a provider cooldown. Client reads are
  capped at 128 KiB and have a separate deadline/abort signal. A cancelled client
  wait does not cancel a bounded refresh shared with other consumers.

### Scientific and temporal contract

Both products are `kind: forecast`, including current-hour values. They are not
station measurements. `issuedAt` stays null because this API response does not
establish a model issuance time. `retrievedAt` is the successful fetch time;
`validFrom` and exclusive `validTo` describe returned UTC validity hours. Missing
or invalid numerical values remain null. Zero is retained only when supplied.
Provider units must match the requested contract before data are admitted.

Weather resolution is unknown in the normalized record: the best-match model
and downscaling must not be advertised as street-scale sensor resolution.
Wind speed and gusts are m/s, precipitation is mm, probability is percent,
temperature is °C, and weather code is WMO.

[Open-Meteo's CAMS documentation](https://open-meteo.com/en/docs/air-quality-api)
identifies the global pollution model as approximately **45 km** with native
**three-hour** timesteps, updated every twelve hours. The returned hourly series
is not a set of independent hourly observations. This adapter exposes both the
hourly output cadence and native cadence. PM2.5/PM10 remain µg/m³; the index is
explicitly **US AQI**, not CPCB/India AQI. European pollen availability does not
extend to India. Retain Open-Meteo and CAMS attribution and the CC BY 4.0 source
license when saving or exporting model values.

## Observed Dehradun feasibility

Small public probes used Dehradun (30.3165, 78.0322); no user key was read or used.
These demonstrate response availability at the recorded times, not continuing
uptime, forecast accuracy or local station coverage.

- Weather returned a valid model hour `2026-11-06T18:45` UTC and model coordinates
  approximately 30.333918, 77.97186. The request and model cell differ.
- CAMS returned `2026-11-06T18:00` UTC, units, and grid coordinates approximately
  30.300003, 78.0. These were model values, not Dehradun monitoring-station readings.
- The existing [Re:Earth](https://terrain.reearth.land/) point-height service
  returned tileset `mapterhorn-egm08`, version `5`, elevation 651.617 m, geoid
  −43.138 m and ellipsoid height 608.479 m. Route profiles must use the supplied
  elevation value with its source/datum; renderer ellipsoid height differs by
  about 43 m here. Do not apply an additional EGM96 conversion.
- The public [Open-Meteo elevation API](https://open-meteo.com/en/docs/elevation-api)
  returned 652 m at Dehradun and 2,006 m at a Mussoorie sample (30.4598, 78.0644).
  It uses 90 m Copernicus GLO-90, at most 100 points/request. Two samples are not
  a route ascent estimate. Copernicus DEM is a surface model including vegetation
  and structures, with EGM2008 vertical reference; it does not resolve stairs,
  cliffs or safe walking surfaces. [Copernicus dataset documentation](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

## Existing capabilities: reuse, with explicit limitations

### Routes and terrain

The existing FOSSGIS routing proxy already provides a shared one-second outbound
gate, coalescing and a bounded queue. Its operator documents worldwide car, bike
and foot routing, approximately two-day graph updates, attribution/map-fix link,
and no heavy use. It does not establish live closures or current trail safety.
[Operator policy](https://routing.openstreetmap.de/about.html).

Re:Earth is keyless with best-effort availability and possible rate limits.
Its terrain combines open sources; rendering zoom is not native survey
resolution. Preserve its runtime attribution and returned provenance. This
phase does not acquire a bulk terrain archive or change terrain providers.

### FIRMS

The saved FIRMS credential remains unchanged and was not tested in this spike.
NASA provides [free MAP_KEY access](https://firms.modaps.eosdis.nasa.gov/api/map_key)
with 5,000 transactions/ten minutes; larger transactions can cost multiple units.
The [area API](https://firms.modaps.eosdis.nasa.gov/api/area/) supports bounded bbox
queries and 1–5-day windows. With an explicit date the window advances forward;
without a date it covers recent days. The existing adapter currently fetches
three `world/2` VIIRS feeds and caches them for thirty minutes. The new local-context adapter uses bounded area acquisition (maximum two degrees
on each axis), four sensor sources and a trailing 24-hour filter over two UTC days.
It does not start additional global requests. Any upstream 429 stops the remaining
sensor requests and pauses acquisition across all areas for the key. Invalid FRP
rows are rejected, with partial coverage retained; supplied zero remains valid. Detection time, sensor, confidence and
partial/stale state must survive projection. No detections does not mean no fire.

### Dated imagery

Existing CMR/GIBS/HLS adapters are reusable. HLS S30 and L30 are **30 m** products;
S30 is not the native 10 m Sentinel product. Scene cloud percentage cannot be
assigned to an individual street. [HLS product definitions](https://hls.gsfc.nasa.gov/data-products/),
[GIBS access](https://nasa-gibs.github.io/gibs-api-docs/access-basics/).

A bounded CMR S30 search over 77.98,30.26,78.09,30.37 for 8 October–7 November
2026 returned eight matching granules. Newest returned acquisitions were
25 October at approximately 05:40 UTC. One 256-pixel Worldview Snapshots request
for that bbox/date returned HTTP 200, a 173,337-byte PNG and `Data-Present:true`;
the image was discarded. Thus dated imagery was actually available, but it was
not current-day imagery. These free visualization probes do not authorize
unbounded image mirroring. Raw HLS science downloads need Earthdata login.
[HLS access](https://hls.gsfc.nasa.gov/data-access-and-tools/).

### Region packs

**Geofabrik Central Zone contains Dehradun; Northern Zone does not.** This was
checked by fetching the two small official `.poly` boundaries and testing the
Dehradun point. The [Central Zone extract](https://download.geofabrik.de/asia/india/central-zone.html)
listed a roughly 335 MB PBF, with OSM content through 4 November 2026. No extract
was downloaded. A future pack should crop locally from that licensed extract,
retain extract date and ODbL attribution, and use a separate bounded manifest.
The Fieldbook document envelope is not a container for full regional datasets.
Public OSM raster tiles must not be bulk-prefetched for offline packs.

## Not admitted by this work

- OGD/CPCB station AQ: the [official catalog](https://www.data.gov.in/catalog/real-time-air-quality-index)
  inspected still displays a sandbox disclaimer; the production resource,
  entitlement, quota and current Dehradun station observations remain unverified.
- New Copernicus/Earthdata accounts, paid processing endpoints or shared keys.
- New direct Google, TomTom, OpenSky or cloud AI calls.
- Claims of street-level weather/pollution measurements, surveyed elevation,
  real-time imagery, or universal provider uptime.

## Verification

Unit/integration tests cover durable ceilings, simultaneous writers, corruption,
clock reversal, unavailable storage, coordinate validation, fixed hosts, absent
keys, same-site admission, coalescing, partial/stale/unavailable responses,
provider cooldown, response limits, deadline/abort behavior, canonical UTC and
units, model-vs-requested coordinates, and both Vite installation modes. All
transport tests use controlled fixtures; they do not consume live provider keys.
