# AUREL — detailed feature specifications

**Proposed implementation scope · 6 November 2026**

Read alongside the [implementation plan](IMPLEMENTATION-PLAN.md) and [free-data policy](FREE-DATA-PLAN.md). These specifications distinguish new behavior from existing capabilities that should be connected or improved.

## F01. AUREL Lens: understand any selected place

**Question:** “What is here, and what can I actually know about it?”

Select a point, existing feature, drawn area or named neighborhood. A consistent dossier replaces the disconnected stack of panels.

### The experience

At Rajpur Road, the first view shows the selected place, coordinates, extent and a concise explanation of available detail. Tabs inside the inspector can organize Overview, Evidence and Notes without creating separate global destinations.

An example of intended copy—not a live data reading:

> Rajpur Road study area  
> Aerial imagery and mapped roads available. Detailed photogrammetric buildings have not been established for this selection.  
> Street imagery: inspect available dates and provider access.  
> Weather: forecast model. Local air-quality station coverage: not yet verified.

The map outline, dossier, nearby results and charts share the same selected area. A small location breadcrumb distinguishes city, neighborhood and exact selected object.

### Implementation slices

1. **MVP:** normalize selection/extent; existing-source coverage and status; coordinates; save place; notes; actions into routes/compare.
2. **Next:** weather, terrain, mapped amenities and evidence counts using admitted sources.
3. **Later:** local region search and user-defined dossier cards.

Reuse current search/navigation, context results and layer snapshots. Build a new dossier view model around them; avoid making the UI issue its own duplicate provider requests.

### Acceptance and boundaries

- Every number exposes its unit, source and applicable time.
- “No results” and “No coverage” are different states.
- Counts identify sampling and geographic extent.
- Preserve names/aliases in source scripts; do not treat an English transliteration as the only place identity.
- An unknown image date stays unknown.
- A pinned camera elsewhere displays its location and distance with Return/Clear actions.
- A location change immediately clears or relabels old local evidence. Delayed replies for the prior city cannot restore it under the new selection.
- Saving the dossier never copies forbidden imagery or secrets.

**Signature detail:** choosing a card briefly highlights the actual area or resolution footprint that supports it. A weather value from a large grid cell visibly represents a large area.

## F02. Observation-quality view: show the limits of detail

**Question:** “Am I seeing information, or merely magnifying pixels?”

This is a useful diagnostic lens, not a scary warning overlay. It reveals native image/grid footprints, acquisition dates, uncertainty areas, stale observations, missing coverage and provenance.

### The experience

At a close zoom, a compact indicator can say “Display zoom exceeds this source's native detail.” If native resolution is unavailable, say “Source resolution unknown.” Never infer source resolution from camera altitude.

A time badge answers whether a source is an observation, forecast, historical image, derived calculation, manual note or simulation. Freshness is a separate dimension: a recently fetched historical image remains historical.

### Implementation

Extend existing feed-state/provenance contracts with typed evidence metadata and per-feature uncertainty where supplied. Have each adapter declare available metadata. Add a metadata drawer, legend and optional map footprints. Reuse the current HUD to show supported coordinates/orientation/scale while moving decorative mission telemetry into Cinematic.

Do not assign an unexplained “87% reliable” score. If source confidence exists, show its actual definition. For a derived result, identify method, inputs and limitations.

### Acceptance

- Point, pixel/grid and polygon data have appropriate representations.
- Unknown uncertainty does not become zero uncertainty.
- Unsupported imagery sharpness/NIIRS claims disappear from research view.
- A source updated today cannot make a ten-year-old observation appear live.
- The explanation is available without enabling the whole quality overlay.
- An accessible evidence table conveys the same information as the visual overlay.

## F03. Fieldbook: a local project that remembers useful work

**Question:** “Can I keep what I discovered and use it again?”

A Fieldbook connects places, areas, routes, drawings, measurements, imported files, evidence and notes. Existing scene sequences become one optional presentation of the project.

### Example

Create “Dehradun foothills weekend.” Add a meeting point, two possible routes, a viewpoint, a GPX track, a weather snapshot, photographs and notes. Reopen later and distinguish what was planned from what was observed.

### MVP data model

Use stable IDs and explicit references for places, areas, routes, notes and evidence. The project stores creation/update timestamps and schema version. An evidence reference contains source identity, applicable time, retrieval time and permitted asset/link information.

