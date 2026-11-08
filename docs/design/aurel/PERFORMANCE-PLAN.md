# AUREL performance plan: delivery, startup, data, rendering, interface

**Prepared 8 November 2026.**

**Baseline:** `main` at `1ed80470` (Spatial theme merged and pushed), CesiumJS 1.138.0 as installed, Free-only mode on.
**Operating constraint:** no paid API, no paid hosting, no paid CDN. Every change below uses Node's standard library, the browser platform, or packages already in `package-lock.json`.
**Inputs:** [docs/PERFORMANCE.md](../../PERFORMANCE.md) (the 22 August 2026 hardware baseline), [DATA-QUALITY-PLAN.md](DATA-QUALITY-PLAN.md), a source-map breakdown of a fresh production build, a headless Chrome probe of the running app (section 2), and a read of the working tree.

How to read this document. File references are `path:line` against the baseline and can drift by a few lines. "Probe" means the scripted measurement described in section 2.1. Anything not confirmed by a probe or a direct read is marked **verify**. Each work package (WP) names its files, the change, the tests that prove it, the acceptance numbers and its size (S is under a day, M is two to four days, L is about a week).

---

## 1. Summary

AUREL is already careful in several places: it stops rendering when nothing moves, it pauses polling when the tab is hidden, and its text labels go through one shared canvas. The remaining cost sits in five places.

1. **Everyone runs the development server.** The README, Docker and the local launcher all start Vite in dev mode. A cold load then makes about 1,600 requests and moves 81 MB, including an unminified 14 MB Cesium. The same app built and served takes 351 requests and 14 MB. On a 50 Mbps link this is the difference between 17.2 s and 6.2 s to a usable globe.
2. **The first download carries the whole product.** The 8.0 MB main chunk holds every layer, voice, Director, CCTV, Street Level and all eleven translation catalogs. The translation catalogs alone are about 3.4 MB, which is 43% of the chunk. Cesium loads before it as a 5.7 MB render-blocking script.
3. **Big static layers are built on Cesium's heaviest path.** Submarine cables and datacenters go through `GeoJsonDataSource` and per-feature Entities. With cables, datacenters and fires on, the probe measured 488 MB of heap, 3.8 s of long tasks with a worst single task of 594 ms, and 45 FPS in motion.
4. **Live feeds re-download and rebuild unchanged data.** FIRMS sends about 18 MB of uncompressed JSON on every 10-minute poll although the server refreshes every 30 minutes. Satellites rebuild their whole catalog every 5 minutes although the elements change every 6 hours. Flights issue one aircraft-type lookup per aircraft, about 130 requests on one load. No `/api` response is compressed.
5. **The glass look is drawn every frame.** The Spatial stylesheets hold 54 `backdrop-filter` declarations at up to 40 px blur, and the browser re-blurs them on every frame the globe renders.

The plan runs in six phases. Phases 1 and 2 are mostly configuration and loading order, carry little risk, and deliver most of the startup gain. Phases 3 to 5 remove the steady-state costs. Phase 0 comes first so every claim can be measured.

| Target | Today (probe) | After the plan |
|---|---|---|
| Time to usable globe, 50 Mbps, cold cache | 17.2 s (dev server) / 6.2 s (built) | 4.0 s or less |
| Bytes to usable globe, cold cache | 81 MB (dev) / 14.2 MB (built, uncompressed) | 6 MB or less on the wire |
| Main JavaScript chunk | 8.0 MB (2.6 MB gzip) | 2.5 MB or less (0.8 MB gzip) |
| Heap, empty globe | 79 MB (built) / 187 MB (dev) | 80 MB or less |
| Heap, cables + datacenters + fires | 488 MB | 250 MB or less |
| Long tasks in the first 15 s of that scene | 3.8 s total, worst 594 ms | 1.0 s total, worst 150 ms |
| Motion frame rate, that scene | 45 FPS | 58 FPS or more |
| FIRMS bytes per unchanged poll | about 18 MB | about 200 bytes (a 304) |

### 1.1 Goal and quality bar

**Goal:** by the end of Phase 6, AUREL reaches every target in the table above on the same machine and probe, with no loss of quality. Progress is recorded in section 8 after each phase.

**Quality bar.** No work package lands unless all of these hold. A package that cannot meet them is reverted or redesigned, never merged with a waiver.

1. **Nothing a user sees gets worse at rest.** The Spatial QA screenshots (`scripts/qa-aurel-spatial.mjs`) stay within review, and every visual change while moving is shown before and after.
2. **No feature is removed or hidden.** Every layer, panel, share link, voice command, theme and language keeps working, including from a cold start.
3. **No data is dropped.** Faster paths return the same records. Caching never serves data older than the source's own refresh, and every layer still shows its age honestly.
4. **Every gate is green:** `npm test`, `npm run format:check`, `npm run check:boundaries`, `npm run i18n`, `npm run build`, plus the WP's own tests.
5. **Free-only holds.** No paid API, host or CDN, and no new runtime dependency.
6. **Each change is measured** with the probe or a benchmark, and a regression in any other row is fixed before merge.

---

## 2. Measured baseline

### 2.1 Method

The probe ran in headless Chrome on an Apple M4 through the hardware Metal path (`ANGLE Metal Renderer: Apple M4`), at 1440 by 900 and device pixel ratio 1, with the browser cache disabled. Each scene opened in a fresh browser context. The probe recorded the time until `window.__godsEyeView` existed and the loading screen was hidden, then waited 15 s and sampled the frame rate for 4 s at rest and 4 s while rotating the camera. Long tasks came from a `PerformanceObserver`, transfer from Chrome's network events. The dev server was the one already running on port 4173; the built app was a fresh `vite build` served by `vite preview`.

