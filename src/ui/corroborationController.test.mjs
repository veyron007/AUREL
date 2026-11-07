import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CorroborationController,
  corroborationKind,
  layerAircraftRecord,
  subjectHex,
} from './corroborationController.js';

const QUAKE = {
  layerId: 'earthquakes',
  id: 'earthquake:us6000u1f1',
  label: 'M4.4 · 9 km NNE of Uttarkashi, India',
  latitude: 30.8109,
  longitude: 78.4864,
  properties: {
    usgsId: 'us6000u1f1',
    mag: 4.4,
    timeMs: Date.parse('2026-10-10T14:37:31.202Z'),
    depthKm: 20.964,
  },
};
const EMSC_ROW = {
  id: '20261010_0000265',
  timeMs: Date.parse('2026-10-10T14:37:30Z'),
  lat: 30.744,
  lon: 78.414,
  depthKm: 11,
  mag: 4.2,
  magType: 'm',
  author: 'NDI',
};

function harness({ client, readLayer = () => null } = {}) {
  const views = [];
  let listener = null;
  let actions = null;
  const store = {
    connect(next) {
      actions = next;
      return { next };
    },
    detach() {
      actions = null;
    },
    publish(view) {
      views.push(view);
    },
  };
  const controller = new CorroborationController({
    store,
    client,
    readLayer,
    now: () => Date.parse('2026-11-07T05:00:00Z'),
    subscribeSubjects(fn) {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  });
  controller.init();
  return {
    controller,
    views,
    emit: (subject) => listener?.(subject),
    act: (name) => actions?.[name]?.(),
    last: () => views.at(-1),
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

test('selection kinds and ICAO addresses', () => {
  assert.equal(corroborationKind(QUAKE), 'quake');
  assert.equal(corroborationKind({ layerId: 'local-firms' }), 'fire');
  assert.equal(corroborationKind({ layerId: 'flights' }), 'aircraft');
  assert.equal(corroborationKind({ layerId: 'cctv' }), null);
  assert.equal(subjectHex({ layerId: 'flights', id: '8014F9' }), '8014f9');
  assert.equal(
    subjectHex({
      layerId: 'local-adsb',
      id: 'x',
      properties: { icao: '800c0c' },
    }),
    '800c0c',
  );
  assert.equal(subjectHex({ layerId: 'flights', id: 'VT-ECG' }), null);
});

test('a selected quake asks the route once and publishes an agreeing card', async () => {
  const calls = [];
  const h = harness({
    client: {
      async quake(query) {
        calls.push(query);
        return {
          sources: {
            emsc: { state: 'ok', records: [EMSC_ROW] },
            geofon: { state: 'empty', records: [] },
          },
        };
      },
    },
  });
  h.emit(QUAKE);
  assert.equal(h.last().status, 'loading');
  await h.settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(
    [calls[0].lat, calls[0].lon, calls[0].mag],
    [30.8109, 78.4864, 4.4],
  );
  assert.equal(h.last().status, 'ready');
  assert.equal(h.last().card.status, 'agree');
  assert.equal(h.last().card.kind, 'quake');
  h.emit({ ...QUAKE });
  await h.settle();
  assert.equal(calls.length, 1, 'the same subject is not re-queried');
  h.act('refresh');
  await h.settle();
  assert.equal(calls.length, 2, 'Check again asks once more');
});

test('a late answer for an old selection never replaces the new one', async () => {
  let release;
  const h = harness({
    client: {
      quake: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              sources: { emsc: { state: 'ok', records: [EMSC_ROW] } },
            });
        }),
    },
  });
  h.emit(QUAKE);
  h.emit({ layerId: 'cctv', id: 'camera-1' });
  release();
  await h.settle();
  assert.equal(h.last(), null, 'unsupported selections hide the card');
  h.emit(QUAKE);
  h.emit(null);
  release();
  await h.settle();
  assert.equal(h.last(), null);
});

