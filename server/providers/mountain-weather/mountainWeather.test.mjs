import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  openMeteoDeciUnits,
  createMountainWeatherBudget,
  createGibsBudget,
} from './budget.js';
import { WEIGHTS, normalizeForecastModel, imdWindows } from './openMeteo.js';
import {
  parseColormap,
  parseLatest,
  classify,
  tileFor,
  imergCell,
} from './imerg.js';
import { readPaletteIndex } from './png.js';
import { createMountainWeatherMiddleware } from './index.js';
import { validateMountainWeatherPayload } from '../../../src/sources/mountainWeatherModel.js';
import {
  CLOCK,
  forecastRaw,
  historicalRaw,
  colormapXml,
  domainsXml,
  palettePng,
  fixtureFetch,
  memoryBudget,
} from '../../../src/testSupport/mountainWeatherFixtures.mjs';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aurel-mountain-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function harness(t, options = {}) {
  const dir = await tempDir(t);
  const calls = [];
  let clock = options.clock ?? CLOCK;
  const now = () => clock;
  const middleware = createMountainWeatherMiddleware({
    now,
    fetchImpl: fixtureFetch({ calls, ...options.fixture }),
    budget: createMountainWeatherBudget({
      file: path.join(dir, 'mw.json'),
      now,
      ...options.budget,
    }),
    gibsBudget: options.gibsBudget
      ? createGibsBudget({
          file: path.join(dir, 'gibs.json'),
          now,
          ...options.gibsBudget,
        })
      : memoryBudget(),
    sleep: async () => {},
  });
  async function get(query) {
    const res = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(body) {
        this.body = body;
      },
    };
    await middleware(
      {
        url: `/api/mountain-weather?${query}`,
        method: 'GET',
        headers: { 'sec-fetch-site': 'same-origin', host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : null,
    };
  }
  const ledger = async (name = 'mw.json') =>
    JSON.parse(await readFile(path.join(dir, name), 'utf8'));
  return {
    get,
    calls,
    ledger,
    advance(ms) {
      clock += ms;
    },
  };
}
const openMeteoCalls = (calls) =>
  calls.filter((u) => u.hostname.endsWith('open-meteo.com'));

test('weights follow the Open-Meteo formula for variables, members and range', () => {
  assert.equal(openMeteoDeciUnits({ variables: 6, days: 2 }), 10);
  assert.equal(openMeteoDeciUnits({ variables: 13, days: 7 }), 13);
  assert.equal(openMeteoDeciUnits({ variables: 13, days: 28 }), 26);
  assert.equal(openMeteoDeciUnits({ variables: 1, members: 51, days: 7 }), 51);
  assert.equal(
    openMeteoDeciUnits({ variables: 2, members: 51, days: 15 }),
    110,
  );
  assert.equal(openMeteoDeciUnits({ variables: 1, members: 2, days: 15 }), 10);
  assert.equal(
    openMeteoDeciUnits({ variables: 13, days: 7, locations: 3 }),
    39,
  );
  assert.throws(() => openMeteoDeciUnits({ variables: 0, days: 1 }));
  assert.deepEqual(WEIGHTS, {
    forecastModel: 13,
    ensemble: 51,
    historical: 10,
  });
});

test('a full sheet reserves 140 deci-units, caches by cell and elevation band', async (t) => {
  const h = await harness(t);
  const first = await h.get('lat=30.49&lon=78.04&elev=1987');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.queried, {
    lat: 30.49,
    lon: 78.04,
    elevationM: 2000,
  });
  assert.equal((await h.ledger()).dayCount, 3 * 13 + 51 + 10 + 4 * 10);
  const before = openMeteoCalls(h.calls).length;
  const second = await h.get('lat=30.4912&lon=78.0399&elev=2010');
  assert.equal(second.status, 200);
  assert.equal(openMeteoCalls(h.calls).length, before);
  assert.equal(
    h.calls
      .find((u) => u.pathname === '/v1/forecast')
      .searchParams.get('elevation'),
    '2000',
  );
  assert.doesNotThrow(() => validateMountainWeatherPayload(second.body));
});

test('the ledger refuses before dispatch when exhausted and labels the part blocked', async (t) => {
  const h = await harness(t, { budget: { dailyLimit: 60 } });
  const { body } = await h.get('lat=30.49&lon=78.04&elev=2000');
  assert.equal(body.ensemble.state, 'blocked');
  assert.equal(body.ensemble.reason, 'daily-limit');
  assert.ok(
    !h.calls.some((u) => u.hostname === 'ensemble-api.open-meteo.com'),
    'no ensemble request was dispatched',
  );
  assert.ok((await h.ledger()).dayCount <= 60);
});

