# WP7 Second Source — source admission

Policy review date: **2026-11-07**. Recorded through the
[FREE-DATA-PLAN.md §6](../../FREE-DATA-PLAN.md) checklist. Every probe below was
a single bounded request made by hand from this machine; the fixtures in
`server/providers/second-source/fixtures/` are those answers, unedited.

| Source                                | Decision                                                    | Licence                          | Key                      | Published limit             | Ledger (self-imposed)               |
| ------------------------------------- | ----------------------------------------------------------- | -------------------------------- | ------------------------ | --------------------------- | ----------------------------------- |
| EMSC SeismicPortal fdsnws event       | **Admitted**                                                | CC BY 4.0                        | No                       | None published              | 1 s spacing, 20/min, 500/day        |
| GFZ GEOFON fdsnws event               | **Admitted, view-only**                                     | Not stated for the event service | No                       | None published              | 1 s spacing, 20/min, 500/day        |
| adsb.fi open data (`/api/v2/hex/`)    | **Admitted, personal non-commercial**                       | Not stated (see §3)              | No                       | 1 request/s per IP          | 1.1 s spacing, 20/min, 1,000/day    |
| adsb.lol single aircraft (`/v2/hex/`) | **Admitted** (aggregator already used by the flights layer) | ODbL (existing admission)        | No                       | Existing provider limits    | 1.1 s spacing, 20/min, 1,000/day    |
| FIRMS MODIS beside VIIRS NOAA-20      | **No new request**                                          | NASA open data                   | Existing `FIRMS_MAP_KEY` | 5,000 transactions / 10 min | Existing FIRMS cache; nothing added |
| India NCS (seismo.gov.in)             | **Not admitted**                                            | Unverified                       | —                        | —                           | Not queried                         |

The plan's table listed adsb.fi as ODbL. The adsb.fi open-data README names no
licence at all, so that claim is **unverified** and the app does not repeat it;
the card carries only what the README requires.

---

## 1. EMSC SeismicPortal FDSN event service

**1. Identity, capability, use.** European-Mediterranean Seismological Centre,
SeismicPortal FDSN event web service,
`https://www.seismicportal.eu/fdsnws/event/1/query`. It returns event
parameters: origin time, location, depth, magnitude and type, and the authoring
agency in `auth`. Intended use: one bounded lookup per selected USGS event to
show agreement, disagreement or a single source.

**2. Geography, scale, time; Dehradun evidence.** Global catalogue of
solutions relayed from contributing agencies. Each query is a box of 2°
great-circle radius and ±180 s around the selected event, `limit=20`,
`orderby=time`. Dehradun sample (2026-11-07; 30 days, 5° around 30.3165 N
78.0322 E; one request; HTTP 200, 20,214 bytes, 0.82 s): **37 events**, all
authored `NDI` (India NCS) as relayed by EMSC. The USGS M4.4 of 2026-10-10
14:37:31 UTC near Uttarkashi (`us6000u1f1`) is matched by EMSC
`20261010_0000265` (M4.2, author NDI): time offset −1.2 s, position residual
10.2 km, magnitude difference −0.2 (fixture `emsc-uttarkashi-2026-10-10.json`).
Global example: the Honshu M6.1 of 2026-11-06 (`us7000twg9`), authored `EMSC`
(fixture `emsc-honshu-2026-11-06.json`).

_NCS rows through EMSC._ Rows authored `NDI` are India NCS solutions that EMSC
republishes under its own CC BY 4.0 terms. The app shows them as EMSC with
"Solution authored by NDI" and never queries NCS. Whether EMSC's licence is
meant to cover relayed NCS solutions is an open question for the owner; until
it is settled, the card shows NDI rows on screen only and nothing exports them.

**3. Authentication, entitlement, quota.** No key, no account. No rate limit
or fair-use figure is published on any page read (seismicportal.eu,
terms.html, fdsn-wsevent.html, the emsc-csem.org FAQ); the only stated limit
is 20,000 events per request. Exhaustion: the ledger refuses before dispatch
(state `denied`, reason `budget:*`); a 429, or a 5xx after the retry, opens a
cooldown that honours `Retry-After`, bounded to 5 s–10 min.

