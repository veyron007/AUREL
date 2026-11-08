import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createTrackedPointMap,
  openTerrainStore,
  terrainStorePath,
} from './terrainStore.js';

async function scratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'terrain-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('points written to the store come back newest last, bounded by the limit', async (t) => {
  const dir = await scratch(t);
  const file = path.join(dir, 'terrain.sqlite');
  const store = openTerrainStore(file);
  store.write(
    [
      ['a', { at: 3, result: { ellipsoid: 1 } }],
      ['b', { at: 1, result: { ellipsoid: 2 } }],
      ['c', { at: 2, result: { ellipsoid: 3, geoid: -4 } }],
    ],
    [],
  );
  store.close();
  const reopened = openTerrainStore(file);
  assert.deepEqual(reopened.loadNewest(10), [
    ['b', { at: 1, result: { ellipsoid: 2 } }],
    ['c', { at: 2, result: { ellipsoid: 3, geoid: -4 } }],
    ['a', { at: 3, result: { ellipsoid: 1 } }],
  ]);
  assert.deepEqual(
    reopened.loadNewest(2).map(([key]) => key),
    ['c', 'a'],
  );
  reopened.write([['a', { at: 9, result: { ellipsoid: 7 } }]], ['b']);
  assert.deepEqual(reopened.loadNewest(10), [
    ['c', { at: 2, result: { ellipsoid: 3, geoid: -4 } }],
    ['a', { at: 9, result: { ellipsoid: 7 } }],
  ]);
  assert.equal(reopened.count(), 2);
  reopened.close();
});

test('the store lives beside the legacy JSON file', () => {
  assert.equal(
    terrainStorePath('/x/.gev-cache/terrain-heights.json'),
    '/x/.gev-cache/terrain-heights.sqlite',
  );
  assert.equal(terrainStorePath('/x/cache'), '/x/cache.sqlite');
});

test('the tracked map reports what changed since the last take, and nothing else', () => {
  const map = createTrackedPointMap();
  map.set('a', 1);
  map.set('b', 2);
  map.takeChanges();
  map.set('a', 3);
  map.delete('b');
  map.set('c', 4);
  map.delete('c');
  assert.deepEqual(map.takeChanges(), {
    upserts: [['a', 3]],
    deletes: ['b', 'c'],
  });
  assert.deepEqual(map.takeChanges(), { upserts: [], deletes: [] });
  assert.equal(map.get('a'), 3);
  assert.equal(map instanceof Map, true);
});

test('a corrupt store file is reported, not thrown past the caller', async (t) => {
  const dir = await scratch(t);
  const file = path.join(dir, 'bad.sqlite');
  await writeFile(file, 'not a database');
  assert.equal(openTerrainStore(file), null);
  assert.ok((await stat(file)).size > 0, 'the file is left for inspection');
});
