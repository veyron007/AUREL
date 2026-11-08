import assert from 'node:assert/strict';
import test from 'node:test';

import { haversineKm } from '../common/geo.js';
import { createSortedSnapshot, parseVesselArea } from './ais-snapshot.js';

const STALE_MS = 30 * 60_000;

/** The pre-snapshot path: copy, sort and slice every request. */
function legacyRows(map, now, maxRows) {
  const cutoff = now - STALE_MS;
  const rows = [];
  for (const row of map.values()) if (row._updatedAt >= cutoff) rows.push(row);
  rows.sort((a, b) => b._updatedAt - a._updatedAt);
  return rows.slice(0, maxRows).map(({ _updatedAt, ...row }) => row);
}

function fixture(now, count = 500) {
  const map = new Map();
  for (let i = 0; i < count; i++) {
    const mmsi = String(200000000 + i);
    map.set(mmsi, {
      mmsi,
      lat: -60 + ((i * 37) % 120),
      lon: -170 + ((i * 53) % 340),
      // distinct times: no ties, so order is fully determined
      _updatedAt: now - i * 7_000,
    });
  }
  return map;
}

function harness(map, clock) {
  return createSortedSnapshot({
    entries: () => map.values(),
    lookup: (key) => map.get(key),
    staleMs: STALE_MS,
    ttlMs: 2_000,
    now: () => clock.now,
  });
}

test('without an area the snapshot returns exactly the legacy rows', () => {
  const clock = { now: 1_800_000_000_000 };
  const map = fixture(clock.now);
  const snapshot = harness(map, clock);
  for (const maxRows of [1, 10, 257, 50_000])
    assert.deepEqual(
      snapshot.rows(maxRows),
      legacyRows(map, clock.now, maxRows),
    );
});

test('a regional request returns only the legacy rows inside the radius', () => {
  const clock = { now: 1_800_000_000_000 };
  const map = fixture(clock.now);
  const snapshot = harness(map, clock);
  const area = { lat: 10, lon: 70, radiusKm: 2_500 };
  const expected = legacyRows(map, clock.now, 50_000).filter(
    (row) => haversineKm(area.lat, area.lon, row.lat, row.lon) <= area.radiusKm,
  );
  assert.ok(expected.length > 0 && expected.length < 100);
  assert.deepEqual(snapshot.rows(50_000, area), expected);
  assert.deepEqual(snapshot.rows(3, area), expected.slice(0, 3));
});

test('requests inside the window share one sort', () => {
  const clock = { now: 1_800_000_000_000 };
  const map = fixture(clock.now);
  const snapshot = harness(map, clock);
  snapshot.rows(100);
  clock.now += 1_000;
  snapshot.rows(100);
  snapshot.rows(100, { lat: 0, lon: 0, radiusKm: 100 });
  assert.equal(snapshot.stats().builds, 1);
  clock.now += 1_500;
  snapshot.rows(100);
  assert.equal(snapshot.stats().builds, 2);
});

test('updates inside the window are served at once, in order', () => {
  const clock = { now: 1_800_000_000_000 };
  const map = fixture(clock.now, 50);
  const snapshot = harness(map, clock);
  snapshot.rows(100);
  clock.now += 500;
  map.set('200000049', {
    ...map.get('200000049'),
    lat: 1,
    _updatedAt: clock.now,
  });
  snapshot.markChanged('200000049');
  map.set('999', { mmsi: '999', lat: 2, lon: 2, _updatedAt: clock.now - 1 });
  snapshot.markChanged('999');
  map.delete('200000003');
  snapshot.markChanged('200000003');
  assert.deepEqual(snapshot.rows(100), legacyRows(map, clock.now, 100));
  assert.equal(snapshot.stats().builds, 1);
});

test('rows that aged past the stale cutoff since the build are not served', () => {
  const clock = { now: 1_800_000_000_000 };
  const map = fixture(clock.now, 400);
  const snapshot = harness(map, clock);
  snapshot.rows(50_000);
  clock.now += 1_900;
  assert.deepEqual(snapshot.rows(50_000), legacyRows(map, clock.now, 50_000));
});

test('an area is read only when all three parameters are valid', () => {
  const params = (query) => new URLSearchParams(query);
  assert.deepEqual(parseVesselArea(params('lat=10&lon=70&radius_km=200')), {
    lat: 10,
    lon: 70,
    radiusKm: 200,
  });
  for (const query of [
    '',
    'lat=10&lon=70',
    'lat=91&lon=0&radius_km=5',
    'lat=0&lon=181&radius_km=5',
    'lat=0&lon=0&radius_km=0',
    'lat=x&lon=0&radius_km=5',
  ])
    assert.equal(parseVesselArea(params(query)), null, query);
});
