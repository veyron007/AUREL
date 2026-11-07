/**
 * @module airQuality/naqi
 *
 * India's National Air Quality Index (CPCB, 2014) and the US EPA AQI, computed
 * from observed station concentrations. Pure: no network, no clock, no i18n.
 *
 * Both indices are defined on averaged concentrations, never on a single hour:
 *
 * - NAQI: 24 h means for PM10, PM2.5, NO2, SO2 and NH3; 8 h means for CO and
 *   O3. A sub-index needs at least 16 valid hours in its 24 h window, and the
 *   index needs at least three sub-indices, one of them PM2.5 or PM10.
 * - US AQI: 24 h means for PM2.5 and PM10, 8 h means for O3 and CO, 1 h values
 *   for NO2 and SO2 (EPA Technical Assistance Document, 2024 revision).
 *
 * The averaging windows are trailing windows ending at the newest valid hour.
 * That is not the US NowCast and not a calendar-day mean; callers state the
 * basis from `basisEndMs` and each sub-index's `fromMs`/`toMs`.
 *
 * Above a table's highest finite breakpoint neither standard publishes an upper
 * concentration, so the sub-index is open-ended (`openEnded: true`, `floor`)
 * instead of an invented number.
 */

const HOUR_MS = 3_600_000;
// A portable module: category labels stay English data for npm run i18n to
// extract; views translate them with t().
const msg = (text) => text;

/** Litres per mole of an ideal gas at 25 °C and 1 atm, the reference both standards use. */
export const MOLAR_VOLUME_L = 24.45;

/** Pollutants AUREL recognises, with molecular weights in g/mol for gases. */
// i18n-ignore: chemical symbols are the same in every language
export const POLLUTANTS = Object.freeze({
  // i18n-ignore: chemical symbol
  pm25: Object.freeze({ id: 'pm25', label: 'PM2.5', gas: false }),
  // i18n-ignore: chemical symbol
  pm10: Object.freeze({ id: 'pm10', label: 'PM10', gas: false }),
  // i18n-ignore: chemical symbol
  no2: Object.freeze({ id: 'no2', label: 'NO2', gas: true, mw: 46.0055 }),
  // i18n-ignore: chemical symbol
  so2: Object.freeze({ id: 'so2', label: 'SO2', gas: true, mw: 64.066 }),
  // i18n-ignore: chemical symbol
  o3: Object.freeze({ id: 'o3', label: 'O3', gas: true, mw: 47.9982 }),
  // i18n-ignore: chemical symbol
  co: Object.freeze({ id: 'co', label: 'CO', gas: true, mw: 28.01 }),
  // i18n-ignore: chemical symbol
  nh3: Object.freeze({ id: 'nh3', label: 'NH3', gas: true, mw: 17.031 }),
});

const UNIT_ALIASES = new Map([
  ['µg/m³', 'ug/m3'],
  ['μg/m³', 'ug/m3'],
  ['µg/m3', 'ug/m3'],
  ['μg/m3', 'ug/m3'],
  ['ug/m3', 'ug/m3'],
  ['ug/m³', 'ug/m3'],
  ['mg/m³', 'mg/m3'],
  ['mg/m3', 'mg/m3'],
  ['ppm', 'ppm'],
  ['ppb', 'ppb'],
]);

/** Canonical unit id ('ug/m3' | 'mg/m3' | 'ppm' | 'ppb') or null. */
export function canonicalUnit(unit) {
  if (typeof unit !== 'string') return null;
  return (
    UNIT_ALIASES.get(unit.trim().toLowerCase().replace(/\s+/g, '')) ?? null
  );
}

/** Display text for a unit, or null when unrecognised. */
export function unitLabel(unit) {
  return (
    { 'ug/m3': 'µg/m³', 'mg/m3': 'mg/m³', ppm: 'ppm', ppb: 'ppb' }[
      canonicalUnit(unit)
    ] ?? null
  );
}

const toMicrograms = (value, unit, pollutant) => {
  if (unit === 'ug/m3') return value;
  if (unit === 'mg/m3') return value * 1000;
  if (!pollutant?.gas) return null;
  const ppb = unit === 'ppm' ? value * 1000 : value;
  return (ppb * pollutant.mw) / MOLAR_VOLUME_L;
};