**4. Attribution, cache, redistribution.** Data: CC BY 4.0, reuse including
commercial use with attribution (seismicportal.eu/terms.html). Credit on the
card: "EMSC-CSEM SeismicPortal (CC BY 4.0)". The website, services and
databases themselves are not CC BY: mirroring or bulk copying needs written
permission. The app does neither: answers are cached in memory for 5 minutes
(served as stale for up to 1 hour after a failure) and never written to disk.

**5. Refresh, bounds, payload, cancellation, retries.** No polling: one request
per selection or explicit "Check again", shared by concurrent callers. Query
box as in item 2. Body cap 512 KiB; 10 s deadline per attempt; one retry after
600 ms on network failure or 5xx; no retry on 4xx or 429.

**6. Tests.** `server/providers/second-source/secondSource.test.mjs`: query
bounds; parser (valid, malformed row dropped, non-JSON); states ok, empty,
partial (malformed row; truncated at the row limit), stale, unavailable and
denied; denial before dispatch; retry and cooldown.
`src/corroboration/corroboration.test.mjs`: the recorded pairs.

**7. User-facing explanation and fallback.** Every card says "Disagreement
between sources is normal…" and "Agreement is not proof…". On outage the card
reads "Second source unavailable" and the USGS event remains the single
source; nothing crosses a cost boundary.

## 2. GFZ GEOFON FDSN event service

**1. Identity.** GFZ Helmholtz Centre for Geosciences, GEOFON programme, FDSN
event service `https://geofon.gfz.de/fdsnws/event/1/query` (SeisComP fdsnws
1.2.7). `format=text` only: `json` and `geojson` return HTTP 400. Same
intended use as EMSC.

**2. Geography, time; Dehradun evidence.** Global, GFZ's own solutions,
typically M4 and above outside Europe. Same bounded box as EMSC. Dehradun
sample (same 30-day, 5° query): **HTTP 204, no events**. GEOFON does not list
the small Himalayan events NCS reports, so for Dehradun-region quakes GEOFON
will usually read "No record". Global example: Honshu `gfz2026vtjo`, Mw 6.01,
2026-11-06 10:39:28.29 UTC (fixture `geofon-honshu-2026-11-06.txt`). Times
carry no zone designator; FDSN defines them as UTC and the parser appends `Z`.

**3. Authentication, quota.** No key. No rate limit published. Same ledger and
cooldown handling as EMSC.

**4. Attribution, cache, redistribution.** **No licence is stated for the
event service**; the CC labels on geofon.gfz.de apply to waveform networks.
The citation page asks users to mention "GEOFON data centre" and/or "GFZ
Helmholtz Centre for Geosciences". Decision: admitted **view-only**. Rows are
shown on the card with that credit, held in memory (5 min fresh, stale up to
1 h), and not exported or saved to Fieldbook. Redistribution is not stated, so
it is not done.

**5–7.** As EMSC: same transport, tests, wording and fallback.

## 3. adsb.fi open data

**1. Identity.** adsb.fi open data API,
`https://opendata.adsb.fi/api/v2/hex/{hex}`, readsb/ADSBexchange-v2-compatible
JSON (`ac[]`, `now` in milliseconds). Intended use: one lookup per selected
aircraft, compared with adsb.lol and the local receiver. Terms were read from
the README at https://github.com/adsbfi/opendata; adsb.fi's homepage returned
HTTP 403 to an automated reader, so the owner should open it once in a
browser to confirm nothing further is stated there.