A rest frame rate of 0 is good news here: the render governor stops drawing when nothing changes. Scenes with flights keep drawing because aircraft interpolate continuously.

This run is not comparable with docs/PERFORMANCE.md row by row: that baseline used an M5, a foreground window and different scenes. Use it only against later runs of the same probe.

### 2.2 Results

| Scene | Server | Ready | DOM ready | Requests | Transfer | Heap | Long tasks (worst) | Rest / motion FPS |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Empty globe over Dehradun | built | 5.9 s | 0.6 s | 351 | 14.2 MB | 78 MB | 0.48 s (168 ms) | 0 / 60 |
| Empty globe over Dehradun | dev | 7.0 s | 1.6 s | 1,594 | 80.9 MB | 187 MB | 0.53 s (297 ms) | 0 / 60 |
| Same, 50 Mbps link | built | 6.2 s | 1.0 s | 353 | 14.2 MB | 79 MB | 0.46 s (159 ms) | 0 / 60 |
| Same, 50 Mbps link | dev | 17.2 s | 12.0 s | 1,592 | 80.8 MB | 174 MB | 0.53 s (252 ms) | 0 / 60 |
| Flights, earthquakes, satellites | built | 6.5 s | 0.5 s | 471 | 14.5 MB | 163 MB | 0.59 s (164 ms) | 60 / 60 |
| Flights, earthquakes, satellites | dev | 6.7 s | 1.4 s | 1,716 | 81.2 MB | 301 MB | 0.57 s (262 ms) | 60 / 60 |
| Cables, datacenters, fires (world view) | built | 6.6 s | 0.5 s | 212 | 49.3 MB | 488 MB | 3.84 s (594 ms) | 0 / 45 |
| Cables, datacenters, fires (world view) | dev | 7.3 s | 1.5 s | 1,450 | 118.5 MB | 625 MB | 4.55 s (593 ms) | 0 / 47 |

Other observations from the same runs:

- **Ready is 6 s even on loopback.** About 1.8 s of that is a fixed splash delay and fade (WP1.5). The rest is Cesium start-up, the first imagery tiles and the bootstrap, which WP0.1 will split into marks.
- **The dev server sat at about 46% CPU** with one tab open and idle, from serving and transforming modules (**verify** with the tab closed).
- **The flights scene issued about 130 `/api/adsbdb/type/<icao24>` requests,** one per aircraft, four at a time (`src/layers/flights/enrichment.js:78-90`, `src/layers/flights/policy.js:220`).

### 2.3 Where the 8.0 MB main chunk goes

From the production source map (sizes are source characters, so they overstate the minified bytes, but the ranking holds):

| Area | Source size | Loaded today | Needed at startup |
|---|---:|---|---|
| Translation catalogs, 11 locales (`src/i18n/index.js:21-31`) | about 3.4 MB | always | only the active locale; none for English |
| `src/data` | 1.4 MB | always | partly |
| `src/ui` and views | 1.6 MB | always | shell yes, panel bodies no |
| `src/voice` | 0.83 MB | always | no, only after the first mic or chat use |
| `src/layers/*` (35 layers) | about 3.5 MB | always | no, only when a layer is turned on |
| `src/scenes` (Director) | 0.19 MB | always | no |
| `src/annotations` | 0.32 MB | always | no |
| Event data (`bhoteKoshiEvent.js` and friends) | 0.21 MB | always | no |
| Vue, Pinia, vue-i18n, satellite.js | 0.94 MB | always | Vue and Pinia yes |

Cesium is not in this chunk. `vite-plugin-cesium` copies it to `/cesium/` and injects `<script src="/cesium/Cesium.js">` into `<head>` with no `defer`. In the built app that file is the minified 5.7 MB (1.7 MB gzip). In dev mode the plugin serves `CesiumUnminified`, 14.4 MB, because `devMinifyCesium` defaults to false (`node_modules/vite-plugin-cesium/dist/index.mjs:10,68`).

---

## 3. Already good: do not redo

- **Idle render governor** (`src/renderGovernor.js:42-72`): request-render mode with named holds, `maximumRenderTimeChange = Infinity`.
- **Hidden-tab suspension** (`src/app/tools.js:298-325`): the render loop and cockpit clouds stop while the tab is hidden.
- **Polling core** (`src/data/lifecycle.js:545-591`): pauses on `visibilitychange`, catches up on return, never overlaps refreshes.
- **One text overlay, no Cesium labels** (`src/overlays/worldOverlay.js`, enforced by `src/noCesiumLabels.test.mjs`), with per-source caps, throttled collision solving and a text-width cache.
- **Primitive collections** for flights, vessels, FIRMS markers, CCTV, bikeshare and traffic; diff-based updates for flights, military and vessels.
- **Satellite propagation** costs about 1.6 ms per second for about 840 satellites, with Starlink spread round-robin; no worker is needed.
- **Server caches and request merging** for OpenSky, adsb.lol, military, CelesTrak, weather and transit. Transit's ETag handling (`src/data/transitProxy.js:24,110-121,296`) is the pattern to copy.
- **Lazy loading that already exists:** egm96, Mapillary, hls.js, the tool catalog, and the bundled JSON packs (`src/data/bundledJson.js`).
- **Stores** use `shallowRef` and `markRaw` throughout; there are no deep watchers.
- **Search suggestions** debounce, cache, abort and guard against stale replies (`src/search/suggest.js`).

