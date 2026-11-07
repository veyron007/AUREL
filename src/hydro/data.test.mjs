import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  accumulate,
  basinMean,
  decodePalettePng,
  gibsPixel,
  gibsTileUrl,
  latestFromDomains,
  parseColormap,
  rateAt,
  stepTimes,
} from './imerg.js';
import {
  glofasPercentile,
  latencyMinutes,
  polygonForecast,
  representativePoints,
} from './cardsMath.js';
import {
  BASIN_WATCH_LIMITS,
  createBasinWatch,
  reduceBasinCheck,
  validateBasinWatch,
} from './basinWatch.js';
import {
  continueDownstream,
  namesAlong,
  validateRiverSubset,
} from './farField.js';
import { imergCellCenter, imergCellKey } from './route.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const colormap = parseColormap(
  fs.readFileSync(fixture('GPM_Precipitation_Rate-v1.3.xml'), 'utf8'),
);
const tile = decodePalettePng(
  new Uint8Array(
    fs.readFileSync(fixture('imerg-30min-2026-09-15T1200Z-5-6-28.png')),
  ),
  (bytes) => zlib.inflateSync(bytes),
);

test('the published colormap maps every class to an interval and no data to null', () => {
  assert.equal(colormap.size, 222);
  assert.equal(colormap.get('128,128,128'), null, 'no data');
  assert.deepEqual(colormap.get('191,191,191'), { lo: 0, hi: 0.1 });
  const top = [...colormap.values()].find((v) => v?.hi === Infinity);
  assert.ok(top.lo > 50);
  assert.throws(() => parseColormap('<xml/>'));
});

test('a real GIBS palette tile decodes and every pixel is a published class', () => {
  assert.equal(tile.width, 512);
  let unknown = 0;
  for (let y = 0; y < 512; y += 8)
    for (let x = 0; x < 512; x += 8)
      if (!colormap.has(tile.rgbAt(x, y).join(','))) unknown++;
  assert.equal(unknown, 0);
  const address = gibsPixel(78.05, 30.35);
  assert.deepEqual({ row: address.row, col: address.col }, { row: 6, col: 28 });
  const rate = rateAt(tile, colormap, address.px, address.py);
  assert.ok(
    rate.lo > 1.4 && rate.hi < 1.5,
    'Dehradun cell, 15 Sep 2026 12:00Z',
  );
  assert.match(
    gibsTileUrl('2026-09-15T12:00:00Z', address),
    /IMERG_Precipitation_Rate_30min\/default\/2026-09-15T12:00:00Z\/2km\/5\/6\/28\.png$/,
  );
  assert.throws(() => decodePalettePng(new Uint8Array(16), zlib.inflateSync));
});

test('IMERG cell keys round-trip to 0.1° cell centres', () => {
  const key = imergCellKey(78.08, 30.36);
  assert.equal(key, '2580:1203');
  assert.deepEqual(imergCellCenter(key), [78.05, 30.35]);
});

test('time steps and the GIBS domain end are explicit half-hours', () => {
  assert.deepEqual(stepTimes('2026-11-06T22:30:00Z', 3), [
    '2026-11-06T22:30:00Z',
    '2026-11-06T22:00:00Z',
    '2026-11-06T21:30:00Z',
  ]);
  assert.equal(
    latestFromDomains('<Domain>2026-11-05/2026-11-06T22:30:00Z/PT30M</Domain>'),
    '2026-11-06T22:30:00Z',
  );
  assert.equal(latestFromDomains('<Domains/>'), null);
});

test('basin mean weights by area and excludes missing cells from both sides', () => {
  const weights = [
    { key: 'a', km2: 30 },
    { key: 'b', km2: 10 },
    { key: 'c', km2: 60 },
  ];
  const mean = basinMean(weights, {
    a: { lo: 1, hi: 2 },
    b: { lo: 5, hi: 6 },
    c: null,
  });
  assert.equal(mean.coverage, 0.4);
  assert.equal(mean.lo, (1 * 30 + 5 * 10) / 40);
  assert.equal(mean.hi, (2 * 30 + 6 * 10) / 40);
  const none = basinMean(weights, {});
  assert.equal(none.lo, null);
  assert.equal(none.coverage, 0);
});

