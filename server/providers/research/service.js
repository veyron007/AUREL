import path from 'node:path';
import { createFieldContextBudget } from '../field-context-budget.js';
import { readResponseJsonCapped } from '../common/http.js';
import { requestWithDeadline } from '../../../src/sources/requestDeadline.js';
import {
  EARTH_SEARCH,
  SENTINEL_COLLECTION,
  validateAnalysisInput,
  validateSearchInput,
  admitSentinelItem,
} from './metadata.js';
import { runSentinelJob } from './workerRunner.js';
const SAFE_REASONS = new Set([
  'unsupported-science-metadata',
  'unsupported-asset',
  'scene-does-not-cover-roi',
  'unsupported-tiff-grid',
  'range-budget-exceeded',
  'invalid-range-response',
  'analysis-timeout',
  'decode-failed',
  'rate-limited',
  'upstream-unavailable',
]);
const rejected = (reason, sceneId = null) => ({
  version: 1,
  status: 'rejected',
  reason,
  sceneId,
});
export function createSentinelNdviService({
  fetchImpl = fetch,
  now = Date.now,
  runJob = runSentinelJob,
  budget = createFieldContextBudget({
    file: path.join(process.cwd(), '.gev-cache', 'research-budget.json'),
    dailyLimit: 48,
    monthlyLimit: 500,
    minuteLimit: 4,
  }),
} = {}) {
  let busy = false,
    nextStart = 0,
    cooldownUntil = 0,
    reservationQueue = Promise.resolve();
  function reserve() {
    const pending = reservationQueue.then(() => budget.reserve());
    reservationQueue = pending.catch(() => {});
    return pending;
  }
  async function catalog(url, options, signal) {
    if (now() < cooldownUntil) throw new Error('rate-limited');
    return requestWithDeadline(
      async (scoped) => {
        const response = await fetchImpl(url, {
          ...options,
          signal: scoped,
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 429) {
            const retry = response.headers.get('retry-after');
            const seconds = Number(retry);
            const delay =
              Number.isFinite(seconds) && seconds > 0
                ? seconds * 1000
                : Date.parse(retry) - now();
            cooldownUntil =
              now() +
              Math.min(
                86400000,
                Math.max(
                  60000,
                  Number.isFinite(delay) && delay > 0 ? delay : 600000,
                ),
              );
            throw new Error('rate-limited');
          }
          throw new Error('upstream-unavailable');
        }
        return readResponseJsonCapped(response, 1024 * 1024, scoped);
      },
      { signal, timeoutMs: 15000 },
    );
  }
  return {
    async analyze(value, { signal } = {}) {
      const input = validateAnalysisInput(value);
      signal?.throwIfAborted();
      if (now() < cooldownUntil) return rejected('rate-limited', input.sceneId);
      if (busy) return rejected('busy', input.sceneId);
      if (now() < nextStart) return rejected('cooldown', input.sceneId);
      busy = true;
      nextStart = now() + 15000;
      try {
        const admission = await reserve();
        signal?.throwIfAborted();
        if (!admission.ok) return rejected(admission.reason, input.sceneId);
        const raw = await catalog(
          `${EARTH_SEARCH}/collections/${SENTINEL_COLLECTION}/items/${input.sceneId}`,
          {},
          signal,
        );
        const item = admitSentinelItem(raw, input.sceneId);
        return await runJob(item, input, { signal });
      } catch (error) {
        signal?.throwIfAborted();
        if (error.message === 'rate-limited' && cooldownUntil <= now())
          cooldownUntil =
            now() +
            Math.min(
              86400000,
              Math.max(
                600000,
                Number.isFinite(error.retryMs) ? error.retryMs : 0,
              ),
            );
        return rejected(
          SAFE_REASONS.has(error.message)
            ? error.message
            : 'upstream-unavailable',
          input.sceneId,
        );
      } finally {
        busy = false;
      }
    },
    async search(value, { signal } = {}) {
      const input = validateSearchInput(value);
      signal?.throwIfAborted();
      if (now() < cooldownUntil)
        return {
          version: 1,
          status: 'rejected',
          reason: 'rate-limited',
          scenes: [],
        };
      try {
        const admission = await reserve();
        signal?.throwIfAborted();
        if (!admission.ok)
          return {
            version: 1,
            status: 'rejected',
            reason: admission.reason,
            scenes: [],
          };
        const raw = await catalog(
          `${EARTH_SEARCH}/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              collections: [SENTINEL_COLLECTION],
              intersects: {
                type: 'Point',
                coordinates: [input.lon, input.lat],
              },
              datetime: `${input.fromDay}T00:00:00Z/${input.toDay}T23:59:59Z`,
              limit: 10,
              sortby: [{ field: 'properties.datetime', direction: 'desc' }],
            }),
          },
          signal,
        );
        if (!Array.isArray(raw.features) || raw.features.length > 10)
          throw new Error('upstream-unavailable');
        const scenes = [];
        for (const row of raw.features) {
          try {
            const item = admitSentinelItem(row, row.id);
            const day = item.acquiredAt.slice(0, 10);
            if (day < input.fromDay || day > input.toDay) continue;
            scenes.push({
              id: item.id,
              acquiredAt: item.acquiredAt,
              cloudCoverPct: item.cloudCoverPct,
              resolutionM: 10,
              maskResolutionM: 20,
              processingBaseline: item.processingBaseline,
            });
          } catch {
            /* Only catalog items with admitted scientific metadata are selectable. */
          }
        }
        return {
          version: 1,
          status: 'available',
          reason: null,
          requested: input,
          retrievedAt: new Date(now()).toISOString(),
          scenes,
        };
      } catch (error) {
        signal?.throwIfAborted();
        return {
          version: 1,
          status: 'rejected',
          reason: SAFE_REASONS.has(error.message)
            ? error.message
            : 'upstream-unavailable',
          scenes: [],
        };
      }
    },
  };
}
