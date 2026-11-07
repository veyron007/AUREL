// i18n-ignore-file: peak matching and envelope fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { destination } from './geodesy.js';
import { decodeGridPayload } from './grid.js';
import { marchHorizon } from './rayMarch.js';
import { matchPeaks } from './peaks.js';
import { computeHorizon } from './compute.js';
import { roundAzimuth, roundTime, toProvenanceEnvelope } from './envelope.js';
import { createHorizonService, normalizeHorizonRequest } from './service.js';
import { syntheticPayload } from './testFixtures.mjs';

const observer = { lat: 30.4597, lon: 78.1058 };
// East: a 3000 m summit at 15 km stands clear.
// South: a 2000 m summit at 15 km stands behind a 1500 m ridge at 3 km (hidden).
// West: a 900 m summit at 9 km just level with a 300 m ridge at 3 km (marginal).
// North: a 1000 m summit at 8 km below a 4000 m range at 18 km (visible, not skyline).
function heights(az, d) {
  const at = (target, width) => Math.abs(d - target) < width;
  if (az >= 89 && az <= 91) return at(15000, 160) ? 3000 : 0;
  if (az >= 179 && az <= 181) return at(3000, 40) ? 1500 : at(15000, 160) ? 2000 : 0;
  if (az >= 269 && az <= 271) return at(3000, 40) ? 300 : at(9000, 100) ? 900 : 0;
  if (az <= 1 || az >= 359) return at(8000, 90) ? 1000 : at(18000, 200) ? 4000 : 0;
  return 0;
}
const peakAt = (id, name, az, d, eleM) => ({
  id,
  name,
  nameHi: null,
  eleM,
  ...destination(observer.lat, observer.lon, az, d),
});
const PEAKS = [
  peakAt('node/1', 'East Summit', 90, 15000, 3050),
  peakAt('node/2', 'South Summit', 180, 15000, 2000),
  peakAt('node/3', 'West Knoll', 270, 9000, null),
  peakAt('node/4', 'North Spur', 0, 8000, 1000),
  peakAt('node/5', 'Beyond Radius', 90, 30000, 5000),
  peakAt('node/6', 'Own Hill', 45, 200, 50),
];

function fixture() {
  const payload = syntheticPayload({ ...observer, height: heights });
  const { grid } = decodeGridPayload(payload);
  return { payload, grid, horizon: marchHorizon(grid, 0) };
}

test('peak matching names, places and classifies skyline peaks', () => {
  const { grid, horizon } = fixture();
  const result = matchPeaks({ observer, eyeM: 0, grid, horizon, peaks: PEAKS, radiusM: 20000 });
  const byName = Object.fromEntries(
    [...result.listed].map((row) => [row.name, row]),
  );
  assert.equal(result.considered, 4, 'out-of-radius and own-hill peaks are skipped');
  assert.equal(byName['East Summit'].state, 'skyline');
  assert.ok(Math.abs(byName['East Summit'].azimuthDeg - 90) < 0.01);
  assert.ok(Math.abs(byName['East Summit'].distanceM - 15000) < 1);
  assert.equal(byName['East Summit'].demM, 3000);
  assert.equal(byName['East Summit'].osmEleM, 3050);
  assert.equal(byName['East Summit'].differenceM, -50);
  assert.equal(byName['North Spur'].state, 'visible');
  assert.equal(result.counts.hidden, 1);
  assert.equal(byName['South Summit'], undefined, 'hidden peaks are counted, not listed');
  assert.equal(result.listed[0].name, 'East Summit', 'skyline first');
});

test('a summit level with its foreground is marginal, with a signed clearance', () => {
  const { grid, horizon } = fixture();
  const result = matchPeaks({ observer, eyeM: 0, grid, horizon, peaks: PEAKS, radiusM: 20000 });
  const knoll = result.listed.find((row) => row.name === 'West Knoll');
  // 900 m at 9 km is 5.70°; 300 m at 3 km is 5.71°: within 0.1°.
  assert.equal(knoll.state, 'marginal');
  assert.ok(Math.abs(knoll.clearanceDeg) < 0.1);
  assert.equal(knoll.differenceM, null, 'no OSM ele, no difference');
});

