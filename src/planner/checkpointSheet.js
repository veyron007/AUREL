/**
 * Mountain-weather sheet for one Planner checkpoint. A pure projection of a
 * validated payload: it derives model spread, ensemble counts and IMD
 * categories, and never turns them into a recommendation.
 */
const HOUR = 3600000;

/** IMD, SOP for Weather Forecasting and Warning (March 2021), Table 1.5 and the rainfall-spell table. */
export const IMD_REFERENCE = Object.freeze({
  title:
    'IMD Standard Operation Procedure: Weather Forecasting and Warning (March 2021)',
  link: 'https://mausam.imd.gov.in/imd_latest/contents/pdf/forecasting_sop.pdf',
  authority: 'https://mausam.imd.gov.in/',
  class: 'note',
});
/** 24 h accumulated rainfall, mm (Table 1.5). `max` is inclusive as published. */
export const IMD_DAILY = Object.freeze([
  Object.freeze({ key: 'very-light', min: 0.1, max: 2.4 }),
  Object.freeze({ key: 'light', min: 2.5, max: 15.5 }),
  Object.freeze({ key: 'moderate', min: 15.6, max: 64.4 }),
  Object.freeze({ key: 'heavy', min: 64.5, max: 115.5 }),
  Object.freeze({ key: 'very-heavy', min: 115.6, max: 204.4 }),
  Object.freeze({ key: 'extremely-heavy', min: 204.5, max: null }),
]);
/** Rainfall spell categories, published in cm/hour; held here in mm/h. */
export const IMD_SPELL = Object.freeze([
  Object.freeze({ key: 'light-spell', min: 0, max: 10 }),
  Object.freeze({ key: 'moderate-spell', min: 10, max: 20 }),
  Object.freeze({ key: 'intense-spell', min: 20, max: 30 }),
  Object.freeze({ key: 'very-intense-spell', min: 30, max: 50 }),
  Object.freeze({ key: 'extremely-intense-spell', min: 50, max: 100 }),
  Object.freeze({ key: 'cloudburst', min: 100, max: null }),
]);
/** Member-count thresholds: 1 mm, then the lower bound of each IMD category from light upward. */
export const ENSEMBLE_THRESHOLDS = Object.freeze([
  1, 2.5, 15.6, 64.5, 115.6, 204.5,
]);
/** Words the sheet must never use: model disagreement is information, not advice. */
export const FORBIDDEN_WORDS =
  /\b(?:safe|unsafe|safety|danger|dangerous|go|no-go|nogo)\b/i;

/** IMD daily category key for a 24 h total; 'none' for zero, null for unknown. */
export function dailyCategory(mm) {
  if (!Number.isFinite(mm)) return null;
  if (mm <= 0) return 'none';
  const tenth = Math.round(mm * 10) / 10;
  if (tenth < 0.1) return 'very-light';
  return (
    IMD_DAILY.find((c) => tenth >= c.min && (c.max === null || tenth <= c.max))
      ?.key ?? 'very-light'
  );
}
export function spellCategory(mmPerHour) {
  if (!Number.isFinite(mmPerHour)) return null;
  return IMD_SPELL.find(
    (c) => mmPerHour >= c.min && (c.max === null || mmPerHour < c.max),
  ).key;
}
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at),
    high = Math.ceil(at);
  const value = sorted[low] + (sorted[high] - sorted[low]) * (at - low);
  return Math.round(value * 10) / 10;
}

/** Checkpoint elevation from the saved route profile; never interpolated. */
export function checkpointElevation(checkpoint, profile) {
  const same = (a, b) =>
    a.lat.toFixed(5) === b.lat.toFixed(5) &&
    a.lon.toFixed(5) === b.lon.toFixed(5);
  const sample = profile?.samples?.find(
    (row) => same(row, checkpoint) && Number.isFinite(row.elevationM),
  );
  return sample
    ? { elevationM: sample.elevationM, source: 'route-profile' }
    : null;
}

