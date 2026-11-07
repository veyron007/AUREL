import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHistoryWindow, captureHistoricalInput } from './historical.js';
import { BOX, candidate } from './testDoubles.mjs';

test('history admits at most 31 real UTC days, fixed products and a 100km box', () => {
  const query = {
    box: BOX,
    fromDay: '2026-10-01',
    toDay: '2026-10-31',
    products: ['S30'],
  };
  assert.deepEqual(validateHistoryWindow(query).products, ['S30']);
  for (const change of [
    { toDay: '2026-11-01' },
    { fromDay: '2026-02-30' },
    { products: ['evil'] },
    { products: ['S30', 'S30'] },
    { box: { west: 0, south: 0, east: 2, north: 2 } },
    { box: { west: 179, south: 0, east: -179, north: 1 } },
  ])
    assert.throws(() => validateHistoryWindow({ ...query, ...change }));
});

test('a saveable image needs a successful matching probe and actual acquisition metadata', () => {
  const c = candidate('S30', '2026-10-22', 5);
  assert.equal(captureHistoricalInput(c, BOX), null);
  const ready = {
    ...c,
    retrievedAt: '2026-11-07T00:00:00.000Z',
    thumbnail: {
      status: 'present',
      acquisitionTime: '2026-10-22',
      probedAt: '2026-11-07T00:01:00.000Z',
    },
  };
  const input = captureHistoricalInput(ready, BOX);
  assert.equal(input.asset.requestedDate, '2026-10-22');
  assert.equal(input.time.kind, 'interval');
  assert.equal(input.cloudScope, 'scene');
  assert.equal(input.nativeResolutionM, 30);
  assert.equal(input.alignment, 'unverified');
  assert.equal(
    captureHistoricalInput(
      {
        ...ready,
        thumbnail: { ...ready.thumbnail, acquisitionTime: '2026-10-23' },
      },
      BOX,
    ),
    null,
  );
  const noTime = {
    ...candidate('VIIRS', '2026-10-22'),
    thumbnail: { status: 'present', probedAt: ready.thumbnail.probedAt },
  };
  assert.equal(captureHistoricalInput(noTime, BOX), null);
  assert.equal(
    captureHistoricalInput(
      {
        ...noTime,
        thumbnail: { ...noTime.thumbnail, acquisitionTime: '2026-10-22' },
      },
      BOX,
    ).time.kind,
    'day',
  );
});