---

## 4. Work packages

### Phase 0: measure before changing anything

**WP0.1 Repeatable startup and scene probe (M)**
- **Files:** new `scripts/perf-probe.mjs`, new `scripts/perf-scenes.json`, `package.json` (`perf:probe` script), `scripts/format-scope.json`.
- **Change:** commit the probe used in section 2 with the controls from docs/PERFORMANCE.md: reject software renderers, record the GPU string, fixed viewport, cache disabled, three runs and the median. Scenes live in JSON so new ones need no code. Add an optional `--throttle 50mbps` network profile, and output one JSON line per scene plus a Markdown table.
- **Startup marks:** add `performance.mark()` calls at `cesium-ready`, `viewer-created`, `first-tile`, `bootstrap-done` and `splash-hidden` in `src/main.js` and `src/app/startupChrome.js`, and have the probe report the gaps between them. These marks cost nothing in production.
- **Tests:** unit tests for the scene parser and the median and table output, in the style of `scripts/run-perf-tests.mjs`.
- **Acceptance:** two consecutive runs on the same machine agree within 10% on ready time and heap.

**WP0.2 Bundle budget gate (S)**
- **Files:** new `scripts/check-bundle-budget.mjs`, `build/vite.js:261`.
- **Change:** after `vite build`, read `dist/.vite/manifest.json` (turn on `build.manifest`) and fail when the entry chunk, its static imports or the entry CSS exceed a budget file. Start the budgets at today's sizes and lower them as each WP lands, so nothing slides back. Lower `chunkSizeWarningLimit` from 1500 to 800 once WP2 lands, so the warning means something again.
- **Acceptance:** the gate passes on the baseline and fails when a test adds a 200 KB static import.

**WP0.3 Benchmarks for the hot loops (S)**
- **Files:** new `*.perf.test.mjs` beside FIRMS aggregation, the vessel reconcile pass, `worldOverlayDraw` and the datacenter ingest. Today only `wildlifeSightings` has them.
- **Change:** fixed synthetic inputs (100k fires, 12k vessels, 4,351 datacenter features) with time budgets that run only under `npm run test:perf`, as `scripts/run-perf-tests.mjs` already arranges.
- **Acceptance:** each benchmark records its current number in the test file so Phase 3 and 4 work can show its gain.

### Phase 1: delivery (biggest startup win, lowest risk)

**WP1.1 A served-build launch mode (M)**
- **Files:** `scripts/local-session.mjs:289`, `scripts/docker-start.mjs:130`, `scripts/pinokio-start.mjs:41`, `Dockerfile`, `README.md` (the "Run it" section around line 141), new `scripts/serve-built.mjs`.
- **Change:** add `npm run serve`, which runs `vite build` when `dist/` is missing or older than the source, then starts `vite preview` with the same standalone config. All 49 providers already implement `configurePreviewServer`, so the `/api` routes work unchanged (**verify** with the provider route tests). Make it the default for Docker, Pinokio and `local:start`, and keep `npm run dev` for development. The Docker image runs `npm run build` at image build time.
- **Tests:** a smoke test that starts the served mode on a free port and checks `/`, one hashed asset and three `/api` routes. Rerun `scripts/qa-aurel-spatial.mjs` against it.
- **Acceptance:** requests to a usable globe fall from about 1,600 to about 350, and ready time on 50 Mbps falls from 17.2 s to the built figure.
- **Risk:** the first `npm run serve` takes about 20 s to build. Print that clearly, and skip the build when `dist/` is current.

**WP1.2 Compress every text response (S)**
- **Files:** new `server/standalone/compression.js`, `server/standalone/vite.config.js`, `build/vite.js`.
- **Change:** one `enforce: 'pre'` plugin installing a middleware on both the dev and preview servers. It compresses JSON, JavaScript, CSS, GeoJSON, GeoJSONL and SVG over 1 KB with Brotli (quality 5) when the browser accepts it, otherwise gzip, using `node:zlib`. It must run before the provider routes, because Vite's own preview compression is installed after them and never reaches `/api` (**verify** in Vite's preview server source). Skip responses that are already encoded, event streams, websockets and media.
- **Tests:** a route returning 100 KB of JSON is compressed with `br` and `gzip`, an `image/png` is not, and an event stream still streams.
- **Acceptance:** the FIRMS payload goes from about 18 MB to about 2 to 3 MB on the wire, and the empty-globe transfer falls by at least half.

**WP1.3 Minified Cesium everywhere, and long caching for hashed files (S)**
- **Files:** `build/vite.js:186`, the new compression plugin.
- **Change:** `cesium({ devMinifyCesium: true })` so dev also serves the 5.7 MB build instead of the 14.4 MB one. Serve `/assets/*` (content-hashed) with `Cache-Control: public, max-age=31536000, immutable`, and `/cesium/*` with a version query plus the same header, or `max-age=86400` if a version query is not practical.
- **Acceptance:** a second visit transfers under 1 MB of JavaScript before the globe appears.
- **Risk:** stack traces from Cesium in dev become minified. Keep an opt-out (`GEV_CESIUM_UNMINIFIED=1`).