Keep the current scene-document parser and storage keys intact. A Fieldbook may reference a validated scene document; it is not a replacement scene format.

### User experience

- One Save action; quiet saved/unsaved feedback; automatic draft protection.
- Library cards emphasize place, purpose and last edit rather than technical file type.
- Add note directly from the selected map feature.
- Rename, duplicate, archive, export and recover.
- Notes can be text or attached local files; no account or cloud sync required.
- Export preview separates bundled assets from online references.
- Explicit backup/restore to a chosen local file.

### Acceptance

Close/reopen, browser refresh, local-server restart and export/import retain IDs, notes, routes and scene associations. Existing scene and share-link formats round-trip unchanged. Corrupt or unsupported imports cannot overwrite the current project. Conflicting tabs surface a revision conflict instead of losing changes. Full disk/storage and write failure produce a visible unsaved state and export option.

The project should be useful offline for saved local content. It must not imply that any previously viewed map has automatically become an offline map.

## F04. Foothills planner: routes with terrain, time and purpose

**Question:** “How should I prepare for this outing?”

Improve existing directions by connecting them to a Fieldbook, elevation profile, daylight and forecast context.

### Dehradun–Mussoorie example

Choose driving, cycling or walking. Compare available routes, distance and estimated travel time. Inspect ascent/descent with the elevation source identified. Mark viewpoints and facilities. Select a proposed departure time and compare forecast conditions at a few meaningful checkpoints.

Do not query weather every meter or route on every mouse movement. Sample a bounded number of points; debounce edits and recalculate after deliberate changes.

### MVP

- Existing route calculation and editable waypoints.
- Interactive route profile: chart cursor highlights map position.
- Local sunrise/sunset/daylight calculation.
- User notes, planned stops, GPX import and export where supported.
- Brief listing route assumptions, data dates and missing segments.

### Next

Terrain-only horizon and golden-hour planning; optional route alternatives; forecast-window comparison; GPX replay with speed only if timestamps support it. A user can compare planned and actual GPX tracks without uploading them.

### Correctness and acceptance

Use existing elevation/geoid conventions and explicitly convert ellipsoid versus mean-sea-level heights where required. A 30 m DEM sample spacing is not a 30 m vertical-error claim. Missing heights create visible gaps; interpolation is labeled. Do not sum noisy elevation samples into implausibly precise ascent totals.

Network routing is estimated, not a guarantee that a road/trail is open or safe. Weather along a route is model output with a valid time. Avoid authoritative landslide/flood safety recommendations from these inputs.

## F05. Chronicle: evidence through time

**Question:** “What changed here, and what could explain the apparent change?”

Build on existing imagery split, weather playback and replay rather than replacing them.

### Time is represented honestly

The timeline has separate lanes for imagery acquisitions, observations/events, forecasts, and personal notes. Missing imagery dates remain gaps. A static basemap is marked static while a weather forecast moves.

Choose two available images. The inspector identifies date, source, resolution, cloud information and any alignment issue before presenting a change annotation.

### MVP

- Inputs: two licensed, georeferenced, dated local image assets, or an admitted date-addressable GIBS product. Phase 3 must establish a useful Dehradun demonstrator pair and its metadata; if none is suitable, that capability remains explicitly unavailable until the input gate is met.
- Existing before/after slider with synchronized location.
- Available-date markers and actual chosen dates.
- Side-by-side evidence cards.
- Manual change polygons/notes, each linked to supporting evidence.
- Exportable comparison with source/date/method labels.

### Next

Bounded Sentinel-2 area selection and cloud filtering. Local vegetation or water-index calculations on permitted science products. Comparable season/sensor/resolution controls. An evidence notebook records whether an interpretation is observed, inferred or unresolved.

Cloud masks, no-data pixels, shadows and resampling need explicit treatment. NDVI uses actual appropriate spectral bands and reflectance processing; it cannot be computed from arbitrary RGB satellite screenshots. A 10 m grid cannot resolve small construction details. Different appearance alone does not prove a real physical change.

### Acceptance

Time movement affects only compatible sources; the application never fetches current data and labels it historical. The keyboard-accessible split control remains functional. Missing imagery is explicit. A saved comparison can reproduce its inputs or say which external assets are no longer accessible.

**Signature detail:** scrub a time lane and see the map, source cards and supported chart change together, while incompatible lanes remain visibly fixed.

## F06. Environment desk and a useful morning brief

