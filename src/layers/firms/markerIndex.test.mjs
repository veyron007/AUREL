import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFireGridIndex, queryFireGridIndex } from './markerIndex.js';
import { seededRandom } from '../../testSupport/perfBench.mjs';

function contains(bounds, lat, lon) {
  if (lat < bounds.south || lat > bounds.north) return false;
  if (bounds.wraps) return lon >= bounds.west || lon <= bounds.east;
  return lon >= bounds.west && lon <= bounds.east;
}

function scan(firesByFrp, bounds, limit) {
  const out = [];
  for (const fire of firesByFrp) {
    if (!contains(bounds, fire.lat, fire.lon)) continue;
    out.push(fire);
    if (out.length >= limit) break;
  }
  return out;
}

function syntheticFires(count) {
  const random = seededRandom(0x4b4);
  const fires = Array.from({ length: count }, (_, index) => ({
    index,
    lat: -89.9 + random() * 179.8,
    lon: -180 + random() * 360,
    // Coarse FRP so many ties exercise the rank tie-break.
    frp: Math.round(random() * 20),
  }));
  fires.push({ index: count, lat: 0, lon: 180, frp: 5 });
  fires.push({ index: count + 1, lat: 90, lon: -180, frp: 5 });
  return fires.sort((a, b) => b.frp - a.frp);
}

const firesByFrp = syntheticFires(20_000);
const index = buildFireGridIndex(firesByFrp);

const views = [
  { west: -20, south: -35, east: 55, north: 38, wraps: false },
  { west: 150, south: -10, east: -150, north: 40, wraps: true },
  { west: -180, south: -90, east: 180, north: 90, wraps: false },
  { west: 10.5, south: 10.5, east: 10.7, north: 10.7, wraps: false },
  { west: 179, south: -1, east: 180, north: 1, wraps: false },
];

test('the index query returns exactly the FRP-ordered scan', () => {
  for (const bounds of views) {
    for (const limit of [1, 37, 3000, 40_000]) {
      const expected = scan(firesByFrp, bounds, limit);
      const actual = queryFireGridIndex(
        index,
        firesByFrp,
        bounds,
        limit,
        contains,
      );
      assert.deepEqual(
        actual.map((fire) => fire.index),
        expected.map((fire) => fire.index),
        JSON.stringify({ bounds, limit }),
      );
    }
  }
});

test('records without a position are never indexed', () => {
  const fires = [
    { index: 0, lat: Number.NaN, lon: 3, frp: 9 },
    { index: 1, lat: 1, lon: 2, frp: 1 },
  ];
  const small = buildFireGridIndex(fires);
  const all = { west: -180, south: -90, east: 180, north: 90, wraps: false };
  assert.deepEqual(
    queryFireGridIndex(small, fires, all, 10, contains).map((f) => f.index),
    [1],
  );
});