test('one missing model is a partial sheet, never a zero', async (t) => {
  const h = await harness(t, {
    fixture: {
      override: (url) =>
        url.searchParams.get('models') === 'gfs_seamless'
          ? new Response('no', { status: 404 })
          : null,
    },
  });
  const { body } = await h.get('lat=30.49&lon=78.04&elev=2000');
  assert.equal(body.forecast.state, 'partial');
  const gfs = body.forecast.models.find((m) => m.id === 'gfs');
  assert.equal(gfs.state, 'missing');
  assert.deepEqual(gfs.hours, []);
  const ifs = body.forecast.models.find((m) => m.id === 'ifs');
  assert.deepEqual(ifs.unsupported, ['freezingLevelM', 'visibilityM']);
  assert.equal(ifs.hours[0].freezingLevelM, null);
  assert.equal(ifs.runAt, '2026-11-06T18:00:00.000Z');
});

test('retries are bounded, reserve each attempt and stop on 429', async (t) => {
  let ensembleAttempts = 0,
    archiveAttempts = 0;
  const h = await harness(t, {
    fixture: {
      override: (url) => {
        if (url.hostname === 'ensemble-api.open-meteo.com') {
          ensembleAttempts++;
          return new Response('busy', { status: 503 });
        }
        if (url.hostname === 'archive-api.open-meteo.com') {
          archiveAttempts++;
          return new Response('slow down', {
            status: 429,
            headers: { 'retry-after': '120' },
          });
        }
        return null;
      },
    },
  });
  const { body } = await h.get('lat=30.49&lon=78.04&elev=2000');
  assert.equal(ensembleAttempts, 2);
  assert.equal(archiveAttempts, 1);
  assert.equal(body.ensemble.state, 'unavailable');
  assert.equal(body.antecedent.reason, 'rate-limited');
  assert.equal((await h.ledger()).dayCount, 3 * 13 + 2 * 51 + 10 + 4 * 10);
});

test('a failed refresh returns stale values with their original retrieval time', async (t) => {
  let fail = false;
  const h = await harness(t, {
    fixture: {
      override: (url) =>
        fail && url.pathname === '/v1/forecast'
          ? new Response('down', { status: 500 })
          : null,
    },
  });
  const first = await h.get('lat=30.49&lon=78.04&elev=2000');
  fail = true;
  h.advance(2 * 3600000);
  const second = await h.get('lat=30.49&lon=78.04&elev=2000');
  assert.equal(second.body.forecast.state, 'stale');
  assert.equal(
    second.body.forecast.retrievedAt,
    first.body.forecast.retrievedAt,
  );
});

test('antecedent totals use complete IMD days and never mix reanalyses', async (t) => {
  const h = await harness(t);
  const { body } = await h.get('lat=30.49&lon=78.04&elev=2000');
  assert.equal(body.antecedent.dataset, 'era5');
  assert.equal(body.antecedent.days.length, 7);
  assert.equal(body.antecedent.totalMm, 42);
  assert.ok(
    body.antecedent.days.every((d) => d.start.endsWith('T03:00:00.000Z')),
  );
  assert.equal(body.antecedent.days.at(-1).end, '2026-11-01T03:00:00.000Z');
  const land = await harness(t, {
    fixture: {
      override: (url) =>
        url.hostname === 'archive-api.open-meteo.com'
          ? new Response(JSON.stringify(historicalRaw({ landEmpty: false })))
          : null,
    },
  });
  assert.equal(
    (await land.get('lat=30.49&lon=78.04&elev=2000')).body.antecedent.dataset,
    'era5_land',
  );
});

test('IMD windows run 03:00 to 03:00 UTC and leave incomplete days null', () => {
  const start = Date.parse('2026-11-07T00:00:00.000Z');
  const times = Array.from({ length: 30 }, (_, i) => start + i * 3600000);
  const values = times.map(() => 1);
  const windows = imdWindows(times, values, start + 3 * 3600000, 2);
  assert.equal(windows[0].sum, 24);
  assert.equal(windows[1].sum, null);
});