test('accumulation sums rate × 0.5 h and reports missing steps instead of zero', () => {
  const full = accumulate([
    { lo: 2, hi: 3 },
    { lo: 4, hi: 5 },
  ]);
  assert.deepEqual(full, {
    lo: 3,
    hi: 4,
    steps: 2,
    presentSteps: 2,
    complete: true,
  });
  const partial = accumulate([
    { lo: 2, hi: 3 },
    { lo: null, hi: null },
  ]);
  assert.equal(partial.complete, false);
  assert.equal(partial.presentSteps, 1);
  assert.equal(accumulate([null]).lo, null);
});

test('GloFAS percentile ranks today within past days only', () => {
  const series = JSON.parse(
    fs.readFileSync(fixture('glofas-flood-30.05N-78.20E.json'), 'utf8'),
  );
  const daily = {
    time: series.daily.time,
    values: series.daily.river_discharge,
  };
  const today = Date.parse(`${daily.time[92]}T06:00:00Z`);
  const ranked = glofasPercentile(daily, today);
  assert.equal(ranked.status, 'ok');
  assert.equal(ranked.n, 92);
  assert.ok(ranked.percentile >= 0 && ranked.percentile <= 100);
  const synthetic = {
    time: Array.from({ length: 41 }, (_, i) =>
      new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10),
    ),
    values: [...Array.from({ length: 40 }, (_, i) => i + 1), 30],
  };
  const at = Date.UTC(2026, 10, 10, 12);
  assert.equal(glofasPercentile(synthetic, at).percentile, 75);
  assert.equal(
    glofasPercentile(
      {
        time: synthetic.time.slice(0, 11),
        values: synthetic.values.slice(0, 11),
      },
      Date.UTC(2026, 9, 11),
    ).status,
    'short-series',
  );
  assert.equal(
    glofasPercentile(synthetic, Date.UTC(2027, 0, 1)).status,
    'no-today',
  );
});

test('polygon forecast uses at most three weighted points and flags gaps', () => {
  const cells = [
    { center: [78.05, 30.35], km2: 50 },
    { center: [78.15, 30.35], km2: 30 },
    { center: [77.85, 30.45], km2: 20 },
    { center: [78.05, 30.25], km2: 10 },
  ];
  const points = representativePoints(cells, 3);
  assert.equal(points.length, 3);
  assert.ok(Math.abs(points.reduce((s, p) => s + p.share, 0) - 1) < 1e-9);
  const now = Date.parse('2026-11-07T04:20:00Z');
  const hours = Array.from(
    { length: 48 },
    (_, i) =>
      new Date(Date.parse('2026-11-07T04:00:00Z') + i * 3600_000)
        .toISOString()
        .slice(0, 19) + 'Z',
  );
  const series = [
    { time: hours, precipitation: hours.map(() => 1) },
    { time: hours, precipitation: hours.map(() => 0) },
  ];
  const [one, three, day] = polygonForecast(series, [0.25, 0.75], now);
  assert.equal(one.totalMm, 0.25);
  assert.equal(three.totalMm, 0.75);
  assert.equal(day.totalMm, 6);
  assert.equal(day.complete, true);
  const short = polygonForecast(
    [{ time: hours.slice(0, 3), precipitation: [1, 1, 1] }],
    [1],
    now,
    [24],
  );
  assert.equal(short[0].complete, false);
  assert.equal(latencyMinutes('2026-11-06T22:30:00Z', now), 350);
});

