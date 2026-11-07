# WP7 — Second Source: corroboration cards

Implemented 7 November 2026 on branch `claude/wp7-second-source-c30186`, as
specified in [IMPLEMENTATION-PLAN-02.md §6 WP7](../../IMPLEMENTATION-PLAN-02.md).
Sources are recorded in [SOURCE-ADMISSION.md](SOURCE-ADMISSION.md).

## What it does

Select an earthquake, a FIRMS fire detection or an aircraft, open **Lens →
Evidence**, and a **Second Source** card checks one independent free source
and says one of four things:

| Status | Meaning |
| --- | --- |
| Sources agree within tolerance (fires: "Two sensors detect this fire") | At least one independent source reports the same subject inside the agreement bounds |
| Sources disagree | An independent source reports it, outside the bounds for a named quantity |
| Single source (fires: "One sensor only") | The other sources answered and none independently reports it, or the only match shares an origin with the primary |
| Second source unavailable | No second source could answer (outage, budget refusal, or the other FIRMS family is not loaded) |

Every card carries both statements, whatever its status:

- "Disagreement between sources is normal: agencies and receivers use
  different stations, methods and update times."
- "Agreement is not proof: sources can share inputs or errors, so a match does
  not make a value true."

There is no "verified" badge and no vote. Every number on the card names its
class (observed or derived), its source (for residuals, the pair, such as
"EMSC − USGS"), its unit and its applicable time in UTC.

### Earthquakes (USGS against EMSC and GFZ GEOFON)

Clicking a disc now selects the event (new: `src/layers/earthquakes/selection.js`;
earthquakes previously had no selection path). The server asks EMSC and GEOFON
for a box of 2° and ±180 s around the event. A row is a candidate within 150 km,
±180 s and ±1.5 magnitude units; it agrees within 15 s, 30 km and 0.4 units.
The card shows magnitude, magnitude difference, time offset, position residual
and depth difference, the authoring agency, and a note when magnitude types
differ.

### Fires (VIIRS NOAA-20 against MODIS)

No new request: FIRMS already fetches both families. A detection from the
other instrument family within 2 km and ±60 min, ignoring the display
intensity filter, gives "Two sensors", with position residual (m), time offset
(min) and both fire radiative powers. A second VIIRS satellite is not a second
sensor. A one-sensor fire carries the note that this is common (VIIRS resolves
smaller fires; the satellites pass at different times).

### Aircraft (adsb.fi against adsb.lol and the local receiver)

The server fetches the address from adsb.fi and adsb.lol at the same moment.
Each report's position time is its answer time minus `seen_pos`; the other
report is moved along its own track to the reference instant before the
residual is taken. It agrees within 1 km after alignment, 60 s and 500 ft.
When the local receiver hears the same address, its report joins the card.

## Dependency graph: shared feeders count once

`src/corroboration/dependencies.js` describes which sources share inputs.
Merging relations (`relays`, `feeds`, `shares-feeders`) put sources in one
group; informational ones (`shares-stations`, `same-distributor`) are named on
the card but do not merge, because the observations are separate.

| Edge | Certainty | Effect |
| --- | --- | --- |
| EMSC row authored NEIC/US/USGS → USGS | known, detected per row | EMSC is "same origin as the primary source; not counted" |
| EMSC row authored GFZ → GEOFON | known, detected per row | EMSC and GEOFON count once |
| Local receiver → adsb.lol | declared for this installation | they count once |
| Local receiver → adsb.fi | possible | merges in the cautious count only |
| adsb.lol ↔ adsb.fi ↔ OpenSky | possible (volunteer feeders; overlap not published) | card says "between 1 and 2 independent sources" |
| USGS ↔ EMSC ↔ GEOFON | possible, shares stations | named, not merged |
| All FIRMS satellites | known, same distributor | named, not merged |

The independence count covers only the sources that reported the subject; a
catalogue with no record is not counted.

The live check proved the rule matters: for both of the most recent global
M4.5+ events on 7 November (us7000twqm near Guam; us7000twqw), EMSC's matching
row was the NEIC solution relayed, so the honest result was "Single source",
not agreement.

## Code

