# Phase 4 free science and imagery admission

Verified 7 November 2026. No saved credential or paid capability was used.

## Chronicle

The existing NASA CMR/GIBS owner now supports explicit windows of at most 31 UTC days, bounded areas, selected-image probes and exact-date restoration. Preview requests use fixed NASA hosts, a 256×256 PNG limit, one MiB response cap, finite deadline and conservative durable request accounting. Acquisition metadata and successful pixel availability remain separate from a request date. Normal GIBS viewport rendering remains with the existing map owner; no bulk offline mirroring was introduced.

Actual public Worldview Snapshots probes over Dehradun [77.98,30.26,78.09,30.37] returned dated HLS S30 imagery for 22 and 25 October 2026. Both declared Data-Present:true and matching Acquisition-Time, at 187,973 and 173,337 bytes. Visual inspection found the same urban/river/foothill footprint; the later image is hazier. That difference is not proof of physical change. HLS is a 30 m product and scene cloud percentage is not local cloud coverage. [NASA HLS products](https://hls.gsfc.nasa.gov/data-products/).

## Sentinel spectral analysis

Element 84 Earth Search exposes public Sentinel-2 L2A cloud-optimized GeoTIFFs without an account, as documented by the [AWS open-data registry](https://registry.opendata.aws/sentinel-2-l2a-cogs/). The adapter fixes collection, hosts, asset types and scientific metadata. It admits only native red B04, NIR B08 and categorical SCL inputs; no arbitrary user URL is fetched.

A verified Dehradun scene was S2B_43RGP_20261025_0_L2A, acquired 2026-10-25T05:40:34.715Z. Its reflectance scale is 0.0001 and offset −0.1; omitting the offset would give a different index. Actual bounded 128² and 256² native-grid runs succeeded using 12,653,299 bytes across 42 exact HTTP range requests, rather than downloading a whole red band of 226,111,347 bytes. These are one-time feasibility observations, not promises about future coverage or uptime.

The runtime accepts only HTTP206 with exact Content-Range, a strong stable ETag and no redirects. Per-job network limits are 24 MiB, 64 ranges and four MiB per range. Native ROI dimensions are 128 or 256 pixels, with TIFF grid/pixel-type/tile bounds checked before decoding. A disposable worker has a hard deadline and is terminated on cancellation. Only one heavy job runs at once. The separate local search/analysis ledger admits at most 48/day, 500/month and four/minute, with cooldown and corrupt-ledger fail-closed behavior. This ledger does not claim to account for unrelated providers.

NDVI applies band-specific scale and offset, rejects no-data and negative reflectance, and masks SCL classes except vegetation, bare ground and water. The 20 m categorical mask is sampled with nearest-neighbor semantics onto the 10 m grid. Missing pixels remain null. Cloud screening cannot guarantee cloud-free pixels, and an index difference alone cannot establish vegetation loss or causation. Exports retain the grid, footprint, processing baseline, source, formula, mask, limitations and actual transfer counts.

The browser source is lazy and same-origin, bounds response bytes, binds results to the exact scene/place/size request and recomputes statistics from the returned raster. It checks the UTM footprint and returns detached immutable data. New dependencies are MIT-licensed geotiff 3.0.5 and proj4 2.22.0. Neither requires an account or service subscription.
