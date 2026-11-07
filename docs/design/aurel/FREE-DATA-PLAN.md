# AUREL — free data and credential plan

**Verified against public official documentation on 6 November 2026.** Service rules can change. This records research and proposed integration decisions, not authenticated account entitlements.

Return to the [implementation plan](IMPLEMENTATION-PLAN.md).

## 1. What is already configured locally

Only credential names and presence were inspected. Values are deliberately omitted. “Configured” does not establish validity, remaining quota, permitted use, coverage or zero-charge status.

| Existing credential | What it serves | Proposed decision for Free-only |
| --- | --- | --- |
| CESIUM_ION_TOKEN | Ion assets, terrain and eligible hosted imagery/3D routes | Retain; enable only after Community eligibility, exact assets and no-charge behavior are verified |
| GOOGLE_MAPS_API_KEY | Direct Google maps/3D/place/street capabilities | Retain but block direct billable capabilities by default |
| AISSTREAM_API_KEY | AIS vessel feed | Reuse for bounded marine views under current free-service terms; do not start for unrelated inland work |
| FIRMS_MAP_KEY | NASA satellite fire observations | Reuse; high priority for Uttarakhand |
| TOMTOM_API_KEY | Traffic flow | Retain; verify the saved account's Evaluation status and current product entitlement before use |
| OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET | OAuth access to aircraft data | Retain; hold operational use pending current license eligibility/permission |

No OpenAI, Gemini, Mapillary or Launch Library token was found in the local configuration files inspected. That is not a claim about every environment variable, account or credential store on the machine.

No keys were created, changed, tested against metered endpoints or copied into this document.

## 2. Existing-provider decisions

### Cesium: useful, but a quota is not unlimited access

