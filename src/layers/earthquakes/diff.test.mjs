import assert from 'node:assert/strict';
import test from 'node:test';

import { createEarthquakesLayer } from './index.js';

function quake(id, mag, extra = {}) {
  return {
    stableId: id,
    usgsId: id,
    lon: 30 + mag,
    lat: 20,
    depthKm: 10,
    mag,
    place: `Place ${id}`,
    time: 1000,
    ...extra,
  };
}

function harness(snapshots) {
  const sources = [];
  const overlay = [];
  const registered = [];
  const viewer = {
    dataSources: {
      add: (value) => sources.push(value),
      remove: (value) => sources.splice(sources.indexOf(value), 1),
    },
  };
  const queue = [...snapshots];
  const layer = createEarthquakesLayer({
    source: { getSnapshot: async () => queue.shift() },
    overlayHost: {
      setEntries: (...args) => overlay.push(args),
      setVisible() {},
      clearSource() {},
    },
    selection: {
      install() {},
      uninstall() {},
      clear() {},
      register: (entries) => registered.push(entries.length),
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  const entities = sources[0].entities;
  const work = { add: 0, remove: 0, removeAll: 0 };
  for (const name of Object.keys(work)) {
    const original = entities[name].bind(entities);
    entities[name] = (...args) => {
      work[name]++;
      return original(...args);
    };
  }
  return { layer, viewer, overlay, registered, work, entities };
}

test('an unchanged poll does no entity, overlay or selection work', async () => {
  const rows = [quake('a', 4), quake('b', 3)];
  const h = harness([rows, rows.map((row) => ({ ...row }))]);
  await h.layer.update(h.viewer);
  const before = { ...h.work };
  const stamp = h.layer.getStats().lastUpdate;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await h.layer.update(h.viewer), true);
  assert.deepEqual(h.work, before);
  assert.equal(h.overlay.length, 1);
  assert.equal(h.registered.length, 1);
  assert.ok(
    h.layer.getStats().lastUpdate > stamp,
    'a confirmed poll stamps its time',
  );
});

test('a changed poll replaces only the changed event and keeps cold-load records', async () => {
  const first = [quake('a', 4), quake('b', 3), quake('c', 2)];
  const second = [quake('d', 5), quake('a', 4), quake('b', 3.5)];
  const h = harness([first, second]);
  await h.layer.update(h.viewer);
  const kept = h.entities.getById('earthquake:a');
  const before = { ...h.work };
  await h.layer.update(h.viewer);
  assert.equal(h.work.add - before.add, 2, 'd and the changed b');
  assert.equal(h.work.remove - before.remove, 2, 'old b and the departed c');
  assert.equal(h.entities.getById('earthquake:a'), kept);
  const cold = harness([second]);
  await cold.layer.update(cold.viewer);
  assert.deepEqual(h.layer.getAnalystRecords(), cold.layer.getAnalystRecords());
  assert.equal(h.layer.getStats().count, 3);
});

test('re-enabling republishes overlay labels and picking even when the poll is unchanged', async () => {
  const rows = [quake('a', 4)];
  const h = harness([rows, rows]);
  await h.layer.update(h.viewer);
  h.layer.disable(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer);
  assert.equal(h.overlay.length, 2);
  assert.equal(h.registered.length, 2);
});
