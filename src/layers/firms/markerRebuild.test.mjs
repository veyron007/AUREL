import assert from 'node:assert/strict';
import test from 'node:test';

import { createMarkerPool } from './markerPool.js';
import { createSlicedJobRunner } from './slicedJob.js';

/** A runner on a fake clock whose scheduled slices run on demand. */
function fakeRunner(costPerStepMs = 1) {
  let clock = 0;
  const queue = [];
  const runner = createSlicedJobRunner({
    budgetMs: 8,
    now: () => clock,
    schedule: (run) => {
      queue.push(run);
      return queue.length;
    },
    cancel: () => {
      queue.length = 0;
    },
  });
  return {
    runner,
    tick: () => {
      clock += costPerStepMs;
    },
    drain() {
      let slices = 0;
      while (queue.length) {
        queue.shift()();
        slices++;
      }
      return slices;
    },
  };
}

test('a job that fits one slice finishes inside start', () => {
  const { runner, tick } = fakeRunner();
  const done = [];
  runner.start(
    (function* () {
      tick();
      yield;
      done.push('swap');
    })(),
  );
  assert.deepEqual(done, ['swap']);
  assert.equal(runner.running, false);
});

test('a long job is split into slices within the budget', () => {
  const { runner, tick, drain } = fakeRunner();
  let steps = 0;
  let finished = false;
  runner.start(
    (function* () {
      for (let i = 0; i < 100; i++) {
        tick();
        steps++;
        yield;
      }
      finished = true;
    })(),
  );
  assert.equal(finished, false);
  assert.ok(steps <= 8, `first slice ran ${steps} steps`);
  const slices = drain();
  assert.equal(finished, true);
  assert.ok(slices >= 11, `ran in ${slices + 1} slices`);
});

test('a newer job cancels the one in flight, which never swaps', () => {
  const { runner, tick, drain } = fakeRunner();
  const swaps = [];
  const job = (name, length) =>
    (function* () {
      for (let i = 0; i < length; i++) {
        tick();
        yield;
      }
      swaps.push(name);
    })();
  runner.start(job('old', 50));
  runner.start(job('new', 50));
  drain();
  assert.deepEqual(swaps, ['new']);
  runner.start(job('cancelled', 50));
  runner.cancel();
  drain();
  assert.deepEqual(swaps, ['new']);
});

test('an error ends the job and is reported, not thrown into the frame', () => {
  const errors = [];
  const runner = createSlicedJobRunner({ onError: (e) => errors.push(e) });
  runner.start(
    // eslint-disable-next-line require-yield
    (function* () {
      throw new Error('boom');
    })(),
  );
  assert.equal(errors.length, 1);
  assert.equal(runner.running, false);
});

/** Billboards as Cesium keeps them, enough for the pool. */
function fakeCollection() {
  const added = [];
  return {
    added,
    create: (fire) => {
      const billboard = {
        id: undefined,
        position: null,
        color: 'c0',
        show: true,
        image: `sprite-${fire.kind}`,
      };
      added.push(billboard);
      return billboard;
    },
  };
}

test('the pool reuses hidden sprites of the same image instead of adding', () => {
  const collection = fakeCollection();
  const pickIndex = new Map();
  const pool = createMarkerPool({
    create: collection.create,
    pickIndex,
    pickIdFor: (fire) => `firms-${fire.index}`,
  });
  const a = { index: 1, kind: 'red' };
  const b = { index: 2, kind: 'red' };
  const c = { index: 3, kind: 'gold' };
  const same = (x, y) => x === y;
  const first = pool.take('red', a, 'pA', 'c1', same);
  assert.equal(first.id, 'firms-1');
  assert.equal(first.show, false);
  assert.equal(pickIndex.get('firms-1'), a);
  pool.release(first);
  assert.equal(pickIndex.has('firms-1'), false);
  assert.equal(pool.available('red'), 1);
  const reused = pool.take('red', b, 'pB', 'c1', same);
  assert.equal(reused, first);
  assert.equal(reused.id, 'firms-2');
  assert.equal(reused.position, 'pB');
  assert.equal(reused.image, 'sprite-red');
  // Another image never takes a red sprite.
  const gold = pool.take('gold', c, 'pC', 'c1', same);
  assert.notEqual(gold, first);
  assert.equal(gold.image, 'sprite-gold');
  assert.equal(collection.added.length, 2);
});

test('growing ahead of a swap adds hidden sprites the swap then takes', () => {
  const collection = fakeCollection();
  const pool = createMarkerPool({
    create: collection.create,
    pickIndex: new Map(),
    pickIdFor: (fire) => `firms-${fire.index}`,
  });
  pool.grow('red', 3, { kind: 'red' });
  assert.equal(pool.available('red'), 3);
  assert.ok(collection.added.every((billboard) => billboard.show === false));
  for (let i = 0; i < 3; i++)
    pool.take('red', { index: i, kind: 'red' }, 'p', 'c', () => true);
  assert.equal(collection.added.length, 3);
});
