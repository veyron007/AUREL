import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEmscEvents } from '../../server/providers/second-source/emsc.js';
import { parseGeofonEvents } from '../../server/providers/second-source/geofon.js';
import { parseAircraftV2 } from '../../server/providers/second-source/aircraft.js';
import {
  analyseDependencies,
  compareAircraft,
  corroborateAircraft,
  corroborateFire,
  corroborateQuake,
  createSecondSourceClient,
  distanceKm,
  matchQuake,
  normalizeSecondSourceAnswer,
  propagate,
  STANDARD_WORDING,
  usgsNetwork,
} from './index.js';

const fixture = (name) =>
  readFileSync(
    new URL(
      `../../server/providers/second-source/fixtures/${name}`,
      import.meta.url,
    ),
    'utf8',
  );
const envelope = (sourceId, parsed, state = null) => ({
  sourceId,
  state: state ?? (parsed.records.length ? 'ok' : 'empty'),
  records: parsed.records,
  retrievedAt: Date.parse('2026-11-07T04:20:00Z'),
});
const EMPTY = { records: [], dropped: 0 };

// Known pairs, from bounded live queries recorded on 2026-11-07.
const USGS_UTTARKASHI = {
  usgsId: 'us6000u1f1',
  lat: 30.8109,
  lon: 78.4864,
  depthKm: 20.964,
  mag: 4.4,
  magType: 'mb',
  timeMs: Date.parse('2026-10-10T14:37:31.202Z'),
};
const USGS_HONSHU = {
  usgsId: 'us7000twg9',
  lat: 34.9677,
  lon: 142.1175,
  depthKm: 29,
  mag: 6.1,
  magType: 'mww',
  timeMs: Date.parse('2026-11-06T10:39:27.869Z'),
};

test('geometry: haversine distance and constant-track propagation', () => {
  assert.ok(
    Math.abs(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111.195) <
      0.01,
  );
  const moved = propagate({ lat: 0, lon: 0 }, 360, 0, 10);
  assert.ok(Math.abs(distanceKm({ lat: 0, lon: 0 }, moved) - 1.852) < 0.001);
  assert.equal(propagate({ lat: 0, lon: 0 }, null, 0, 10), null);
});

test('USGS Uttarkashi M4.4 agrees with the EMSC row (author NDI) inside tolerance', () => {
  const card = corroborateQuake(USGS_UTTARKASHI, {
    sources: {
      emsc: envelope(
        'emsc',
        parseEmscEvents(fixture('emsc-uttarkashi-2026-10-10.json')),
      ),
      geofon: envelope('geofon', EMPTY),
    },
  });
  assert.equal(card.status, 'agree');
  const emsc = card.rows.find((row) => row.nodeId === 'emsc');
  assert.equal(emsc.role, 'independent');
  const value = (id) => emsc.quantities.find((q) => q.id === id);
  assert.equal(value('time-offset').value, -1.2);
  assert.equal(value('time-offset').unit, 's');
  assert.equal(value('time-offset').class, 'derived');
  assert.equal(value('time-offset').source, 'EMSC − USGS');
  assert.equal(value('time-offset').at, USGS_UTTARKASHI.timeMs);
  assert.equal(value('position-residual').value, 10.2);
  assert.equal(value('magnitude-difference').value, -0.2);
  assert.ok(
    emsc.notes.some((n) => n.code === 'catalogue-author' && n.author === 'NDI'),
  );
  assert.ok(emsc.notes.some((n) => n.code === 'magnitude-types-differ'));
  const geofon = card.rows.find((row) => row.nodeId === 'geofon');
  assert.deepEqual([geofon.state, geofon.matched], ['empty', false]);
  assert.equal(card.dependency.independentCorroborators, 1);
  assert.deepEqual(card.wording, [...STANDARD_WORDING]);
});

