import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NAQI_BREAKPOINTS,
  US_AQI_BREAKPOINTS,
  canonicalHours,
  canonicalUnit,
  computeNaqi,
  computeUsAqi,
  convertConcentration,
  naqiCategory,
  naqiSubIndex,
  trailingMean,
  unitLabel,
  usAqiSubIndex,
} from './naqi.js';

const HOUR = 3_600_000;
const END = Date.UTC(2026, 10, 7, 6); // 06:00 UTC, an hour boundary
const hoursOf = (value, count, unit = 'µg/m³', end = END) =>
  Array.from({ length: count }, (_, i) => ({
    endMs: end - i * HOUR,
    value: typeof value === 'function' ? value(i) : value,
    unit,
  }));

test('NAQI sub-indices sit exactly on the published CPCB breakpoints', () => {
  const cases = [
    ['pm25', 0, 0],
    ['pm25', 30, 50],
    ['pm25', 31, 51],
    ['pm25', 60, 100],
    ['pm25', 61, 101],
    ['pm25', 90, 200],
    ['pm25', 91, 201],
    ['pm25', 120, 300],
    ['pm25', 121, 301],
    ['pm25', 250, 400],
    ['pm10', 50, 50],
    ['pm10', 100, 100],
    ['pm10', 250, 200],
    ['pm10', 350, 300],
    ['pm10', 430, 400],
    ['no2', 40, 50],
    ['no2', 80, 100],
    ['no2', 180, 200],
    ['no2', 280, 300],
    ['no2', 400, 400],
    ['o3', 100, 100],
    ['o3', 168, 200],
    ['o3', 169, 201],
    ['o3', 208, 300],
    ['o3', 748, 400],
    ['co', 1.0, 50],
    ['co', 1.1, 51],
    ['co', 2.0, 100],
    ['co', 10, 200],
    ['co', 17, 300],
    ['co', 34, 400],
    ['so2', 40, 50],
    ['so2', 380, 200],
    ['so2', 800, 300],
    ['so2', 1600, 400],
    ['nh3', 200, 50],
    ['nh3', 400, 100],
    ['nh3', 1200, 300],
    ['nh3', 1800, 400],
  ];
  for (const [pollutant, concentration, expected] of cases)
    assert.equal(
      naqiSubIndex(pollutant, concentration).index,
      expected,
      `${pollutant} ${concentration}`,
    );
});

test('NAQI interpolates linearly inside a band', () => {
  // 51 + (100 − 51) / (60 − 31) × (45 − 31) = 74.66 → 75
  assert.equal(naqiSubIndex('pm25', 45).index, 75);
  // 201 + (300 − 201) / (17 − 10) × (10.1 − 10) = 202.41 → 202
  assert.equal(naqiSubIndex('co', 10.1).index, 202);
  assert.equal(naqiSubIndex('pm25', 45).category, 'satisfactory');
});

test('NAQI rounds to table precision so band gaps cannot strand a value', () => {
  assert.equal(naqiSubIndex('pm25', 30.4).index, 50);
  assert.equal(naqiSubIndex('pm25', 30.5).index, 51);
  assert.equal(naqiSubIndex('co', 1.04).index, 50);
  assert.equal(naqiSubIndex('co', 1.05).index, 51);
});

test('Severe NAQI is open-ended instead of an invented number', () => {
  for (const [pollutant, concentration] of [
    ['pm25', 251],
    ['pm10', 431],
    ['co', 34.1],
    ['nh3', 1801],
  ]) {
    const sub = naqiSubIndex(pollutant, concentration);
    assert.deepEqual(sub, {
      index: null,
      floor: 401,
      category: 'severe',
      openEnded: true,
    });
  }
});

test('NAQI rejects unknown pollutants and invalid concentrations', () => {
  assert.equal(naqiSubIndex('pb', 1), null);
  assert.equal(naqiSubIndex('pm25', -1), null);
  assert.equal(naqiSubIndex('pm25', Number.NaN), null);
  assert.equal(naqiSubIndex('pm25', '40'), null);
  assert.equal(naqiCategory(250).id, 'poor');
});

test('NAQI averaging periods follow CPCB: 24 h, with 8 h for CO and O3', () => {
  for (const [id, breakpoints] of Object.entries(NAQI_BREAKPOINTS))
    assert.equal(breakpoints.hours, ['co', 'o3'].includes(id) ? 8 : 24, id);
  assert.equal(NAQI_BREAKPOINTS.co.unit, 'mg/m3');
});

