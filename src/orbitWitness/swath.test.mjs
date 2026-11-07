import test from 'node:test';
import assert from 'node:assert/strict';
import { missionElementSets, tleEpochMs, epochConfidence } from './tle.js';
import {
  findSwathPasses,
  findSkyPasses,
  swathFootprint,
  ringContains,
  groundDistanceKm,
  offNadirDeg,
  trackOffsets,
  PASS_SEARCH_LIMITS,
} from './swath.js';
import { FIXTURE_TLE, MUSSOORIE, S2B_SCENE } from './testFixtures.mjs';

const sets = missionElementSets(FIXTURE_TLE);
const set = (id) => sets.find((row) => row.missionId === id);

test('element sets are read by NORAD id with their line-1 epochs', () => {
  assert.deepEqual(
    sets.map((row) => row.missionId),
    [
      'sentinel-2a',
      'sentinel-2b',
      'sentinel-2c',
      'landsat-8',
      'landsat-9',
      'iss',
    ],
  );
  assert.equal(
    new Date(set('sentinel-2b').epochMs).toISOString(),
    '2026-11-06T20:45:23.948Z',
  );
  assert.equal(tleEpochMs('1 bad'), null);
  assert.equal(epochConfidence(2), 'fresh');
  assert.equal(epochConfidence(5), 'aging');
  assert.equal(epochConfidence(12), 'stale');
});

test('the Sentinel-2B swath crossing over Mussoorie lands beside the catalogued acquisition', () => {
  const { passes } = findSwathPasses({
    satrec: set('sentinel-2b').satrec,
    place: MUSSOORIE,
    fromMs: Date.parse('2026-10-24T00:00:00Z'),
    days: 3,
    swathKm: 290,
  });
  assert.equal(passes.length, 1);
  const [pass] = passes;
  // Earth Search tile-centre time for 43RGP; back-propagated from an epoch 12 days later.
  assert.ok(Math.abs(pass.timeMs - Date.parse(S2B_SCENE.datetime)) < 30000);
  assert.equal(pass.node, 'descending');
  assert.ok(Math.abs(pass.crossTrackKm) < 145, 'inside the half swath');
  assert.ok(Math.abs(Math.abs(pass.crossTrackKm) - 58) < 10);
  assert.ok(pass.altitudeKm > 780 && pass.altitudeKm < 800);
  assert.ok(pass.offNadirDeg > 3 && pass.offNadirDeg < 6);
  assert.ok(pass.solarElevationDeg > 30);
});

test('a nominal footprint is a closed ring that contains the place and spans the swath', () => {
  const timeMs = Date.parse('2026-10-25T05:40:29Z');
  const ring = swathFootprint(set('sentinel-2b').satrec, timeMs, {
    swathKm: 290,
  });
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.ok(ringContains(ring, MUSSOORIE.lon, MUSSOORIE.lat));
  const half = (ring.length - 1) / 2;
  const [l, r] = [
    ring[Math.floor(half / 2)],
    ring[ring.length - 2 - Math.floor(half / 2)],
  ];
  const width = groundDistanceKm(
    { lon: l[0], lat: l[1] },
    { lon: r[0], lat: r[1] },
  );
  assert.ok(Math.abs(width - 290) < 6, `width ${width}`);
  assert.equal(ringContains(ring, MUSSOORIE.lon + 5, MUSSOORIE.lat), false);
  assert.throws(() =>
    swathFootprint(set('sentinel-2b').satrec, timeMs, {
      swathKm: 290,
      halfSpanSec: 500,
    }),
  );
});

test('a narrower swath drops a crossing the wider swath keeps', () => {
  const args = {
    satrec: set('sentinel-2b').satrec,
    place: MUSSOORIE,
    fromMs: Date.parse('2026-10-24T00:00:00Z'),
    days: 3,
  };
  assert.equal(findSwathPasses({ ...args, swathKm: 290 }).passes.length, 1);
  assert.equal(findSwathPasses({ ...args, swathKm: 100 }).passes.length, 0);
});

test('Landsat 8 and 9 cross on their eight-day offset; night crossings are dropped', () => {
  const window = {
    place: MUSSOORIE,
    fromMs: Date.parse('2026-10-20T00:00:00Z'),
    days: 14,
    swathKm: 185,
  };
  const l8 = findSwathPasses({
    ...window,
    satrec: set('landsat-8').satrec,
  }).passes;
  const l9 = findSwathPasses({
    ...window,
    satrec: set('landsat-9').satrec,
  }).passes;
  assert.equal(new Date(l8[0].timeMs).toISOString().slice(0, 10), '2026-10-24');
  assert.equal(new Date(l9[0].timeMs).toISOString().slice(0, 10), '2026-11-01');
  assert.ok([...l8, ...l9].every((pass) => pass.solarElevationDeg > 0));
  const night = findSwathPasses({
    ...window,
    satrec: set('landsat-8').satrec,
    includeNight: true,
  }).passes;
  assert.ok(night.length >= l8.length);
});

test('the search is bounded in days, propagations and passes', () => {
  const base = {
    satrec: set('sentinel-2a').satrec,
    place: MUSSOORIE,
    fromMs: Date.parse('2026-11-01T00:00:00Z'),
    swathKm: 290,
  };
  assert.throws(
    () => findSwathPasses({ ...base, days: PASS_SEARCH_LIMITS.maxDays + 1 }),
    RangeError,
  );
  assert.throws(() => findSwathPasses({ ...base, days: 0 }), RangeError);
  assert.throws(
    () => findSwathPasses({ ...base, place: { lat: 91, lon: 0 }, days: 1 }),
    TypeError,
  );
  const result = findSwathPasses({ ...base, days: 14 });
  assert.ok(result.propagations <= PASS_SEARCH_LIMITS.maxPropagations + 100);
  // A huge swath crosses every orbit; the pass cap must stop it.
  const wide = findSwathPasses({
    ...base,
    days: 14,
    swathKm: 40000,
    includeNight: true,
  });
  assert.equal(wide.passes.length, PASS_SEARCH_LIMITS.maxPasses);
  assert.equal(wide.truncated, true);
});

test('track offsets and off-nadir geometry follow spherical trigonometry', () => {
  const nadir = { lat: 0, lon: 0 };
  const east = trackOffsets(nadir, 0, { lat: 0, lon: 1 });
  assert.ok(
    east.crossTrackKm > 110 && east.crossTrackKm < 112,
    'right of a northbound track',
  );
  assert.ok(Math.abs(east.alongTrackKm) < 1e-6);
  const ahead = trackOffsets(nadir, 0, { lat: 1, lon: 0 });
  assert.ok(ahead.alongTrackKm > 110);
  assert.equal(offNadirDeg(0, 786), 0);
  assert.ok(Math.abs(offNadirDeg(145, 786) - 10.3) < 0.3);
});

test('the ISS has sky passes but no swath', () => {
  const { passes } = findSkyPasses({
    satrec: set('iss').satrec,
    place: MUSSOORIE,
    fromMs: Date.parse('2026-11-07T00:00:00Z'),
    days: 2,
  });
  assert.ok(passes.length >= 3);
  assert.ok(
    passes.every(
      (pass) => pass.maxElevationDeg >= 10 && pass.riseMs < pass.setMs,
    ),
  );
});
