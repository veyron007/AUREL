import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCheckpointSheet,
  dailyCategory,
  spellCategory,
  quantile,
  FORBIDDEN_WORDS,
  IMD_REFERENCE,
} from './checkpointSheet.js';
import {
  loadCheckpointSheet,
  resolveCheckpointElevation,
  sheetFocusHour,
} from './checkpointSheetLoader.js';
import { precipitationEvidence } from './precipitationLane.js';
import { createMountainWeatherSource } from '../sources/mountainWeather.js';
import {
  SOURCES,
  validateMountainWeatherPayload,
} from '../sources/mountainWeatherModel.js';
import { validateSavedMountainWeather } from '../fieldbook/mountainWeatherSnapshot.js';
import {
  sheetPayload,
  forecastRaw,
} from '../testSupport/mountainWeatherFixtures.mjs';

const point = { lat: 30.49, lon: 78.04, elevationM: 1987 };
const disagreeing = {
  override: (url) =>
    url.pathname === '/v1/forecast' &&
    url.searchParams.get('models') === 'gfs_seamless'
      ? new Response(
          JSON.stringify(forecastRaw({ values: { temperature_2m: 7 } })),
        )
      : null,
};

test('the sheet shows three models side by side with run time, lead and spread', async () => {
  const payload = await sheetPayload({ point, fixture: disagreeing });
  const sheet = buildCheckpointSheet(payload);
  assert.deepEqual(
    sheet.models.map((m) => m.label),
    ['DWD ICON', 'NOAA GFS', 'ECMWF IFS'],
  );
  assert.equal(sheet.focusAt, '2026-11-07T04:00:00.000Z');
  assert.ok(sheet.models.every((m) => m.runAt === '2026-11-06T18:00:00.000Z'));
  assert.ok(sheet.models.every((m) => m.leadHours === 10));
  const temperature = sheet.rows.find((r) => r.key === 'temperatureC');
  assert.deepEqual(
    temperature.values.map((v) => v.value),
    [4, 7, 4],
  );
  assert.equal(temperature.spread, 3);
  const freezing = sheet.rows.find((r) => r.key === 'freezingLevelM');
  assert.equal(freezing.values[2].unsupported, true);
  assert.equal(freezing.values[2].value, null);
  const wind = sheet.rows.find((r) => r.key === 'wind700Mps');
  assert.deepEqual(wind.values[0], {
    id: 'icon',
    value: 6,
    direction: 290,
    unsupported: false,
  });
  assert.equal(
    sheet.rows.find((r) => r.key === 'precipitation24Mm').values[0].value,
    12,
  );
});

test('a missing model stays missing in the sheet and in the spread', async () => {
  const payload = await sheetPayload({
    point,
    fixture: {
      override: (url) =>
        url.searchParams.get('models') === 'icon_seamless'
          ? new Response('gone', { status: 404 })
          : null,
    },
  });
  const sheet = buildCheckpointSheet(payload);
  assert.equal(sheet.forecastState, 'partial');
  assert.equal(sheet.models[0].state, 'missing');
  assert.equal(sheet.models[0].runAt, null);
  assert.equal(sheet.models[0].leadHours, null);
  const temperature = sheet.rows.find((r) => r.key === 'temperatureC');
  assert.equal(temperature.values[0].value, null);
  assert.equal(temperature.spread, 0);
});

test('ensemble counts members at or above each threshold on the focus day', async () => {
  const sheet = buildCheckpointSheet(await sheetPayload({ point }));
  const day = sheet.ensemble.focusDay;
  assert.equal(day.start, '2026-11-07T03:00:00.000Z');
  assert.equal(day.memberCount, 51);
  assert.deepEqual(
    day.counts.map((c) => [c.threshold, c.count]),
    [
      [1, 34],
      [2.5, 17],
      [15.6, 0],
      [64.5, 0],
      [115.6, 0],
      [204.5, 0],
    ],
  );
  assert.equal(day.median, 2.4);
  assert.equal(day.p90, 4.8);
  assert.equal(sheet.ensemble.leadHours, 10);
  assert.equal(sheet.ensemble.days.length, 6);
});

test('a departure hour moves the focus and its lead', async () => {
  const payload = await sheetPayload({
    point,
    from: '2026-11-08T06:00:00.000Z',
  });
  const sheet = buildCheckpointSheet(payload, {
    departureAt: '2026-11-08T06:30:00.000Z',
  });
  assert.equal(sheet.focusAt, '2026-11-08T06:00:00.000Z');
  assert.equal(sheet.focusIsDeparture, true);
  assert.equal(sheet.models[1].leadHours, 36);
  assert.equal(sheet.ensemble.focusDay.start, '2026-11-08T03:00:00.000Z');
});