const fromMicrograms = (micrograms, unit, pollutant) => {
  if (unit === 'ug/m3') return micrograms;
  if (unit === 'mg/m3') return micrograms / 1000;
  if (!pollutant?.gas) return null;
  const ppb = (micrograms * MOLAR_VOLUME_L) / pollutant.mw;
  return unit === 'ppm' ? ppb / 1000 : ppb;
};

const isMassUnit = (unit) => unit === 'ug/m3' || unit === 'mg/m3';

/**
 * Convert a concentration between mass and mixing-ratio units.
 *
 * Mass ↔ mixing ratio needs the molecular weight and assumes 25 °C and 1 atm;
 * `converted` reports whether that assumption was used so a card can say so.
 *
 * @returns {{value:number, converted:boolean}|null} null when impossible.
 */
export function convertConcentration(value, fromUnit, toUnit, pollutantId) {
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);
  if (typeof value !== 'number' || !Number.isFinite(value) || !from || !to)
    return null;
  if (from === to) return { value, converted: false };
  const pollutant = POLLUTANTS[pollutantId];
  const micrograms = toMicrograms(value, from, pollutant);
  if (micrograms === null) return null;
  const result = fromMicrograms(micrograms, to, pollutant);
  if (result === null || !Number.isFinite(result)) return null;
  return { value: result, converted: isMassUnit(from) !== isMassUnit(to) };
}

/** NAQI categories in ascending severity, with their published index ranges. */
export const NAQI_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'good', label: msg('Good'), lo: 0, hi: 50 }),
  Object.freeze({
    id: 'satisfactory',
    label: msg('Satisfactory'),
    lo: 51,
    hi: 100,
  }),
  Object.freeze({
    id: 'moderate',
    label: msg('Moderately polluted'),
    lo: 101,
    hi: 200,
  }),
  Object.freeze({ id: 'poor', label: msg('Poor'), lo: 201, hi: 300 }),
  Object.freeze({ id: 'very-poor', label: msg('Very poor'), lo: 301, hi: 400 }),
  Object.freeze({ id: 'severe', label: msg('Severe'), lo: 401, hi: 500 }),
]);

const table = (unit, hours, decimals, rows) =>
  Object.freeze({
    unit,
    hours,
    decimals,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
  });

/**
 * CPCB NAQI breakpoints (National Air Quality Index, CPCB, October 2014). Each
 * row is one category's concentration range, in category order; the last
 * ("Severe") is open-ended above its lower bound, marked by `null`.
 */
export const NAQI_BREAKPOINTS = Object.freeze({
  pm10: table('ug/m3', 24, 0, [
    [0, 50],
    [51, 100],
    [101, 250],
    [251, 350],
    [351, 430],
    [430, null],
  ]),
  pm25: table('ug/m3', 24, 0, [
    [0, 30],
    [31, 60],
    [61, 90],
    [91, 120],
    [121, 250],
    [250, null],
  ]),
  no2: table('ug/m3', 24, 0, [
    [0, 40],
    [41, 80],
    [81, 180],
    [181, 280],
    [281, 400],
    [400, null],
  ]),
  o3: table('ug/m3', 8, 0, [
    [0, 50],
    [51, 100],
    [101, 168],
    [169, 208],
    [209, 748],
    [748, null],
  ]),
  co: table('mg/m3', 8, 1, [
    [0, 1],
    [1.1, 2],
    [2.1, 10],
    [10, 17],
    [17, 34],
    [34, null],
  ]),
  so2: table('ug/m3', 24, 0, [
    [0, 40],
    [41, 80],
    [81, 380],
    [381, 800],
    [801, 1600],
    [1600, null],
  ]),
  nh3: table('ug/m3', 24, 0, [
    [0, 200],
    [201, 400],
    [401, 800],
    [801, 1200],
    [1200, 1800],
    [1800, null],
  ]),
});

/** CPCB: a sub-index needs at least 16 hours of a 24 h window. */
export const MIN_HOURS_24H = 16;
/** AUREL's completeness rule for 8 h windows: 6 of 8 hours, the same 75 % share. */
export const MIN_HOURS_8H = 6;
/** CPCB: at least three pollutants, one of them PM2.5 or PM10. */
export const NAQI_MIN_POLLUTANTS = 3;