**Question:** “What deserves attention around the places I care about?”

Use deterministic templates to summarize a saved area: forecast changes, daylight, recent satellite fire detections, reported earthquakes and fresh station observations where available.

### Example

A Dehradun brief might show tomorrow's rainfall window, current forecast issue time, nearby dated fire detections and available pollution context. Each item opens its map evidence. Missing or stale feeds are included as missing information rather than omitted to make the brief look complete.

Actual values must come from data at use time; this plan supplies no invented current measurements.

### Watchlist behavior

Users explicitly select an area, source and condition. Example: notify me once about new FIRMS detections within this study area. Deduplicate by stable event IDs or a documented source-specific identity rule. Separate a newly retrieved old observation from a newly occurring event.

Pause on repeated errors; honor cooldowns. Do not flood notifications after waking a sleeping laptop. Show the monitoring interval and last successful check.

### Acceptance

- Works without an LLM.
- Every sentence can be traced to structured evidence.
- Unsupported providers do not silently return zero events.
- Large-area model AQ and station AQ remain separate cards with their own standards/units.
- Notifications work only while the app/local service runs in the initial release.
- No hidden always-on agent, cloud scheduler or SMS service.
- Stop monitoring cancels requests, timers and websockets.

This is personal situational awareness, not a substitute for official emergency warnings.

## F07. Open region pack and an honest structural city view

**Question:** “Can Dehradun feel detailed without depending on paid photorealistic 3D?”

Yes, through useful open geometry and local information. Detail can mean named roads, building footprints, trails, waterways, useful places, terrain contours and your own observations.

### MVP region pack

Use a licensed regional extract, cropped to a bounded Dehradun/Mussoorie study area. Include manifest, extent, source/release date, licenses, file sizes and integrity checks. Produce derived display files locally and retain their attribution.

Start with roads, water, buildings and a small local search index. Keep an optional terrain asset separate. Provide a preview and storage size before import. Use the existing source/pack registration and import constraints; importing a manifest must not trigger arbitrary URLs.

### Structural view

Display available building footprints as outlines. Extrude only with supplied or explicitly estimated heights, visibly distinguishing the two. Missing heights remain missing by default. A schematic extrusion is not a textured or surveyed building model.

A subtle wireframe/contour treatment can be visually striking while revealing real geometry. Keep it distinct from aerial-image textures so users know what they are seeing.

### Offline acceptance

Search, selected local layers, drawings, notes and saved routes work when internet access is disabled and the locally installed server is running. The map may fall back to a lower-detail bundled basemap outside the pack. Downloads use admitted extract/product routes, never bulk copying of OSM public raster tiles or commercial imagery.

Use a visible cache/storage manager and bounded region sizes. A whole-planet routing/search system is outside the MVP.

## F08. Mission templates: make complex tasks easy without a paid agent

**Question:** “Can the app assemble the right tools for my purpose?”

Templates are transparent, editable procedures built on existing actions. The first version is deterministic.

Examples:

| Template | Inputs | Actions | Result |
| --- | --- | --- | --- |
| Explore a neighborhood | Place or drawn area | Inspect coverage, map useful features, attach notes | Lens dossier and Fieldbook |
| Plan a half-day outing | Start, destination, mode, time | Route, terrain profile, daylight, bounded forecast | Itinerary and evidence |
| Investigate a visible change | Area, two available dates | Compare images, inspect quality, annotate | Sourced comparison |
| Watch my region | Area, selected events | Register bounded checks and notification rules | Watchlist with last-check status |
| Prepare a cinematic tour | Saved places/evidence | Populate existing scene authoring workflow | Editable sequence with attribution |
| Learn this landscape | Area and topic | Terrain/river/weather layers plus explanatory cards | Interactive educational project |

Before execution, show the proposed sources, time range, storage and unavailable steps. Paid steps are omitted with an explanation under Free-only. The procedure does not invent replacement evidence.

Existing manual tools remain available. Templates are shortcuts, not a new parallel engine. Each step supports cancellation, progress, retry and undo where applicable.

**Acceptance:** the same template produces a useful partial result when one optional source fails, with the failed step recorded. A scene or template imported from elsewhere cannot authorize paid requests, execute code or silently change credentials.

## F09. Optional local intelligence with an inspectable evidence trail

**Question:** “Can I ask the app questions naturally without a usage bill?”

Deliver in three levels:

1. **Deterministic commands:** search places, toggle layers, save a project, compare available dates. Reuse existing action schemas.
2. **Structured summaries:** narrate selected evidence with templates and links. This is the default briefing engine.
3. **Optional local model:** interpret phrasing and summarize only supplied evidence after hardware/quality testing.

The local inference candidates are llama.cpp and whisper.cpp. Both have official open-source implementations; whisper.cpp documents Apple Silicon support. Runtime licensing and a chosen model's weight license are separate checks. [llama.cpp](https://github.com/ggml-org/llama.cpp), [whisper.cpp](https://github.com/ggml-org/whisper.cpp).

### Hardware-aware scope

Begin with a small quantized text model and a short context budget. Benchmark while Cesium is rendering on the actual 16 GB machine. Keep model loading on demand; cancel/unload cleanly. Do not prescribe a giant model because it can technically start.

Speech is optional push-to-talk, with a visible microphone indicator and local-only processing when selected. Hindi/English recognition quality must be evaluated before being advertised. Use local installed speech output only where available; avoid silently falling back to a network voice.

### Boundaries

The model proposes valid application actions; it does not execute shell commands or arbitrary network requests. Tool validation and cost admission remain outside the model. Imported notes and provider text cannot override those rules.

If evidence is missing, the answer says so. The assistant must not estimate building details, declare route safety, invent historical data or fabricate citations. Every factual summary claim links to a source card.

### Acceptance

The entire app remains usable when the model is absent or fails. Local commands pass an evaluation set including ambiguous place names, invalid coordinates, missing data, stale sources and attempts to invoke prohibited providers. No unsupported privacy promise: verify the actual network trace.

## F10. Neighborhood comparison and service access

**Question:** “How do two areas differ for the things I care about?”

Compare two drawn areas or saved places using mapped amenities, road/trail access, terrain, vegetation context and personal notes. Let the user choose the criteria rather than giving every neighborhood an opaque “quality score.”

Example: compare two possible bases for a visit to Dehradun by distance to mapped food, parks and transport, terrain steepness and planned excursions.

### Build sequence

Start with consistent dossiers side by side and straight-line distances clearly labeled. Add route-based travel estimates where an admitted routing service supports the request volume. Later add bounded local network analysis for accessibility.

Different map completeness is itself a comparison field. “No hospital mapped” must not become “No hospital exists.” Avoid household inference from population grids, crime labels without data, property valuations or legal-boundary claims.

### Acceptance

Criteria, weights if used, source dates, coverage and distance method are visible. Export records the chosen criteria. Turning off an uncertain criterion updates the result explainably; it is not a black-box ranking.

## F11. Science and research lenses

These are optional Labs built on the same sources/projects. Each requires a small proof-of-value before promotion.

| Lens | Concrete use case | Minimum evidence/computation | Limitation to expose |
| --- | --- | --- | --- |
| Terrain cross-section | Understand the valley-to-ridge transition near Dehradun | DEM samples, horizontal/vertical references, profile | Sampling and voids; not survey-grade |
| Terrain-only viewshed | Explore which ridges may be visible from a viewpoint | DEM, observer height, line-of-sight algorithm | Buildings/trees omitted unless supported geometry exists |
| Solar/photography | Plan a hillside sunrise shot | Local solar geometry and optional terrain horizon | Weather and building occlusion can differ |
| Vegetation seasonality | Compare a forest/agricultural area's available seasons | Suitable spectral bands, masks and dated series | Clouds, sensor/season differences; not crop-health diagnosis |
| Drainage/catchment learning | Explain where terrain suggests water might flow | Hydrologically conditioned elevation and known watercourses | No validated flood depth or evacuation prediction |
| Settlement history | Explore broad changes in built-up area/population estimates | Versioned GHSL or other admitted datasets | Modelled estimates and projections; not live occupancy |
| Seasonal ecology | Explore regional sighting patterns and field notes | Existing wildlife observations; optional GBIF history | Observation effort bias; preserve sensitive-location uncertainty |
| Event context | Compare fire detections, wind and AQ in a period | Separate source/time metadata and spatial joins | Co-occurrence does not prove cause |
| Personal infrastructure | Place user-owned sites, photos and maintenance notes | Local imports and explicit user data | No automatic access to private networks/cameras |
| Sky notebook | Plan visible satellite passes and record observations | Existing propagated orbit tools and local sky/time context | Predicted pass differs from observed visibility |

