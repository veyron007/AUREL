/** Offline build tool: explicit local PBF input only; never downloads or changes application keys. */
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  verifyRegionPack,
  validateRegionExtent,
  REGION_LIMITS,
} from '../src/regions/pack.js';
const run = promisify(execFile);
export const DEFAULT_EXTENT = Object.freeze([78.022, 30.312, 78.05, 30.34]);
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function points(value) {
  return typeof value[0] === 'number' ? [value] : value.flatMap(points);
}
export function buildRegionArtifacts(
  geojson,
  {
    extent = DEFAULT_EXTENT,
    extractAt,
    retrievedAt = new Date().toISOString(),
    extractSha256,
    omittedBoundaryFeatures = 0,
  } = {},
) {
  const names = [],
    counts = {
      features: geojson.features.length,
      positions: 0,
      names: 0,
      roads: 0,
      buildings: 0,
      water: 0,
      places: 0,
      suppliedHeights: 0,
    };
  for (const feature of geojson.features) {
    const p = feature.properties;
    counts[
      { road: 'roads', building: 'buildings', water: 'water', place: 'places' }[
        p.kind
      ]
    ]++;
    if (p.heightM !== null) counts.suppliedHeights++;
    const positions = points(feature.geometry.coordinates);
    counts.positions += positions.length;
    if (p.name) {
      let west = Infinity,
        south = Infinity,
        east = -Infinity,
        north = -Infinity;
      for (const [lon, lat] of positions) {
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
      }
      names.push({
        id: feature.id,
        name: p.name,
        aliases: [...p.aliases],
        kind: p.kind,
        coordinates: [(west + east) / 2, (south + north) / 2],
      });
    }
  }
  counts.names = names.length;
  names.sort((a, b) => a.id.localeCompare(b.id));
  const assets = {
    geometry: encode(geojson),
    names: encode({ version: 1, entries: names }),
  };
  const manifest = {
    version: 1,
    id: 'dehradun-core',
    name: 'Dehradun core',
    extent: [...extent],
    source: {
      id: 'openstreetmap-geofabrik',
      label: 'OpenStreetMap via Geofabrik Central Zone',
      url: 'https://download.geofabrik.de/asia/india/central-zone.html',
      extractAt,
      retrievedAt,
      extractSha256,
    },
    license: {
      id: 'ODbL-1.0',
      url: 'https://opendatacommons.org/licenses/odbl/1-0/',
      attribution: '© OpenStreetMap contributors',
    },
    assets: [
      ['geometry', 'geometry.geojson', 'geojson'],
      ['names', 'names.json', 'name-index'],
    ].map(([id, assetPath, format]) => ({
      id,
      path: assetPath,
      format,
      byteLength: assets[id].byteLength,
      sha256: digest(assets[id]),
    })),
    counts,
    coverage: 'partial',
    limitations: [
      'Community mapping is incomplete and can be outdated; absence does not mean a feature does not exist.',
      'This pack contains mapped footprints, roads, waterways and named places, not photography or a live digital twin.',
      'Only complete geometries wholly within the selected extent are included; features crossing the crop boundary are omitted.',
      `${omittedBoundaryFeatures} geometries with vertices both inside and outside the crop were omitted during this build.`,
      'Building heights appear only when an explicit usable OSM height tag is supplied; storey counts never become invented heights.',
      'Search locations are bounding-box centers of mapped features and are not entrances or verified access points.',
      'Source date is the extract snapshot time, not a survey date or proof of current conditions.',
    ],
  };
  return { manifest, assets };
}
const LICENSE_NOTICE = [
  'Dehradun core region database',
  '© OpenStreetMap contributors',
  'Licensed under the Open Data Commons Open Database License (ODbL) 1.0.',
  'https://opendatacommons.org/licenses/odbl/1-0/',
  'https://www.openstreetmap.org/copyright',
  'Derived locally from the public Geofabrik Central Zone extract.',
  'https://download.geofabrik.de/asia/india/central-zone.html',
  'Keep this notice and manifest provenance with redistributed database copies.',
  '',
].join('\n');
const GENERATED_FILES = [
  'manifest.json',
  'geometry.geojson',
  'names.json',
  'LICENSE.txt',
];
async function syncDirectory(fileSystem, directory) {
  const handle = await fileSystem.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeDurable(fileSystem, file, bytes) {
  await fileSystem.writeFile(file, bytes);
  const handle = await fileSystem.open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** Stage and verify a complete generation before replacing the previous directory. */
export async function publishRegionPack(
  result,
  destination,
  { fileSystem = fs } = {},
) {
  await verifyRegionPack(result.manifest, result.assets);
  const output = path.resolve(destination),
    parent = path.dirname(output);
  if (output === parent)
    throw new Error('Region output must be a generated pack directory');
  await fileSystem.mkdir(parent, { recursive: true });
  const lock = path.join(parent, `.${path.basename(output)}.publish-lock`);
  await fileSystem.mkdir(lock);
  let stage = null,
    backup = null,
    previous = false;
  try {
    try {
      const prior = await fileSystem.lstat(output);
      if (!prior.isDirectory() || prior.isSymbolicLink())
        throw new Error('Region output must be a real directory');
      const entries = await fileSystem.readdir(output);
      if (entries.some((name) => !GENERATED_FILES.includes(name)))
        throw new Error('Refusing to replace unrelated output files');
      previous = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    stage = await fileSystem.mkdtemp(
      path.join(parent, `.${path.basename(output)}.stage-`),
    );
    for (const asset of result.manifest.assets)
      await writeDurable(
        fileSystem,
        path.join(stage, asset.path),
        result.assets[asset.id],
      );
    await writeDurable(
      fileSystem,
      path.join(stage, 'manifest.json'),
      JSON.stringify(result.manifest, null, 2) + '\n',
    );
    await writeDurable(
      fileSystem,
      path.join(stage, 'LICENSE.txt'),
      LICENSE_NOTICE,
    );
    const stagedManifest = JSON.parse(
      await fileSystem.readFile(path.join(stage, 'manifest.json'), 'utf8'),
    );
    const stagedAssets = Object.fromEntries(
      await Promise.all(
        stagedManifest.assets.map(async (asset) => [
          asset.id,
          new Uint8Array(
            await fileSystem.readFile(path.join(stage, asset.path)),
          ),
        ]),
      ),
    );
    await verifyRegionPack(stagedManifest, stagedAssets);
    await syncDirectory(fileSystem, stage);
    if (previous) {
      const candidate = stage + '.previous';
      await fileSystem.rename(output, candidate);
      backup = candidate;
    }
    try {
      await fileSystem.rename(stage, output);
      stage = null;
    } catch (error) {
      if (backup) {
        try {
          await fileSystem.rename(backup, output);
          backup = null;
        } catch (rollback) {
          throw Object.assign(
            new AggregateError(
              [error, rollback],
              `Publication failed; previous pack preserved at ${backup}`,
            ),
            { backupPath: backup },
          );
        }
      }
      throw error;
    }
    await syncDirectory(fileSystem, parent);
    if (backup) {
      await fileSystem.rm(backup, { recursive: true, force: true });
      backup = null;
    }
    return result.manifest;
  } finally {
    if (stage) await fileSystem.rm(stage, { recursive: true, force: true });
    // A failed rollback retains its previous directory for explicit recovery.
    await fileSystem.rmdir(lock);
  }
}
export async function buildRegionPack({
  input,
  output,
  python = 'python3',
  extent = DEFAULT_EXTENT,
}) {
  if (!input || !output || !input.endsWith('.osm.pbf'))
    throw new Error('Provide a local .osm.pbf input and output directory');
  validateRegionExtent(extent);
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size > 400 * 1024 * 1024)
    throw new Error('PBF input exceeds400MiB build limit');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aurel-region-crop-'));
  try {
    const rawPath = path.join(temp, 'geometry.geojson');
    const helper = fileURLToPath(
      new URL('./regions/extract.py', import.meta.url),
    );
    const { stdout } = await run(
      python,
      [helper, path.resolve(input), rawPath, JSON.stringify(extent)],
      { timeout: 300000, maxBuffer: 1024 * 1024 },
    );
    const meta = JSON.parse(stdout);
    if ((await fs.stat(rawPath)).size > REGION_LIMITS.bytes)
      throw new Error('Cropped geometry exceeds pack byte limit');
    const geojson = JSON.parse(await fs.readFile(rawPath, 'utf8'));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(input)) hash.update(chunk);
    const result = buildRegionArtifacts(geojson, {
      extent,
      ...meta,
      extractSha256: hash.digest('hex'),
    });
    await publishRegionPack(result, output);
    return result.manifest;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      !['--input', '--output', '--python', '--extent'].includes(key) ||
      !args[i + 1]
    )
      throw new Error(
        'Expected --input --output [--python] [--extent west,south,east,north]',
      );
    options[key.slice(2)] =
      key === '--extent' ? args[i + 1].split(',').map(Number) : args[i + 1];
  }
  const manifest = await buildRegionPack(options);
  console.log(
    JSON.stringify({
      id: manifest.id,
      counts: manifest.counts,
      bytes: manifest.assets.reduce((sum, a) => sum + a.byteLength, 0),
      extractAt: manifest.source.extractAt,
    }),
  );
}