const ROWS = Object.freeze([
  { key: 'temperatureC', unit: '°C', digits: 1, spread: true },
  { key: 'freezingLevelM', unit: 'm', digits: 0, spread: true },
  { key: 'cloudLowPct', unit: '%', digits: 0, spread: true },
  { key: 'cloudMidPct', unit: '%', digits: 0, spread: true },
  { key: 'cloudHighPct', unit: '%', digits: 0, spread: true },
  { key: 'visibilityM', unit: 'm', digits: 0, spread: true },
  { key: 'capeJkg', unit: 'J/kg', digits: 0, spread: true },
  {
    key: 'wind700Mps',
    unit: 'm/s',
    digits: 1,
    spread: true,
    direction: 'wind700Deg',
  },
  {
    key: 'wind500Mps',
    unit: 'm/s',
    digits: 1,
    spread: true,
    direction: 'wind500Deg',
  },
]);
const round = (value, digits) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
function spreadOf(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length > 1
    ? Math.max(...numbers) - Math.min(...numbers)
    : null;
}
function sum24(hours, key) {
  if (hours.length !== 24 || hours.some((h) => !Number.isFinite(h[key])))
    return null;
  return Math.round(hours.reduce((s, h) => s + h[key], 0) * 10) / 10;
}
const hourOf = (iso) => Math.floor(Date.parse(iso) / HOUR) * HOUR;

function modelColumns(payload, focus) {
  return payload.forecast.models.map((model) => {
    const hour = model.hours.find((h) => Date.parse(h.time) === focus) ?? null;
    return {
      id: model.id,
      label: model.label,
      state: model.state,
      resolutionKm: model.resolutionKm,
      runAt: model.runAt,
      leadHours: model.runAt
        ? Math.round((focus - Date.parse(model.runAt)) / HOUR)
        : null,
      grid: model.grid,
      elevationM: model.elevationM,
      unsupported: model.unsupported,
      hour,
      precipitation24Mm: sum24(model.hours, 'precipitationMm'),
      snowfall24Cm: model.unsupported.includes('snowfallCm')
        ? null
        : sum24(model.hours, 'snowfallCm'),
    };
  });
}
function forecastRows(columns) {
  const rows = ROWS.map((row) => {
    const values = columns.map((c) => ({
      id: c.id,
      value: round(c.hour?.[row.key], row.digits),
      direction: row.direction ? round(c.hour?.[row.direction], 0) : null,
      unsupported: c.unsupported.includes(row.key),
    }));
    return {
      key: row.key,
      unit: row.unit,
      values,
      spread: round(spreadOf(values.map((v) => v.value)), row.digits),
    };
  });
  for (const [key, field, unit] of [
    ['precipitation24Mm', 'precipitation24Mm', 'mm'],
    ['snowfall24Cm', 'snowfall24Cm', 'cm'],
  ]) {
    const values = columns.map((c) => ({
      id: c.id,
      value: c[field],
      direction: null,
      unsupported: false,
    }));
    rows.push({
      key,
      unit,
      values,
      spread: round(spreadOf(values.map((v) => v.value)), 1),
    });
  }
  return rows;
}
function ensembleView(ensemble, focus) {
  const days = ensemble.days.map((day) => {
    const values = day.members.filter(Number.isFinite).sort((a, b) => a - b);
    return {
      start: day.start,
      end: day.end,
      memberCount: values.length,
      counts: ENSEMBLE_THRESHOLDS.map((threshold) => ({
        threshold,
        count: values.filter((v) => v >= threshold).length,
      })),
      min: quantile(values, 0),
      p10: quantile(values, 0.1),
      median: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      max: quantile(values, 1),
      focus: Date.parse(day.start) <= focus && focus < Date.parse(day.end),
    };
  });
  return {
    state: ensemble.state,
    reason: ensemble.reason,
    label: ensemble.label,
    resolutionKm: ensemble.resolutionKm,
    runAt: ensemble.runAt,
    leadHours: ensemble.runAt
      ? Math.round((focus - Date.parse(ensemble.runAt)) / HOUR)
      : null,
    memberCount: ensemble.memberCount,
    days,
    focusDay: days.find((d) => d.focus) ?? null,
  };
}
function antecedentView(antecedent) {
  const days = antecedent.days;
  const wettest = days.length
    ? days.reduce((a, b) => (b.precipitationMm > a.precipitationMm ? b : a))
    : null;
  return {
    state: antecedent.state,
    reason: antecedent.reason,
    dataset: antecedent.dataset,
    resolutionKm: antecedent.resolutionKm,
    totalMm: antecedent.totalMm,
    windowStart: days[0]?.start ?? null,
    windowEnd: days.at(-1)?.end ?? null,
    days: days.map((d) => ({
      ...d,
      category: dailyCategory(d.precipitationMm),
    })),
    wettest: wettest
      ? { ...wettest, category: dailyCategory(wettest.precipitationMm) }
      : null,
  };
}
function imergView(imerg) {
  const present = imerg.halfHours.filter((r) => r.lowMmH !== null);
  const peak = present.length
    ? present.reduce((a, b) => (b.lowMmH > a.lowMmH ? b : a))
    : null;
  return {
    state: imerg.state,
    reason: imerg.reason,
    cell: imerg.cell,
    latestAt: imerg.latestAt,
    windowStart: imerg.halfHours[0]?.time ?? null,
    windowEnd: imerg.latestAt
      ? new Date(Date.parse(imerg.latestAt) + HOUR / 2).toISOString()
      : null,
    missingCount: imerg.missingCount,
    totalLowMm: imerg.totalLowMm,
    totalHighMm: imerg.totalHighMm,
    categoryLow: dailyCategory(imerg.totalLowMm),
    categoryHigh:
      imerg.totalHighMm === null ? null : dailyCategory(imerg.totalHighMm),
    peak: peak
      ? {
          time: peak.time,
          lowMmH: peak.lowMmH,
          highMmH: peak.highMmH,
          spell: spellCategory(peak.lowMmH),
        }
      : null,
  };
}