/** US AQI categories (EPA, 2024). */
export const US_AQI_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'good', label: msg('Good'), lo: 0, hi: 50 }),
  Object.freeze({ id: 'moderate', label: msg('Moderate'), lo: 51, hi: 100 }),
  Object.freeze({
    id: 'usg',
    label: msg('Unhealthy for Sensitive Groups'),
    lo: 101,
    hi: 150,
  }),
  Object.freeze({ id: 'unhealthy', label: msg('Unhealthy'), lo: 151, hi: 200 }),
  Object.freeze({
    id: 'very-unhealthy',
    label: msg('Very Unhealthy'),
    lo: 201,
    hi: 300,
  }),
  Object.freeze({ id: 'hazardous', label: msg('Hazardous'), lo: 301, hi: 500 }),
]);

/**
 * EPA breakpoints (Technical Assistance Document for the Reporting of Daily
 * Air Quality, 2024). Rows are [concentration lo, hi, index lo, hi];
 * `decimals` is the published truncation precision.
 */
export const US_AQI_BREAKPOINTS = Object.freeze({
  pm25: table('ug/m3', 24, 1, [
    [0.0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500],
  ]),
  pm10: table('ug/m3', 24, 0, [
    [0, 54, 0, 50],
    [55, 154, 51, 100],
    [155, 254, 101, 150],
    [255, 354, 151, 200],
    [355, 424, 201, 300],
    [425, 604, 301, 500],
  ]),
  // The 8 h O3 index is defined only up to 0.200 ppm; above it EPA uses the
  // 1 h table, which this module does not compute.
  o3: table('ppm', 8, 3, [
    [0.0, 0.054, 0, 50],
    [0.055, 0.07, 51, 100],
    [0.071, 0.085, 101, 150],
    [0.086, 0.105, 151, 200],
    [0.106, 0.2, 201, 300],
  ]),
  co: table('ppm', 8, 1, [
    [0.0, 4.4, 0, 50],
    [4.5, 9.4, 51, 100],
    [9.5, 12.4, 101, 150],
    [12.5, 15.4, 151, 200],
    [15.5, 30.4, 201, 300],
    [30.5, 50.4, 301, 500],
  ]),
  // The 1 h SO2 index stops at 304 ppb; higher values need 24 h SO2.
  so2: table('ppb', 1, 0, [
    [0, 35, 0, 50],
    [36, 75, 51, 100],
    [76, 185, 101, 150],
    [186, 304, 151, 200],
  ]),
  no2: table('ppb', 1, 0, [
    [0, 53, 0, 50],
    [54, 100, 51, 100],
    [101, 360, 101, 150],
    [361, 649, 151, 200],
    [650, 1249, 201, 300],
    [1250, 2049, 301, 500],
  ]),
});

// A tolerance absorbs binary representation (0.07 * 1000 = 70.00000000000001).
const EPSILON = 1e-9;
const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor + EPSILON) / factor;
};
const truncateTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + EPSILON) / factor;
};
const interpolate = (c, bLo, bHi, iLo, iHi) =>
  Math.round(((iHi - iLo) / (bHi - bLo)) * (c - bLo) + iLo);

const validConcentration = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * NAQI sub-index for one pollutant from an already-averaged concentration in
 * the table's own unit. The concentration is rounded to the table's precision
 * (integer µg/m³; 0.1 mg/m³ for CO) before the band lookup, so the published
 * gaps between bands (30 → 31) cannot strand a value.
 *
 * @returns {{index:number|null, floor:number, category:string, openEnded:boolean}|null}
 */
export function naqiSubIndex(pollutantId, concentration) {
  const breakpoints = NAQI_BREAKPOINTS[pollutantId];
  if (!breakpoints || !validConcentration(concentration)) return null;
  const c = roundTo(concentration, breakpoints.decimals);
  for (let i = 0; i < breakpoints.rows.length; i += 1) {
    const [bLo, bHi] = breakpoints.rows[i];
    const category = NAQI_CATEGORIES[i];
    if (bHi === null)
      return {
        index: null,
        floor: category.lo,
        category: category.id,
        openEnded: true,
      };
    if (c <= bHi) {
      const index = interpolate(
        Math.max(c, bLo),
        bLo,
        bHi,
        category.lo,
        category.hi,
      );
      return { index, floor: index, category: category.id, openEnded: false };
    }
  }
  return null;
}