**2. Geography, time; Dehradun evidence.** Global, wherever volunteer
receivers hear the aircraft. Query: one 24-bit address. Dehradun sample
(2026-11-07 04:13 UTC; `/api/v2/lat/30.3165/lon/78.0322/dist/100`; one
request; HTTP 200, 7,504 bytes): several aircraft including VT-TNC (A20N) and
VT-ECG (C25A, hex `8014f9`). Hex lookups for `8014f9` from adsb.fi and adsb.lol
4.1 s apart are the fixtures `adsbfi-hex-8014f9.json` and
`adsblol-hex-8014f9.json`: raw separation 471 m; after moving the adsb.fi
report along its own track to the adsb.lol position time, the residual is
18 m (the card rounds aircraft residuals to 10 m and shows 20 m), with
altitude +150 ft. A later live probe the same morning found adsb.fi
had no position for `8014f9` while adsb.lol did, a real single-source case.
An unknown address returns HTTP 200 with an empty `ac` array (fixture
`adsbfi-hex-empty.json`), so lookups do not produce the 404s that count
towards adsb.fi's block.

**3. Authentication, quota.** No key is mentioned. Published: public endpoints
are limited to **1 request per second**; responses with 400, 401, 403, 404 or
429 count towards a temporary IP block. Ledger: 1.1 s spacing (a second
selection inside that window waits up to 1.5 s rather than failing), 20/min,
1,000/day. Invalid addresses are refused before dispatch, so no 4xx is
provoked.

**4. Attribution, cache, redistribution.** README: personal, non-commercial use
only; cite adsb.fi and link to its home page; no licensing, selling, renting or
leasing of the data or service; no warranty; access may be withdrawn. **No
licence is named**; the plan's ODbL entry is unverified. The card shows
"adsb.fi open data for personal, non-commercial use" with a link to
https://adsb.fi/. Cache: memory only, 8 s fresh, stale up to 60 s. Not
exported. AUREL is a personal desk; a shared or commercial deployment must
drop this source or contact adsb.fi.

**5. Refresh, bounds, retries.** No polling; one request per selected aircraft
or "Check again". 512 KiB cap, 10 s deadline, one retry on network error or
5xx, none on 4xx or 429; 429 opens a cooldown honouring `Retry-After`.

**6. Tests.** Parser (millisecond and second clocks, position-time alignment,
rows for other addresses dropped, empty answer), spacing wait, states, route
validation.

**7. Explanation and fallback.** The card states that adsb.fi and adsb.lol may
share volunteer receivers and counts them as between one and two independent
sources. On outage the card reads "Second source unavailable"; the map layer's
own report remains.

## 4. adsb.lol single-aircraft lookup

adsb.lol is already admitted for the flights layer
(`server/providers/aircraft/opensky.js`, `adsb-lol.js`). WP7 adds
`https://api.adsb.lol/v2/hex/{hex}` so that adsb.fi is compared with an
adsb.lol report taken at the same moment. Same ledger shape as adsb.fi; ODbL
attribution as already shown for the flights layer.

## 5. FIRMS MODIS against VIIRS NOAA-20

No new request. `server/providers/firms.js` already fetches `VIIRS_NOAA20_NRT`,
`VIIRS_NOAA21_NRT`, `VIIRS_SNPP_NRT` and `MODIS_NRT` into one cached payload
(30 min TTL; 5,000 transactions per ten minutes per key). The FIRMS layer's new
read-only `getCorroborationInput()` looks for a detection from the other
instrument family within 2 km and ±60 min of the selected one, ignoring the
display intensity filter. "Two sensors" means VIIRS and MODIS both detect; a
second VIIRS satellite is not a second sensor. If the loaded payload holds no
detections of the other family, the card says the second source is
unavailable rather than "one sensor".

## 6. India NCS — not admitted

The seismo.gov.in terms of use are unverified, so NCS is neither queried nor
listed as a source. NCS solutions do reach the card through EMSC (author
`NDI`); see §1.

## Request ledger

`GET /api/second-source/status` returns, per source: limits, requests in the
last minute and day, totals (dispatched, denied, failed, succeeded), any
cooldown with its status, the last denial and the last outcome. The ledger is
in memory and resets when the server restarts; that is a stated limit, not a
budget guarantee across restarts.
