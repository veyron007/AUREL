# Phase 0 — free-only foundation

Implemented 6 November 2026. Existing AUREL work, scene/share formats and saved credentials are retained.

## Runtime policy

The standalone Vite application now defaults to Free-only in dev, preview and browser builds. Google direct, Cesium ion, OpenAI, Gemini, TomTom and OpenSky are paused pending verified entitlement. The policy has no browser or URL switch that silently enables them. Library factories retain their explicit embedding behavior; this policy protects this standalone application, not arbitrary third-party hosts of the library.

Saved environment keys are neither deleted nor rewritten. Provider Settings distinguishes saved credentials from active providers. Restricted browser keys are excluded from builds, stale Google page globals are cleared, and paid providers are not mounted in the standalone server. Places and CCTV receive empty Google credential resolvers, including CCTV's otherwise billable fallback. Launch Library uses public access without its saved paid token; flights use the existing adsb.lol regional fallback.

Unverified capped services fail closed. No account-wide quota or entitlement is claimed. A general persisted quota ledger for admitting such accounts remains future work; none is admitted by this phase. Existing source-specific free-service pacing and limits remain in place.

## Data and geography

Normal HUD shows unknown imagery resolution rather than camera-altitude-derived GSD/NIIRS, uses UTC rather than a claimed image collection time, and removes fictional recording/sensor/mission indicators. Cinematic estimates are explicitly simulated.

Pinned cameras show their actual city, coordinates and distance from viewer position. Navigating elsewhere preserves the pin and its Focus action without presenting it as a camera at the new place.

## Offline overview

Natural Earth II tiles already distributed with Cesium supply a selectable, shareable local overview with local ellipsoid terrain. Esri and OSM failures eventually fall back to this overview. It is low-detail world context, not offline street imagery. The installed local server is still required. Other enabled layers may require internet; fonts fall back if remote font loading is unavailable.

## Validation

Tests cover pre-dispatch denials, dev/preview hooks, saved-key preservation, empty Google resolvers for Places/CCTV, paid plugin omission, OpenSky fallback, public launches, stale browser credentials, map restoration, local map assets, HUD presentation and pinned-camera geography. Focused tests are followed by the full suite, build, package/import boundaries, formatting, translations and browser smoke checks.

Provider credentials have not been validated against external accounts. Free-only guards avoid exercising them. Future account verification must establish no-charge behavior before an optional capped provider is admitted.

### Completed checks

- Full unit suite: 11,024 tests; 11,021 passed, 3 skipped, 0 failures. Two separate Node-24-calibrated allocation probes were not run on Node 26.13.0.
- Production build passed (existing large-chunk advisory remains).
- Import and package boundaries passed.
- Formatting: 1,844 files checked.
- Translation checks: 2,958 messages complete in all 11 locale catalogs.
- Performance suite passed in isolation. An earlier run alongside the full suite/browser failed a timing budget; the isolated rerun passed without changing its budget.
- Headless browser: external browser HTTP requests blocked; local overview rendered in preview without JavaScript errors. Dev Provider Settings showed Free-only, seven paused visible rows and preserved saved-key presence. Desktop/mobile screenshots are under evidence/phase-0/.
- All temporary app servers and QA browsers were closed. No credential values appear in these artifacts.