/** NAQI category descriptor for an index value. */
export function naqiCategory(index) {
  return (
    NAQI_CATEGORIES.find((category) => index <= category.hi) ??
    NAQI_CATEGORIES.at(-1)
  );
}

/** US AQI category descriptor for an index value. */
export function usAqiCategory(index) {
  return (
    US_AQI_CATEGORIES.find((category) => index <= category.hi) ??
    US_AQI_CATEGORIES.at(-1)
  );
}

/**
 * US AQI sub-index from an averaged concentration in the table's unit, after
 * EPA truncation.
 *
 * @returns {{index:number|null, floor:number, category:string, openEnded:boolean}|null}
 *   null when the table does not define this concentration for this averaging
 *   period (8 h O3 above 0.200 ppm, 1 h SO2 above 304 ppb).
 */
export function usAqiSubIndex(pollutantId, concentration) {
  const breakpoints = US_AQI_BREAKPOINTS[pollutantId];
  if (!breakpoints || !validConcentration(concentration)) return null;
  const c = truncateTo(concentration, breakpoints.decimals);
  for (const [bLo, bHi, iLo, iHi] of breakpoints.rows) {
    if (c <= bHi) {
      const index = interpolate(Math.max(c, bLo), bLo, bHi, iLo, iHi);
      return {
        index,
        floor: index,
        category: usAqiCategory(index).id,
        openEnded: false,
      };
    }
  }
  if (pollutantId === 'o3' || pollutantId === 'so2') return null;
  // "Beyond the AQI": PM, CO and NO2 above the top row.
  return { index: null, floor: 501, category: 'hazardous', openEnded: true };
}

/**
 * Validate hourly values into a canonical series: one value per hour end,
 * finite, non-negative, in a recognised unit. A repeated hour end keeps the
 * first value; flagged hours are dropped.
 *
 * @param {Array<{endMs:number, value:number, unit:string, flagged?:boolean}>} hours
 * @returns {Array<{endMs:number, value:number, unit:string}>} Ascending by endMs.
 */
export function canonicalHours(hours) {
  if (!Array.isArray(hours)) return [];
  const byEnd = new Map();
  for (const hour of hours) {
    const endMs = Number(hour?.endMs);
    if (!Number.isFinite(endMs) || endMs % HOUR_MS !== 0) continue;
    if (!validConcentration(hour.value)) continue;
    if (hour.flagged === true || !canonicalUnit(hour.unit)) continue;
    if (!byEnd.has(endMs))
      byEnd.set(endMs, { endMs, value: hour.value, unit: hour.unit });
  }
  return [...byEnd.values()].sort((a, b) => a.endMs - b.endMs);
}

/**
 * Mean of the hours in the trailing window (endMs − windowHours, endMs],
 * converted to `unit`, when at least `minHours` valid hours are present.
 *
 * @returns {{state:'ok'|'insufficient', value?:number, hours:number,
 *   fromMs:number, toMs:number, converted:boolean}}
 */
export function trailingMean(
  hours,
  { endMs, windowHours, minHours, unit, pollutantId },
) {
  const fromMs = endMs - windowHours * HOUR_MS;
  let sum = 0;
  let count = 0;
  let converted = false;
  for (const hour of canonicalHours(hours)) {
    if (hour.endMs <= fromMs || hour.endMs > endMs) continue;
    const value = convertConcentration(
      hour.value,
      hour.unit,
      unit,
      pollutantId,
    );
    if (!value) continue;
    sum += value.value;
    count += 1;
    converted ||= value.converted;
  }
  if (count < minHours)
    return {
      state: 'insufficient',
      hours: count,
      fromMs,
      toMs: endMs,
      converted,
    };
  return {
    state: 'ok',
    value: sum / count,
    hours: count,
    fromMs,
    toMs: endMs,
    converted,
  };
}

/** The newest valid hour end across all pollutant series, or null. */
export function newestHourEnd(seriesByPollutant) {
  let newest = null;
  for (const hours of Object.values(seriesByPollutant || {}))
    for (const hour of canonicalHours(hours))
      if (newest === null || hour.endMs > newest) newest = hour.endMs;
  return newest;
}

const minHoursFor = (windowHours) =>
  windowHours === 24 ? MIN_HOURS_24H : windowHours === 8 ? MIN_HOURS_8H : 1;

