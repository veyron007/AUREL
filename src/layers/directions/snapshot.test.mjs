import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteSnapshot, validateRouteSnapshot } from './snapshot.js';

const route = () => ({
  mode: 'foot',
  distanceM: 1200,
  durationS: 800,
  geometry: [
    [78.04, 30.32],
    [78.05, 30.33],
  ],
  steps: [
    {
      instruction: 'Continue',
      lat: 30.32,
      lon: 78.04,
      distanceM: 1200,
      durationS: 800,
      token: 'private',
    },
  ],
});
test('route snapshot is detached, bounded and drops non-whitelisted source metadata', () => {
  const live = route();
  const snapshot = createRouteSnapshot(
    live,
    { lat: 30.32, lon: 78.04 },
    { lat: 30.33, lon: 78.05 },
    1000,
  );
  live.geometry[0][0] = 9;
  live.steps[0].instruction = 'changed';
  assert.equal(snapshot.geometry[0][0], 78.04);
  assert.equal(snapshot.steps[0].instruction, 'Continue');
  assert.equal('token' in snapshot.steps[0], false);
  assert.throws(() => {
    snapshot.geometry[0][0] = 1;
  }, TypeError);
  assert.deepEqual(validateRouteSnapshot(snapshot), snapshot);
});
test('invalid or future snapshots are rejected without partial geometry repair', () => {
  const good = createRouteSnapshot(
    route(),
    { lat: 30.32, lon: 78.04 },
    { lat: 30.33, lon: 78.05 },
    null,
  );
  for (const invalid of [
    { ...good, version: 2 },
    { ...good, mode: 'teleport' },
    {
      ...good,
      geometry: [
        [78, 30],
        [Infinity, 30],
      ],
    },
    { ...good, distanceM: -1 },
    { ...good, a: { lat: 91, lon: 78 } },
    { ...good, steps: Array(201).fill(good.steps[0]) },
  ])
    assert.equal(validateRouteSnapshot(invalid), null);
  assert.equal(createRouteSnapshot(null, null, null, null), null);
});
