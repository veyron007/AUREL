#!/usr/bin/env node
/**
 * Build the bundled HydroSHEDS far-field subset for Raindrop:
 *   public/hydro/rivers.json       HydroRIVERS v1.0 reaches in the Doon window
 *                                  plus every reach downstream of them to the sea
 *   public/hydro/basins-doon.json  HydroBASINS v1c level-12 units in the window
 *
 *   node scripts/build-hydro-farfield.mjs \
 *     --rivers <dir>/HydroRIVERS_v10_as --basins <dir>/hybas_as_lev12_v1c \
 *     --osm <doon-waterways.json> [--out public/hydro]
 *
 * Inputs are the owner-approved downloads from https://data.hydrosheds.org/file/
 * and one Overpass extract of named waterways; they are read, never executed.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  readDbf,
  readShp,
  simplify,
  simplifyRing,
} from './hydro-shapefile.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const riversBase = arg('rivers'),
  basinsBase = arg('basins'),
  osmFile = arg('osm');
const outDir = path.resolve(arg('out', 'public/hydro'));
if (!riversBase || !basinsBase || !osmFile)
  throw new Error('--rivers, --basins and --osm are required');

const EXTENT = [77.6, 29.98, 78.32, 30.56];
const SEED = [
  EXTENT[0] - 0.02,
  EXTENT[1] - 0.02,
  EXTENT[2] + 0.02,
  EXTENT[3] + 0.02,
];
const NEAR_TOL = 0.0002,
  FAR_TOL = 0.002;
/** Names propagate downstream only from reaches at least this large. */
const PROPAGATE_MIN_KM2 = 300;
const OSM_MATCH_M = 300;
/** Names not present as OSM waterways in the window, placed by hand. */
const ANCHORS = [
  {
    name: 'Asan',
    lon: 77.6661,
    lat: 30.4358,
    maxUpKm2: 3000,
    radiusM: 1500,
    note: 'Asan Barrage (OSM dam way at 30.437 N, 77.666 E). OSM names the channel upstream of it "Tons Nadi" and has no named Asan waterway in the window, so "Asan" applies from the barrage reach to the Yamuna.',
  },
  {
    name: 'Padma',
    lon: 89.03,
    lat: 24.06,
    minUpKm2: 500000,
    radiusM: 25000,
    note: 'Hardinge Bridge reach, Bangladesh.',
  },
  {
    name: 'Meghna',
    lon: 90.62,
    lat: 23.0,
    minUpKm2: 1000000,
    radiusM: 30000,
    note: 'Lower Meghna below the Padma confluence near Chandpur, Bangladesh.',
  },
];

const intersects = (b, e) =>
  b[0] <= e[2] && b[2] >= e[0] && b[1] <= e[3] && b[3] >= e[1];
const inside = ([lon, lat], e) =>
  lon >= e[0] && lon <= e[2] && lat >= e[1] && lat <= e[3];
const round = (line) => line.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
const RAD = Math.PI / 180;
const metres = (a, b) =>
  Math.hypot((a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * RAD), a[1] - b[1]) *
  111195;
const sha = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// --- HydroRIVERS -----------------------------------------------------------
const dbf = readDbf(`${riversBase}.dbf`);
const ids = dbf.column('HYRIV_ID'),
  nexts = dbf.column('NEXT_DOWN'),
  uplands = dbf.column('UPLAND_SKM'),
  lengths = dbf.column('LENGTH_KM'),
  endos = dbf.column('ENDORHEIC'),
  hybas = dbf.column('HYBAS_L12');
const indexOf = new Map();
for (let i = 0; i < dbf.records; i++) indexOf.set(ids[i], i);
const shp = readShp(`${riversBase}.shp`);
const seeds = [];
for (const record of shp.records({ geometry: () => false }))
  if (record.bbox && intersects(record.bbox, SEED)) seeds.push(record.index);
