/**
 * Bounded storage, upstream pacing and request parsing for the adsbdb proxy
 * (server/providers/aircraft/enrichment.js).
 *
 * The proxy used to keep every aircraft and route it ever saw, in memory and
 * in `.gev-cache/adsbdb.json`. The LRU store below holds at most a fixed number
 * of keys per kind and evicts on write. The pacer moves the politeness bound
 * the browser used to enforce per tab (4 concurrent, one dispatch per 200 ms)
 * onto the server, where it now covers every tab at once.
 */

/** Most ICAO24 codes one batch request may ask about. */
export const ADSBDB_BATCH_MAX = 100;
/** Keys kept per kind (aircraft, routes); about 150 bytes each on disk. */
export const ADSBDB_LRU_MAX = 20_000;
/** Upstream politeness: concurrent requests and the gap between dispatches. */
export const ADSBDB_UPSTREAM_CONCURRENCY = 4;
export const ADSBDB_UPSTREAM_GAP_MS = 200;
/** Lookups waiting for an upstream slot; past this a key is reported pending. */
export const ADSBDB_UPSTREAM_MAX_QUEUED = 2_000;
/** How long a batch request waits for its unknown keys before answering. */
export const ADSBDB_BATCH_WAIT_MS = 2_500;

/** A full batch body is about 1.1 KB; this bounds a hostile one. */
export const ADSBDB_BATCH_MAX_BODY_BYTES = 8 * 1024;

const HEX_RE = /^[0-9a-f]{6}$/;

/**
 * The client-facing answer for one aircraft lookup.
 * @param {?object} data
 * @returns {{found: boolean}}
 */
export function typeResult(data) {
  return data ? { found: true, ...data } : { found: false };
}

/**
 * Wait for promises to settle, but no longer than `ms`.
 * @param {Promise<unknown>[]} promises
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function settleWithin(promises, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return Promise.race([Promise.allSettled(promises), deadline]).then(() =>
    clearTimeout(timer),
  );
}

/**
 * Read a request body as text; null once it passes `maxBytes`.
 * @param {AsyncIterable<Buffer|string>} req
 * @param {number} maxBytes
 * @returns {Promise<?string>}
 */
export async function readRequestTextCapped(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > maxBytes) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A Map with least-recently-used eviction. `get` refreshes recency; `set`
 * evicts the oldest keys once the bound is exceeded.
 * @param {number} maxEntries
 */
export function createLruStore(maxEntries) {
  const map = new Map();

  function set(key, value) {
    map.delete(key);
    map.set(key, value);
    while (map.size > maxEntries) map.delete(map.keys().next().value);
  }

  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    peek: (key) => map.get(key),
    has: (key) => map.has(key),
    set,
    keys: () => map.keys(),
    get size() {
      return map.size;
    },
    /**
     * Replace the contents with a persisted object, oldest `at` first so the
     * bound keeps the most recently fetched keys.
     * @param {Record<string, {at: number}>|undefined} snapshot
     */
    load(snapshot) {
      map.clear();
      const entries = Object.entries(snapshot || {}).filter(([, value]) =>
        Number.isFinite(value?.at),
      );
      entries.sort((a, b) => a[1].at - b[1].at);
      for (const [key, value] of entries) set(key, value);
    },
    toJSON: () => Object.fromEntries(map),
  };
}

/**
 * Run async tasks at most `concurrency` at a time and at least `gapMs` apart.
 * `schedule` returns null when `maxQueued` tasks are already waiting.
 * @param {{concurrency: number, gapMs: number, maxQueued: number, now?: () => number, setTimer?: Function}} options
 */
export function createPacer({
  concurrency,
  gapMs,
  maxQueued,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms).unref?.(),
}) {
  const queue = [];
  let active = 0;
  let lastStart = -Infinity;
  let timerArmed = false;

  function start(job) {
    lastStart = now();
    active += 1;
    let run;
    try {
      run = Promise.resolve(job.task());
    } catch (error) {
      run = Promise.reject(error);
    }
    run.then(job.resolve, job.reject).finally(() => {
      active -= 1;
      pump();
    });
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const wait = gapMs - (now() - lastStart);
      if (wait > 0) {
        if (!timerArmed) {
          timerArmed = true;
          setTimer(() => {
            timerArmed = false;
            pump();
          }, wait);
        }
        return;
      }
      start(queue.shift());
    }
  }

  return {
    /**
     * @template T
     * @param {() => Promise<T>} task
     * @returns {?Promise<T>}
     */
    schedule(task) {
      if (queue.length >= maxQueued) return null;
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
      });
    },
  };
}

/**
 * Parse a `POST /api/adsbdb/types` body: `{"hexes": [...]}` with 1 to
 * ADSBDB_BATCH_MAX ICAO24 codes. Returns the unique lowercased codes, or null
 * when the body is not valid.
 * @param {string} text
 * @returns {?string[]}
 */
export function parseTypeBatchBody(text) {
  if (typeof text !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const hexes = parsed?.hexes;
  if (!Array.isArray(hexes) || !hexes.length) return null;
  if (hexes.length > ADSBDB_BATCH_MAX) return null;
  const normalized = hexes.map((hex) => String(hex).toLowerCase());
  if (!normalized.every((hex) => HEX_RE.test(hex))) return null;
  return [...new Set(normalized)];
}
