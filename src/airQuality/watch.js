/**
 * @module airQuality/watch
 *
 * The station-threshold Watchlist condition: "tell me when this monitor's
 * PM2.5 24 h mean enters Poor or worse".
 *
 * - The threshold is a NAQI category for one pollutant, evaluated on that
 *   pollutant's CPCB averaging period (24 h, or 8 h for CO and O3) ending at
 *   the newest observed hour, with CPCB's completeness rule.
 * - It fires once per crossing: only on a below → at-or-above transition.
 *   Staying above never repeats; dropping below re-arms it.
 * - A cooldown suppresses a second notification within six hours of the last.
 * - Each evaluation is deduplicated by station id and observation hour, so a
 *   repeated check of the same hour never fires twice.
 * - The first successful check (or one after a gap) is a silent baseline.
 * - Missing or insufficient hours keep the last known side: a gap is not a
 *   crossing, in either direction.
 */
import {
  NAQI_BREAKPOINTS,
  NAQI_CATEGORIES,
  MIN_HOURS_24H,
  MIN_HOURS_8H,
  POLLUTANTS,
  naqiSubIndex,
  newestHourEnd,
  trailingMean,
  unitLabel,
} from './naqi.js';

export const STATION_WATCH_TYPE = 'aq-station-threshold';
export const STATION_WATCH_COOLDOWN_MS = 6 * 3_600_000;
/** Categories a watch may name: alerting on "Good" would be noise. */
export const STATION_WATCH_CATEGORIES = Object.freeze([
  'satisfactory',
  'moderate',
  'poor',
  'very-poor',
  'severe',
]);
const SIDES = ['unknown', 'below', 'above'];
const CONDITION_KEYS = [
  'type',
  'provider',
  'stationId',
  'stationName',
  'sensorId',
  'pollutant',
  'category',
];
const NOTE_KEYS = [
  'id',
  'createdAt',
  'kind',
  'stationId',
  'stationName',
  'pollutant',
  'category',
  'mean',
  'unit',
  'averagingHours',
  'hours',
  'observedTo',
  'index',
];

const fail = () => {
  throw new TypeError('Invalid station watch data');
};
const exactKeys = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
};
const shortText = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail();
};
const isoText = (value) => {
  shortText(value, 24);
  if (new Date(value).toISOString() !== value) fail();
};
const nullableTime = (value) => {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 0) fail();
};

/** Validate a station-threshold condition. Returns a copy. */
export function validateStationCondition(value) {
  exactKeys(value, CONDITION_KEYS);
  if (value.type !== STATION_WATCH_TYPE || value.provider !== 'openaq') fail();
  if (typeof value.stationId !== 'string') fail();
  if (!/^openaq:\d{1,12}$/.test(value.stationId)) fail();
  shortText(value.stationName, 160);
  if (!Number.isSafeInteger(value.sensorId) || value.sensorId <= 0) fail();
  if (!Object.hasOwn(NAQI_BREAKPOINTS, value.pollutant)) fail();
  if (!STATION_WATCH_CATEGORIES.includes(value.category)) fail();
  return { ...value };
}

/** Build a condition from a station, one of its sensors and a category. */
export function createStationCondition({ station, pollutant, category }) {
  const sensor = station?.sensors?.find((row) => row.pollutant === pollutant);
  if (!sensor) fail();
  return validateStationCondition({
    type: STATION_WATCH_TYPE,
    provider: 'openaq',
    stationId: station.id,
    stationName: String(station.name || station.id).slice(0, 160),
    sensorId: sensor.sensorId,
    pollutant,
    category,
  });
}

/** The concentration at which the condition's category begins, in table units. */
export function conditionThreshold(condition) {
  const table = NAQI_BREAKPOINTS[condition.pollutant];
  const index = NAQI_CATEGORIES.findIndex((c) => c.id === condition.category);
  return {
    value: table.rows[index][0],
    unit: unitLabel(table.unit),
    averagingHours: table.hours,
  };
}

/** Validate the crossing state a station watch keeps in its runtime. */
export function validateStationState(value) {
  exactKeys(value, ['side', 'lastObservedEndMs', 'lastFiredAt']);
  if (!SIDES.includes(value.side)) fail();
  nullableTime(value.lastObservedEndMs);
  nullableTime(value.lastFiredAt);
  return { ...value };
}

/** Validate one crossing notification. */
export function validateCrossingNote(note) {
  exactKeys(note, NOTE_KEYS);
  shortText(note.id, 160);
  isoText(note.createdAt);
  if (note.kind !== 'aq-crossing') fail();
  if (!/^openaq:\d{1,12}$/.test(String(note.stationId))) fail();
  shortText(note.stationName, 160);
  if (!Object.hasOwn(NAQI_BREAKPOINTS, note.pollutant)) fail();
  if (!STATION_WATCH_CATEGORIES.includes(note.category)) fail();
  if (!Number.isFinite(note.mean) || note.mean < 0) fail();
  shortText(note.unit, 12);
  if (![8, 24].includes(note.averagingHours)) fail();
  if (!Number.isSafeInteger(note.hours) || note.hours < 0 || note.hours > 24)
    fail();
  isoText(note.observedTo);
  if (note.index !== null && !Number.isSafeInteger(note.index)) fail();
  return { ...note };
}