| Area | Files |
| --- | --- |
| Server adapters | `server/providers/second-source/` — `ledger.js` (per-source request ledger), `transport.js` (bounded fetch, retries with backoff, cooldown), `adapter.js` (typed ok / empty / partial / stale / unavailable / denied, cache, single flight), `quakeQuery.js`, `emsc.js`, `geofon.js`, `aircraft.js` (adsb.fi and adsb.lol hex), `index.js` (`GET /api/second-source/{quake,aircraft,status}`), `fixtures/` |
| Corroboration core | `src/corroboration/` — `geo.js`, `dependencies.js`, `verdict.js`, `quakes.js`, `fires.js`, `aircraft.js`, `client.js` |
| UI (owner / store / view) | `src/ui/corroborationController.js`, `src/ui/stores/corroboration.js`, `src/ui/views/panels/CorroborationCard.vue`, `src/ui/styles/corroboration.css` |
| Registration seams | `server/providers/local.js` (plugin), `src/ui/views/panels/LensPanel.vue` (one tag), `src/ui/styles/aurel.css` (one import), `src/ui/personalWorkspace.js` and `src/app/personalTools.js` (wiring, plain-data subject subscription), `src/app/layers/earthquakes.js` and `src/layers/earthquakes/index.js` (optional selection), `src/layers/firms/queries.js` (`getCorroborationInput`), `src/layers/localAdsb/index.js` (`getCorroborationRecord`), locale catalogs |

The Lens controller still makes no provider request; the corroboration owner
is separate and talks only to this app's own server.

## Budget and polling

There is no background polling. One check per selection (re-selections of the
same subject are ignored), plus the explicit **Check again** button. Every
upstream request is reserved in its source's ledger before dispatch; a refusal
never reaches the network. Answers are cached in memory (quakes 5 min,
aircraft 8 s) and shared by concurrent callers. `GET /api/second-source/status`
shows each ledger.

## Verification

| Check | Result |
| --- | --- |
| Targeted tests | `secondSource.test.mjs` 13, `corroboration.test.mjs` 14, `corroborationController.test.mjs` 8 — all pass |
| `npm test` | GATE_TEST_RESULT |
| `npm run format:check` | GATE_FORMAT_RESULT |
| `npm run check:boundaries` | GATE_BOUNDARY_RESULT |
| `npm run i18n` | All 11 catalogs complete, 64 new strings each (ar, de, es, fr, it, ja, pt, ru, uk, zh-CN, zh-Hant) |
| QA script | `node scripts/qa-aurel-second-source.mjs` — 19/19 checks pass, twice in a row; [evidence/checks.json](evidence/checks.json) |
| Live browser check | Real USGS feed, real EMSC and GEOFON through the dev server on port 4177 (4173 was in use by another session), 1440×900 and 390×844, most recent global M4.5+ selected by a real click: [live-check.json](evidence/live-check.json), [desktop](evidence/live-quake-desktop.png), [phone](evidence/live-quake-phone.png) |
| Free-only | Policy stays active; QA saw no paid host. Blocked external attempts were basemap and terrain tiles only |
| Configuration | `.env` not read, printed or changed |

QA evidence (labelled fixtures from the recorded samples): the
[quake card](evidence/quake-card-desktop.png) and its
[phone view](evidence/quake-card-phone.png), the
[fire card](evidence/fire-card-desktop.png) and the
[aircraft card](evidence/aircraft-card-desktop.png).

## Limits and open items

- **Aircraft in the browser were checked with a fixture selection event**, not
  by clicking a live aircraft; the live comparison was exercised only through
  the server probes recorded in SOURCE-ADMISSION.md.
- **Fires in the browser use a fixture FIRMS payload** (no `FIRMS_MAP_KEY` was
  read in this work).
- **The local receiver's feed to adsb.lol is declared, not detected.** If the
  owner's receiver does not feed adsb.lol, the edge in `dependencies.js` should
  change to `possible`.
- **NCS solutions reach the card through EMSC** (author `NDI`). Whether EMSC's
  CC BY 4.0 covers relayed NCS solutions is an open question for the owner.
- **GEOFON's event-service licence is not stated**; its rows are view-only.
  GEOFON rarely lists small Himalayan events, so near Dehradun it usually reads
  "No record".
- **adsb.fi is personal, non-commercial only**, and its README names no
  licence (the plan's ODbL entry is unverified). adsb.fi's homepage could not
  be read by an automated fetch.
- The USGS magnitude type is not kept by the earthquake layer, so the primary
  magnitude shows the unit "M".
- The request ledgers are in memory and reset when the server restarts.
- Translations were produced in this session and validated for placeholders
  and completeness, not by native reviewers. The zh-Hant strings use Taiwan
  usage (資料, 接收器), while some older zh-Hant strings lean mainland
  (數據源, 接收機); a translator may want to align them. Where a word is
  identical to English (pt/fr "Magnitude", "Altitude"), the translation adds a
  qualifier ("Magnitude sísmica", "Altitude de vol") instead of listing it in
  `same-as-english.json`.
- Hindi strings are not included; WP8's `hi.json` was not on `main` when this
  branch was cut.
