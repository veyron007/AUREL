import {
  TYPE_BATCH_COLLECT_MS,
  TYPE_BATCH_MAX,
  TYPE_BATCH_MAX_ATTEMPTS,
  TYPE_BATCH_RETRY_MS,
} from './policy.js';

/**
 * Aircraft type lookups in batches (`POST /api/adsbdb/types`).
 *
 * Requests collect for TYPE_BATCH_COLLECT_MS (priority ones flush at once) and
 * go out up to TYPE_BATCH_MAX per request, one request at a time. The server
 * answers what it knows and lists the rest as `pending` while it fetches them
 * upstream at its paced rate; pending codes are asked again after
 * TYPE_BATCH_RETRY_MS. An answered miss is final for the session, exactly as
 * the per-aircraft path treated `{found: false}`; a failed request drops its
 * codes silently, as the per-aircraft path did.
 *
 * @param {{flightState: object, onData: (icao24: string, data: object) => void}} options
 */
export function createTypeBatcher({ flightState, onData }) {
  /** hex -> {attempts, priority, dueAt} */
  const waiting = new Map();
  let timer = null;
  let active = false;

  const transport = () => flightState.feed._source;
  const aborted = () => flightState.lifetime.signal.aborted;

  function schedule(delayMs) {
    if (timer || active || aborted()) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  /** Due codes, priority first, at most one batch. */
  function nextBatch(now) {
    const due = [...waiting].filter(([, job]) => job.dueAt <= now);
    due.sort((a, b) => Number(b[1].priority) - Number(a[1].priority));
    return due.slice(0, TYPE_BATCH_MAX).map(([hex]) => hex);
  }

  function requeue(hexes, now) {
    for (const hex of hexes) {
      const job = waiting.get(hex);
      if (!job) continue;
      if (job.attempts >= TYPE_BATCH_MAX_ATTEMPTS) waiting.delete(hex);
      else waiting.set(hex, { ...job, dueAt: now + TYPE_BATCH_RETRY_MS });
    }
  }

  function apply(reply, hexes) {
    const results = reply?.results || {};
    for (const hex of hexes) {
      const result = results[hex];
      if (!result) continue;
      waiting.delete(hex);
      if (result.found) onData(hex, result);
    }
    const pending = new Set(Array.isArray(reply?.pending) ? reply.pending : []);
    for (const hex of hexes)
      if (!(hex in results) && !pending.has(hex)) waiting.delete(hex);
    return hexes.filter((hex) => pending.has(hex));
  }

  async function flush() {
    if (aborted() || active) return;
    const hexes = nextBatch(Date.now());
    if (!hexes.length) return scheduleNext();
    for (const hex of hexes)
      waiting.set(hex, {
        ...waiting.get(hex),
        attempts: waiting.get(hex).attempts + 1,
      });
    active = true;
    const lifetime = flightState.lifetime;
    let pending = [];
    try {
      const reply = await transport().getTypeBatch(hexes, {
        signal: lifetime.signal,
      });
      if (lifetime.signal.aborted) return;
      pending = apply(reply, hexes);
    } catch {
      // Enrichment never surfaces errors; the codes are dropped as before.
      for (const hex of hexes) waiting.delete(hex);
    } finally {
      active = false;
    }
    if (lifetime.signal.aborted) return;
    requeue(pending, Date.now());
    scheduleNext();
  }

  function scheduleNext() {
    if (!waiting.size) return;
    const now = Date.now();
    const soonest = Math.min(...[...waiting.values()].map((job) => job.dueAt));
    schedule(Math.max(0, soonest - now));
  }

  return {
    /** Whether the transport offers the batch route. */
    available: () => typeof transport()?.getTypeBatch === 'function',

    /**
     * @param {string} icao24 Lowercase hex.
     * @param {boolean} [priority]
     */
    request(icao24, priority = false) {
      if (aborted()) return;
      const held = waiting.get(icao24);
      waiting.set(icao24, {
        attempts: held?.attempts || 0,
        priority: priority || Boolean(held?.priority),
        dueAt: held?.dueAt ?? Date.now(),
      });
      if (priority && timer) {
        clearTimeout(timer);
        timer = null;
      }
      schedule(priority ? 0 : TYPE_BATCH_COLLECT_MS);
    },

    clear() {
      waiting.clear();
      if (timer) clearTimeout(timer);
      timer = null;
      active = false;
    },
  };
}