test('antecedent, IMERG and the rain lane keep classes and IMD categories', async () => {
  const sheet = buildCheckpointSheet(await sheetPayload({ point }));
  assert.equal(sheet.antecedent.totalMm, 42);
  assert.equal(sheet.antecedent.dataset, 'era5');
  assert.equal(sheet.antecedent.wettest.category, 'light');
  assert.equal(sheet.imerg.totalLowMm, 2.4);
  assert.equal(sheet.imerg.totalHighMm, 24);
  assert.equal(sheet.imerg.categoryLow, 'very-light');
  assert.equal(sheet.imerg.categoryHigh, 'moderate');
  assert.equal(sheet.imerg.peak.spell, 'light-spell');
  assert.equal(sheet.imerg.windowEnd, '2026-11-06T23:00:00.000Z');
  assert.deepEqual(
    sheet.lane.rows.map((r) => [r.key, r.class]),
    [
      ['model-icon', 'modelled'],
      ['model-gfs', 'modelled'],
      ['model-ifs', 'modelled'],
      ['ensemble', 'modelled'],
      ['imerg', 'observed'],
      ['antecedent', 'modelled'],
    ],
  );
  assert.deepEqual(
    sheet.lane.lines.map((l) => l.mm),
    [2.5, 15.6],
  );
  assert.deepEqual(
    sheet.sources.map((s) => s.class),
    ['modelled', 'modelled', 'modelled', 'observed'],
  );
});

test('IMD categories follow the published boundaries', () => {
  assert.equal(dailyCategory(0), 'none');
  assert.equal(dailyCategory(2.4), 'very-light');
  assert.equal(dailyCategory(2.5), 'light');
  assert.equal(dailyCategory(15.55), 'moderate');
  assert.equal(dailyCategory(64.4), 'moderate');
  assert.equal(dailyCategory(64.5), 'heavy');
  assert.equal(dailyCategory(204.4), 'very-heavy');
  assert.equal(dailyCategory(204.5), 'extremely-heavy');
  assert.equal(dailyCategory(null), null);
  assert.equal(spellCategory(9.9), 'light-spell');
  assert.equal(spellCategory(100), 'cloudburst');
  assert.equal(quantile([0, 10], 0.5), 5);
  assert.equal(quantile([], 0.5), null);
});

test('sheet copy never uses go/no-go or safety wording', () => {
  for (const word of ['safe', 'Dangerous', 'go', 'no-go', 'unsafe'])
    assert.match(word, FORBIDDEN_WORDS);
  assert.doesNotMatch(
    'IMD remains the warning authority; ago',
    FORBIDDEN_WORDS,
  );
  const files = [
    'src/ui/views/panels/CheckpointSheet.vue',
    'src/planner/checkpointSheet.js',
    'src/planner/precipitationLane.js',
    'src/sources/mountainWeatherModel.js',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8').replace(
      /export const FORBIDDEN_WORDS[^\n]*\n(?:[^\n]*\n)?/,
      '',
    );
    for (const literal of source.match(
      /'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g,
    ))
      assert.doesNotMatch(literal, FORBIDDEN_WORDS, `${file}: ${literal}`);
  }
  const panel = readFileSync('src/ui/views/panels/PlannerPanelBody.vue', 'utf8');
  const sheetCopy = panel.match(
    /'[^']*mountain sheet[^']*'|'On request only[^']*'/g,
  );
  assert.ok(sheetCopy.length >= 3);
  sheetCopy.forEach((text) => assert.doesNotMatch(text, FORBIDDEN_WORDS));
  for (const source of Object.values(SOURCES))
    for (const value of Object.values(source))
      assert.doesNotMatch(value, FORBIDDEN_WORDS);
  assert.doesNotMatch(IMD_REFERENCE.title, FORBIDDEN_WORDS);
});

test('checkpoint elevation comes from the route profile, then a terrain lookup, then the provider DEM', async () => {
  const checkpoint = { lat: 30.4598, lon: 78.0644, distanceM: 0 };
  const profile = { samples: [{ ...checkpoint, elevationM: 2006 }] };
  assert.deepEqual(await resolveCheckpointElevation(checkpoint, profile), {
    elevationM: 2006,
    source: 'route-profile',
  });
  const terrain = async ([p]) => ({
    results: [
      {
        lat: p.lat,
        lon: p.lon,
        elevation: 1400,
        provenance: { tileset: 'mapterhorn-egm08', version: '5' },
      },
    ],
  });
  assert.deepEqual(
    await resolveCheckpointElevation(checkpoint, null, { getTerrain: terrain }),
    { elevationM: 1400, source: 'terrain-lookup' },
  );
  assert.deepEqual(
    await resolveCheckpointElevation(checkpoint, null, {
      getTerrain: async () => {
        throw new Error('offline');
      },
    }),
    { elevationM: null, source: 'provider-dem' },
  );
  const now = Date.parse('2026-11-07T04:20:00.000Z');
  assert.equal(
    sheetFocusHour('2026-11-08T06:30:00.000Z', now),
    '2026-11-08T06:00:00.000Z',
  );
  assert.equal(sheetFocusHour('2026-12-30T06:00:00.000Z', now), null);
  assert.equal(sheetFocusHour('2026-11-06T23:00:00.000Z', now), null);
  assert.equal(
    sheetFocusHour('2026-11-12T23:00:00.000Z', now),
    '2026-11-12T23:00:00.000Z',
  );
  assert.equal(sheetFocusHour('2026-11-13T00:00:00.000Z', now), null);
  assert.equal(sheetFocusHour(null, now), null);
});