test('forecast normalisation rejects changed units and keeps unsupported fields null', () => {
  const raw = forecastRaw({ unsupported: ['visibility'] });
  assert.deepEqual(normalizeForecastModel(raw).unsupported, ['visibilityM']);
  const changed = forecastRaw();
  changed.hourly_units.temperature_2m = '°F';
  assert.throws(() => normalizeForecastModel(changed), /unit-mismatch/);
});

test('IMERG values come only from exact published colormap classes', () => {
  const map = parseColormap(colormapXml());
  assert.deepEqual(classify(map, { index: 2, rgb: [0, 118, 78] }), {
    low: 0.1,
    high: 1,
  });
  assert.deepEqual(classify(map, { index: 1, rgb: [191, 191, 191] }), {
    low: 0,
    high: 0.1,
  });
  assert.equal(classify(map, { index: 0, rgb: [128, 128, 128] }), null);
  assert.deepEqual(classify(map, { index: 3, rgb: [58, 3, 48] }), {
    low: 1,
    high: null,
  });
  assert.throws(
    () => classify(map, { index: 2, rgb: [0, 118, 79] }),
    /colormap-mismatch/,
  );
  assert.equal(parseLatest(domainsXml()), Date.parse('2026-11-06T22:30:00Z'));
  assert.deepEqual(tileFor({ lat: 30.49, lon: 78.04 }), {
    row: 6,
    col: 28,
    x: 343,
    y: 313,
  });
  assert.deepEqual(imergCell({ lat: 30.49, lon: 78.04 }), {
    lat: 30.45,
    lon: 78.05,
  });
  const png = palettePng({
    filter: 2,
    pixel: (x, y) => (x === 343 && y === 313 ? 3 : 1),
  });
  assert.deepEqual(readPaletteIndex(png, 343, 313), {
    index: 3,
    rgb: [58, 3, 48],
  });
  assert.equal(readPaletteIndex(png, 342, 313).index, 1);
});

test('IMERG totals are intervals and missing half-hours make the part partial', async (t) => {
  const h = await harness(t, {
    fixture: {
      imergIndex: (url) => (url.pathname.includes('T22:30:00Z') ? 0 : 2),
    },
  });
  const { body } = await h.get('lat=30.49&lon=78.04&elev=2000');
  assert.equal(body.imerg.state, 'partial');
  assert.equal(body.imerg.missingCount, 1);
  assert.equal(body.imerg.totalLowMm, 2.35);
  assert.equal(body.imerg.totalHighMm, null);
  assert.equal(body.imerg.latestAt, '2026-11-06T22:30:00.000Z');
  assert.equal(body.imerg.class, 'observed');
});

test('queries outside the fixed capability are refused', async (t) => {
  const h = await harness(t);
  for (const query of [
    'lat=30.49',
    'lat=30.49&lon=78.04&elev=99999',
    'lat=30.49&lon=78.04&model=gfs',
    'lat=30.49&lon=78.04&from=2026-11-07T04:30:00Z',
    'lat=30.49&lon=78.04&from=2027-01-01T00:00:00Z',
  ])
    assert.equal((await h.get(query)).status, 400, query);
  assert.equal(h.calls.length, 0);
});

test('the GIBS ledger counts every IMERG request and refuses before dispatch', async (t) => {
  const h = await harness(t, { gibsBudget: { dailyLimit: 10 } });
  const { body } = await h.get('lat=30.49&lon=78.04&elev=2000');
  const gibs = await h.ledger('gibs.json');
  assert.equal(gibs.dayCount, 10);
  assert.equal(
    h.calls.filter((u) => u.hostname === 'gibs.earthdata.nasa.gov').length,
    10,
  );
  assert.equal(body.imerg.state, 'partial');
  assert.equal(body.imerg.reason, 'daily-limit');
});

test('weighted reservations count units and refuse when they would exceed a period', async (t) => {
  const dir = await tempDir(t);
  const budget = createMountainWeatherBudget({
    file: path.join(dir, 'w.json'),
    now: () => CLOCK,
    minuteLimit: 60,
  });
  assert.equal((await budget.reserve(51)).ok, true);
  assert.equal((await budget.reserve(13)).reason, 'minute-limit');
  assert.equal((await budget.reserve(9)).ok, true);
  assert.equal((await budget.reserve(61)).reason, 'budget-units');
  assert.equal((await budget.reserve(0)).reason, 'budget-units');
  assert.equal(
    JSON.parse(await readFile(path.join(dir, 'w.json'), 'utf8')).minuteCount,
    60,
  );
});
