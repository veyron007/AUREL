# WP8 — Dehradun presets and India housekeeping

Implemented 7 November 2026 on branch `claude/wp8-hindi-dehradun-eb283a`, from `main` at `45efecdc`.

## Scope change: no Hindi interface

[IMPLEMENTATION-PLAN-02.md §6 WP8](../../IMPLEMENTATION-PLAN-02.md) planned a Hindi-first AUREL: a `hi` locale, lakh/crore grouping, IST labels, OSM `name:hi` in search and a Hinglish-to-Devanagari search aid. The owner decided against it during the build ("dont want the app to be in hindi") and then chose to drop every Hindi-specific part, including Devanagari search, and to keep number and time formatting unchanged. None of it was built.

What that means for the rest of the plan:

- No `src/i18n/locales/hi.json` exists. The plan's merge rule ("packages merged after WP8 must also supply Hindi strings") does not apply.
- The search modules (`src/search/*`, `src/sources/nominatim.js`) are unchanged. Hindi aliases already in the Dehradun region pack behave as before.
- `docs/TRANSLATORS.md` is unchanged: no language was added.

## What was built

### Eight Indian city presets

`src/cityPoisIndia.js` holds Dehradun, Mussoorie, Rishikesh, Delhi, Mumbai, Bengaluru, Chennai and Kolkata in the existing `CITY_POIS` row format. `src/cityPois.js` registers them after the nine original cities, so they appear in the Location tray, the HUD's nearest-landmark readout and the camera preset API with no view changes. Each city has five landmarks.

| City      | First landmark            | Ground fallback (m, WGS84 ellipsoid) |
| --------- | ------------------------- | -----------------------------------: |
| Dehradun  | Clock Tower (Ghanta Ghar) |                                  596 |
| Mussoorie | Gun Hill                  |                                1,949 |
| Rishikesh | Ram Jhula                 |                                  296 |
| Delhi     | India Gate                |                                  162 |
| Mumbai    | Gateway of India          |                                  −59 |
| Bengaluru | Vidhana Soudha            |                                  834 |
| Chennai   | Marina Beach              |                                  −85 |
| Kolkata   | Victoria Memorial         |                                  −48 |

- **Coordinates:** WGS84 degrees, rounded to 4 decimals (about 11 m), class `note` (hand-entered from public references, not measured).
- **Ground fallback:** the approximate orthometric height of the city centre plus the EGM96 undulation from `src/data/geoid.js`, class `derived`. It applies only until terrain answers. Coastal values are negative because the geoid lies 50–90 m below the ellipsoid there.
- **Framing:** Google Photorealistic 3D has no mesh over the Doon valley, so the hill presets use longer ranges (900 m or more) and steeper pitches than the photoreal presets.
- **Names:** city names show in the UI language through `src/ui/placeNames.js`, with entries in all 11 catalogs. Where the English form is correct (for example German, French and Italian), the entry is listed in `src/i18n/same-as-english.json`. Landmark names stay as data in English, like every other preset.
- **Voice:** the `fly_to_location` voice schema still enumerates only the original eight IDs (Tallinn was never added either). Voice reaches the new cities through its `query` field.

### Google 3D message that knows about coverage

`src/maps/photorealCoverage.js` holds a coarse outline of mainland India, with vertices accurate to tens of kilometres, and reads the camera's point without importing Cesium. `photorealUnavailableReason` in `src/maps/availability.js` now takes the camera point. `src/mapStackController.js` passes it through `createDefaultMapSources`, which reads it each time the reason is shown.

| Camera position  | Credentials configured                                                                                                           | No credentials                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Over India       | "Google 3D tiles unavailable — this area is likely outside Google's photorealistic coverage. If 3D fails elsewhere too, check …" | "This area is likely outside Google's photorealistic coverage, so a Google key would not add 3D buildings here. Esri and OSM …" |
| Elsewhere / none | unchanged: "… check the key's API restrictions, quota, or network"                                                               | unchanged: "Needs GOOGLE_MAPS_API_KEY …"                                                                                        |

Free-only still shows its own policy reason first. The no-mesh evidence is observed for Dehradun only ([COVERAGE-DEHRADUN.md](../../COVERAGE-DEHRADUN.md)); for the rest of India it is reported, not observed, so the wording says "likely". The plan's acceptance phrase, "outside Google's photorealistic coverage", is contained in both messages.

### Free-only status matches behaviour

`server/standalone/free-only-status.js` used to list `launch-library` under `blockedProviders`, yet `server/providers/local.js` only blanks the optional paid token and launches keep loading. The status now has two lists:

- `blockedProviders`: services Free-only stops (route answers 403, or browser key withheld). These are `google-maps`, `google-maps-server`, `cesium-ion`, `openai`, `gemini`, `tomtom` and `opensky`.
- `pausedCredentials`: optional tokens ignored while the service keeps working. This is `launch-library`.