test('loading a sheet returns a new snapshot that Fieldbook admits unchanged', async () => {
  const checkpoint = { lat: 30.49, lon: 78.04, distanceM: 0, context: {} };
  const snapshot = Object.freeze({
    departureAt: null,
    profile: null,
    checkpoints: Object.freeze([Object.freeze(checkpoint)]),
  });
  const requests = [];
  const next = await loadCheckpointSheet({
    snapshot,
    index: 0,
    getMountainWeather: async (p, options) => {
      requests.push([p, options.from]);
      return sheetPayload({ point: p });
    },
    getTerrain: null,
  });
  assert.equal(snapshot.checkpoints[0].mountainWeather, undefined);
  assert.deepEqual(requests, [
    [{ lat: 30.49, lon: 78.04, elevationM: null }, null],
  ]);
  const saved = next.checkpoints[0].mountainWeather;
  assert.equal(saved.elevationSource, 'provider-dem');
  assert.doesNotThrow(() =>
    validateSavedMountainWeather(saved, '$.m', checkpoint),
  );
  assert.throws(
    () =>
      validateSavedMountainWeather(
        { ...saved, elevationSource: 'route-profile' },
        '$.m',
        checkpoint,
      ),
    /elevation source/,
  );
  assert.throws(
    () =>
      validateSavedMountainWeather(saved, '$.m', { ...checkpoint, lat: 30.5 }),
    /another checkpoint/,
  );
  assert.throws(
    () =>
      validateSavedMountainWeather(
        { ...saved, sheet: { ...saved.sheet, extra: 1 } },
        '$.m',
        checkpoint,
      ),
    /invalid mountain weather sheet/,
  );
});

test('Chronicle precipitation rows keep their windows and classes', async () => {
  const sheet = await sheetPayload({ point });
  const rows = precipitationEvidence([
    {
      id: 'analysis-1',
      snapshot: {
        departureAt: null,
        checkpoints: [
          {
            ...point,
            mountainWeather: { elevationSource: 'route-profile', sheet },
          },
          { ...point },
        ],
      },
    },
  ]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['analysis-1:0:imerg', 'analysis-1:0:antecedent', 'analysis-1:0:ensemble'],
  );
  assert.match(rows[0].label, /observed/);
  assert.match(rows[1].label, /ERA5 7-day total 42 mm/);
  assert.match(rows[2].label, /34 of 51/);
  assert.equal(rows[2].start, '2026-11-07T03:00:00.000Z');
  assert.equal(rows[0].sourceId, 'nasa-gibs-imerg-30min');
});

test('the same-origin client validates the payload and the requested cell', async () => {
  const payload = await sheetPayload({ point });
  const urls = [];
  const source = createMountainWeatherSource({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(payload));
    },
  });
  const result = await source.getSheet(point, {
    from: '2026-11-07T04:00:00.000Z',
  });
  assert.deepEqual(result, validateMountainWeatherPayload(payload));
  assert.equal(
    urls[0],
    '/api/mountain-weather?lat=30.49&lon=78.04&elev=1987&from=2026-11-07T04%3A00%3A00.000Z',
  );
  await assert.rejects(
    source.getSheet({ lat: 31, lon: 78, elevationM: null }),
    /location mismatch/,
  );
  const limited = createMountainWeatherSource({
    fetchImpl: async () => new Response('{}', { status: 429 }),
  });
  await assert.rejects(limited.getSheet(point), { code: 'RATE_LIMITED' });
  const tampered = createMountainWeatherSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ ...payload, version: 2 })),
  });
  await assert.rejects(tampered.getSheet(point), /Invalid mountain weather/);
});

test('a departure outside the fetched window keeps the sheet on the window it describes', async () => {
  const payload = await sheetPayload({ point });
  const sheet = buildCheckpointSheet(payload, {
    departureAt: '2026-11-27T06:00:00.000Z',
  });
  assert.equal(sheet.focusAt, payload.window.from);
  assert.equal(sheet.focusIsDeparture, false);
  assert.equal(sheet.departureAt, '2026-11-27T06:00:00.000Z');
  assert.equal(sheet.models[0].leadHours, 10);
});

test('a model without snowfall says so in the 24 h snowfall row', async () => {
  const payload = await sheetPayload({
    point,
    fixture: {
      override: (url) =>
        url.searchParams.get('models') === 'ecmwf_ifs025'
          ? new Response(
              JSON.stringify(
                forecastRaw({
                  unsupported: [
                    'freezing_level_height',
                    'visibility',
                    'snowfall',
                  ],
                }),
              ),
            )
          : null,
    },
  });
  const row = buildCheckpointSheet(payload).rows.find(
    (r) => r.key === 'snowfall24Cm',
  );
  assert.equal(row.values[2].unsupported, true);
  assert.equal(row.values[2].value, null);
  assert.equal(row.values[0].unsupported, false);
});
