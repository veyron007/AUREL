import {
  readResponseJsonCapped,
  readResponseBytesCapped,
  readResponseTextCapped,
} from '../common/http.js';
import { requestWithDeadline } from '../../../src/sources/requestDeadline.js';

const BUDGET_REASONS = new Set([
  'budget-storage',
  'budget-busy',
  'budget-units',
  'clock-reversed',
  'daily-limit',
  'monthly-limit',
  'minute-limit',
]);

export class SourceError extends Error {
  constructor(reason, { retry = false } = {}) {
    super(reason);
    this.reason = reason;
    this.state = BUDGET_REASONS.has(reason) ? 'blocked' : 'unavailable';
    this.retry = retry;
  }
}

function cooldownFor(response, clock) {
  const raw = response.headers?.get('retry-after');
  const delay = /^\d+$/.test(raw || '')
    ? Number(raw) * 1000
    : Date.parse(raw) - clock;
  return Number.isFinite(delay) && delay > 0
    ? Math.min(86400000, Math.max(60000, delay))
    : 5 * 60000;
}

/**
 * Fixed-host acquisition: each attempt reserves its weighted units before
 * dispatch, redirects are refused, bodies are capped, and at most
 * `maxAttempts` attempts run (retrying only network failures and HTTP 5xx).
 * HTTP 429 starts a cooldown shared by every request through this acquirer.
 */
export function createAcquirer({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  budget,
  timeoutMs = 9000,
  maxAttempts = 2,
  retryDelayMs = 400,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  accept = 'application/json',
}) {
  let coolUntil = 0;
  async function attempt(url, maxBytes, read) {
    return requestWithDeadline(
      async (signal) => {
        let response;
        try {
          response = await fetchImpl(url, {
            signal,
            redirect: 'error',
            headers: {
              Accept: accept,
              'User-Agent': 'AUREL-personal-mountain-weather/1.0',
            },
          });
        } catch {
          throw new SourceError('upstream-unavailable', { retry: true });
        }
        if (response.status === 429) {
          coolUntil = now() + cooldownFor(response, now());
          throw new SourceError('rate-limited');
        }
        if (!response.ok)
          throw new SourceError('upstream-unavailable', {
            retry: response.status >= 500,
          });
        if (read === 'bytes')
          return readResponseBytesCapped(response, maxBytes, signal);
        if (read === 'text')
          return readResponseTextCapped(response, maxBytes, signal);
        return readResponseJsonCapped(response, maxBytes, signal);
      },
      { timeoutMs },
    );
  }
  return async function acquire({ url, units, maxBytes, read = 'json' }) {
    let last = new SourceError('upstream-unavailable');
    for (let index = 0; index < maxAttempts; index++) {
      if (coolUntil > now()) throw new SourceError('rate-limited');
      const admission = await budget.reserve(units);
      if (!admission?.ok)
        throw new SourceError(admission?.reason || 'budget-storage');
      try {
        return await attempt(url, maxBytes, read);
      } catch (error) {
        last =
          error instanceof SourceError
            ? error
            : new SourceError('upstream-unavailable', {
                retry: error?.name === 'TimeoutError',
              });
        if (!last.retry) break;
        if (index + 1 < maxAttempts) await sleep(retryDelayMs);
      }
    }
    throw last;
  };
}

/**
 * Bounded cache with in-flight coalescing. A failed refresh may return the
 * previous value as stale within `staleMs`, preserving its retrieval time.
 * An upstream failure (not a local budget refusal) is remembered for
 * `failMs`, so repeated sheets do not spend budget on the same failure.
 */
export function createSourceCache({
  now = Date.now,
  max = 96,
  failMs = 2 * 60000,
} = {}) {
  const entries = new Map(),
    inflight = new Map(),
    failures = new Map();
  function remember(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > max) entries.delete(entries.keys().next().value);
  }
  return function get(key, { ttlMs, staleMs }, load) {
    const old = entries.get(key);
    const age = old ? now() - old.retrievedAt : Infinity;
    if (old && age >= 0 && age < ttlMs)
      return Promise.resolve({ ...old, stale: false, reason: null });
    if (inflight.has(key)) return inflight.get(key);
    const failed = failures.get(key);
    if (failed && failed.until > now()) {
      if (old && age >= 0 && age <= staleMs)
        return Promise.resolve({ ...old, stale: true, reason: failed.reason });
      return Promise.reject(new SourceError(failed.reason));
    }
    failures.delete(key);
    const pending = (async () => {
      try {
        const value = await load();
        const entry = { value, retrievedAt: now() };
        remember(key, entry);
        return { ...entry, stale: false, reason: null };
      } catch (error) {
        const reason = error?.reason || 'upstream-unavailable';
        if (error?.state !== 'blocked') {
          failures.set(key, { until: now() + failMs, reason });
          while (failures.size > max)
            failures.delete(failures.keys().next().value);
        }
        if (old && age >= 0 && age <= staleMs)
          return { ...old, stale: true, reason };
        throw error instanceof SourceError
          ? error
          : new SourceError('upstream-unavailable');
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
    return pending;
  };
}