test('USGS Honshu M6.1 is matched by EMSC and GEOFON as two independent solutions', () => {
  const card = corroborateQuake(USGS_HONSHU, {
    sources: {
      emsc: envelope(
        'emsc',
        parseEmscEvents(fixture('emsc-honshu-2026-11-06.json')),
      ),
      geofon: envelope(
        'geofon',
        parseGeofonEvents(fixture('geofon-honshu-2026-11-06.txt')),
      ),
    },
  });
  assert.equal(card.status, 'agree');
  assert.equal(card.dependency.independentCorroborators, 2);
  const geofon = card.rows.find((row) => row.nodeId === 'geofon');
  const residual = geofon.quantities.find((q) => q.id === 'position-residual');
  assert.ok(
    residual.value > 0 && residual.value < 30,
    `residual ${residual.value} km`,
  );
});

test('an EMSC row authored by NEIC is the USGS solution relayed and is not corroboration', () => {
  const parsed = parseEmscEvents(fixture('emsc-honshu-2026-11-06.json'));
  const relayed = {
    records: [{ ...parsed.records[0], author: 'NEIC' }],
    dropped: 0,
  };
  const card = corroborateQuake(USGS_HONSHU, {
    sources: {
      emsc: envelope('emsc', relayed),
      geofon: envelope('geofon', EMPTY),
    },
  });
  assert.equal(card.status, 'single-source');
  const emsc = card.rows.find((row) => row.nodeId === 'emsc');
  assert.deepEqual([emsc.matched, emsc.role], [true, 'dependent']);
  // Live case 2026-11-07 (us7000twqm, Guam): a catalogue with no record is
  // not counted, so the relayed solution leaves one independent source.
  assert.deepEqual(
    [card.dependency.minIndependent, card.dependency.maxIndependent],
    [1, 1],
  );
  assert.ok(
    card.dependency.edges.some(
      (edge) =>
        edge.from === 'emsc' &&
        edge.to === 'usgs' &&
        edge.relation === 'relays',
    ),
  );
  assert.equal(usgsNetwork('us7000twg9'), 'US');
  assert.equal(usgsNetwork('ak0245zz'), 'AK');
});

test('EMSC relaying GFZ and GEOFON itself count once', () => {
  const geofon = parseGeofonEvents(fixture('geofon-honshu-2026-11-06.txt'));
  const emsc = {
    records: [{ ...geofon.records[0], id: 'emsc-1', author: 'GFZ' }],
    dropped: 0,
  };
  const card = corroborateQuake(USGS_HONSHU, {
    sources: {
      emsc: envelope('emsc', emsc),
      geofon: envelope('geofon', geofon),
    },
  });
  assert.equal(card.status, 'agree');
  assert.equal(card.dependency.independentCorroborators, 1);
});

test('a match outside agreement bounds is a (normal) disagreement naming the quantity', () => {
  const parsed = parseEmscEvents(fixture('emsc-uttarkashi-2026-10-10.json'));
  const far = {
    records: [
      { ...parsed.records[0], lat: parsed.records[0].lat + 0.6, mag: 5.2 },
    ],
    dropped: 0,
  };
  const card = corroborateQuake(USGS_UTTARKASHI, {
    sources: {
      emsc: envelope('emsc', far),
      geofon: envelope('geofon', EMPTY),
    },
  });
  assert.equal(card.status, 'disagree');
  const emsc = card.rows.find((row) => row.nodeId === 'emsc');
  const note = emsc.notes.find((n) => n.code === 'outside-agreement');
  assert.deepEqual(note.quantities, ['position', 'magnitude']);
  assert.deepEqual(card.wording, [
    'disagreement-normal',
    'agreement-not-truth',
  ]);
});

test('matching windows: rows outside time, distance or magnitude are not candidates', () => {
  const base = {
    id: 'x',
    lat: 30.8,
    lon: 78.5,
    mag: 4.4,
    timeMs: USGS_UTTARKASHI.timeMs,
  };
  assert.ok(matchQuake(USGS_UTTARKASHI, [base]));
  assert.equal(
    matchQuake(USGS_UTTARKASHI, [{ ...base, timeMs: base.timeMs + 181_000 }]),
    null,
  );
  assert.equal(matchQuake(USGS_UTTARKASHI, [{ ...base, lat: 32.3 }]), null);
  assert.equal(matchQuake(USGS_UTTARKASHI, [{ ...base, mag: 6.0 }]), null);
  const best = matchQuake(USGS_UTTARKASHI, [
    { ...base, id: 'later', timeMs: base.timeMs + 120_000 },
    { ...base, id: 'close' },
  ]);
  assert.equal(best.row.id, 'close');
});

