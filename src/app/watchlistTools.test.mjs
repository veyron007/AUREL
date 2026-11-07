import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { FieldbookController } from '../ui/fieldbookController.js';
import { useFieldbookStore } from '../ui/stores/fieldbook.js';
import { useWatchlistsStore } from '../ui/stores/watchlists.js';
import { emptyWatchRuntime } from '../watchlists/model.js';
import { createWatchlistTools } from './watchlistTools.js';

test('watch creation requires an acknowledged durable Fieldbook revision, including after a failed save', async () => {
  const pinia = createPinia(),
    records = new Map(),
    writes = [];
  let failSave = false;
  const fieldbook = new FieldbookController({
    store: useFieldbookStore(pinia),
    draftStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    repository: {
      list: async () =>
        [...records.values()].map(({ id, revision }) => ({ id, revision })),
      get: async (id) => records.get(id),
      save: async (project) => {
        if (failSave) throw new Error('quota');
        const saved = { ...project, revision: project.revision + 1 };
        records.set(saved.id, saved);
        return saved;
      },
      close() {},
    },
  });
  await fieldbook.init();
  const tools = createWatchlistTools({
    pinia,
    source: {},
    repository: {
      list: async () => ({ watches: [], corrupt: [] }),
      save: async (definition) => {
        writes.push(definition);
        return {
          definition,
          runtime: emptyWatchRuntime(),
          lease: null,
          revision: 1,
        };
      },
      close() {},
    },
  });
  await tools.ready;
  fieldbook.savePlace({
    name: 'Dehradun',
    geometry: { type: 'Point', coordinates: [78.04, 30.32] },
  });
  const library = useFieldbookStore(pinia),
    store = useWatchlistsStore(pinia),
    id = library.view.draft.places[0].id;
  assert.equal(store.view.places.length, 0);
  assert.equal(await tools.controller.create({ placeId: id }), false);
  failSave = true;
  assert.equal(await fieldbook.save(), false);
  assert.equal(store.view.places.length, 0);
  assert.equal(await tools.controller.create({ placeId: id }), false);
  assert.equal(writes.length, 0);
  failSave = false;
  assert.equal(await fieldbook.save(), true);
  assert.equal(store.view.places.length, 1);
  assert.equal(await tools.controller.create({ placeId: id }), true);
  assert.equal(writes.length, 1);
  fieldbook.savePlace({
    name: 'Austin',
    geometry: { type: 'Point', coordinates: [-97.74, 30.27] },
  });
  assert.equal(store.view.places.length, 0);
  const unsavedId = library.view.draft.places[1].id;
  assert.equal(await tools.controller.create({ placeId: unsavedId }), false);
  failSave = true;
  assert.equal(await fieldbook.save(), false);
  assert.equal(writes.length, 1);
  await tools.destroy();
  fieldbook.destroy();
});

test('clean drafts without matching saved project metadata cannot seed watchlists', async () => {
  const pinia = createPinia(),
    library = useFieldbookStore(pinia),
    store = useWatchlistsStore(pinia);
  const tools = createWatchlistTools({
    pinia,
    source: {},
    repository: {
      list: async () => ({ watches: [], corrupt: [] }),
      close() {},
    },
  });
  await tools.ready;
  const draft = {
    id: 'project',
    revision: 2,
    places: [
      {
        id: 'place',
        name: 'Place',
        geometry: { type: 'Point', coordinates: [78, 30] },
      },
    ],
  };
  for (const projects of [
    [],
    [{ id: 'other', revision: 2 }],
    [{ id: 'project', revision: 1 }],
  ]) {
    library.publish({ draft, dirty: false, projects });
    assert.equal(store.view.places.length, 0);
  }
  library.publish({
    draft,
    dirty: false,
    projects: [{ id: 'project', revision: 2 }],
  });
  assert.equal(store.view.places.length, 1);
  for (const state of [
    { busy: true },
    { loading: true },
    { conflict: true },
    { dirty: true },
  ]) {
    library.publish({
      draft,
      dirty: false,
      projects: [{ id: 'project', revision: 2 }],
      ...state,
    });
    assert.equal(store.view.places.length, 0);
  }
  await tools.destroy();
});