Do not ship a visually impressive calculation until it has known-input fixtures, transparent units/methods, cancellation and a source-quality explanation. Raw computation is not validation.

## F12. Evidence briefs and cinematic presentations

**Question:** “Can I turn exploration into something readable and shareable?”

Extend existing exports and scene authoring with a sourced brief:

- Purpose, place/extent and selected period.
- Map views or diagrams whose export rights are permitted.
- Notes, measurements and findings separated from hypotheses.
- Sources, dates, units, processing methods and limitations.
- Which files are bundled versus online references.
- Optional existing scene sequence for presentation.

Start with local HTML/Markdown and print-to-PDF. Keep machine-readable project export alongside the readable brief. No hosted publishing, external render service or paid document API is necessary.

Cinematic mode can be beautiful: camera moves between saved places, overlays reveal evidence and charts track the selected event. Attribution and observation/simulation distinctions remain visible in the presentation.

### Acceptance

The export contains no API keys, bearer URLs or private metadata unless deliberately included. A privacy preview can omit home coordinates, personal notes and photo EXIF. Removed imagery becomes a source link, not a broken hidden dependency. Reopening the project preserves the evidence relationships.

## Domain coverage without a giant menu

| Domain | Useful outcome | Supporting features |
| --- | --- | --- |
| Everyday life | A brief for saved places and upcoming plans | Lens, environment desk, Fieldbook |
| Travel | A place collection, route and portable itinerary | Fieldbook, foothills planner, templates |
| Photography and film | Sun/terrain preparation and sourced scene sequence | Planner, science lenses, presentation |
| Urban exploration | Understand a neighborhood and mapped services | Lens, open pack, comparison |
| Environmental observation | Review fires, rainfall, AQ and changes with sources | Environment desk, Chronicle |
| Agriculture and forests | Inspect seasonal vegetation context | Chronicle, research lenses |
| Geography education | Explain terrain, rivers, time and spatial scale | Lens, cross-sections, templates |
| Astronomy and aviation | Explore existing sky/flight tools in local context | Lens, sky notebook, Fieldbook |
| Biodiversity | Seasonal observation notebook | Existing wildlife, optional GBIF, Fieldbook |
| Civic/service research | Examine documented mapped access and data gaps | Neighborhood comparison |
| Cultural/personal history | Attach the user's dated photographs and stories to places | Fieldbook, Chronicle |
| Personal sites/assets | Keep local notes and authorized user data on a map | Imports, Fieldbook |
| Scientific reproducibility | Retain inputs, methods and evidence references | Chronicle, briefs, source ledger |
| Accessibility | Explore meaningful data without relying on a visual globe | Inspector tables, search, keyboard, text summaries |
| Low-connectivity use | Work with saved local material and bounded licensed geography | Open region pack, Fieldbook |

This breadth should come from combining a few strong primitives: **place, area, time, evidence, route, note and project**. More domains should not multiply the interface indefinitely.

## The dimensions that matter

- **Horizontal:** point, neighborhood, region and global context.
- **Vertical:** terrain and supported building geometry, with correct height references.
- **Temporal:** historical observation, present retrieval, forecast and personal memory.
- **Scale:** source resolution versus display zoom.
- **Uncertainty:** measured fields, model output, interpretation and missing information.
- **Intent:** exploring, comparing, preparing, observing or presenting.
- **Connectivity:** online source, cached evidence, intentionally offline pack.
- **Ownership:** public data, licensed provider content, private user material.

Subsurface detail, building interiors, individual identities and universal real-time observation are not available merely because the globe can display a coordinate. They must never be implied by the visual design.

## Recommended release composition

**Release 1, through Phase 3 of the main plan:** F01–F04 core workflows, a basic F06 brief, and a coherent responsive shell under Free-only. Phase 2 supplies the brief's presentation; Phase 3 adds its weather/field-workflow integrations.

**Release 2, through Phase 4:** F05 Chronicle using verified input images, admitted research adapters and F08 mission templates. F07 region-pack feasibility proceeds before committing to offline detail.

**Release 3, through Phase 5 and selected follow-ups:** F07 bounded offline region pack, selected F09 local intelligence, F10 comparisons and F12 polished presentations. Large research lenses receive separate estimates.

**Labs:** choose individual F11 experiments based on personal usefulness and verified data, not completeness of the idea list.

This order lets AUREL become meaningfully better early while leaving room for technically ambitious work.