test('a route failure becomes an unavailable card, not an error', async () => {
  const h = harness({
    client: {
      async quake() {
        throw new Error('Second Source HTTP 502');
      },
    },
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    h.emit(QUAKE);
    await h.settle();
  } finally {
    console.warn = warn;
  }
  assert.equal(h.last().status, 'ready');
  assert.equal(h.last().card.status, 'unavailable');
});

test('a fire selection reads the FIRMS layer without any request', async () => {
  const acqMs = Date.parse('2026-11-07T08:00:00Z');
  const h = harness({
    client: {
      quake: () => assert.fail('no request'),
      aircraft: () => assert.fail('no request'),
    },
    readLayer: (id) =>
      id === 'local-firms'
        ? {
            getCorroborationInput: () => ({
              id: 'fire-1',
              selected: {
                lat: 30.3,
                lon: 78,
                acqMs,
                sensor: 'VIIRS',
                satellite: 'N20',
                frp: 9,
              },
              nearby: [
                {
                  lat: 30.304,
                  lon: 78,
                  acqMs: acqMs + 600_000,
                  sensor: 'MODIS',
                  satellite: 'Terra',
                  frp: 20,
                },
              ],
              loadedBySensor: { VIIRS: 1, MODIS: 1 },
              fetchedAt: acqMs,
              stale: false,
            }),
          }
        : null,
  });
  h.emit({ layerId: 'local-firms', id: 'fire-1', properties: {} });
  await h.settle();
  assert.equal(h.last().card.status, 'agree');
  assert.equal(h.last().card.rows[0].label, 'MODIS Terra');
  h.emit({ layerId: 'local-firms', id: 'fire-2', properties: {} });
  await h.settle();
  assert.equal(
    h.last().status,
    'unsupported',
    'a mismatched selection is not guessed',
  );
});

test('an aircraft joins the layer, the local receiver and the route answer', async () => {
  const at = Date.parse('2026-11-07T04:20:00Z');
  const asked = [];
  const local = {
    hex: '8014f9',
    lat: 30.3291,
    lon: 77.0778,
    positionTimeMs: at,
    altBaroFt: 6675,
    groundSpeedKt: 234,
    trackDeg: 97,
  };
  const h = harness({
    client: {
      async aircraft(query) {
        asked.push(query);
        return {
          sources: {
            'adsb-fi': { state: 'empty', records: [] },
            'adsb-lol': {
              state: 'ok',
              records: [{ ...local, positionTimeMs: at - 500 }],
            },
          },
        };
      },
    },
    readLayer: (id) =>
      id === 'local-adsb'
        ? {
            getCorroborationRecord: (hex) => (hex === '8014f9' ? local : null),
          }
        : null,
  });
  h.emit({ layerId: 'flights', id: '8014f9', properties: {} });
  await h.settle();
  assert.deepEqual(asked, [{ hex: '8014f9' }]);
  const card = h.last().card;
  assert.equal(card.status, 'single-source');
  const localRow = card.rows.find((row) => row.nodeId === 'local-receiver');
  assert.equal(localRow.role, 'dependent');
});

test('layer aircraft records convert units and name their source', () => {
  const module = {
    getStats: () => ({ source: 'OpenSky Network' }),
    getAnalystRecords: () => [
      {
        icao24: '8014f9',
        lat: 30,
        lon: 77,
        altitudeM: 1000,
        speedMps: 100,
        heading: 90,
        lastContactAtMs: 5,
      },
    ],
  };
  const record = layerAircraftRecord(module, '8014f9');
  assert.equal(record.altBaroFt, 3281);
  assert.ok(Math.abs(record.groundSpeedKt - 194.38) < 0.01);
  assert.equal(record.sourceNode, 'opensky');
  assert.equal(layerAircraftRecord(module, '000000'), null);
});

test('destroy detaches, clears the view and stops listening', () => {
  const h = harness({ client: { quake: async () => null } });
  h.controller.destroy();
  assert.equal(h.last(), null);
  h.emit(QUAKE);
  assert.equal(h.views.at(-1), null);
});