Provider Settings shows a different note on a paused row: "Token ignored by Free-only — this service still works without a key." The rule lives in `src/providerSettingsPolicy.js`. `server/standalone/free-only-status.test.mjs` proves each blocked entry is enforced. It also runs `/api/launches` through the composed providers with a saved `LL2_API_TOKEN`: under Free-only the request goes out with no `Authorization` header and answers 200, and outside Free-only the token is sent.

### Radio priority surfaced

`RADIO_PRIORITY_COUNTRIES` parsing moved from `server/providers/radio/catalog.js` into `server/providers/radio/priority.js`; `catalog.js` re-exports it. The rules are unchanged: up to 8 ISO alpha-2 codes and 40 reserved stations per country. The key-setup status now carries `radioPriority: {countries, valid, reservedPerCountry}`. It holds country codes only and never echoes a malformed raw value. Provider Settings shows a read-only **RADIO PRIORITY COUNTRIES** row:

- unset: how to set `RADIO_PRIORITY_COUNTRIES=IN` (up to 40 Indian stations), then restart;
- set: the active codes and the per-country reservation;
- invalid: that the radio directory will not start until the value is fixed.

`.env.example` documents `IN` for India. `.env` was not read or changed.

## Verification

| Check                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New tests                                                  | `src/cityPoisIndia.test.mjs` (6), `src/maps/photorealCoverage.test.mjs` (28), `src/providerSettingsPolicy.test.mjs` (10), `server/standalone/free-only-status.test.mjs` (4): 48 tests, all pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm test`                                                 | After merging `main` (`ef0eae9f`, git hook variables kept out of unit tests): 11,474 tests, 11,464 pass, 4 skipped by design, 6 failed under a load average of about 30 (seven sibling sessions): `devCctv` launcher timeouts (2), `analystEngine` 250k-row budget, `geoFileImport` KML process deadline, `radioPanel` RTL-SDR card and `tool-schema-codepoints` bounds. Re-run alone, all five files pass except the KML deadline test, which passes and fails alternately on repeat runs of that one test. WP8 changes none of those modules. An earlier pre-push run also failed `shellToasts.i18n` only because a test had set `core.bare` on the shared repository; with that fixed it passes 124/124. |
| `npm run i18n`                                             | All 11 catalogs complete, 3,622 messages each (15 new: 8 city names, 2 Google 3D reasons, 3 radio lines, the radio row title and the paused-token note)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:boundaries`                                 | Passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run format:check`                                     | Fails on `main` before any WP8 change: `scripts/format-scope.json` lists `src/fieldbook/document.test.mjs` and `src/sources/firmsArea.test.mjs`, which do not exist. With those two entries dropped from a temporary copy (not committed), the check passes for the whole scope. Left for the orchestrator.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scripts/qa-aurel-india.mjs` against `npm run dev` on 4188 | 17/17 pass, evidence in [`evidence/checks.json`](evidence/checks.json). Fresh profile, every off-machine request blocked, offline overview map. Port 4173 was in use by a sibling session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Browser, 1440×900                                          | Location tray lists all eight presets; Dehradun, Mussoorie and Mumbai fly to within 10 km of their first landmark below 15 km height; Mumbai's landmark row shows; Google 3D chip keeps the Free-only reason; Provider Settings shows Launch Library as paused, Google Maps as blocked, the radio row read-only ([dehradun-desktop.png](evidence/dehradun-desktop.png), [provider-settings-desktop.png](evidence/provider-settings-desktop.png))                                                                                                                                                                                                                                                            |
| Browser, `?lang=ru`                                        | The Dehradun pill reads «Дехрадун»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Browser, 390×844                                           | Rishikesh preset flies; search field visible; no horizontal page overflow ([rishikesh-phone.png](evidence/rishikesh-phone.png))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Free-only                                                  | `/api/free-only/status` lists `launch-library` as paused only; no paid browser host attempted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Runtime errors                                             | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Limits

- **Phones cannot open the Location tray.** In AUREL's phone layout, `body.mobile-shell` hides `#location-bar` and the mobile tab bar that would show it renders at zero size. This was true before WP8. The QA script drives the phone flight through the Location controls the tray calls and records the hidden tray as a check. Fixing it needs a mobile-shell layout change.
- **Typed search does not use the presets.** Searching "Dehradun" goes to the geocoder or the offline region pack, not to the preset camera pose. Voice matches landmark names (`findPoiByName`).
- **The India outline is coarse.** Border towns within tens of kilometres of Pakistan, Nepal, Bangladesh or China may be misclassified. Lakshadweep and the Andaman and Nicobar Islands are outside it. If Google adds mesh in an Indian city, narrow the outline in `src/maps/photorealCoverage.js`.
- **Coverage message not seen live.** The Free-only tree withholds Google keys, so the coverage message was verified by unit tests only, not by a failing tileset in the browser.
- **Landmark coordinates are hand-entered** from public references and checked to about 300 m against a second reference list in the test. They are not surveyed.
- **Translations of the 15 new messages** were written for this package without a native reader's review.
