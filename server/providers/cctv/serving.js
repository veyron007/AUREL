import { createHash } from 'node:crypto';

import { normalizeFeedType } from './normalize.js';

/**
 * Per-catalog views and frame caching for the CCTV proxy (../cctv.js).
 *
 * The catalog holds up to tens of thousands of cameras and is replaced only
 * when it refreshes, yet every CCTV request used to rebuild an id index from
 * it, and every `/sources` request re-projected and re-serialized it. A view
 * is built once per catalog array. Frames are kept briefly so viewers of the
 * same camera share one upstream fetch, which is abandoned when every one of
 * them has gone.
 */

/** Public fields of one camera as `/api/cctv/sources` lists it. */
function projectSource(source) {
  return {
    id: source.id,
    pack: source.pack,
    name: source.name,
    city: source.city,
    cityId: source.cityId,
    provider: source.provider,
    lat: source.lat,
    lon: source.lon,
    headingDeg: source.headingDeg,
    headingConfidence: source.headingConfidence || '',
    pitchDeg: source.pitchDeg,
    fovDeg: source.fovDeg,
    rangeM: source.rangeM,
    mountHeightM: source.mountHeightM,
    groundElevationM: source.groundElevationM,
    feedType: normalizeFeedType(source.feedType),
    sourceKind: source.sourceKind || (source.url ? 'configured' : 'fallback'),
    poseSource: source.poseSource,
    model: source.model || '',
    manufacturer: source.manufacturer || '',
    license: source.license,
    credit: source.credit || '',
    code: source.code || '',
    groundHeights: source.groundHeights || null,
  };
}

/**
 * @param {{trimmedPacks: (sources: object[]) => string[], onBuild?: () => void}} options
 */
export function createCatalogViews({ trimmedPacks, onBuild = () => {} }) {
  /** @type {WeakMap<object[], {sourceById: Map<string, object>, body: string, etag: string}>} */
  const views = new WeakMap();

  function build(sources) {
    onBuild();
    const body = JSON.stringify({
      trimmedPacks: trimmedPacks(sources) ?? [],
      sources: sources.map(projectSource),
    });
    const digest = createHash('sha1').update(body).digest('hex').slice(0, 16);
    return {
      sourceById: new Map(sources.map((source) => [source.id, source])),
      body,
      etag: `W/"cctv-${digest}"`,
    };
  }

  return {
    /**
     * The id index, serialized `/sources` body and its validator.
     * @param {object[]} sources The catalog array (replaced on refresh).
     */
    viewFor(sources) {
      let view = views.get(sources);
      if (!view) {
        view = build(sources);
        views.set(sources, view);
      }
      return view;
    },
  };
}

/**
 * Recent upstream frames per camera, bounded by count and bytes, evicting the
 * least recently used. A frame is served only while younger than `maxAgeMs`,
 * which is kept below the client's own frame refresh interval.
 * @param {{maxEntries: number, maxBytes: number, maxAgeMs: number, now?: () => number}} options
 */
export function createFrameCache({
  maxEntries,
  maxBytes,
  maxAgeMs,
  now = () => Date.now(),
}) {
  const frames = new Map(); // cameraId -> {at, frame}
  let bytes = 0;

  function drop(key) {
    const held = frames.get(key);
    if (!held) return;
    bytes -= held.frame.body.length;
    frames.delete(key);
  }

  return {
    get(cameraId) {
      const held = frames.get(cameraId);
      if (!held) return null;
      if (now() - held.at >= maxAgeMs) {
        drop(cameraId);
        return null;
      }
      frames.delete(cameraId);
      frames.set(cameraId, held);
      return held.frame;
    },
    set(cameraId, frame) {
      drop(cameraId);
      const size = frame?.body?.length ?? Infinity;
      if (size > maxBytes) return;
      frames.set(cameraId, { at: now(), frame });
      bytes += size;
      while (frames.size > maxEntries || bytes > maxBytes)
        drop(frames.keys().next().value);
    },
    stats: () => ({ entries: frames.size, bytes }),
  };
}

/**
 * Single-flight upstream fetches with per-client cancellation. Each caller
 * passes its own disconnect signal; a caller that leaves gets `null`, and the
 * shared fetch is aborted only when no caller is left waiting for it.
 */
export function createSharedFetches() {
  const inflight = new Map(); // key -> {controller, waiters, promise}

  function start(key, task) {
    const controller = new AbortController();
    const entry = { controller, waiters: 0, promise: null };
    entry.promise = Promise.resolve()
      .then(() => task(controller.signal))
      .finally(() => {
        if (inflight.get(key) === entry) inflight.delete(key);
      });
    inflight.set(key, entry);
    return entry;
  }

  return {
    /**
     * @template T
     * @param {string} key
     * @param {(signal: AbortSignal) => Promise<T>} task
     * @param {?AbortSignal} waiterSignal The caller's disconnect signal.
     * @returns {Promise<?T>}
     */
    run(key, task, waiterSignal) {
      const entry = inflight.get(key) || start(key, task);
      entry.waiters += 1;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          entry.waiters -= 1;
          waiterSignal?.removeEventListener('abort', leave);
          callback();
        };
        const leave = () =>
          finish(() => {
            if (entry.waiters === 0) {
              if (inflight.get(key) === entry) inflight.delete(key);
              entry.controller.abort();
            }
            resolve(null);
          });
        if (waiterSignal?.aborted) return leave();
        waiterSignal?.addEventListener('abort', leave, { once: true });
        entry.promise.then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error)),
        );
      });
    },
  };
}