test('single-source when both catalogues answer empty; unavailable on outage', () => {
  const single = corroborateQuake(USGS_UTTARKASHI, {
    sources: {
      emsc: envelope('emsc', EMPTY),
      geofon: envelope('geofon', EMPTY),
    },
  });
  assert.equal(single.status, 'single-source');
  const outage = corroborateQuake(USGS_UTTARKASHI, null);
  assert.equal(outage.status, 'unavailable');
  assert.ok(outage.rows.every((row) => row.state === 'unavailable'));
  const denied = corroborateQuake(USGS_UTTARKASHI, {
    sources: {
      emsc: { state: 'denied', records: [], reason: 'budget:daily-limit' },
      geofon: { state: 'unavailable', records: [], reason: 'http:503' },
    },
  });
  assert.equal(denied.status, 'unavailable');
  assert.equal(denied.rows[0].reason, 'budget:daily-limit');
  const stale = corroborateQuake(USGS_UTTARKASHI, {
    sources: {
      emsc: envelope(
        'emsc',
        parseEmscEvents(fixture('emsc-uttarkashi-2026-10-10.json')),
        'stale',
      ),
      geofon: { state: 'unavailable', records: [] },
    },
  });
  assert.equal(stale.status, 'agree');
  assert.ok(stale.rows[0].notes.some((n) => n.code === 'served-stale'));
});

const VIIRS = {
  lat: 30.3,
  lon: 78.0,
  acqMs: Date.parse('2026-11-07T08:00:00Z'),
  sensor: 'VIIRS',
  satellite: 'N20',
  frp: 12.4,
};
const MODIS = {
  ...VIIRS,
  lat: 30.305,
  sensor: 'MODIS',
  satellite: 'Aqua',
  frp: 30.1,
};

test('FIRMS: VIIRS NOAA-20 and MODIS within the window read as two sensors', () => {
  const card = corroborateFire({
    selected: VIIRS,
    nearby: [{ ...MODIS, acqMs: VIIRS.acqMs + 20 * 60_000 }],
    loadedBySensor: { VIIRS: 10, MODIS: 4 },
  });
  assert.equal(card.status, 'agree');
  assert.equal(card.primary.label, 'VIIRS NOAA-20');
  const row = card.rows[0];
  assert.equal(row.label, 'MODIS Aqua');
  assert.equal(row.quantities.find((q) => q.id === 'time-offset').value, 20);
  const residual = row.quantities.find((q) => q.id === 'position-residual');
  assert.deepEqual([residual.value, residual.unit], [560, 'm']);
  assert.ok(card.notes.some((n) => n.code === 'same-distributor'));
});

test('FIRMS: one sensor is normal; another VIIRS satellite is not a second sensor', () => {
  const card = corroborateFire({
    selected: VIIRS,
    nearby: [
      { ...VIIRS, satellite: 'N21' },
      { ...MODIS, acqMs: VIIRS.acqMs + 3 * 3_600_000 },
      { ...MODIS, lat: 30.4 },
    ],
    loadedBySensor: { VIIRS: 10, MODIS: 4 },
  });
  assert.equal(card.status, 'single-source');
  assert.ok(card.notes.some((n) => n.code === 'one-sensor-common'));
  const missing = corroborateFire({
    selected: MODIS,
    nearby: [VIIRS],
    loadedBySensor: { MODIS: 4, VIIRS: 0 },
  });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.rows[0].reason, 'family-not-loaded');
});

const fi = parseAircraftV2(fixture('adsbfi-hex-8014f9.json'), {
  hex: '8014f9',
});
const lol = parseAircraftV2(fixture('adsblol-hex-8014f9.json'), {
  hex: '8014f9',
});