test('provenance envelope: rounded, labelled, and every number carries unit, class, source and time', () => {
  const { payload } = fixture();
  const result = computeHorizon({
    payload,
    localDate: '2026-12-21',
    timeZone: 'Asia/Kolkata',
    shadowAt: '2026-12-21T07:00:00Z',
    peaks: {
      entries: PEAKS,
      source: {
        label: 'fixture peaks',
        license: 'ODbL-1.0',
        attribution: '© OpenStreetMap contributors',
        link: 'https://www.openstreetmap.org/copyright',
        retrievedAt: '2026-11-06T19:58:02.272Z',
        extractAt: '2026-11-05T21:23:02Z',
      },
    },
    now: '2026-11-07T00:00:00.000Z',
  });
  const envelope = toProvenanceEnvelope(result);
  assert.equal(envelope.kind, 'aurel.horizon');
  assert.equal(envelope.label, 'geometric visibility, terrain-only');
  assert.equal(envelope.refractionK, 0.13);
  assert.equal(envelope.horizon.elevationDeg.value.length, 360);
  assert.deepEqual(
    envelope.sources.map((source) => source.id),
    ['copernicus-glo30', 'local-ephemeris', 'osm-peaks'],
  );
  const quantities = [];
  (function walk(value) {
    if (!value || typeof value !== 'object') return;
    if ('class' in value && 'unit' in value) return quantities.push(value);
    Object.values(value).forEach(walk);
  })(envelope);
  assert.ok(quantities.length > 25);
  for (const q of quantities) {
    assert.ok(['observed', 'modelled', 'derived', 'simulated', 'note'].includes(q.class));
    assert.equal(typeof q.unit, 'string');
    assert.equal(typeof q.source, 'string');
    assert.ok('applicableTime' in q);
  }
  for (const row of envelope.peaks.listed)
    assert.ok(Number.isInteger(row.azimuthDeg.value));
  for (const key of ['astronomicalRise', 'terrainRise', 'astronomicalSet', 'terrainSet'])
    assert.match(envelope.sun[key].value, /:00\.000Z$/);
  assert.equal(envelope.shadow.timeSource, 'entered on this device');
  assert.doesNotMatch(JSON.stringify(envelope), /guarantee/i);
});

test('rounding helpers keep azimuths in [0, 360) and times on the minute', () => {
  assert.equal(roundAzimuth(359.6), 0);
  assert.equal(roundAzimuth(41.49), 41);
  assert.equal(roundTime('2026-12-21T01:40:31.000Z'), '2026-12-21T01:41:00.000Z');
  assert.equal(roundTime(null), null);
});

test('request validation names each bound', () => {
  const base = { lat: 30.4597, lon: 78.1058, localDate: '2026-12-21' };
  assert.equal(normalizeHorizonRequest(base).radiusKm, 200);
  assert.throws(() => normalizeHorizonRequest({ ...base, lat: 89 }), /Latitude/);
  assert.throws(() => normalizeHorizonRequest({ ...base, observerHeightM: 900 }), /Observer height/);
  assert.throws(() => normalizeHorizonRequest({ ...base, localDate: 'tomorrow' }), /Date/);
  assert.throws(() => normalizeHorizonRequest({ ...base, timeZone: 'Mars/Olympus' }), /time zone/);
  assert.throws(() => normalizeHorizonRequest({ ...base, radiusKm: 5 }), /Radius/);
  assert.throws(() => normalizeHorizonRequest({ ...base, gnomonM: 0 }), /Gnomon/);
});

test('service reads the terrain route and degrades to an empty peaks list', async () => {
  const payload = syntheticPayload({ ...observer, radiusKm: 20 });
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('/api/horizon/terrain'))
      return new Response(JSON.stringify(payload), { status: 200 });
    return new Response('missing', { status: 404 });
  };
  const service = createHorizonService({ fetchImpl });
  const result = await service.horizonAt({ ...observer, localDate: '2026-12-21', radiusKm: 20 });
  assert.match(calls[0], /^\/api\/horizon\/terrain\?lat=30\.4597&lon=78\.1058&radiusKm=20$/);
  assert.deepEqual(result.peaks.listed, []);
  assert.equal(result.peaks.source, null);
  const failing = createHorizonService({
    fetchImpl: async () => new Response(JSON.stringify({ error: 'The DEM host is limiting requests; try again later.' }), { status: 429 }),
  });
  await assert.rejects(
    failing.horizonAt({ ...observer, localDate: '2026-12-21' }),
    /limiting requests/,
  );
});