const selected = new Set(seeds);
for (const seed of seeds) {
  let i = seed;
  for (let guard = 0; guard < 20000 && nexts[i] !== 0; guard++) {
    const next = indexOf.get(nexts[i]);
    if (next === undefined || selected.has(next)) break;
    selected.add(next);
    i = next;
  }
}
const reaches = [];
for (const record of shp.records({
  geometry: (index) => selected.has(index),
})) {
  if (!record.parts) continue;
  const i = record.index;
  const raw = record.parts.flat();
  const near = raw.some((p) => inside(p, SEED));
  reaches.push({
    id: ids[i],
    next: nexts[i],
    upKm2: uplands[i],
    lengthKm: lengths[i],
    hybas: hybas[i],
    ...(endos[i] ? { endorheic: true } : {}),
    name: null,
    nameSource: null,
    near,
    line: round(simplify(raw, near ? NEAR_TOL : FAR_TOL)),
  });
}
const byId = new Map(reaches.map((r) => [r.id, r]));

// --- Names: OSM waterways in the window -------------------------------------
const osm = JSON.parse(fs.readFileSync(osmFile, 'utf8'));
const clean = (name) => name.replace(/\s+River$/i, '').trim();
const bins = new Map();
for (const element of osm.elements || []) {
  const name = element.tags?.name;
  if (!name || !Array.isArray(element.geometry)) continue;
  const river = element.tags.waterway === 'river';
  for (const { lon, lat } of element.geometry) {
    const key = `${Math.floor(lon * 100)}:${Math.floor(lat * 100)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push({ p: [lon, lat], name: clean(name), river });
  }
}
function nearestOsm(p) {
  let best = null;
  const cx = Math.floor(p[0] * 100),
    cy = Math.floor(p[1] * 100);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (const v of bins.get(`${cx + dx}:${cy + dy}`) || []) {
        const d = metres(p, v.p);
        if (d <= OSM_MATCH_M && (!best || d < best.d)) best = { ...v, d };
      }
  return best;
}
for (const reach of reaches) {
  if (!reach.near) continue;
  const votes = new Map();
  for (const p of reach.line) {
    const hit = nearestOsm(p);
    if (hit)
      votes.set(hit.name, (votes.get(hit.name) || 0) + (hit.river ? 1.5 : 1));
  }
  const [name, score] =
    [...votes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (name && score >= reach.line.length * 0.5) {
    reach.name = name;
    reach.nameSource = 'osm';
  }
}
// --- Names: curated anchors ----------------------------------------------
const anchorsUsed = [];
for (const anchor of ANCHORS) {
  let best = null;
  for (const reach of reaches) {
    if (anchor.minUpKm2 && reach.upKm2 < anchor.minUpKm2) continue;
    if (anchor.maxUpKm2 && reach.upKm2 > anchor.maxUpKm2) continue;
    for (const p of reach.line) {
      const d = metres([anchor.lon, anchor.lat], p);
      if (d <= anchor.radiusM && (!best || d < best.d)) best = { reach, d };
    }
  }
  anchorsUsed.push({
    ...anchor,
    reach: best?.reach.id ?? null,
    distanceM: best ? Math.round(best.d) : null,
    upKm2: best?.reach.upKm2 ?? null,
  });
  if (best) {
    best.reach.name = anchor.name;
    best.reach.nameSource = 'curated';
  }
}
// --- Propagate large rivers' names downstream, largest first -----------------
const named = reaches
  .filter((r) => r.name && r.upKm2 >= PROPAGATE_MIN_KM2)
  .sort(
    (a, b) =>
      (b.nameSource === 'curated') - (a.nameSource === 'curated') ||
      b.upKm2 - a.upKm2,
  );
for (const start of named) {
  let reach = start;
  for (let guard = 0; guard < 20000 && reach.next; guard++) {
    const next = byId.get(reach.next);
    // A curated name overrides OSM downstream until a larger named river.
    const yields =
      next &&
      start.nameSource === 'curated' &&
      next.nameSource === 'osm' &&
      next.upKm2 < start.upKm2 * 2;
    if (!next || (next.name && !yields)) break;
    next.name = start.name;
    next.nameSource = `${start.nameSource}-downstream`;
    reach = next;
  }
}

// --- HydroBASINS level 12 -----------------------------------------------------
const bdbf = readDbf(`${basinsBase}.dbf`);
const bId = bdbf.column('HYBAS_ID'),
  bNext = bdbf.column('NEXT_DOWN'),
  bSub = bdbf.column('SUB_AREA'),
  bUp = bdbf.column('UP_AREA');
const units = [];
for (const record of readShp(`${basinsBase}.shp`).records({
  geometry: (_, bbox) => intersects(bbox, EXTENT),
})) {
  if (!record.parts) continue;
  const i = record.index;
  const outer = record.parts.reduce((a, b) => (b.length > a.length ? b : a));
  units.push({
    id: bId[i],
    next: bNext[i],
    subKm2: bSub[i],
    upKm2: bUp[i],
    ring: round(simplifyRing(outer, 0.0005)),
  });
}

// --- Write --------------------------------------------------------------------
const retrievedAt = '2026-11-07';
const source = {
  id: 'hydrosheds-v1',
  label: 'HydroSHEDS v1 (WWF)',
  url: 'https://www.hydrosheds.org/',
  license:
    'HydroSHEDS v1 License Agreement (free for non-commercial and commercial use; no stand-alone redistribution)',
  notice: 'hydro/HYDROSHEDS-NOTICE.txt',
  retrievedAt,
};
fs.mkdirSync(outDir, { recursive: true });
const strip = ({ near, ...rest }) => rest;
const riversDoc = {
  version: 1,
  extent: EXTENT,
  source: {
    ...source,
    product: 'HydroRIVERS v1.0, Asia (15 arc-second network)',
    citation:
      'Lehner, B., Grill G. (2013). Hydrological Processes 27(15): 2171-2186. https://doi.org/10.1002/hyp.9740',
    archiveSha256: sha(
      `${path.dirname(riversBase)}/../HydroRIVERS_v10_as_shp.zip`,
    ),
  },
  naming: {
    osm: {
      label: 'OpenStreetMap named waterways in the Doon window',
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      timestamp: osm.osm3s?.timestamp_osm_base ?? null,
    },
    anchors: anchorsUsed.map(
      ({ name, lon, lat, note, reach, distanceM, upKm2 }) => ({
        name,
        lon,
        lat,
        note,
        reach,
        distanceM,
        upKm2,
      }),
    ),
    propagation: `Names of reaches draining at least ${PROPAGATE_MIN_KM2} km² continue downstream until another named reach.`,
  },
  reaches: reaches.map(strip),
};
const basinsDoc = {
  version: 1,
  extent: EXTENT,
  source: {
    ...source,
    product: 'HydroBASINS v1c, Asia, level 12',
    citation:
      'Lehner, B., Grill G. (2013). Hydrological Processes 27(15): 2171-2186.',
    archiveSha256: sha(`${path.dirname(basinsBase)}/../hybas_as_lev12_v1c.zip`),
  },
  units,
};
fs.writeFileSync(path.join(outDir, 'rivers.json'), JSON.stringify(riversDoc));
fs.writeFileSync(
  path.join(outDir, 'basins-doon.json'),
  JSON.stringify(basinsDoc),
);
const vertices = reaches.reduce((n, r) => n + r.line.length, 0);
console.log(
  JSON.stringify({
    seeds: seeds.length,
    reaches: reaches.length,
    vertices,
    named: reaches.filter((r) => r.name).length,
    names: [...new Set(reaches.map((r) => r.name).filter(Boolean))],
    anchors: anchorsUsed.map((a) => [a.name, a.reach, a.distanceM, a.upKm2]),
    units: units.length,
    riversBytes: fs.statSync(path.join(outDir, 'rivers.json')).size,
    basinsBytes: fs.statSync(path.join(outDir, 'basins-doon.json')).size,
  }),
);