The current Community plan is free for individual personal/noncommercial use. Its published allowances include 10 GB storage, 15 GB monthly streaming, 1,000 monthly global-imagery sessions, 1,000 monthly Google Photorealistic 3D root-tile requests and 50,000 monthly geocodes. The actual account, asset entitlements and enforcement on exhaustion remain unverified. [Official pricing](https://cesium.com/platform/cesium-ion/pricing/).

**Implementation decision:** retain the token and inspect eligibility during the provider-verification phase. Enable only capabilities whose use cannot create a charge under the actual account configuration. Keep the app functional without ion. Direct Google API usage and ion-hosted access must have separate capability IDs; possessing one key must not authorize the other route.

### Google direct: optional legacy capability, excluded from the free core

Google's Map Tiles API requires billing and API-key configuration. A free usage allowance does not remove that account requirement or guarantee every request is free. [Google setup requirements](https://developers.google.com/maps/documentation/tile/get-api-key).

**Implementation decision:** no direct Google dependency in the core roadmap. Preserve the saved key. Do not load its SDK or start a photorealistic/street-view request automatically because a restored URL once selected that map. A blocked selection should explain the policy and offer an already-admitted map.

### TomTom: verify the exact product and account

Current official pricing publishes no-card free monthly allowances, including 200,000 requests each for traffic flow/incidents vector-tile and raster-tile products, 20,000 flow-segment requests and 2,500 incident-detail requests. These are distinct products. The user's earlier key screenshot said Evaluation, so it does not prove continuing production entitlement. [Official pricing](https://docs.tomtom.com/pricing).

**Implementation decision:** inspect account plan, expiry and overage behavior before activation. Adapt the existing persistent daily governor to the actual monthly product units if admitted. A local request budget should reserve a margin, count failed attempts conservatively and never silently move to a paid product. Traffic animation without a live provider must remain labeled simulated.

### OpenSky: credentials are not sufficient

The official terms explicitly require a prior written agreement for operational REST integration, including internal live products or automated systems. That is stricter than a simple “personal use is free” interpretation. [OpenSky terms](https://opensky-network.org/about/terms-of-use).

**Implementation decision:** do not claim the existing OAuth pair is an unconditional free entitlement. Hold this source pending clarification or permission. The app already has an adsb.lol path: its official API is free and the data are ODbL, with best-effort availability and provider-specific usage conditions. Retain attribution and review any key requirements. [adsb.lol API](https://www.adsb.lol/docs/open-data/api), [API usage documentation](https://api.adsb.lol/docs).

### AISStream and FIRMS: reuse the useful keys

AISStream describes its global AIS API as free. Treat it as a community service with variable coverage; subscribe narrowly and shut down unnecessary connections. A silent vessel feed does not prove there are no ships. [Official project](https://github.com/aisstream/aisstream).

FIRMS issues free MAP_KEY credentials and currently allows 5,000 transactions per ten minutes; multi-day requests may consume multiple transactions. Reuse the existing adapter and its cache. [NASA key/limits](https://firms.modaps.eosdis.nasa.gov/api/map_key).

### AI subscriptions: distinguish building from app operation

ChatGPT and API billing remain separate, but current OpenAI documentation describes included API-credit benefits for eligible Pro and Business subscriptions. Activation and the receiving API organization must be verified; eligibility alone does not mean a grant exists. Credits expire and the benefit may change. [OpenAI credit benefit](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions).

Claude's current help page likewise describes separate API billing and API-credit benefits for certain plans; this does not establish what this user receives. [Claude billing explanation](https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan).

**Implementation decision:** do not require subscription credits for any core workflow. If a verified included benefit can be used with no spillover charges, it can later be an explicitly optional allowance with a hard stop. Until then use deterministic commands, source-backed templates and optional on-device inference. Do not repurpose browser/session credentials as a hidden general-purpose API.

## 3. Sources to reuse, extend or add

“Public” means access is presently available without a credential for the documented use. It does not mean an unlimited service or permission to mirror everything.

| Source and access | Useful work | Limits, fidelity and implementation choice |
| --- | --- | --- |
| **Open-Meteo weather — public, new adapter** | Forecast strips, departure-window comparison, daily brief | Free personal/noncommercial limits: 10,000 calls/day, 5,000/hour, 600/minute and 300,000/month. Stay below them and count weighted provider units: requests exceeding ten variables or two weeks can count as multiple/fractional calls. Coalesce/cache and attribute the providers. [Terms](https://open-meteo.com/en/terms), [pricing/unit definitions](https://open-meteo.com/en/pricing) |
| **Open-Meteo CAMS AQ — public, new context** | Background pollution outlook for India | Global CAMS grid is roughly 45 km; it is model output, not a road-level monitor. Preserve pollutant units and the selected AQI standard. Do not show European pollen coverage as available in India. [AQ documentation](https://open-meteo.com/en/docs/air-quality-api) |
| **NASA FIRMS — existing free key** | Selected-area fire observations and history | VIIRS detections have 375 m nominal resolution; they are not exact fire perimeters. Show acquisition time, source and confidence fields; do not label them live flames. [NASA guide](https://www.earthdata.nasa.gov/s3fs-public/2023-03/FIRMS_OnePager_2022_Prnt-Web.pdf?VersionId=1.pHw_vC487jLkt_aDy.bMvHQxDFC44f) |
| **NASA GIBS — public, improve existing imagery** | Dated cloud/snow/aerosol/imagery views | Read each layer's time extent and resolution from capabilities. Visual tile pixels and native sensor resolution are different. Include product-specific attribution. [Access](https://nasa-gibs.github.io/gibs-api-docs/access-basics/), [visualizations](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/) |
| **Copernicus Data Space/Sentinel-2 — free account, new research adapter** | Seasonal vegetation and urban-area comparisons | Bands are 10/20/60 m; nominal five-day revisit does not guarantee a cloud-free image. General-user Sentinel Hub resources currently include 10,000 requests and 10,000 processing units/month; other download/processing services have separate limits. Prefer small local analyses. [Mission](https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2), [quotas](https://documentation.dataspace.copernicus.eu/Quotas.html) |
| **OSM via Geofabrik — public extract files, new region pack** | Roads, buildings, trails, amenities and local search | Download a suitable regional extract and crop locally; do not expect every house, trail or opening hour to be present. Keep ODbL attribution, extract date and derived-database obligations. [Downloads](https://www.geofabrik.de/data/download.html), [India](https://download.geofabrik.de/asia/india.html), [license](https://www.openstreetmap.org/copyright) |
| **FOSSGIS OSRM — public, improve existing routes** | Walking, cycling and driving itinerary | Maximum one request/second, no heavy use, valid identification and required attribution/map-fix link. Route queries reach the operator. Graph data are not live closures or traffic. [Operator policy](https://routing.openstreetmap.de/about.html) |
| **USGS — public, improve existing earthquakes** | Regional seismic context and history | Prefer feeds for automatic current display; use bounded catalog queries for history. Event uncertainties are data fields when available, not something to invent. [Catalog API](https://earthquake.usgs.gov/fdsnws/event/1/1), [feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) |
| **NASA EONET — public, optional discovery adapter** | Open a natural event and its related imagery | Curated event metadata and dated geometry; incomplete as a local alert system. Event “closed” status is not necessarily the exact physical end time. [API](https://eonet.gsfc.nasa.gov/docs/v3) |
| **iNaturalist/Acartia — already implemented** | Better seasonal exploration and field notes | Reuse existing pacing, daily budget, caching and sensitive-location protection in docs/CURRENT-STATE.md. Improve the workflow before adding another sightings provider |
| **GBIF — public search, optional account for bulk** | Historical biodiversity context beyond recent observations | Add only if it fills a demonstrated gap. Records carry differing CC0/CC-BY/CC-BY-NC licenses and coordinate uncertainty. Use official downloads for bulk; preserve citations and privacy. [API](https://techdocs.gbif.org/en/openapi/v1/occurrence), [licenses](https://www.gbif.org/publishing-data) |
| **OGD India/CPCB — account API key, priority feasibility spike** | Actual Indian air-quality station observations | The official catalog identifies station pollutant data, but the inspected page carries a sandbox disclaimer. Production resource ID/access route, free quota and a real sample remain unverified. Then verify Dehradun station freshness/completeness. Preserve GODL conditions and attribution. [Catalog](https://www.data.gov.in/catalog/real-time-air-quality-index), [license](https://data.gov.in/Godl), [API help](https://www.data.gov.in/help) |
| **Bhuvan Panchayat — documented no-cost services, feasibility gate** | Drainage, slope, settlement and land-use context | The service manual describes thematic downloads and WMS/WMTS. Verify Uttarakhand layer, scale, date and service-specific permission. General Bhuvan terms are restrictive; do not scrape or assume blanket redistribution rights. [Manual](https://bhuvanpanchayat.nrsc.gov.in/SISDP/BP-usermanual.pdf), [general terms](https://bhuvan.nrsc.gov.in/terms.php) |
| **Natural Earth — public-domain downloadable data** | Small bundled global fallback and educational overview | Suitable for broad-scale context, not street detail. It provides a base that works without live services. Preserve neutral source naming for contested boundaries. [Terms](https://www.naturalearthdata.com/about/terms-of-use/) |
| **Overture — open licensed files, optional region enrichment** | Building footprints and place records where they improve OSM | Use the official data distribution and bounded regional extracts, not a similarly named paid API. Themes and upstream sources have different licensing/attribution. Verify local quality and preserve release version. [Official quickstart](https://docs.overturemaps.org/getting-data/), [licenses](https://docs.overturemaps.org/attribution/) |
| **GHSL — public downloadable data, later research lens** | Settlement growth and population context | Historical estimates and projections are different products; neither gives current people inside a building. Pin dataset/version/year, resolution and acknowledgement. [Official datasets](https://human-settlement.emergency.copernicus.eu/datasets.php) |
| **NASA SRTM — free dataset, acquisition spike** | Terrain profile, hillshade and terrain-only visibility | Approximately 30 m horizontal sampling for the one-arc-second product; vertical accuracy is a different quantity. Do not infer stairs, walls or precise building heights. Verify the selected download route and datum. [NASA guide](https://www.earthdata.nasa.gov/s3fs-public/2025-05/SRTM_Quick_Guide.pdf?VersionId=ZDrZprebSzTuJdC57vPsRXhuXU3S1OZK) |

Existing CelesTrak, launches, transit, cameras, street imagery and other regional layers remain available within their verified policies. They do not all need new integrations. Review each active product in Phase 0; no keyless endpoint gets a universal “safe forever” label.

## 4. Shared-service rules that must shape implementation

### OSM raster tiles

Normal interactive viewing is permitted under the tile policy; proper attribution, identification and caching are required. City prefetch, bulk tile archives and offline-download features using tile.openstreetmap.org are prohibited. Offline AUREL packs must use licensed extract files or an explicitly offline-permitted source. [Tile policy](https://operations.osmfoundation.org/policies/tiles/).

### Nominatim

The public endpoint requires deliberate informed developer selection, identification, attribution and caching; at most one request/second applies. Autocomplete and systematic enumeration are prohibited. Current policy also restricts generic inclusion by AI/no-code platforms. Prefer the existing local gazetteer, coordinates and regional search index; do not silently wire Nominatim into a universal search-as-you-type backend. [Usage policy](https://operations.osmfoundation.org/policies/nominatim/).

### Overpass

Public instances are shared infrastructure. Operator guidance is not a capacity entitlement. Keep any admitted query explicit, geographically bounded, queued and cached; never rotate endpoints to evade throttling. Repeated analytical work belongs on local extracts. The current app already requires configured upstreams for this feature. [Operator guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

### Basemap and image caching

The current Esri keyless path is a useful existing capability, but keyless access alone does not settle all product terms or offline/export permissions. Review the specific service before admitting new caching or packaging behavior. Do not copy Google, Bing, Esri, street-view images or third-party photographs into a portable pack simply because they rendered in the browser.

A saved project may retain a source link and metadata when copying the underlying content is not allowed. The export dialog should say which assets travel with it and which need an online provider.

## 5. Additional credentials: a deliberately short list

| Order | Credential/account | Why it is worth considering | When to obtain it |
| --- | --- | --- | --- |
| 1 | OGD India API key | Station-based AQ can fill a genuine India gap | After catalog/resource and free-account limits are validated |
| 2 | Copernicus Data Space account and supported access credentials | Dated Sentinel scenes and local change analysis | When Chronicle's basic comparison/evidence flow works |
| 3 | NASA Earthdata login, if the selected terrain/science download requires it | Licensed raw science/terrain inputs | Only for a specific admitted product |
| 4 | Open street-imagery token, if needed | Broader street-level access | Only after coverage and current terms justify it |

The MVP does not need any of these to be useful. Reuse FIRMS and the genuinely applicable saved providers first; add Open-Meteo and local computation without keys.

Do not create accounts merely to fill provider settings. Free registrations may require the owner's email verification and acceptance of service conditions. This planning pass does not perform those actions or create credentials. No shared, scraped or hardcoded keys are part of the design.

## 6. Adapter admission checklist

An adapter is ready only when its implementation record contains:

1. Official service and dataset identity, capability, intended use and policy-review date.
2. Allowed geography, scale and time semantics; actual sample evidence for Dehradun when claimed.
3. Authentication requirement, verified free entitlement, quota unit/window and exhaustion behavior.
4. Attribution, cache duration, offline/export/redistribution permissions and source links.
5. Minimum refresh interval, bounded geographic query, payload limits, cancellation, retries and backoff.
6. Tests for errors, empty/partial/stale responses and no-charge denial before dispatch.
7. User-facing explanation and a useful fallback that does not cross a cost boundary.

No-source and local-only operation are valid fallbacks. “Ask the user to buy another API” is not a fallback for this roadmap.

## 7. Open questions to resolve with small spikes

- Does the current Cesium account enforce no-charge exhaustion for the particular assets?
- Is the TomTom key still evaluation-only, and what happens when its free product allowance is consumed?
- What written permission, if any, covers this application's OpenSky usage?
- What is the verified production OGD resource/access route, and which station records are fresh and geographically relevant to Dehradun?
- Which Bhuvan Panchayat services expose suitable Uttarakhand layers under the intended use?
- Which two Sentinel scenes provide a useful comparison with acceptable clouds and comparable season?
- How large is a practical Dehradun/Mussoorie vector/terrain pack on this machine?
- Which source assets can legally be included in a portable report or offline project?

Each spike should produce a small evidence record, a go/no-go decision and a user-visible limitation where appropriate. None should expand into an unbounded global download.

