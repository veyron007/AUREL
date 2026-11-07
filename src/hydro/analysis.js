/**
 * Raindrop analysis: choose a DEM window, route it in the worker, query the
 * drop, then hand off to the HydroSHEDS subset where the window ends.
 *
 * Window choice: a click inside the bundled Doon grid (with a 10-cell margin)
 * uses that grid, which also makes the drop work offline. Anywhere else, a
 * 256 × 256 live window is sampled from the keyless terrain mesh.
 */
import { createGridSpec, gridAround, lineLengthM } from './grid.js';
import {
  BUNDLED_ENCODING,
  LIVE_WINDOW,
  MESH_SOURCE,
  decodeHeights,
  sampleMeshGrid,
} from './demSampler.js';
import { basinAt, continueDownstream, namesAlong } from './farField.js';

const BUNDLED_MARGIN_CELLS = 10;
/** Live windows are keyed on a 0.05° lattice so nearby clicks share one fill. */
const LIVE_SNAP_DEG = 0.05;

const RAD = Math.PI / 180;
export function describeResolution(spec) {
  const midLat = (spec.north + spec.south) / 2;
  return {
    stepArcSec: Math.round(spec.stepLatDeg * 3600 * 100) / 100,
    eastWestM: Math.round(
      spec.stepLonDeg * RAD * 6371008.8 * Math.cos(midLat * RAD),
    ),
    northSouthM: Math.round(spec.stepLatDeg * RAD * 6371008.8),
  };
}

/** Is the point inside a grid with a margin of whole cells? */
export function insideWithMargin(
  spec,
  { lon, lat },
  margin = BUNDLED_MARGIN_CELLS,
) {
  return (
    lon > spec.west + margin * spec.stepLonDeg &&
    lon < spec.east - margin * spec.stepLonDeg &&
    lat > spec.south + margin * spec.stepLatDeg &&
    lat < spec.north - margin * spec.stepLatDeg
  );
}

/**
 * @param {{client: ReturnType<import('./workerClient.js').createHydroClient>,
 *   loadBundled?: () => Promise<{manifest: object, codes: Uint16Array}|null>,
 *   loadRivers?: () => Promise<object|null>,
 *   fetchTile?: Function, geoid?: () => Promise<(lat:number, lon:number)=>number>}} deps
 */