/** Rain lane: 24 h totals on one axis with the IMD daily category lines. */
function rainLane(sheet) {
  const rows = [];
  for (const c of sheet.models)
    if (c.precipitation24Mm !== null)
      rows.push({
        key: `model-${c.id}`,
        label: c.label,
        class: 'modelled',
        low: c.precipitation24Mm,
        high: c.precipitation24Mm,
      });
  const day = sheet.ensemble.focusDay;
  if (day?.memberCount)
    rows.push({
      key: 'ensemble',
      label: sheet.ensemble.label,
      class: 'modelled',
      low: day.p10,
      high: day.p90,
      median: day.median,
    });
  if (sheet.imerg.totalLowMm !== null)
    rows.push({
      key: 'imerg',
      label: 'IMERG',
      class: 'observed',
      low: sheet.imerg.totalLowMm,
      high: sheet.imerg.totalHighMm,
    });
  if (sheet.antecedent.wettest)
    rows.push({
      key: 'antecedent',
      label: sheet.antecedent.dataset === 'era5_land' ? 'ERA5-Land' : 'ERA5',
      class: 'modelled',
      low: sheet.antecedent.wettest.precipitationMm,
      high: sheet.antecedent.wettest.precipitationMm,
    });
  const top = Math.max(
    20,
    ...rows.map((r) => (Number.isFinite(r.high) ? r.high : r.low) * 1.2),
  );
  const scaleMax = Math.min(260, top);
  return {
    scaleMax,
    rows,
    lines: IMD_DAILY.filter((c) => c.min <= scaleMax && c.min >= 2.5).map(
      (c) => ({
        key: c.key,
        mm: c.min,
      }),
    ),
  };
}

export function buildCheckpointSheet(payload, { departureAt = null } = {}) {
  const focus = departureAt
    ? hourOf(departureAt)
    : Date.parse(payload.window.from);
  const models = modelColumns(payload, focus);
  const sheet = {
    focusAt: new Date(focus).toISOString(),
    requested: payload.requested,
    queried: payload.queried,
    forecastState: payload.forecast.state,
    forecastReason: payload.forecast.reason,
    retrievedAt: payload.forecast.retrievedAt,
    models,
    rows: forecastRows(models),
    ensemble: ensembleView(payload.ensemble, focus),
    antecedent: antecedentView(payload.antecedent),
    imerg: imergView(payload.imerg),
    sources: ['forecast', 'ensemble', 'antecedent', 'imerg'].map((kind) => ({
      kind,
      sourceLabel: payload[kind].sourceLabel,
      class: payload[kind].class,
      license: payload[kind].license,
      attribution: payload[kind].attribution,
      link: payload[kind].link,
      retrievedAt: payload[kind].retrievedAt,
      state: payload[kind].state,
    })),
  };
  return { ...sheet, lane: rainLane(sheet) };
}

/** Saved snapshots carry the payload; this reads it back without refetching. */
export function sheetSummary(payload, departureAt) {
  const sheet = buildCheckpointSheet(payload, { departureAt });
  const day = sheet.ensemble.focusDay;
  return {
    runs: sheet.models.map((m) => ({
      id: m.id,
      label: m.label,
      runAt: m.runAt,
      leadHours: m.leadHours,
    })),
    ensembleAtLeast1Mm: day ? day.counts[0].count : null,
    ensembleMembers: day ? day.memberCount : null,
    antecedentMm: sheet.antecedent.totalMm,
    antecedentDataset: sheet.antecedent.dataset,
  };
}