/** Evaluate one series against a condition: side, mean and hour basis. */
export function evaluateCondition(condition, hours) {
  const table = NAQI_BREAKPOINTS[condition.pollutant];
  const endMs = newestHourEnd({ [condition.pollutant]: hours });
  if (endMs === null) return { state: 'no-data', endMs: null };
  const mean = trailingMean(hours, {
    endMs,
    windowHours: table.hours,
    minHours: table.hours === 24 ? MIN_HOURS_24H : MIN_HOURS_8H,
    unit: table.unit,
    pollutantId: condition.pollutant,
  });
  if (mean.state !== 'ok')
    return { state: 'insufficient', endMs, hours: mean.hours };
  const sub = naqiSubIndex(condition.pollutant, mean.value);
  const rank = (id) => NAQI_CATEGORIES.findIndex((c) => c.id === id);
  return {
    state: 'ok',
    endMs,
    hours: mean.hours,
    mean: mean.value,
    index: sub.index,
    side: rank(sub.category) >= rank(condition.category) ? 'above' : 'below',
  };
}

const roundMean = (value) => Math.round(value * 10) / 10;

function crossingNote(condition, evaluation, now, notifications) {
  const table = NAQI_BREAKPOINTS[condition.pollutant];
  return {
    id: `${condition.stationId}:${evaluation.endMs}:${notifications.length}`,
    createdAt: new Date(now).toISOString(),
    kind: 'aq-crossing',
    stationId: condition.stationId,
    stationName: condition.stationName,
    pollutant: condition.pollutant,
    category: condition.category,
    mean: roundMean(evaluation.mean),
    unit: unitLabel(table.unit),
    averagingHours: table.hours,
    hours: evaluation.hours,
    observedTo: new Date(evaluation.endMs).toISOString(),
    index: evaluation.index,
  };
}

const emptyState = () => ({
  side: 'unknown',
  lastObservedEndMs: null,
  lastFiredAt: null,
});

/**
 * Reduce one check into the next runtime. `result` is the validated sensor
 * payload; `runtime` is the watch's previous runtime (FIRMS keys plus
 * `station`). Returns a new runtime; never mutates its inputs.
 */
export function reduceStationWatchCheck(
  runtime,
  result,
  {
    condition,
    now = Date.now(),
    baseline = false,
    intervalMs,
    limits = { seen: 2000, notifications: 100 },
  },
) {
  const station = runtime.station ?? emptyState();
  const attempted = {
    ...runtime,
    station,
    lastAttemptAt: now,
    nextAllowedAt: now + intervalMs,
  };
  if (!['ok', 'stale'].includes(result?.state))
    return { ...attempted, coverage: 'unavailable' };
  const evaluation = evaluateCondition(condition, result.hours);
  const retrievedAt = Date.parse(result.retrievedAt);
  const success = {
    ...attempted,
    lastSuccessAt: now,
    lastRetrievedAt: Number.isFinite(retrievedAt) ? retrievedAt : now,
    errorCount: 0,
  };
  // Dedupe: an hour already evaluated is not evaluated again.
  if (
    evaluation.endMs === null ||
    (station.lastObservedEndMs !== null &&
      evaluation.endMs <= station.lastObservedEndMs)
  )
    return { ...success, coverage: 'stale' };
  const seenId = `${condition.stationId}:${new Date(evaluation.endMs).toISOString()}`;
  const seen = [
    ...runtime.seen.filter((row) => row.id !== seenId),
    { id: seenId, acquiredAt: evaluation.endMs },
  ].slice(-limits.seen);
  if (evaluation.state !== 'ok')
    return {
      ...success,
      coverage: 'partial',
      seen,
      station: { ...station, lastObservedEndMs: evaluation.endMs },
    };
  const silent = baseline || runtime.baselineAt === null;
  const crossed =
    !silent && station.side === 'below' && evaluation.side === 'above';
  const cooling =
    station.lastFiredAt !== null &&
    now - station.lastFiredAt < STATION_WATCH_COOLDOWN_MS;
  const fire = crossed && !cooling;
  return {
    ...success,
    baselineAt: silent ? now : runtime.baselineAt,
    coverage: 'complete',
    seen,
    notifications: fire
      ? [
          ...runtime.notifications,
          crossingNote(condition, evaluation, now, runtime.notifications),
        ].slice(-limits.notifications)
      : runtime.notifications,
    station: {
      side: evaluation.side,
      lastObservedEndMs: evaluation.endMs,
      lastFiredAt: fire ? now : station.lastFiredAt,
    },
  };
}

/** Watch acquisition through the same-site client: one sensor's hours. */
export function createStationWatchSource({ stations }) {
  if (typeof stations?.sensor !== 'function')
    throw new TypeError('Station watches require a stations source');
  return {
    async check(condition, { signal } = {}) {
      const series = await stations.sensor(condition.sensorId, { signal });
      return { series, retryAt: null };
    },
  };
}

/** Display facts for a condition, for watch cards. */
export function describeCondition(condition) {
  const threshold = conditionThreshold(condition);
  const category = NAQI_CATEGORIES.find((c) => c.id === condition.category);
  return {
    stationName: condition.stationName,
    pollutant: POLLUTANTS[condition.pollutant].label,
    category: condition.category,
    categoryLabel: category.label,
    threshold: threshold.value,
    unit: threshold.unit,
    averagingHours: threshold.averagingHours,
  };
}
