import path from 'node:path';
import { createWeightedLedger } from '../field-context-budget.js';

/**
 * Open-Meteo request weight, from the provider's own
 * `ForecastApiResult.calculateQueryWeight` (open-meteo/open-meteo commit
 * cfb443ac, 29 July 2026):
 *   weight = max(1, V / 10, V / 10 × days / 14) per location,
 *   V = variables × Σ ensemble members (1 for a deterministic model).
 * `days` is the whole-day length of the requested time range. The result is
 * returned in tenths of a unit (deci-units), rounded up.
 */
export function openMeteoDeciUnits({
  variables,
  members = 1,
  days,
  locations = 1,
}) {
  for (const value of [variables, members, days, locations])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new TypeError('Open-Meteo weight inputs must be positive integers');
  const fraction = (variables * members) / 10;
  const weight = Math.max(1, fraction, fraction * (days / 14));
  return Math.ceil(weight * 10 - 1e-9) * locations;
}

/** Static run metadata is not covered by the published formula; local policy counts one unit. */
export const META_DECI_UNITS = 10;

/**
 * Mountain weather keeps its own durable ledger so a sheet can never starve
 * the Phase 3 field-context card. Counts are deci-units. Ceilings: 400 units
 * a day, 6,000 a month, 40 a minute (4% and 2% of Open-Meteo's published
 * 10,000/day and 300,000/month free limits).
 */
export const MOUNTAIN_CEILINGS = Object.freeze({
  day: 4000,
  month: 60000,
  minute: 400,
});
/** GIBS publishes no quota; one tile or metadata request is one unit. */
export const GIBS_CEILINGS = Object.freeze({
  day: 1000,
  month: 15000,
  minute: 120,
});

export function createMountainWeatherBudget({
  file = path.join(process.cwd(), '.gev-cache', 'mountain-weather-budget.json'),
  now = Date.now,
  dailyLimit,
  monthlyLimit,
  minuteLimit,
} = {}) {
  return serialized(
    createWeightedLedger({
      file,
      now,
      ceilings: MOUNTAIN_CEILINGS,
      dailyLimit,
      monthlyLimit,
      minuteLimit,
    }),
  );
}

export function createGibsBudget({
  file = path.join(process.cwd(), '.gev-cache', 'gibs-imerg-budget.json'),
  now = Date.now,
  dailyLimit,
  monthlyLimit,
  minuteLimit,
} = {}) {
  return serialized(
    createWeightedLedger({
      file,
      now,
      ceilings: GIBS_CEILINGS,
      dailyLimit,
      monthlyLimit,
      minuteLimit,
    }),
  );
}

/** One process-local queue avoids self-inflicted `budget-busy` lock contention. */
export function serialized(ledger) {
  let tail = Promise.resolve();
  return {
    reserve(units) {
      const next = tail.then(() => ledger.reserve(units));
      tail = next.catch(() => {});
      return next;
    },
  };
}
