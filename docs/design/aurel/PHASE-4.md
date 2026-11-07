# Phase 4 — Chronicle and bounded research

Implemented 7 November 2026. Chronicle adds a deliberate historical workflow to the existing imagery owner; Research adds bounded native Sentinel-2 analysis. Both retain the free-only policy, original scene renderer and saved credentials.

## Delivered

- Search a bounded date window and area, inspect acquisition metadata, explicitly probe selected images, and compare exact dated acquisitions using the existing keyboard-operable divider. Opening saved comparison metadata makes no provider requests.
- Save immutable comparison inputs and evidence-linked change notes in Fieldbook v3. Notes retain their interpretation, including unresolved observations. Earlier Fieldbooks migrate on read; persistence still uses explicit atomic saves and revision checks.
- Separate observations, forecasts, note creation time and imagery acquisitions. Different dates, haze or colors are not automatically labelled physical change.
- Search admitted Sentinel-2 L2A scenes, choose a scene, then calculate a 128² or 256² native-grid NDVI crop. Red/NIR scaling, categorical masks, missing pixels, coordinate binding, provenance and processing limits are explicit. Export includes the raster and its scientific metadata.
- Bounded upstream responses, exact HTTP ranges, stable validators, fixed hosts, durable quotas, a single heavy worker, hard deadlines and cancellation. No account or paid model is required.

## Verification

The actual Chronicle/Research browser workflow passed ten checks with isolated storage and intercepted synthetic science/imagery responses. Checks cover no startup acquisition, selected-only probes, exact A/B dates, keyboard divider, durable unresolved notes, historical reopen without refresh, native raster dimensions, phone layout and runtime errors. Desktop and phone screenshots were inspected; the discovered header overlap, unsupported icon and desktop-to-phone inspector loss were corrected.

Actual tiny public-source probes are recorded separately in [science admission](phase-4/SCIENCE-ADMISSION.md). Browser fixtures are not represented as actual Dehradun analysis. Focused source, controller, schema and persistence tests cover malformed payloads, cancellation, failed saves, provider cooldown and stale-owner races. The combined final regression record is maintained in Phase 5.

## Limits

Historical HLS imagery is a 30 m product; Sentinel red/NIR are 10 m, with a 20 m classification mask. Neither resolves individual people or provides live street imagery. Cloud screening and a valid NDVI calculation do not establish vegetation loss, safety or causation. Research output is a native-grid inspector/export, not a fabricated high-resolution globe texture. Saved inputs can be reopened without acquisition, but redisplaying remote pixels requires source availability.
