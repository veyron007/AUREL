import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentImageryLayer } from './index.js';
import {
  BOX,
  candidate,
  fakeRenderer,
  fakeThumbnails,
  settle,
} from './testDoubles.mjs';
function fixture(searchWindow) {
  const thumbnails = fakeThumbnails(),
    renderer = fakeRenderer();
  const get = thumbnails.get;
  thumbnails.get = (key) => ({
    ...get(key),
    probedAt: '2026-11-07T00:00:00.000Z',
    acquisitionTime: key?.slice(4),
  });
  const layer = createRecentImageryLayer({
    catalog: { searchHls: async () => ({ candidates: [] }), searchWindow },
    renderer,
    thumbnails,
    now: () => new Date('2026-11-07'),
    host: () => ({ kind: 'globe', collection: {} }),
  });
  layer.enable();
  return { layer, thumbnails, renderer };
}
test('historical search uses exact window, requires probes, rejects stale area results', async () => {
  let resolve;
  const h = fixture(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const task = h.layer.searchWindow({
    box: BOX,
    fromDay: '2026-10-22',
    toDay: '2026-10-25',
    products: ['S30'],
  });
  await settle();
  h.layer.setBox({ ...BOX, west: -97.81 });
  resolve({ candidates: [candidate('S30', '2026-10-22')] });
  await task;
  assert.equal(h.layer.getSnapshot().candidates.length, 0);
  h.layer.destroy();
});
test('restore queries two exact dates even years apart and only pins requested inputs', async () => {
  const calls = [];
  const h = fixture(async (q) => {
    calls.push(q);
    return { candidates: [candidate(q.products[0], q.fromDay)] };
  });
  const task = h.layer.restoreComparison({
    box: BOX,
    a: { product: 'S30', day: '2024-10-22' },
    b: { product: 'S30', day: '2026-10-25' },
    split: 0.3,
  });
  await settle();
  h.thumbnails.probeRequested();
  const result = await task;
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => [c.fromDay, c.toDay]),
    [
      ['2024-10-22', '2024-10-22'],
      ['2026-10-25', '2026-10-25'],
    ],
  );
  assert.equal(h.layer.getSnapshot().shown.a, 'S30:2024-10-22');
  assert.equal(h.layer.getSnapshot().shown.b, 'S30:2026-10-25');
  assert.equal(h.layer.getSnapshot().split, 0.3);
  h.layer.destroy();
});

test('selected probes do not pin imagery; captures require a live pair and cancellation is immediate', async () => {
  const h = fixture(async () => ({
    candidates: [
      candidate('S30', '2026-10-22'),
      candidate('S30', '2026-10-25'),
    ],
  }));
  await h.layer.searchWindow({
    box: BOX,
    fromDay: '2026-10-22',
    toDay: '2026-10-25',
    products: ['S30'],
  });
  assert.equal(h.layer.getSnapshot().shown.a, null);
  assert.equal(h.layer.captureComparisonInputs(), null);
  const abort = new AbortController(),
    task = h.layer.probeCandidate('S30:2026-10-22', { signal: abort.signal });
  abort.abort();
  assert.equal((await task).status, 'cancelled');
  assert.equal((await h.layer.probeCandidate('missing')).status, 'cancelled');
  const empty = h.layer.probeCandidate('S30:2026-10-22');
  h.thumbnails.probe('S30:2026-10-22', 'empty');
  assert.equal((await empty).status, 'empty');
  const timeout = await h.layer.probeCandidate('S30:2026-10-25', {
    timeoutMs: 1,
  });
  assert.equal(timeout.status, 'error');
  h.thumbnails.probe('S30:2026-10-22', 'present');
  h.thumbnails.probe('S30:2026-10-25', 'present');
  h.layer.setAssignment('a', 'S30:2026-10-22');
  h.layer.setAssignment('b', 'S30:2026-10-25');
  h.layer.setMode('ab');
  assert.equal(
    h.layer.captureComparisonInputs().before.asset.requestedDate,
    '2026-10-22',
  );
  h.layer.destroy();
});
test('restore missing dates never shows replacement imagery, invalid windows never start work', async () => {
  const h = fixture(async () => ({ candidates: [] }));
  const result = await h.layer.restoreComparison({
    box: BOX,
    a: { product: 'S30', day: '2024-10-22' },
    b: { product: 'S30', day: '2026-10-25' },
  });
  assert.equal(result.ok, false);
  assert.equal(h.layer.getSnapshot().shown.a, null);
  await assert.rejects(
    h.layer.restoreComparison({
      box: BOX,
      a: { product: 'S30', day: '2024-10-22' },
      b: { product: 'S30', day: '2024-10-22' },
    }),
  );
  h.layer.disable();
  await assert.rejects(
    h.layer.searchWindow({
      box: BOX,
      fromDay: '2026-10-22',
      toDay: '2026-10-25',
    }),
    /Enable/,
  );
  h.layer.destroy();
});

test('cancelling lease acquisition removes only this restore pair and releases its map lease', async () => {
  let ready,
    released = 0;
  const leaseReady = new Promise((resolve) => {
    ready = resolve;
  });
  const h = fixture(async (q) => ({
    candidates: [candidate('S30', q.fromDay)],
  }));
  h.layer.attachMapStackController({
    getActiveId: () => 'esri-imagery',
    acquireImageryComparison: () => ({
      ready: leaseReady,
      release: () => {
        released++;
      },
    }),
  });
  const abort = new AbortController();
  const pending = h.layer.restoreComparison(
    {
      box: BOX,
      a: { product: 'S30', day: '2026-10-22' },
      b: { product: 'S30', day: '2026-10-25' },
    },
    { signal: abort.signal },
  );
  await settle();
  h.thumbnails.probeRequested();
  await settle();
  abort.abort();
  assert.equal((await pending).ok, false);
  assert.deepEqual(h.layer.getSnapshot().shown, {
    a: null,
    b: null,
    swipe: 'none',
  });
  await settle();
  assert.equal(released, 1);
  ready({ status: 'ready' });
  h.layer.destroy();
});

test('an aborted restore does not clear a newer manual pin selection', async () => {
  let ready;
  const leaseReady = new Promise((resolve) => {
    ready = resolve;
  });
  const h = fixture(async (q) => ({
    candidates: [candidate('S30', q.fromDay)],
  }));
  h.layer.attachMapStackController({
    getActiveId: () => 'esri-imagery',
    acquireImageryComparison: () => ({ ready: leaseReady, release: () => {} }),
  });
  const abort = new AbortController(),
    pending = h.layer.restoreComparison(
      {
        box: BOX,
        a: { product: 'S30', day: '2026-10-22' },
        b: { product: 'S30', day: '2026-10-25' },
      },
      { signal: abort.signal },
    );
  await settle();
  h.thumbnails.probeRequested();
  await settle();
  h.layer.setAssignment('b', null);
  abort.abort();
  await pending;
  assert.equal(h.layer.getSnapshot().shown.a, 'S30:2026-10-22');
  assert.equal(h.layer.getSnapshot().shown.b, null);
  ready({ status: 'ready' });
  h.layer.destroy();
});
