/**
 * `get_free_budget` arithmetic: estimated remaining units per Free-only
 * ledger, so an agent can predict a refusal before it asks. The ledgers are
 * the persistent counters the providers already keep (.gev-cache/*.json, see
 * server/providers/field-context-budget.js); this module only reads their
 * state. The answer is always "estimated remaining": other tabs, other
 * processes and upstream weighting can spend units first, so it is never a
 * guarantee that a request will be dispatched free.
 *
 * Portable: the Node reader lives in server/agentDesk/freeBudget.js.
 */

/**
 * The ledgers and the limits their providers construct them with. Keep in
 * step with the provider defaults; budget.test.mjs reads the provider source
 * and fails when they drift.
 */
export const FREE_LEDGERS = Object.freeze([
  Object.freeze({
    id: 'field-context',
    provider: 'Open-Meteo forecast and CAMS air quality (Planner)',
    file: 'field-context-budget.json',
    unit: 'upstream request',
    limits: Object.freeze({ minute: 10, day: 100, month: 2000 }),
  }),
  Object.freeze({
    id: 'imagery-history',
    provider: 'NASA CMR / GIBS dated imagery (Chronicle)',
    file: 'imagery-history-budget.json',
    unit: 'upstream request',
    limits: Object.freeze({ minute: 10, day: 100, month: 2000 }),
  }),
  Object.freeze({
    id: 'openaq',
    provider: 'OpenAQ station observations (Breath)',
    file: 'openaq-budget.json',
    unit: 'upstream request',
    limits: Object.freeze({ minute: 10, day: 100, month: 2000 }),
  }),
  Object.freeze({
    id: 'mountain-weather',
    provider:
      'Open-Meteo forecast, ensemble and ERA5-Land (Planner checkpoints)',
    file: 'mountain-weather-budget.json',
    unit: 'weighted Open-Meteo unit',
    limits: Object.freeze({ minute: 400, day: 4000, month: 60000 }),
  }),
  Object.freeze({
    id: 'gibs-imerg',
    provider: 'NASA GIBS IMERG precipitation (Planner rain lane)',
    file: 'gibs-imerg-budget.json',
    unit: 'tile or metadata request',
    limits: Object.freeze({ minute: 120, day: 1000, month: 15000 }),
  }),
  Object.freeze({
    id: 'orbit-witness-stac',
    provider: 'Earth Search and NASA CMR-STAC scene search (Orbit Witness)',
    file: 'orbit-witness-stac-budget.json',
    unit: 'upstream request',
    limits: Object.freeze({ minute: 10, day: 100, month: 2000 }),
  }),
  Object.freeze({
    id: 'research',
    provider: 'Earth Search Sentinel-2 L2A NDVI (Research)',
    file: 'research-budget.json',
    unit: 'analysis job',
    limits: Object.freeze({ minute: 4, day: 48, month: 500 }),
  }),
]);

export const BUDGET_WORDING =
  'Estimated remaining units from the local ledgers. Not a guarantee of free dispatch: other tabs or processes may spend units first, and upstream services may weight requests.';

const PERIOD_KEYS = Object.freeze({
  minute: (iso) => iso.slice(0, 16),
  day: (iso) => iso.slice(0, 10),
  month: (iso) => iso.slice(0, 7),
});

function validState(state) {
  return (
    state &&
    typeof state === 'object' &&
    state.version === 1 &&
    Number.isFinite(state.lastAt) &&
    Object.keys(PERIOD_KEYS).every(
      (period) =>
        typeof state[period] === 'string' &&
        Number.isSafeInteger(state[`${period}Count`]) &&
        state[`${period}Count`] >= 0,
    )
  );
}

/**
 * One ledger's estimate. `state` is the parsed ledger file, `null` when it
 * does not exist yet (nothing spent), or `undefined` when it is unreadable.
 * @param {typeof FREE_LEDGERS[number]} ledger
 * @param {object | null | undefined} state
 * @param {number} now Epoch ms.
 */
export function ledgerEstimate(ledger, state, now) {
  const iso = new Date(now).toISOString();
  const base = {
    ledger: ledger.id,
    provider: ledger.provider,
    unit: ledger.unit,
    limits: { ...ledger.limits },
  };
  if (state === undefined || (state !== null && !validState(state)))
    return {
      ...base,
      status: 'unreadable',
      used: null,
      estimated_remaining: null,
      estimated_remaining_units: null,
      note: 'The ledger could not be read; the provider refuses rather than guess, so expect refusals.',
    };
  const used = {};
  const remaining = {};
  for (const [period, keyOf] of Object.entries(PERIOD_KEYS)) {
    const current = state && state[period] === keyOf(iso);
    used[period] = current ? state[`${period}Count`] : 0;
    remaining[period] = Math.max(0, ledger.limits[period] - used[period]);
  }
  const units = Math.min(remaining.day, remaining.month);
  return {
    ...base,
    status: units === 0 ? 'exhausted' : 'available',
    used,
    estimated_remaining: remaining,
    estimated_remaining_units: units,
    note:
      remaining.minute === 0 && units > 0
        ? 'The per-minute allowance is spent; wait a minute.'
        : null,
  };
}

/**
 * The whole answer: every ledger, the providers Free-only pauses, and the
 * wording that keeps it an estimate.
 */
export function freeBudgetAnswer(
  states,
  { now = Date.now(), paused = [] } = {},
) {
  return {
    estimated: true,
    wording: BUDGET_WORDING,
    as_of: new Date(now).toISOString(),
    ledgers: FREE_LEDGERS.map((ledger) =>
      ledgerEstimate(ledger, states[ledger.id], now),
    ),
    paused_by_free_only: [...paused],
  };
}

/** A one-line summary in the required wording. */
export function budgetSummary(answer) {
  const parts = answer.ledgers.map((row) =>
    row.estimated_remaining_units === null
      ? `${row.ledger}: unreadable`
      : `${row.ledger}: about ${row.estimated_remaining_units} ${row.unit}s left today (estimated)`,
  );
  return `Estimated remaining free units — ${parts.join('; ')}. Not a guarantee of free dispatch.`;
}
