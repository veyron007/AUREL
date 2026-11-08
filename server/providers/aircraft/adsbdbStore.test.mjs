import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADSBDB_BATCH_MAX,
  createLruStore,
  createPacer,
  parseTypeBatchBody,
} from './adsbdbStore.js';

test('the LRU store evicts the least recently used key on write', () => {
  const store = createLruStore(3);
  store.set('a', 1);
  store.set('b', 2);
  store.set('c', 3);
  assert.equal(store.get('a'), 1); // a is now most recent
  store.set('d', 4);
  assert.equal(store.has('b'), false);
  assert.deepEqual([...store.keys()], ['c', 'a', 'd']);
  assert.equal(store.size, 3);
});

test('the LRU store bounds a loaded snapshot, keeping the newest entries', () => {
  const store = createLruStore(2);
  store.load({
    old: { at: 1, data: null },
    newer: { at: 3, data: 'n' },
    mid: { at: 2, data: 'm' },
  });
  assert.deepEqual([...store.keys()], ['mid', 'newer']);
  assert.deepEqual(store.toJSON(), {
    mid: { at: 2, data: 'm' },
    newer: { at: 3, data: 'n' },
  });
});

test('the pacer runs at most N tasks at once, a gap apart, and refuses past its queue bound', async () => {
  let clock = 0;
  const timers = [];
  const pacer = createPacer({
    concurrency: 2,
    gapMs: 200,
    maxQueued: 2,
    now: () => clock,
    setTimer: (fn, ms) => timers.push({ fn, at: clock + ms }),
  });
  const started = [];
  const releases = [];
  const task = (name) => () =>
    new Promise((resolve) => {
      started.push([name, clock]);
      releases.push(resolve);
    });
  const runs = ['a', 'b', 'c'].map((name) => pacer.schedule(task(name)));
  assert.equal(pacer.schedule(task('d')), null, 'queue bound');
  assert.deepEqual(started, [['a', 0]]);
  clock = 200;
  timers.shift().fn();
  assert.deepEqual(started.at(-1), ['b', 200]);
  clock = 400;
  timers.shift()?.fn();
  assert.equal(started.length, 2, 'concurrency 2 holds c back');
  releases[0]('A');
  assert.equal(await runs[0], 'A');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.at(-1), ['c', 400]);
});

test('a type batch body accepts up to the batch limit of valid hexes, deduped and lowercased', () => {
  assert.deepEqual(
    parseTypeBatchBody('{"hexes":["ABCDEF","abcdef","123456"]}'),
    ['abcdef', '123456'],
  );
  assert.equal(parseTypeBatchBody('{"hexes":["zz"]}'), null);
  assert.equal(parseTypeBatchBody('not json'), null);
  assert.equal(parseTypeBatchBody('{"hexes":[]}'), null);
  const tooMany = Array.from({ length: ADSBDB_BATCH_MAX + 1 }, (_, i) =>
    i.toString(16).padStart(6, '0'),
  );
  assert.equal(parseTypeBatchBody(JSON.stringify({ hexes: tooMany })), null);
});