**WP1.4 Stop Cesium blocking the first paint (S)**
- **Files:** `build/vite.js` (a small `transformIndexHtml` plugin), `index.html`.
- **Change:** add `defer` to the injected Cesium script. A deferred classic script still runs before module scripts, so `window.Cesium` is ready when `src/main.js` runs. The loading screen can then paint while Cesium downloads.
- **Tests:** a build test asserting the tag carries `defer` and comes before the module entry.
- **Acceptance:** the loading screen appears within 1 s on the 50 Mbps profile.

**WP1.5 Remove the fixed splash delay (S)**
- **Files:** `src/app/startupChrome.js:19`, `src/ui/styles/controls.css:388-440`.
- **Change:** measure the 1,000 ms minimum from `performance.timeOrigin` instead of from the end of bootstrap, so a slow start never waits longer. Shorten the 0.8 s fade to 0.3 s. On `transitionend`, remove the loading screen instead of leaving it at `visibility: hidden`, which keeps its `logo-pulse` and `pulse` animations running for the whole session.
- **Acceptance:** about 1.5 s off ready time on every machine, and no running animation on a hidden element (check with `document.getAnimations()`).

**WP1.6 Preload fonts (S)**
- **Files:** `index.html`, `public/fonts/fonts.css`.
- **Change:** `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the Latin Plus Jakarta Sans regular and semibold and JetBrains Mono regular, and inline `fonts.css` into the main stylesheet so it is not a second blocking stylesheet.
- **Acceptance:** no visible font swap on the loading screen in the throttled probe.

### Phase 2: startup bundle

**WP2.1 Load only the active translation catalog (M)**
- **Files:** `src/i18n/index.js:19-40`, `src/ui/i18n.js:30`, `src/i18n/locale.js`, locale tests, `scripts/i18n.mjs` if it imports the catalogs.
- **Change:** replace the eleven static imports with `import.meta.glob('./locales/*.json')`. `setLocale` becomes async: load the catalog, then switch. Before mounting, await only the resolved locale, and skip the wait for English. Give vue-i18n only the active catalog, because it stores catalogs in a deep reactive ref.
- **Tests:** switching locale loads one catalog and re-renders; an unknown locale falls back to English; the existing i18n coverage checks still pass.
- **Acceptance:** about 3.4 MB (about 1.1 MB gzip) leaves the main chunk.

**WP2.2 Build layers on first use (L)**
- **Files:** `src/app/constructCatalog.js:1-40`, `src/data/lifecycle.js`, `src/app/layers/*`, the layer panel and command palette sources that read layer metadata.
- **Change:** split each layer into a small descriptor (id, name, icon, category, default options, URL token) that stays in the main chunk, and a `load: () => import('../layers/<name>/index.js')` that runs the first time the layer is enabled, restored from a share link, or asked for by voice. The lifecycle shows "loading" during the import and catches import failures as a normal layer error.
- **Order:** start with the biggest and rarest layers (CCTV, Street Level, military, traffic, wildlife, launches, transit, radio, SDR/local ADS-B), then the rest. Flights and satellites can stay eager if the probe shows they are on for most users.
- **Boundaries:** descriptors must not import layer internals. Add a rule to `scripts/package-boundaries.json` that fails if `constructCatalog.js` statically imports `src/layers/*/index.js`.
- **Tests:** every layer descriptor loads and registers; a share link with five layers restores them all; turning a layer on twice imports once.
- **Acceptance:** about 3 MB of source leaves the main chunk; layer activation time rises by no more than 150 ms on loopback.

**WP2.3 Load voice, Director and event data on demand (M)**
- **Files:** `src/app/tools.js:5,29,64`, `src/voice/commands.js:2-3`, `src/hud.js:34`, `src/scenes/director.js`, `src/app/constructCatalog.js:39-40`.
- **Change:** load the realtime and Gemini sessions with `import()` on the first mic or chat action, and show a "connecting" state meanwhile. Move `getBasemapLabelContext` out of `gevActions.js` into a small module so the HUD does not pull in 188 KB. Load the Director on the first Authoring panel open or scene import. Load the Bhote Koshi event data when its layer or link is used.
- **Tests:** a voice turn still works from a cold start; a scene link still opens the Director; HUD labels are unchanged.
- **Acceptance:** about 1.2 MB of source leaves the main chunk.

**WP2.4 Lazy panel bodies (M)**
- **Files:** `src/ui/views/LayerPanelsView.vue:9-26`, `src/ui/views/panels/UiPanel.vue:8`, `docs/UI-OWNERSHIP.md`.
- **Change:** load the 13 panel bodies with `defineAsyncComponent`. Keep each panel's header and collapsed geometry in the main chunk, because the rails measure the bodies (`UiPanel.vue:8`). Give each body a fixed placeholder height while it loads.
- **Tests:** rail measurement tests still pass; opening each panel renders its body; no layout jump larger than the placeholder.

**WP2.5 Vendor chunk and CSS split (S)**
- **Files:** `build/vite.js`.
- **Change:** `manualChunks` that puts Vue, Pinia and vue-i18n in a `vendor` chunk, which changes rarely and caches across releases. Load `cyber.css` (76 KB) only when the Cyber theme is chosen, through a `<link>` added at theme switch, because today it is parsed by every user.
- **Acceptance:** main CSS falls from 594 KB by at least 70 KB; switching to Cyber shows no unstyled frame (preload the link on hover of the theme choice).

**WP2.6 Trim stacked theme rules (M)**
- **Files:** `src/ui/styles/lamplight.css`, `src/ui/styles/spatial.css`, `src/ui/styles/spatial-shell.css`, `style.css`.
- **Change:** Lamplight and Spatial both describe themselves as the default and Spatial mirrors Lamplight's selectors, so both apply and override each other. Remove the Lamplight rules that Spatial fully overrides, using a script that compares computed styles on the main surfaces before and after. Keep any rule that Field or Instrument still need.
- **Acceptance:** the Spatial QA script passes with identical screenshots (pixel difference under 0.5%), and main CSS shrinks by at least 30 KB.

### Phase 3: data pipeline

**WP3.1 FIRMS: send nothing when nothing changed (M)**
- **Files:** `server/providers/firms.js:154,264-273,324`, `src/layers/firms/policy.js:7`, `src/layers/firms/ingestion.js:43-47`.
- **Change:** serialize the response body once per upstream refresh and keep it. Add an `ETag` built from `fetchedAt` and the filter, answer `If-None-Match` with 304, and send `Cache-Control: private, max-age=<seconds until the next refresh>`. On the client, skip adapt, sort and raster work when `fetchedAt` has not changed. Later, add a compact columnar format (parallel arrays of latitude, longitude, brightness, confidence and time), which roughly halves the JSON before compression.
- **Tests:** a second request with the ETag gets 304 and no body; a refresh changes the ETag; the client does no work on 304.
- **Acceptance:** two of every three FIRMS polls cost about 200 bytes and no main-thread time.

**WP3.2 Satellites: rebuild only changed groups (S)**
- **Files:** `src/layers/satellites/controls.js:102`, `src/layers/satellites/ingestion.js:87-99,115-160,188-190`, `server/providers/space/celestrak.js:27,127`.
- **Change:** the server adds an ETag and `max-age` per group from its 6-hour cache. The client compares each group's cache time and keeps unchanged groups' points, orbit paths and detection labels. Move the refresh from 5 minutes to 60 minutes.
- **Acceptance:** eleven of twelve refreshes do no rebuild; detection labels no longer flicker on refresh.

**WP3.3 Vessels: filter by area on the server (M)**
- **Files:** `server/providers/vessels/ais-live.js:111-125`, `server/providers/vessels/ais-store.js:260-267`, `src/layers/vessels/policy.js:6`, `src/layers/vessels/ingestion.js:182-188`.
- **Change:** honour the `lat`, `lon` and `radius_km` the client already sends. Keep a sorted snapshot cached for 2 s and shared by all requests, instead of copying and sorting up to 50k rows per request. Then cap rows. Later, support `since=<epoch>` and return only rows updated since then.
- **Tests:** a regional request returns only rows inside the radius; two concurrent requests sort once.
- **Acceptance:** a regional view over India receives hundreds of rows instead of 12,000.

**WP3.4 Earthquakes and slow layers: diff instead of rebuild (S)**
- **Files:** `src/layers/earthquakes/index.js:149-150`, `src/layers/weather/cyclones/rendering.js:91` (**verify** path), `src/layers/launches/ingestion.js:192`, `src/layers/airQuality/index.js:131`.
- **Change:** copy the perimeters pattern (`src/layers/perimeters/index.js:310-315`): compute a snapshot signature from each item's stable id and `updated` time, and skip the rebuild when it matches. When it differs, add and remove only the changed items.
- **Acceptance:** an unchanged earthquake poll does no ground-primitive work.

**WP3.5 Aircraft type lookups in batches (M)**
- **Files:** `src/layers/flights/enrichment.js:78-90`, `src/sources/live/standalone.js:108-118`, `server/providers/aircraft/enrichment.js:16-41,120`.
- **Change:** add `POST /api/adsbdb/types` taking up to 100 ICAO24 codes and returning the known ones from the server cache. The server fetches the unknown ones upstream at its existing pace and the client polls the batch again later. Give the server cache an LRU limit (for example 20,000 aircraft) and evict on write, because today it grows without bound in memory and on disk.
- **Acceptance:** turning on flights makes 2 or 3 enrichment requests instead of about 130.

**WP3.6 CCTV: build the catalog once and cache frames (M)**
- **Files:** `server/providers/cctv.js:153-193,546`, `server/providers/cctv/media.js:638`, `src/layers/cctv/lifecycle.js:170,214-218,468`.
- **Change:** build the source map and the `/sources` body once per catalog refresh, with an ETag. Add a small LRU frame cache keyed by camera and time bucket, merge concurrent requests with the existing `coalesceProxyRequest`, and abort the upstream fetch when the client disconnects. On the client, show the cameras as soon as the catalog arrives, and run ground priors and the health check in parallel, applying them when they land (`applyLateGroundPriors` exists for this).
- **Acceptance:** CCTV cold activation falls from 19.6 s (docs/PERFORMANCE.md) to under 3 s.

**WP3.7 Server disk caches that do not block (M)**
- **Files:** `server/providers/terrain.js:194-205`, `server/providers/aircraft/enrichment.js`, `server/providers/common/boundedCache.js:131-133`.
- **Change:** the terrain height cache rewrites about 9.5 MB with `JSON.stringify` every 15 s whenever it changed, which blocks the event loop for every request. Move it to `node:sqlite`, which the Nominatim gate already uses, with one row per point. Prune bounded caches at most once a minute instead of after every write.
- **Acceptance:** no server event-loop stall over 50 ms during a terrain-heavy Planner session (measure with `perf_hooks.monitorEventLoopDelay`).

**WP3.8 Quiet timers (S)**
- **Files:** `src/layers/localAdsb/feeds.js:196`, `src/layers/localAdsb/index.js:727`, `src/data/lifecycle.js:595-598`, `src/app/layerPresentation.js:20`, `src/hud.js:410,425,430,878`, `src/layers/flights/snapshotRenderer.js:44`.
- **Change:**
  - Pause the local ADS-B poll when the tab is hidden.
  - Replace the per-layer one-second status timers with one shared ticker that skips hidden tabs.
  - Gate the HUD timestamp and REC blink on HUD visibility.
  - Drive the typewriter from CSS instead of a 24 ms publish.
  - Refresh the military registry every 5 minutes instead of every 60 s when the military layer is off.
- **Acceptance:** with the tab hidden, the page runs no timers more often than once a minute (check with a timer-count probe).

### Phase 4: rendering

**WP4.1 Submarine cables off the Entity path (L)**
- **Files:** `src/layers/submarineCables/ingestion.js:12,66,78`, `src/layers/submarineCables/rendering.js:131,166`, `src/layers/submarineCables/overlay.js:298`.
- **Change:**
  - Draw the 1,913 cables as one static `GroundPolylinePrimitive` with a colour per instance.
  - Draw the 1,917 landing points in a `PointPrimitiveCollection` with heights resolved at ingest instead of ground clamping.
  - Draw the reference stems in a `PolylineCollection`, which updates single lines cheaply, instead of Entity polylines whose `setValue` rebuilds the batch.
  - Pick through the primitive instance id and look the record up in one keyed map.
  - Keep one parsed copy of the data, not the raw JSON, the normalized features and a spread copy.
- **Tests:** picking a cable or landing point opens the same card; stems follow the camera sweep; the layer frees all GPU resources on disable.
- **Acceptance:** heap with the layer on falls from 412 MB (docs/PERFORMANCE.md) to under 150 MB.

**WP4.2 Datacenters off the Entity path (L)**
- **Files:** `src/data/localGeojsonCore.js:610,716-731,1293`, `src/data/localGeojsonLod.js`, `src/sources/infrastructureData.js:22-27`.
- **Change:** the same conversion as WP4.1. Each datacenter becomes a point plus a stem at its centroid. Polygon footprints appear only when the camera is close, built as one batched primitive for the features in view. Pre-compute centroids at build time, or parse the `.geojsonl` in a worker. This core is shared with dams and other local GeoJSON layers, so convert behind the existing interface and move one layer at a time.
- **Acceptance:** heap with datacenters on falls from 328 MB to under 120 MB, and the parse leaves the main thread.

**WP4.3 FIRMS heat raster in a worker, without a PNG (M)**
- **Files:** `src/layers/firms/policy.js:64-67`, `src/data/firmsHeatRaster.js:103-126,180-209`, `src/layers/firms/heatImagery.js:43-49`, `src/layers/firms/model.js:205`.
- **Change:** bin, blur and colour the raster in a worker on an `OffscreenCanvas` and transfer an `ImageBitmap` back. Give Cesium the bitmap through a small imagery provider whose `requestImage` returns it, so the 8-megapixel image is never encoded to PNG and decoded again. Use 2048 by 1024 in the world view, where 4096 by 2048 adds no visible detail (**verify** by screenshot comparison).
- **Acceptance:** FIRMS activation falls from 30 s (docs/PERFORMANCE.md) to under 5 s, and no main-thread task over 100 ms during a refresh.

**WP4.4 FIRMS markers with a spatial index (M)**
- **Files:** `src/layers/firms/rendering.js:98-116,138,331-375`.
- **Change:** build a grid index once per payload (in the worker from WP4.3) and query the view from it instead of scanning 100k records. Diff the visible marker set instead of `removeAll()` and re-adding up to 40,000 billboards. Replace the per-billboard colour rewrite in the hand-off fade with one shared value, for example two collections and a collection-level alpha. Use integer cell keys instead of `toFixed` strings.
- **Acceptance:** motion frame rate with FIRMS on rises from 32 FPS to 55 or more.

**WP4.5 Vessels oriented by the GPU (M)**
- **Files:** `src/layers/vessels/rendering.js:39-61,131,291,440`, `src/data/iconOrientation.js:52-91`.
- **Change:** set `alignedAxis` once per AIS update to the heading's world-space tangent and keep `rotation` at zero. The GPU then turns the icons and the per-vessel, per-camera-move rotation work on the CPU disappears. Reuse scratch vectors instead of three new ones per vessel per snapshot. Run the horizon test per spatial cell instead of per vessel. Compare camera poses as numbers instead of a string built every frame.
- **Acceptance:** with 12,000 vessels, motion frame rate rises from 22 FPS to 50 or more.

**WP4.6 Detection overlay without a full-screen CSS filter (S)**
- **Files:** `src/data/detection.js:640-642,875`.
- **Change:** remove `mix-blend-mode: screen` and the `contrast() saturate() drop-shadow()` filter from the full-viewport detection canvas; the compositor redoes them every frame. Draw the glow inside the canvas once per batched `Path2D`, or from pre-rendered glow sprites. Replace the 225 scanline `fillRect` calls per frame with one cached pattern.
- **Acceptance:** detection at 100% rises from 34 FPS to 50 or more, with a visual difference reviewed by screenshot.

**WP4.7 Cached label bitmaps in the text overlay (M)**
- **Files:** `src/overlays/worldOverlay.js:2575-2615`, `src/overlays/worldOverlayDraw.js:661,842,864,881`.
- **Change:** render each label or card once into a small bitmap keyed by text, font, variant and scale, and `drawImage` it each frame. Re-render only when the content changes. Bound the cache by total pixels and evict least recently used.
- **Acceptance:** text draws per frame in the combined stress scene fall from about 50,000 to under 5,000, and its motion frame rate rises from 40 FPS to 50 or more.

**WP4.8 Viewer settings (S)**
- **Files:** `src/app/viewer.js:355-356`, `src/ui/agentDeskCapture.js:87`, `src/voice/realtimeViewport.js:51`, `src/maps/google3d.js:100-102,123-125`.
- **Change:**
  - Turn `preserveDrawingBuffer` off. It adds a full-frame copy to every frame and is only needed for captures. Capture inside a `postRender` callback, or render once and read the canvas at once.
  - Make MSAA adaptive: start at 4 samples and drop to FXAA when the frame-time monitor (WP5.4) reports sustained frames over 20 ms.
  - Lower the 3D tile cache from 1.5 GB plus 1 GB overflow to sizes that fit an 8 GB machine, and set `cullRequestsWhileMoving`.
- **Tests:** agent desk capture and voice viewport snapshots still return the right image.

**WP4.9 Cheaper post-processing (M)**
- **Files:** `src/styles/thermal.js:173-228`, `src/styles/surveillance.js:194-205`, `src/styles/noir.js`.
- **Change:** split the thermal and night-vision blurs into separate horizontal and vertical passes at half resolution, in a `PostProcessStageComposite`, with constant weights instead of `exp()` in the loop. That turns 81 to 121 taps per pixel into about 18. Re-measure Noir before touching it: its shader is a single tap, so its 47 FPS has another cause.
- **Acceptance:** FLIR and night vision hold 58 FPS or more in motion, and screenshots match within review.

**WP4.10 Smaller layer fixes (S each)**
- **Radio** (`src/layers/radio/rendering.js:315-344`): move 750 entities to a `PointPrimitiveCollection`, and remove them on disable instead of hiding them.
- **Traffic** (`src/layers/traffic/animation.js:237-317`, `flowDecode.js`): move the tile decode to a worker. Moving the dot animation onto the GPU is a later step.
- **Map-drawn selection highlight:** keep as is; its colours are pinned by tests (see the Spatial record).

### Phase 5: interface and CSS

**WP5.1 A blur budget for the glass theme (M)**
- **Files:** `src/ui/styles/spatial.css:31,201,234,262,362,386`, `src/ui/styles/spatial-shell.css`, `src/renderGovernor.js`, `src/ui/chromeRest.js`.
- **Change:**
  - One blurred backdrop per group (the dock, the top-bar cluster) instead of one per button.
  - Cap the blur radius at 20 px; at the pane sizes used, 40 px and 20 px look nearly the same (**verify** by screenshot).
  - Swap to the solid pane colour (`--spatial-pane-solid`) while the camera is moving, by setting a `data-camera-moving` attribute on `<html>` from the render governor's holds. Fade back over 150 ms when the camera settles.
  - Honour `prefers-reduced-transparency` with the solid look.
- **Acceptance:** the Spatial theme's motion frame rate matches the Cyber theme's within 2 FPS on the same scene, and the resting look is unchanged in the Spatial QA screenshots.

**WP5.2 Screen annotations without Vue on every frame (M)**
- **Files:** `src/annotations/screenAnnotationRenderer.js:124,651,689,754`, `src/ui/views/ScreenAnnotations.vue` (**verify** path).
- **Change:** in `projectAll`, write the SVG `transform` and `d` attributes straight to the cached elements it already holds. Keep Vue only for adding and removing marks. Replace the `JSON.stringify` of the whole board with a dirty flag, and remove the per-mark `getBBox()` call, which forces layout.
- **Acceptance:** no Vue component update during a camera move with ten annotations on screen.

**WP5.3 Paint-heavy animations and page-wide selectors (S)**
- **Files:** `src/ui/styles/controls.css:1212`, `src/ui/styles/ai-chat.css:1089`, `src/ui/styles/annotations.css:23`, `src/ui/styles/command-dock.css:222`, `src/ui/styles/command-dock-trays.css:453,486`, `src/ui/styles/cockpit.css:165`, `src/ui/chromeRest.js:113-123`, `src/ui/logoGaze.js:155`.
- **Change:**
  - Replace `box-shadow` and gradient-angle animations with `opacity` and `transform` on a pseudo-element.
  - Replace the `body:has(...)` rules with `data-*` flags set from JavaScript.
  - In chrome rest, store the last input time and compare it in one timer instead of clearing and re-arming a timeout on every pointer move.
  - In the logo gaze, read the logo's rectangle once and again only on resize.

**WP5.4 Adaptive quality (M)**
- **Files:** new `src/app/qualityGovernor.js`, `src/app/viewer.js`, `src/ui/visualSettings.js`.
- **Change:** watch frame times while the camera moves. After 3 s of frames over 20 ms, step down in order: MSAA to FXAA, `resolutionScale` 1.0 to 0.85, glass to solid panes, label density one step down. Step back up after 10 s of frames under 12 ms. Show the current level in Settings with a manual override (Auto, High, Balanced, Battery). Never step down while the user is recording or capturing.
- **Acceptance:** on a laptop with integrated graphics, the combined stress scene holds 30 FPS or more instead of dropping below 25.

### Phase 6: guardrails

**WP6.1 Performance in CI (S)**
- **Files:** `.github/workflows/ci.yml`.
- **Change:** run the bundle budget gate (WP0.2) on every pull request. Run the empty-globe probe scene (WP0.1) on a schedule rather than per pull request, because CI runners render in software. Record the result as a build artifact, and only fail on budget size, never on frame rate.

**WP6.2 Update the performance record (S)**
- **Files:** `docs/PERFORMANCE.md`.
- **Change:** after each phase, add a dated section with the probe output on the same machine and scenes, next to the August baseline. Never overwrite earlier rows.

---

## 5. Order, parallel work and effort

| Phase | WPs | Effort | Depends on | Can run in parallel with |
|---|---|---|---|---|
| 0 | 0.1 to 0.3 | about 3 days | nothing | nothing (comes first) |
| 1 | 1.1 to 1.6 | about 4 days | 0.1 | Phase 3 server work |
| 2 | 2.1 to 2.6 | about 2.5 weeks | 0.2, 1.1 | Phase 3 |
| 3 | 3.1 to 3.8 | about 2.5 weeks | 0.3, 1.2 | Phases 2 and 4 |
| 4 | 4.1 to 4.10 | about 4 weeks | 0.3 | Phase 3; 4.8 waits for 5.4's monitor |
| 5 | 5.1 to 5.4 | about 1.5 weeks | 0.1 | Phase 4 |
| 6 | 6.1, 6.2 | about 1 day | 0.1, 0.2 | runs last, then continuously |

If only one week is available, do WP1.1 to WP1.5, WP2.1 and WP3.1. Together they take about 11 s off a remote cold start, cut the first download by roughly three quarters and stop the largest repeated transfer, with almost no change to rendering code.

The parallel tracks do not touch the same files: Phase 3 is mostly `server/` and layer ingestion, Phase 4 is layer rendering, Phase 5 is CSS and annotations. WP2.2 touches every layer's entry point, so schedule it before or after Phase 4's layer work, not alongside it.

---

## 6. Risks

- **Served-build mode hides edits.** Someone editing code while running `npm run serve` will not see changes. The launcher must say which mode it is in, and `npm run dev` stays the development path.
- **Lazy layers can break share links and voice.** A link or voice command that names a layer must await its import. WP2.2's tests cover share links; add a voice test that enables a cold layer.
- **Compression and streaming.** A compression middleware that buffers would break event streams and the realtime voice proxy. WP1.2 skips them explicitly and tests one.
- **Visual drift.** WP4.6, WP4.9 and WP5.1 change how things look while moving. Each needs before-and-after screenshots reviewed by a person, not only a pixel threshold.
- **Cesium internals.** WP4.3's custom imagery provider and WP4.5's `alignedAxis` behaviour depend on Cesium details to **verify** against 1.138's source before building.
- **Memory numbers vary with live data.** FIRMS and AIS counts change hourly. Record counts with every probe, as docs/PERFORMANCE.md already requires.

---

## 7. Not established yet

- No measurement on Windows, on a phone, or on a machine without a discrete-class GPU. WP5.4 assumes integrated graphics behave like the M5 rows in docs/PERFORMANCE.md scaled down, which needs a real run.
- The vessel and CCTV figures come from docs/PERFORMANCE.md, not from this probe; AIS needs a key and CCTV was not enabled here.
- The split of the 6 s loopback ready time beyond the splash delay is estimated until WP0.1 adds start-up marks.
- The dev server's idle CPU use was seen once and not traced to a cause.

---

## 8. Progress against the goal

| Phase | Status | Measured result | Commits |
|---|---|---|---|
| 0 Measure | not started | | |
| 1 Delivery | WP1.1 to WP1.6 landed | Empty globe, cold cache, same probe: dev server 1,594 requests, 80.8 MB, ready 6.9 s (17.3 s at 50 Mbps); `npm run serve` 295 requests, 11.9 MB, ready 3.8 s (4.3 s at 50 Mbps). Served build before this phase: 351 requests, 14.2 MB, ready 6.1 s. About 7 MB of the remainder is remote terrain and imagery. Most of the ready gain is WP1.5: the cover waited for the start-up share flight (a fixed 1.5 s delay plus a 3 s `flyTo` no one could see), so the start-up restore now lands at once and the cover lifts when the destination's tiles report loaded (capped at 2 s, `src/app/startupView.js`); app-ready to cover-hidden fell from about 4.4 s to about 2.2 s with an identical reveal frame. | `worktree-agent-a01e7c00e67b2833d` |
| 2 Startup bundle | WP2.1, WP2.2 (10 of 35 layers), WP2.5, WP2.6 landed; WP2.3 and WP2.4 not started | Entry JS 8,053 KB → 4,186 KB (2,624 → 1,319 KB gzip), plus a 110 KB vendor chunk; entry CSS 605 KB → 532 KB. Same probe, main and branch back to back on a loaded machine: empty globe ready 3.6 s → 3.7 s (loopback ready is dominated by the cover's tile wait), transfer 11.9 → 11.2 MB, heap 75 → 67 MB. WP2.3 needs facades for the voice session adapter and the Director, which are built synchronously at start-up; WP2.4 was not attempted: start-up wiring that reads panel markup by id must be ruled out first (**verify**). | `worktree-agent-a57f2250d14c79336` |
| 3 Data pipeline | not started | | |
| 4 Rendering | not started | | |
| 5 Interface | not started | | |
| 6 Guardrails | not started | | |