/** Average every series over its table's period and look up its sub-index. */
function subIndicesFor(seriesByPollutant, tables, lookup, endMs) {
  const rows = [];
  for (const [pollutantId, breakpoints] of Object.entries(tables)) {
    const hours = seriesByPollutant?.[pollutantId];
    if (!Array.isArray(hours) || hours.length === 0) continue;
    const mean = trailingMean(hours, {
      endMs,
      windowHours: breakpoints.hours,
      minHours: minHoursFor(breakpoints.hours),
      unit: breakpoints.unit,
      pollutantId,
    });
    const sub = mean.state === 'ok' ? lookup(pollutantId, mean.value) : null;
    let state = 'insufficient';
    if (sub) state = 'ok';
    else if (mean.state === 'ok') state = 'out-of-table';
    rows.push({
      pollutant: pollutantId,
      averagingHours: breakpoints.hours,
      unit: breakpoints.unit,
      hours: mean.hours,
      fromMs: mean.fromMs,
      toMs: mean.toMs,
      mean: mean.state === 'ok' ? mean.value : null,
      converted: mean.converted,
      state,
      index: sub?.index ?? null,
      floor: sub?.floor ?? null,
      category: sub?.category ?? null,
      openEnded: sub?.openEnded ?? false,
    });
  }
  return rows;
}

const worst = (rows) =>
  rows.reduce((top, row) => (row.floor > top.floor ? row : top));

function indexResult(rows, endMs) {
  const dominant = worst(rows);
  return {
    state: 'ok',
    index: dominant.index,
    floor: dominant.floor,
    openEnded: dominant.openEnded,
    category: dominant.category,
    dominant: dominant.pollutant,
    basisEndMs: endMs,
  };
}

/**
 * Compute NAQI from hourly series keyed by pollutant id.
 *
 * Every pollutant is averaged over its CPCB period ending at the station's
 * newest valid hour. The index is the highest sub-index; an open-ended Severe
 * sub-index makes the index open-ended too.
 *
 * @param {Record<string, Array>} seriesByPollutant
 * @returns {object} `{state:'ok'|'insufficient', reason?, index, floor,
 *   openEnded, category, dominant, subIndices, basisEndMs}`
 */
export function computeNaqi(seriesByPollutant) {
  const endMs = newestHourEnd(seriesByPollutant);
  if (endMs === null)
    return {
      state: 'insufficient',
      reason: 'no-data',
      subIndices: [],
      basisEndMs: null,
    };
  const subIndices = subIndicesFor(
    seriesByPollutant,
    NAQI_BREAKPOINTS,
    naqiSubIndex,
    endMs,
  );
  const valid = subIndices.filter((row) => row.state === 'ok');
  if (
    !valid.some((row) => row.pollutant === 'pm25' || row.pollutant === 'pm10')
  )
    return {
      state: 'insufficient',
      reason: 'no-particulate',
      subIndices,
      basisEndMs: endMs,
    };
  if (valid.length < NAQI_MIN_POLLUTANTS)
    return {
      state: 'insufficient',
      reason: 'insufficient-pollutants',
      subIndices,
      basisEndMs: endMs,
    };
  return { ...indexResult(valid, endMs), subIndices };
}

/**
 * Compute the US AQI from the same hourly series: 24 h PM (at least 16 hours),
 * 8 h O3 and CO (at least 6 hours), and the newest single hour of NO2 and SO2.
 * Indian monitors report gases in µg/m³; they are converted to ppm/ppb at
 * 25 °C and 1 atm, and `converted` marks each sub-index that needed it.
 */
export function computeUsAqi(seriesByPollutant) {
  const endMs = newestHourEnd(seriesByPollutant);
  if (endMs === null)
    return {
      state: 'insufficient',
      reason: 'no-data',
      subIndices: [],
      basisEndMs: null,
    };
  const subIndices = subIndicesFor(
    seriesByPollutant,
    US_AQI_BREAKPOINTS,
    usAqiSubIndex,
    endMs,
  );
  const valid = subIndices.filter((row) => row.state === 'ok');
  if (valid.length === 0)
    return {
      state: 'insufficient',
      reason: 'no-data',
      subIndices,
      basisEndMs: endMs,
    };
  return { ...indexResult(valid, endMs), subIndices };
}
