/**
 * Rain card arithmetic over the /api/hydro envelopes. Each function returns
 * plain numbers plus the source, unit, applicable time and class the panel
 * must print; nothing here formats text.
 */
import { accumulate, basinMean, IMERG_WINDOWS } from './imerg.js';
import {
  glofasPercentile,
  latencyMinutes,
  polygonForecast,
  representativePoints,
} from './cardsMath.js';

/** Largest number of IMERG cells sent in one request. */
export const MAX_IMERG_CELLS = 24;

/** The heaviest-weighted IMERG cells and the share of catchment they cover. */
export function imergRequestCells(weights) {
  const sorted = [...weights].sort((a, b) => b.km2 - a.km2);
  const used = sorted.slice(0, MAX_IMERG_CELLS);
  const total = sorted.reduce((sum, cell) => sum + cell.km2, 0);
  const covered = used.reduce((sum, cell) => sum + cell.km2, 0);
  return { cells: used, share: total ? covered / total : 0 };
}

/**
 * 1, 3 and 24 h basin accumulations from one 24 h IMERG envelope.
 * @returns {{state:string, reason?:string, latest?:string, latencyMin?:number, windows?:object, coverage?:number}}
 */
export function imergCard(envelope, weights, nowMs) {
  if (!envelope || !['ready', 'partial'].includes(envelope.state))
    return {
      state: 'unavailable',
      reason: envelope?.reason || 'upstream-unavailable',
    };
  const means = envelope.steps.map((step) => basinMean(weights, step.values));
  const windows = {};
  for (const [name, steps] of Object.entries(IMERG_WINDOWS))
    windows[name] = {
      ...accumulate(means.slice(0, steps)),
      from: envelope.steps[Math.min(steps, envelope.steps.length) - 1]?.time,
    };
  const coverage = Math.min(
    ...means.filter((m) => m.lo != null).map((m) => m.coverage),
    1,
  );
  return {
    state: envelope.state,
    latest: envelope.latest,
    retrievedAt: envelope.retrievedAt,
    latencyMin: latencyMinutes(
      new Date(Date.parse(envelope.latest) + 1800_000).toISOString(),
      nowMs,
    ),
    windows,
    coverage: Number.isFinite(coverage) ? coverage : 0,
    source: 'NASA GIBS IMERG_Precipitation_Rate_30min',
    unit: 'mm',
    class: 'derived',
  };
}

/** Points for the polygon forecast (at most three). */
export const forecastPoints = (weights) => representativePoints(weights, 3);

/** Weighted next-hours totals from a forecast envelope. */
export function forecastCard(envelope, points, nowMs) {
  if (!envelope || envelope.state !== 'ready')
    return {
      state: envelope?.state || 'unavailable',
      reason: envelope?.reason || 'upstream-unavailable',
    };
  const totals = polygonForecast(
    envelope.points,
    points.map((p) => p.share),
    nowMs,
  );
  return {
    state: 'ready',
    retrievedAt: envelope.retrievedAt,
    unitsReserved: envelope.unitsReserved,
    points: points.length,
    totals,
    source: 'Open-Meteo forecast (best match)',
    unit: 'mm',
    class: 'modelled',
  };
}

/** GloFAS percentile card; never exposes the discharge values themselves. */
export function glofasCard(envelope, nowMs) {
  if (!envelope || envelope.state !== 'ready')
    return {
      state: envelope?.state || 'unavailable',
      reason: envelope?.reason || 'upstream-unavailable',
    };
  const rank = glofasPercentile(envelope, nowMs);
  return {
    state: rank.status === 'ok' ? 'ready' : 'insufficient',
    reason: rank.status === 'ok' ? null : rank.status,
    percentile: rank.percentile ?? null,
    n: rank.n ?? null,
    day: rank.day ?? null,
    from: rank.from ?? null,
    to: rank.to ?? null,
    cell: envelope.cell,
    retrievedAt: envelope.retrievedAt,
    unitsReserved: envelope.unitsReserved,
    source: 'GloFAS v4 via Open-Meteo Flood API',
    unit: 'percentile',
    class: 'derived',
  };
}

/** One watch observation from a 3 h IMERG envelope. */
export function watchObservation(envelope, weights) {
  if (!envelope || !['ready', 'partial'].includes(envelope.state)) return null;
  const means = envelope.steps.map((step) => basinMean(weights, step.values));
  const total = accumulate(means);
  const coverage = Math.min(...means.map((m) => m.coverage));
  return {
    windowEnd: new Date(Date.parse(envelope.latest) + 1800_000)
      .toISOString()
      .replace('.000Z', 'Z'),
    lo: total.lo,
    hi: total.hi,
    coverage,
    complete: total.complete,
  };
}