test('basin watch fires once per crossing, cools down and dedupes by basin and window', () => {
  const t0 = Date.parse('2026-09-15T12:00:00Z');
  let watch = createBasinWatch(
    {
      basinId: 'hybas:4120012345',
      label: 'Song at Raiwala',
      thresholdMm: 10,
      cells: [{ key: '2580:1203', center: [78.05, 30.35], km2: 40 }],
    },
    { id: 'w1', now: t0 },
  );
  const obs = (windowEnd, lo, hi = lo * 1.06) => ({
    windowEnd,
    lo,
    hi,
    coverage: 1,
    complete: true,
  });
  let step = reduceBasinCheck(watch, obs('2026-09-15T12:00:00Z', 4), t0);
  assert.equal(step.fired, null);
  step = reduceBasinCheck(
    step.watch,
    obs('2026-09-15T12:30:00Z', 12),
    t0 + 1800_000,
  );
  assert.equal(step.fired?.thresholdMm, 10);
  assert.equal(step.watch.runtime.armed, false);
  const fired = step;
  // Still above: no second firing.
  step = reduceBasinCheck(
    fired.watch,
    obs('2026-09-15T13:00:00Z', 15),
    t0 + 3600_000,
  );
  assert.equal(step.fired, null);
  // The same window cannot fire again even if re-armed.
  const rearmedSameKey = validateBasinWatch({
    ...fired.watch,
    runtime: { ...fired.watch.runtime, armed: true, cooldownUntil: null },
  });
  assert.equal(
    reduceBasinCheck(
      rearmedSameKey,
      obs('2026-09-15T12:30:00Z', 20),
      t0 + 7200_000,
    ).fired,
    null,
  );
  // Drop below the hysteresis band re-arms; the cooldown still holds.
  step = reduceBasinCheck(
    step.watch,
    obs('2026-09-15T14:00:00Z', 2),
    t0 + 2 * 3600_000,
  );
  assert.equal(step.watch.runtime.armed, true);
  step = reduceBasinCheck(
    step.watch,
    obs('2026-09-15T15:00:00Z', 30),
    t0 + 3 * 3600_000,
  );
  assert.equal(step.fired, null, 'cooldown');
  step = reduceBasinCheck(
    step.watch,
    obs('2026-09-15T19:00:00Z', 30),
    t0 + 7 * 3600_000,
  );
  assert.ok(step.fired, 'fires again after cooldown and a new crossing');
  assert.equal(step.watch.runtime.notifications.length, 2);
  // Incomplete or low-coverage observations never fire.
  const quiet = createBasinWatch(
    {
      basinId: 'b',
      label: 'x',
      thresholdMm: 5,
      cells: [{ key: '1:1', center: [0, 0], km2: 1 }],
    },
    { id: 'w2', now: t0 },
  );
  assert.equal(
    reduceBasinCheck(
      quiet,
      { ...obs('2026-09-15T12:00:00Z', 50), coverage: 0.3 },
      t0,
    ).fired,
    null,
  );
  assert.equal(
    reduceBasinCheck(
      quiet,
      { ...obs('2026-09-15T12:00:00Z', 50), complete: false },
      t0,
    ).fired,
    null,
  );
  assert.equal(reduceBasinCheck(quiet, null, t0).fired, null);
  assert.throws(() =>
    createBasinWatch(
      { basinId: 'b', label: 'x', thresholdMm: 0, cells: quiet.cells },
      { now: t0 },
    ),
  );
  assert.ok(BASIN_WATCH_LIMITS.minCooldownMs >= 3 * 3600_000);
});

test('the local trace hands off to HydroRIVERS and follows NEXT_DOWN to the sea', () => {
  const network = validateRiverSubset({
    version: 1,
    reaches: [
      {
        id: 1,
        next: 3,
        upKm2: 40,
        name: 'Rispana',
        line: [
          [78.06, 30.33],
          [78.05, 30.3],
        ],
      },
      {
        id: 2,
        next: 3,
        upKm2: 300,
        name: 'Song',
        line: [
          [78.15, 30.2],
          [78.1, 30.15],
        ],
      },
      {
        id: 3,
        next: 4,
        upKm2: 900,
        name: 'Song',
        line: [
          [78.1, 30.15],
          [78.2, 30.05],
        ],
      },
      {
        id: 4,
        next: 0,
        upKm2: 22000,
        name: 'Ganga',
        line: [
          [78.2, 30.05],
          [78.2, 29.5],
          [88, 22],
        ],
      },
      {
        id: 9,
        next: 0,
        upKm2: 2,
        name: null,
        line: [
          [78.101, 30.151],
          [78.11, 30.16],
        ],
      },
    ],
  });
  const result = continueDownstream(network, [78.101, 30.149], 500);
  assert.equal(result.status, 'ok');
  assert.equal(result.end, 'ocean');
  assert.deepEqual(result.names, ['Song', 'Ganga']);
  assert.deepEqual(result.path.at(-1), [88, 22]);
  assert.ok(result.handoffM < 300);
  assert.equal(
    continueDownstream(network, [70, 10], 10).status,
    'no-reach',
    'nothing within the handoff radius',
  );
  assert.deepEqual(
    namesAlong(
      network,
      [
        [78.06, 30.33],
        [78.1, 30.15],
        [78.2, 29.5],
      ],
      { every: 1 },
    ),
    ['Rispana', 'Song', 'Ganga'],
  );
  assert.throws(() =>
    validateRiverSubset({ version: 1, reaches: [{ id: 1 }] }),
  );
});