test('US AQI sub-indices sit on the 2024 EPA breakpoints', () => {
  const cases = [
    ['pm25', 9.0, 50],
    ['pm25', 9.1, 51],
    ['pm25', 35.4, 100],
    ['pm25', 35.5, 101],
    ['pm25', 55.5, 151],
    ['pm25', 125.4, 200],
    ['pm25', 225.5, 301],
    ['pm25', 325.4, 500],
    ['pm10', 54, 50],
    ['pm10', 55, 51],
    ['pm10', 424, 300],
    ['pm10', 604, 500],
    ['o3', 0.054, 50],
    ['o3', 0.07, 100],
    ['o3', 0.2, 300],
    ['co', 4.4, 50],
    ['co', 9.4, 100],
    ['co', 50.4, 500],
    ['so2', 35, 50],
    ['so2', 304, 200],
    ['no2', 53, 50],
    ['no2', 100, 100],
    ['no2', 2049, 500],
  ];
  for (const [pollutant, concentration, expected] of cases)
    assert.equal(
      usAqiSubIndex(pollutant, concentration).index,
      expected,
      `${pollutant} ${concentration}`,
    );
});

test('US AQI truncates as EPA prescribes before the lookup', () => {
  // 35.49 truncates to 35.4 → 100, not 101.
  assert.equal(usAqiSubIndex('pm25', 35.49).index, 100);
  // 101 + (150 − 101) / (55.4 − 35.5) × (35.9 − 35.5) = 101.98 → 102
  assert.equal(usAqiSubIndex('pm25', 35.9).index, 102);
  assert.equal(usAqiSubIndex('pm10', 54.9).index, 50);
  assert.equal(usAqiSubIndex('pm25', 35.9).category, 'usg');
});

test('US AQI marks what its tables do not define', () => {
  assert.equal(usAqiSubIndex('o3', 0.201), null);
  assert.equal(usAqiSubIndex('so2', 305), null);
  assert.deepEqual(usAqiSubIndex('pm25', 325.5), {
    index: null,
    floor: 501,
    category: 'hazardous',
    openEnded: true,
  });
  assert.equal(US_AQI_BREAKPOINTS.no2.hours, 1);
});

test('unit handling converts gases at 25 °C and 1 atm and refuses particles', () => {
  assert.equal(canonicalUnit('μg/m³'), 'ug/m3');
  assert.equal(canonicalUnit(' PPM '), 'ppm');
  assert.equal(canonicalUnit('furlongs'), null);
  assert.equal(unitLabel('ug/m3'), 'µg/m³');
  const no2 = convertConcentration(100, 'µg/m³', 'ppb', 'no2');
  assert.ok(Math.abs(no2.value - (100 * 24.45) / 46.0055) < 1e-9);
  assert.equal(no2.converted, true);
  const co = convertConcentration(1, 'ppm', 'mg/m³', 'co');
  assert.ok(Math.abs(co.value - 28.01 / 24.45) < 1e-9);
  assert.deepEqual(convertConcentration(1500, 'µg/m³', 'mg/m³', 'co'), {
    value: 1.5,
    converted: false,
  });
  assert.equal(convertConcentration(10, 'ppm', 'µg/m³', 'pm25'), null);
  assert.equal(convertConcentration(Number.NaN, 'ppm', 'ppb', 'no2'), null);
});

test('canonical hours drop flagged, invalid, off-hour and duplicate rows', () => {
  const rows = canonicalHours([
    { endMs: END, value: 10, unit: 'µg/m³' },
    { endMs: END, value: 99, unit: 'µg/m³' },
    { endMs: END - HOUR, value: 20, unit: 'µg/m³', flagged: true },
    { endMs: END - 2 * HOUR, value: -1, unit: 'µg/m³' },
    { endMs: END - 3 * HOUR + 5, value: 5, unit: 'µg/m³' },
    { endMs: END - 4 * HOUR, value: 5, unit: 'parsecs' },
    { endMs: END - 5 * HOUR, value: 7, unit: 'µg/m³' },
  ]);
  assert.deepEqual(
    rows.map((row) => row.value),
    [7, 10],
  );
  assert.deepEqual(canonicalHours(null), []);
});

