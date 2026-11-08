import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatalogViews,
  createFrameCache,
  createSharedFetches,
} from './serving.js';

const camera = (id, extra = {}) => ({
  id,
  pack: 'p',
  name: `Cam ${id}`,
  city: 'C',
  lat: 1,
  lon: 2,
  url: 'https://example.test/x.jpg',
  ...extra,
});

test('the catalog body and id index are built once per catalog and carry a content ETag', () => {
  let projections = 0;
  const views = createCatalogViews({
    trimmedPacks: () => ['trimmed'],
    onBuild: () => projections++,
  });
  const catalog = [camera('a'), camera('b')];
  const first = views.viewFor(catalog);
  const again = views.viewFor(catalog);
  assert.equal(projections, 1);
  assert.equal(first, again);
  assert.equal(first.sourceById.get('b'), catalog[1]);
  const body = JSON.parse(first.body);
  assert.deepEqual(body.trimmedPacks, ['trimmed']);
  assert.equal(body.sources.length, 2);
  assert.equal(body.sources[0].sourceKind, 'configured');
  assert.match(first.etag, /^W\/"cctv-[0-9a-f]{16}"$/);
  const refreshed = views.viewFor([camera('a'), camera('b', { lat: 9 })]);
  assert.notEqual(refreshed.etag, first.etag);
  const same = views.viewFor([camera('a'), camera('b')]);
  assert.equal(same.etag, first.etag, 'equal content keeps its validator');
});

test('the frame cache serves a frame only while it is younger than its age limit', () => {
  const clock = { now: 0 };
  const cache = createFrameCache({
    maxEntries: 2,
    maxBytes: 1_000,
    maxAgeMs: 5_000,
    now: () => clock.now,
  });
  const frame = (n) => ({
    ok: true,
    body: Buffer.alloc(n),
    contentType: 'image/jpeg',
  });
  cache.set('a', frame(10));
  clock.now = 4_999;
  assert.equal(cache.get('a').body.length, 10);
  clock.now = 5_000;
  assert.equal(cache.get('a'), null);
});

test('the frame cache evicts least recently used frames past its entry and byte bounds', () => {
  const cache = createFrameCache({
    maxEntries: 2,
    maxBytes: 100,
    maxAgeMs: 60_000,
    now: () => 0,
  });
  const frame = (n) => ({
    ok: true,
    body: Buffer.alloc(n),
    contentType: 'image/jpeg',
  });
  cache.set('a', frame(10));
  cache.set('b', frame(10));
  cache.get('a');
  cache.set('c', frame(10));
  assert.equal(cache.get('b'), null, 'entry bound evicts the least recent');
  assert.ok(cache.get('a'));
  cache.set('d', frame(95));
  assert.equal(cache.get('a'), null, 'byte bound evicts too');
  assert.equal(cache.get('c'), null);
  assert.ok(cache.get('d'));
  cache.set('huge', frame(101));
  assert.equal(
    cache.get('huge'),
    null,
    'a frame over the byte bound is not kept',
  );
  assert.equal(cache.stats().bytes, 95);
});

test('concurrent requests for one frame share a single upstream fetch', async () => {
  const shared = createSharedFetches();
  let fetches = 0;
  let release;
  const task = () => {
    fetches++;
    return new Promise((resolve) => (release = resolve));
  };
  const one = shared.run('cam', task, null);
  const two = shared.run('cam', task, null);
  await Promise.resolve();
  release('frame');
  assert.deepEqual(await Promise.all([one, two]), ['frame', 'frame']);
  assert.equal(fetches, 1);
});

test('the upstream fetch is aborted once every waiting client has disconnected', async () => {
  const shared = createSharedFetches();
  let upstreamSignal;
  const task = (signal) => {
    upstreamSignal = signal;
    return new Promise(() => {});
  };
  const a = new AbortController();
  const b = new AbortController();
  const first = shared.run('cam', task, a.signal);
  const second = shared.run('cam', task, b.signal);
  a.abort();
  assert.equal(await first, null);
  assert.equal(upstreamSignal.aborted, false, 'one client is still waiting');
  b.abort();
  assert.equal(await second, null);
  assert.equal(upstreamSignal.aborted, true);
  let fresh = 0;
  const third = shared.run('cam', async () => ++fresh, null);
  assert.equal(await third, 1, 'a later request starts a new fetch');
});