test('aircraft: adsb.fi agrees with adsb.lol after moving to the same instant', () => {
  const compared = compareAircraft(lol.records[0], fi.records[0]);
  assert.ok(compared.rawKm > 0.2, 'the raw positions are seconds apart');
  assert.ok(compared.residualKm < compared.rawKm);
  assert.equal(compared.agree, true);
  const card = corroborateAircraft({
    hex: '8014f9',
    answer: {
      sources: {
        'adsb-fi': envelope('adsb-fi', fi),
        'adsb-lol': envelope('adsb-lol', lol),
      },
    },
  });
  assert.equal(card.status, 'agree');
  assert.equal(card.primary.nodeId, 'adsb-lol');
  const row = card.rows[0];
  assert.equal(
    row.possiblyShared,
    true,
    'aggregators may share volunteer feeders',
  );
  assert.equal(card.dependency.minIndependent, 1);
  assert.equal(card.dependency.maxIndependent, 2);
});

test('aircraft: the local receiver feeding adsb.lol counts once', () => {
  const local = {
    ...lol.records[0],
    positionTimeMs: lol.records[0].positionTimeMs + 1000,
  };
  const card = corroborateAircraft({
    hex: '8014f9',
    localRecord: local,
    answer: {
      sources: {
        'adsb-fi': envelope('adsb-fi', EMPTY),
        'adsb-lol': envelope('adsb-lol', lol),
      },
    },
  });
  const localRow = card.rows.find((row) => row.nodeId === 'local-receiver');
  assert.deepEqual([localRow.matched, localRow.role], [true, 'dependent']);
  assert.equal(card.status, 'single-source');
  const graph = analyseDependencies(['local-receiver', 'adsb-lol', 'adsb-fi']);
  assert.equal(graph.maxIndependent, 2);
  assert.equal(graph.minIndependent, 1);
});

test('aircraft: outage of the second source and a disagreeing report', () => {
  const outage = corroborateAircraft({
    hex: '8014f9',
    answer: {
      sources: {
        'adsb-fi': { state: 'unavailable', records: [], reason: 'http:503' },
        'adsb-lol': envelope('adsb-lol', lol),
      },
    },
  });
  assert.equal(outage.status, 'unavailable');
  const layerOnly = corroborateAircraft({
    hex: '8014f9',
    layerRecord: { ...lol.records[0], sourceNode: 'opensky' },
    answer: null,
  });
  assert.equal(layerOnly.primary.label, 'OpenSky Network');
  assert.equal(layerOnly.status, 'unavailable');
  const far = {
    ...fi.records[0],
    lat: fi.records[0].lat + 0.05,
    altBaroFt: 9000,
  };
  const card = corroborateAircraft({
    hex: '8014f9',
    answer: {
      sources: {
        'adsb-fi': envelope('adsb-fi', { records: [far] }),
        'adsb-lol': envelope('adsb-lol', lol),
      },
    },
  });
  assert.equal(card.status, 'disagree');
  assert.deepEqual(
    card.rows[0].notes.find((n) => n.code === 'outside-agreement').quantities,
    ['position', 'altitude'],
  );
});

test('client keeps only typed envelopes from the local route', async () => {
  const normalized = normalizeSecondSourceAnswer(
    { sources: { emsc: { state: 'weird', records: 'x' } } },
    ['emsc', 'geofon'],
  );
  assert.deepEqual(
    [normalized.sources.emsc.state, normalized.sources.geofon.reason],
    ['unavailable', 'missing'],
  );
  const urls = [];
  const client = createSecondSourceClient({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ sources: {} }), { status: 200 });
    },
  });
  await client.quake({ lat: 30.81, lon: 78.49, timeMs: 1 });
  await client.aircraft({ hex: '8014f9' });
  assert.deepEqual(urls, [
    '/api/second-source/quake?lat=30.81&lon=78.49&time=1',
    '/api/second-source/aircraft?hex=8014f9',
  ]);
  const failing = createSecondSourceClient({
    fetchImpl: async () => new Response('{}', { status: 500 }),
  });
  await assert.rejects(failing.aircraft({ hex: '8014f9' }));
});