test('a 24 h mean needs 16 valid hours; missing hours are not filled', () => {
  const fifteen = trailingMean(hoursOf(40, 15), {
    endMs: END,
    windowHours: 24,
    minHours: 16,
    unit: 'ug/m3',
    pollutantId: 'pm25',
  });
  assert.equal(fifteen.state, 'insufficient');
  assert.equal(fifteen.hours, 15);
  const sixteen = trailingMean(
    hoursOf((i) => (i % 2 ? 30 : 50), 16),
    {
      endMs: END,
      windowHours: 24,
      minHours: 16,
      unit: 'ug/m3',
      pollutantId: 'pm25',
    },
  );
  assert.equal(sixteen.state, 'ok');
  assert.equal(sixteen.value, 40);
  assert.equal(sixteen.fromMs, END - 24 * HOUR);
  // Hours outside the window do not count.
  const old = trailingMean(hoursOf(40, 30), {
    endMs: END,
    windowHours: 24,
    minHours: 16,
    unit: 'ug/m3',
    pollutantId: 'pm25',
  });
  assert.equal(old.hours, 24);
});

test('NAQI uses the highest sub-index and names its dominant pollutant', () => {
  const result = computeNaqi({
    pm25: hoursOf(45, 24),
    pm10: hoursOf(80, 24),
    no2: hoursOf(30, 20),
  });
  assert.equal(result.state, 'ok');
  assert.equal(result.index, 80);
  assert.equal(result.dominant, 'pm10');
  assert.equal(result.category, 'satisfactory');
  assert.equal(result.basisEndMs, END);
  const pm25 = result.subIndices.find((row) => row.pollutant === 'pm25');
  assert.equal(pm25.averagingHours, 24);
  assert.equal(pm25.index, 75);
});

test('NAQI requires three pollutants including a particulate', () => {
  const two = computeNaqi({ pm25: hoursOf(45, 24), no2: hoursOf(30, 24) });
  assert.equal(two.state, 'insufficient');
  assert.equal(two.reason, 'insufficient-pollutants');
  const gases = computeNaqi({
    no2: hoursOf(30, 24),
    so2: hoursOf(10, 24),
    o3: hoursOf(40, 8),
  });
  assert.equal(gases.reason, 'no-particulate');
  // A particulate with too few hours does not count.
  const thin = computeNaqi({
    pm25: hoursOf(45, 10),
    no2: hoursOf(30, 24),
    so2: hoursOf(10, 24),
  });
  assert.equal(thin.reason, 'no-particulate');
  assert.equal(computeNaqi({}).reason, 'no-data');
});

test('NAQI 8 h pollutants use their own window and convert ppm CO', () => {
  const result = computeNaqi({
    pm25: hoursOf(20, 24),
    pm10: hoursOf(40, 24),
    // 8 hours of 1.5 ppm CO ≈ 1.72 mg/m³ → Satisfactory.
    co: hoursOf(1.5, 8, 'ppm'),
  });
  const co = result.subIndices.find((row) => row.pollutant === 'co');
  assert.equal(co.averagingHours, 8);
  assert.equal(co.converted, true);
  assert.equal(co.category, 'satisfactory');
  assert.equal(result.state, 'ok');
});

test('a Severe sub-index makes the NAQI open-ended', () => {
  const result = computeNaqi({
    pm25: hoursOf(300, 24),
    pm10: hoursOf(200, 24),
    no2: hoursOf(30, 24),
  });
  assert.equal(result.openEnded, true);
  assert.equal(result.index, null);
  assert.equal(result.floor, 401);
  assert.equal(result.category, 'severe');
});

test('US AQI from Indian µg/m³ series converts gases and uses 1 h NO2', () => {
  const result = computeUsAqi({
    pm25: hoursOf(35.9, 24),
    no2: [...hoursOf(300, 1), ...hoursOf(10, 5, 'µg/m³', END - HOUR)],
  });
  assert.equal(result.state, 'ok');
  assert.equal(result.index, 112);
  assert.equal(result.dominant, 'no2');
  assert.equal(
    result.subIndices.find((row) => row.pollutant === 'pm25').index,
    102,
  );
  const no2 = result.subIndices.find((row) => row.pollutant === 'no2');
  assert.equal(no2.averagingHours, 1);
  assert.equal(no2.converted, true);
  // 300 µg/m³ ≈ 159.4 ppb → 101 + 49/259 × 58 = 111.97 → 112 (truncated to 159)
  assert.equal(no2.index, 112);
  const outside = computeUsAqi({ o3: hoursOf(500, 8) });
  assert.equal(outside.state, 'insufficient');
  assert.equal(outside.subIndices[0].state, 'out-of-table');
});
