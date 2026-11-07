/**
 * Per-source request ledger for the Second Source adapters.
 *
 * Every upstream dispatch is reserved here BEFORE it leaves the process, so a
 * failed attempt still counts. A reservation is refused (never queued) when
 * the minimum spacing, the per-minute cap, the per-day cap or an upstream
 * cooldown would be crossed. The ledger is in memory: a server restart resets
 * the counters, which the admission record states as a limit.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const COOLDOWN_MIN_MS = 5_000;
const COOLDOWN_MAX_MS = 10 * MINUTE_MS;

/** Self-imposed budgets. Only adsb.fi publishes a limit (1 request per second). */
export const SECOND_SOURCE_BUDGETS = Object.freeze({
  emsc: Object.freeze({ minIntervalMs: 1_000, perMinute: 20, perDay: 500 }),
  geofon: Object.freeze({ minIntervalMs: 1_000, perMinute: 20, perDay: 500 }),
  'adsb-fi': Object.freeze({
    minIntervalMs: 1_100,
    perMinute: 20,
    perDay: 1_000,
  }),
  'adsb-lol': Object.freeze({
    minIntervalMs: 1_100,
    perMinute: 20,
    perDay: 1_000,
  }),
});

const positive = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * @param {object} options
 * @param {string} options.sourceId
 * @param {{minIntervalMs: number, perMinute: number, perDay: number}} options.budget
 * @param {() => number} [options.now]
 */
export function createRequestLedger({ sourceId, budget, now = Date.now }) {
  if (!sourceId) throw new TypeError('A ledger needs a source id');
  const limits = Object.freeze({
    minIntervalMs: positive(budget?.minIntervalMs, 1_000),
    perMinute: positive(budget?.perMinute, 10),
    perDay: positive(budget?.perDay, 100),
  });
  /** Dispatch times inside the trailing day, oldest first. */
  let dispatches = [];
  let cooldownUntil = 0;
  let cooldownStatus = null;
  let totals = { dispatched: 0, denied: 0, failed: 0, succeeded: 0 };
  let lastDenial = null;
  let lastOutcome = null;

  function prune(clock) {
    const dayStart = clock - DAY_MS;
    if (dispatches.length && dispatches[0] <= dayStart)
      dispatches = dispatches.filter((at) => at > dayStart);
  }

  function deny(reason, clock, retryAt) {
    totals = { ...totals, denied: totals.denied + 1 };
    lastDenial = { reason, at: clock };
    return {
      ok: false,
      reason,
      retryAfterMs: Math.max(0, Math.ceil((retryAt ?? clock) - clock)),
    };
  }

  /** Reserve one dispatch, or explain the refusal. Never waits. */
  function reserve() {
    const clock = now();
    if (!Number.isFinite(clock)) return deny('clock', 0, 0);
    prune(clock);
    if (clock < cooldownUntil) return deny('cooldown', clock, cooldownUntil);
    const last = dispatches.at(-1);
    if (last != null && clock < last)
      return deny('clock-reversed', clock, last);
    if (last != null && clock - last < limits.minIntervalMs)
      return deny('min-interval', clock, last + limits.minIntervalMs);
    const inMinute = dispatches.filter((at) => at > clock - MINUTE_MS);
    if (inMinute.length >= limits.perMinute)
      return deny('minute-limit', clock, inMinute[0] + MINUTE_MS);
    if (dispatches.length >= limits.perDay)
      return deny('daily-limit', clock, dispatches[0] + DAY_MS);
    dispatches = [...dispatches, clock];
    totals = { ...totals, dispatched: totals.dispatched + 1 };
    return { ok: true, at: clock };
  }

  /**
   * Record how a reserved dispatch ended. A 429, or a 5xx on the final
   * attempt, opens a bounded cooldown; a 5xx that will be retried does not.
   */
  function settle({
    ok,
    status = null,
    retryAfterMs = null,
    final = true,
  } = {}) {
    const clock = now();
    lastOutcome = { ok: Boolean(ok), status, at: clock };
    if (ok) {
      totals = { ...totals, succeeded: totals.succeeded + 1 };
      return;
    }
    totals = { ...totals, failed: totals.failed + 1 };
    if (
      status === 429 ||
      (final && Number.isInteger(status) && status >= 500)
    ) {
      const fallback = status === 429 ? 60_000 : 15_000;
      const wait = Math.min(
        COOLDOWN_MAX_MS,
        Math.max(COOLDOWN_MIN_MS, positive(retryAfterMs, fallback)),
      );
      cooldownUntil = Math.max(cooldownUntil, clock + wait);
      cooldownStatus = status;
    }
  }

  /** JSON-safe ledger row for the status route and the admission evidence. */
  function snapshot() {
    const clock = now();
    prune(clock);
    const cooling = clock < cooldownUntil;
    return {
      sourceId,
      limits: { ...limits },
      lastMinute: dispatches.filter((at) => at > clock - MINUTE_MS).length,
      lastDay: dispatches.length,
      totals: { ...totals },
      cooldownUntil: cooling ? cooldownUntil : null,
      cooldownStatus: cooling ? cooldownStatus : null,
      lastDenial: lastDenial ? { ...lastDenial } : null,
      lastOutcome: lastOutcome ? { ...lastOutcome } : null,
    };
  }

  return { sourceId, reserve, settle, snapshot };
}

/** One ledger per admitted Second Source upstream. */
export function createSecondSourceLedgers({
  now = Date.now,
  budgets = SECOND_SOURCE_BUDGETS,
} = {}) {
  return Object.fromEntries(
    Object.entries(budgets).map(([sourceId, budget]) => [
      sourceId,
      createRequestLedger({ sourceId, budget, now }),
    ]),
  );
}
