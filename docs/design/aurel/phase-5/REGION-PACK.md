# Bounded Dehradun offline region pack

## Source admission

The pack is a local derivative of OpenStreetMap's public **Geofabrik Central Zone** PBF extract. Central Zone contains the Dehradun area. Download the extract file once and crop it locally; do not bulk-download OpenStreetMap rendered tiles.

- Source: [Geofabrik Central Zone](https://download.geofabrik.de/asia/india/central-zone.html). The reviewed listing described a roughly 335 MiB PBF containing data through **2026-11-05T21:23:02Z**. The generated manifest uses the timestamp read from the actual PBF header, rather than trusting a webpage label.
- Data license: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution is **© OpenStreetMap contributors**. Keep the manifest, source details, attribution and ODbL notice with this derived database and any redistributed copy. See [OSM copyright](https://www.openstreetmap.org/copyright).
- Building tool: [PyOsmium](https://osmcode.org/pyosmium/), version **4.3.2**, BSD 2-Clause. It is installed in an isolated temporary Python environment for regeneration only. The application does not import Python or PyOsmium, and this adds no runtime Node dependency.
- Credentials and cost: no key, account, billing configuration or paid endpoint is used. No user's saved configuration is read or modified.

## Scope and honesty

The default extent is `[78.022, 30.312, 78.05, 30.34]`, a small core of Dehradun around Clock Tower and nearby neighborhoods. This is not all of Dehradun, much less a worldwide offline database. Mapped roads, building footprints, waterways/water areas and named points are included when their complete geometry fits inside the extent. PyOsmium assembles multipolygon areas; no geometry is invented to join incomplete relations.

Boundary-crossing geometries are deliberately omitted. The manifest counts the cases with at least one vertex inside the crop and another outside; it does not claim a complete count of geometries intersecting the boundary. A missing feature is not evidence that it does not exist. OSM editing dates and extract timestamps are not survey dates, current-condition observations, opening-hours guarantees or verified access information.

Coordinates remain two-dimensional. The pack preserves a building height only when its OSM `height` tag supplies an unambiguous positive number in meters (up to 1,000 m). Unknown heights remain `null`; `building:levels` is never multiplied into a guessed height. Footprints do not imply photorealistic models, ownership, occupancy or indoor detail.

The local search index includes mapped feature names and available English/Hindi aliases. A search result uses the feature's bounding-box center, which is explicitly approximate and does not identify an entrance. The search never falls back to a remote geocoder.

## Verified starter build

The shipped pack contains **8,647 actual OSM features**: 6,984 building footprints, 1,460 roads, 18 water features and 185 named points. Its 318-entry local name index includes Ghanta Ghar via the “Clock Tower” alias and Rajpur-Mussoorie Road via “Rajpur Road.” Geometry contains 54,769 positions. Combined geometry and index size is **3,368,870 bytes (about 3.21 MiB)**.

Only **one** included building has an admitted explicit height tag (10 m); the other 6,983 building heights are unknown. The build omitted 161 geometries with vertices both inside and outside the crop. The larger initial candidate extent exceeded the feature cap, so the starter extent was reduced instead of silently dropping features or raising resource limits.

The actual PBF header snapshot is `2026-11-05T21:23:02Z`. Its SHA-256 is `b6eaf4f9c098d77a1c8a05996fd6752e83ee8550b022aefa0c4de255af20eaeb`; the downloaded source also matched Geofabrik’s published MD5. Source retrieval/build completion was `2026-11-06T19:58:02.272Z` (November 7 locally). Data and index SHA-256 values are recorded in the shipped manifest and checked by the real-bundle offline test.

## Admission and use

The generated bundle lives in `public/regions/dehradun-core/`:

- `manifest.json`: extent, source/extract/retrieval timestamps, original PBF SHA-256, license, coverage limitations, exact feature/vertex/name/category counts, and asset sizes/digests.
- `geometry.geojson`: whitelisted local geometry and display metadata.
- `names.json`: a bounded name/alias index referencing those same feature IDs.
- `LICENSE.txt`: data attribution and license notice.

`validateRegionManifest` admits metadata for a preview without loading or rendering geometry. The UI should show extent, snapshot date, byte size, feature counts and limitations, then wait for explicit **Enable**. `verifyRegionPack` checks exact sizes and SHA-256, geographic bounds, field whitelist, geometry structure, supplied-height provenance, index references and counts before returning any renderable objects. It does not fetch. A hash verifies consistency with the manifest; it is not an independent authenticity signature.

After explicit enable, feed verified local GeoJSON to the existing geospatial import/ground-clamping owner. Do not create a second globe, automatically frame the map, fetch remote asset URLs, enable unrelated layers, manufacture building heights or re-download the extract at runtime. Local-server requests for bundled bytes are sufficient when internet is disabled. Provider basemap imagery and terrain outside already permitted local assets remain unavailable offline.

Caps: 4 MiB of geometry plus name-index bytes, 10,000 features, 100,000 positions, 10,000 names and 10 km per extent side. The current starter extent is smaller. Unsupported paths, source fields, extra properties, traversal and URL-valued asset paths fail closed. Any update is an explicit replacement build with new hashes and snapshot metadata; normal startup performs no refresh.

## Regeneration

Use an isolated build environment, preserving the application's package lock and saved keys:

```sh
python3 -m venv /tmp/aurel-region-build/venv
/tmp/aurel-region-build/venv/bin/python -m pip install --only-binary=:all: osmium==4.3.2
```

Download only the official `central-zone-latest.osm.pbf` file to a temporary directory using HTTPS and a 400 MiB maximum transfer/file bound. The builder itself accepts a local PBF path only and has no downloader. Then run:

```sh
node scripts/build-region-pack.mjs \
  --input /tmp/aurel-region-build/central-zone-latest.osm.pbf \
  --python /tmp/aurel-region-build/venv/bin/python \
  --output public/regions/dehradun-core
```

The build bounds input size to 400 MiB and the extraction subprocess to five minutes. Publication writes a sibling staging directory, flushes files, reads and verifies the staged bytes, then replaces the prior generated directory. A publication lock serializes builders; unrelated output files and symlink destinations are refused. A failed final rename rolls back to the previous complete directory. If rollback itself fails, the error reports the retained previous directory for explicit recovery. Retain the complete attribution/license notice with the outputs. Do not distribute the full source extract as part of the app.

## Verification

```sh
node --test src/regions/pack.test.mjs src/regions/bundled.test.mjs scripts/build-region-pack.test.mjs
AUREL_PYOSMIUM=/tmp/aurel-region-build/venv/bin/python \
  node --test scripts/build-region-pack.test.mjs
```

The first command covers strict admission, integrity, spatial bounds, unknown heights, geometry/index consistency, Unicode local search and the actual bundled dataset. The optional second command also creates an actual small PBF, runs the extraction subprocess, and verifies the resulting pack. Regeneration of the real starter dataset exercises the same admission path; production-bundle verification should additionally hash the shipped files and validate actual counts.

Generated `geometry.geojson` and `names.json` are compact, integrity-pinned data. Exclude them from automatic formatting. Any byte change requires regenerating the manifest sizes and digests and rerunning the bundled-data verification.

Directory publication uses two individual rename operations, not a filesystem transaction spanning both. An abrupt process or machine stop between them can leave the destination briefly absent while the complete prior generation remains in a sibling `.stage-*.previous` directory. After confirming no builder is running, verify that previous generation before restoring it and clear a stale `.publish-lock` only as an explicit recovery step. Normal exceptions roll back automatically; data files are never overwritten in place.

## Browser acceptance evidence

Run `node scripts/qa-aurel-offline.mjs` against the locally built preview at `http://127.0.0.1:4173`. It uses an isolated browser profile and blocks external HTTP requests, so it neither reads the user's browser state nor exercises their saved provider credentials. The real shipped pack is used for geometry, integrity checks and local search. The FIRMS response is explicitly synthetic and empty; it tests monitoring lifecycle, not the availability or contents of live observations.

The final run passed **17/17 checks**: no automatic acquisition; manifest-only preview; tampered-byte rejection without changing an unrelated imported file; admission of all 8,647 actual features through the existing importer; local “Clock Tower” alias search and camera navigation; desktop and phone layouts; explicit watch creation/start/stop; a quiet first baseline; persisted 30-minute cooldown after reload; and removal confined to the owned region. Reloading does not restart a watch or load a region automatically. No runtime exceptions occurred, and the test browser was closed.

Results and screenshots are in [`evidence/offline-checks.json`](evidence/offline-checks.json), [`offline-region-desktop.png`](evidence/offline-region-desktop.png), [`offline-region-mobile.png`](evidence/offline-region-mobile.png), [`offline-region-rejected.png`](evidence/offline-region-rejected.png), [`offline-watchlist-desktop.png`](evidence/offline-watchlist-desktop.png) and [`offline-watchlist-mobile.png`](evidence/offline-watchlist-mobile.png). The overview basemap is local Natural Earth, with honest offline attribution. Street-level photography, live traffic and terrain availability are not claimed by this test.
