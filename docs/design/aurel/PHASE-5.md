# Phase 5 — Offline use, explicit automation and release hardening

Implemented 7 November 2026. This release extends the same AUREL application; it does not replace existing scenes, imports, camera ownership or credential storage.

## Delivered workflows

### Inspect a bounded part of Dehradun offline

Open **Library → Offline region**, preview the source date, extent and size, then explicitly enable the pack. Search locally for **Clock Tower** or **Rajpur Road** and choose a result to inspect. Enabling does not move the camera; framing a result is a separate action. Disable/remove releases this pack through the existing importer and preserves other imported files.

The included OSM-derived core covers `[78.022,30.312,78.05,30.34]` and contains 8,647 features: 6,984 building footprints, 1,460 roads, 18 water features and 185 named points. There are 318 indexed names. Geometry and index total 3,368,870 bytes. Only one building has an admitted height; the others remain unknown. This is a bounded local map, not a free photorealistic digital twin of the entire city.

The locally installed server must remain running for offline browser use. Fonts, overview globe, project storage and the region pack need no internet. Remote imagery, live feeds and remote terrain do. The pack is admitted with size, hash, geometry, source and license checks before rendering. Regeneration stages and verifies output before publication, retains rollback data on publication failure, and never bulk-downloads rendered map tiles. See [source and regeneration details](phase-5/REGION-PACK.md).

### Keep a deliberate local watch

Save a place in Fieldbook first, then create its watch in **Library → Watchlists**. Unsaved or failed-save drafts cannot seed persistent watches. Starting is explicit: initial observations establish a quiet baseline, and later newly observed detections can appear in local notifications. Empty results are not a safety guarantee.

Watches use the admitted NASA FIRMS source and the existing server-side key. They are bounded to eight definitions, four active watches, a minimum 30-minute interval, 2,000 remembered identities and 100 stored notifications. A local transactional lease prevents duplicate work across tabs. Hidden pages pause monitoring; reload does not silently arm watches. Cooldowns, partial results, failed persistence, cancellation and late renewal responses retain honest states. This is an in-app convenience, not a background emergency alert service.

### Use explicit commands without an API bill

Open **Library → Local commands**. Type a supported command, preview it and choose Run. Examples include `go to 30.3258, 78.0438`, `find Dehradun, India`, opening a tool, saving the current place/project/route, and comparing already selected acquisitions. Mission templates stage commands rather than executing them automatically.

Place-name commands stage a query in the existing search tray for review and submission. They never silently choose an ambiguous result. Commands are schema-checked again against current context before execution, use existing owners and cannot execute shell commands, fetch arbitrary URLs, bypass the free-only policy or treat imported text as instructions.

The optional small local-model trial did not meet the accuracy gate and is not enabled. The deterministic interface remains fully usable without it. [Trial evidence and limitations](phase-5/LOCAL-ASSISTANT-TRIAL.md) record the model, licenses, measured resource use and failed quality gate.

### Pause and end a session

**Pause feeds** stops the reviewed live-feed owners, locally armed watches and pending planner/Chronicle/Research work. Unsaved routes, drawings, imported files and image comparisons stay open; map tiles remain available. New or unknown layer IDs are preserved until their lifecycle is explicitly reviewed. There is no automatic resume; enable the specific layer or watch deliberately.

From the project directory:

```sh
npm run local:start
npm run local:status
npm run local:stop
```

The default URL is `http://127.0.0.1:4173`. `-- --port 4174` chooses another port. The launcher uses an authenticated loopback control endpoint belonging to the process it started. It never kills a process merely because it uses a port or has a matching name. A pre-existing preview/dev server is reported as occupied and left untouched. Stop verifies that the managed application and control ports have been released. Local session control state, locks and logs live outside the project in a private per-user temporary directory, keyed by the canonical project path. The CLI reports its path when recovery is needed.

## Release validation

Browser source responses are explicitly labelled fixtures where used; the offline region is the actual shipped dataset. No browser QA consumes saved paid-provider credentials.

- Offline region and watch lifecycle: **17/17** browser checks, including real geometry, tamper rejection, unrelated-import preservation, quiet baseline, explicit stop and persisted cooldown.
- Local commands: **10/10** browser checks, with no automatic geocoding or model generation.
- Planner: **12/12** browser checks, including Pause feeds preserving the current route.
- Chronicle and Research: **10/10** browser checks; exact dated inputs, native raster provenance, historical reopen and phone layout.
- Responsive/accessibility hardening: **73/73** scoped checks across eight panels at desktop, phone and landscape. Keyboard focus, reduced motion, 44px controls, actual scroll ownership and full-control hit tests pass. This is not a complete WCAG certification.
- Resource stress: **6/6** assertions across 50 coordinate and 50 saved-project switches. Observed p95 control times were 52.8 ms and 51.9 ms, with zero added DOM nodes, listeners or documents and unchanged map-resource counts. Retained heap rose 1.52 MiB; no leak-free or rendering-FPS claim is made. Existing performance benchmarks passed **2/2**. See [measurements](phase-5/HARDENING.md).
- Production build succeeds with the existing large-chunk warning. All 11 translation catalogs contain 3,607 messages. Scoped format and package-boundary checks pass.
- Production dependency audit reports zero advisories. Five moderate development-only advisories remain in the test-utils → js-beautify/editorconfig/glob/minimatch chain. Compatible high-severity and Vite fixes were applied; unsafe forced major overrides were not adopted.
- Real managed launcher verification served HTTP 200 on 4174, then released the application and authenticated control ports. Preview 4173 and all task browser/model/extraction processes were stopped. Saved `.env` SHA-256 matches the pre-work baseline; no key values are recorded in this report.

The final full regression run completed **11,446 tests: 11,442 passed, zero failed, four skipped**. Two additional allocation microbenchmarks were explicitly skipped because their budgets are calibrated for Node 24 and this workspace uses Node 26.13.0; they are not reported as passes. The ordinary performance benchmarks passed separately. Earlier red-phase and mid-translation runs were superseded by this complete green run.

## Remaining boundaries

The app preserves saved keys but does not automatically activate capabilities whose free use has not been established. Provider quotas, geographic coverage and availability remain finite. Existing legacy provider calls outside the new admitted adapters are not represented as covered by the new ledgers. No always-on daemon, account signup, hosted inference or paid dependency was added. Experimental Labs such as catchment modelling and viewsheds remain outside this accepted release, as the plan specifies.