export function createRaindropAnalysis({
  client,
  loadBundled = async () => null,
  loadRivers = async () => null,
  loadBasins = async () => null,
  fetchTile,
  geoid,
}) {
  let bundled = null,
    bundledTried = false,
    rivers = null,
    riversTried = false,
    basins = null,
    basinsTried = false;
  const liveMeta = new Map();
  const disclosures = new Map();

  async function bundledGrid() {
    if (bundledTried) return bundled;
    bundledTried = true;
    try {
      const pack = await loadBundled();
      if (pack) {
        const spec = createGridSpec(pack.manifest.grid);
        if (pack.codes.length !== spec.cols * spec.rows)
          throw new RangeError('Bundled DEM size mismatch');
        bundled = { spec, manifest: pack.manifest, codes: pack.codes };
      }
    } catch {
      bundled = null;
    }
    return bundled;
  }
  async function riverNetwork() {
    if (riversTried) return rivers;
    riversTried = true;
    try {
      rivers = await loadRivers();
    } catch {
      rivers = null;
    }
    return rivers;
  }

  async function basinUnits() {
    if (basinsTried) return basins;
    basinsTried = true;
    try {
      basins = await loadBasins();
    } catch {
      basins = null;
    }
    return basins;
  }

  async function chooseWindow(point, signal) {
    const pack = await bundledGrid();
    if (pack && insideWithMargin(pack.spec, point)) {
      const key = `bundled:${pack.manifest.id}:${pack.manifest.asset.sha256}`;
      if (!client.isLoaded(key))
        disclosures.set(
          key,
          await client.load(key, pack.manifest.grid, decodeHeights(pack.codes)),
        );
      return {
        key,
        spec: pack.spec,
        dem: {
          kind: 'bundled',
          label: pack.manifest.name,
          source: pack.manifest.source,
          missingCells: pack.manifest.missingCells,
          datum: pack.manifest.encoding?.datum,
          quantizationM: BUNDLED_ENCODING.stepM,
        },
      };
    }
    if (typeof fetchTile !== 'function' || typeof geoid !== 'function')
      throw Object.assign(new Error('No terrain outside the bundled grid'), {
        code: 'offline-outside-pack',
      });
    const center = {
      lon: Math.round(point.lon / LIVE_SNAP_DEG) * LIVE_SNAP_DEG,
      lat: Math.round(point.lat / LIVE_SNAP_DEG) * LIVE_SNAP_DEG,
    };
    const spec = gridAround(center, LIVE_WINDOW);
    const key = `live:${center.lon.toFixed(2)},${center.lat.toFixed(2)}`;
    if (!client.isLoaded(key)) {
      const geoidHeight = await geoid();
      const sampled = await sampleMeshGrid(spec, {
        fetchTile,
        geoidHeight,
        signal,
      });
      if (sampled.missingCells > spec.cols * spec.rows * 0.2)
        throw Object.assign(new Error('Terrain window incomplete'), {
          code: 'terrain-incomplete',
        });
      disclosures.set(key, await client.load(key, spec, sampled.heights));
      liveMeta.set(key, sampled);
    }
    const sampled = liveMeta.get(key);
    return {
      key,
      spec,
      dem: {
        kind: 'live',
        label: MESH_SOURCE.name,
        source: {
          ...MESH_SOURCE,
          level: sampled?.level,
          tiles: sampled?.tiles,
        },
        missingCells: sampled?.missingCells ?? null,
        datum:
          'EGM96 orthometric (bundled geoid applied to the ellipsoidal mesh)',
        quantizationM: null,
      },
    };
  }

  /** Full analysis for one click. Throws coded errors for the controller. */
  async function analyze(point, { signal } = {}) {
    const window = await chooseWindow(point, signal);
    signal?.throwIfAborted();
    const drop = await client.query(window.key, point);
    if (drop.status !== 'ok')
      throw Object.assign(new Error(drop.status), { code: drop.status });
    const network = await riverNetwork();
    let far = null;
    if (network && drop.end !== 'loop') {
      far = continueDownstream(network, drop.path.at(-1), drop.exitUpstreamKm2);
    }
    const localNames = network
      ? namesAlong(network, drop.path, { upKm2: drop.pathUpKm2 })
      : [];
    const names = [...localNames];
    for (const name of far?.names || [])
      if (names.at(-1) !== name) names.push(name);
    return {
      point,
      window: {
        key: window.key,
        extent: [
          window.spec.west,
          window.spec.south,
          window.spec.east,
          window.spec.north,
        ],
        cols: window.spec.cols,
        rows: window.spec.rows,
        resolution: describeResolution(window.spec),
      },
      dem: window.dem,
      worker: client.mode,
      disclosure: disclosures.get(window.key) ?? null,
      drop: { ...drop, localLengthKm: lineLengthM(drop.path) / 1000 },
      farField: network
        ? far?.status === 'ok'
          ? {
              status: 'ok',
              path: far.path,
              lengthKm: lineLengthM(far.path) / 1000,
              reaches: far.reaches,
              end: far.end,
              handoffM: far.handoffM,
              upKm2: far.upKm2,
              startUpKm2: far.startUpKm2,
              source: network.source,
              naming: network.naming,
            }
          : { status: far?.status || 'not-needed' }
        : { status: 'unavailable' },
      rivers: names,
      basin: basinAt(await basinUnits(), drop.outlet),
    };
  }

  return { analyze, bundledGrid };
}
