import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchController } from './researchController.js';
const point = {
  id: 'place',
  name: 'Dehradun',
  geometry: { type: 'Point', coordinates: [78.03, 30.31] },
};
const sceneId = 'S2B_43RGP_20261025_0_L2A';
function fixture(overrides = {}) {
  let selection = point,
    listener,
    view;
  const calls = [];
  const source = {
    search: async (query) => {
      calls.push(['search', query]);
      return { status: 'available', scenes: [{ id: sceneId }] };
    },
    analyze: async (query) => {
      calls.push(['analyze', query]);
      return { status: 'available', sceneId, values: [0.5] };
    },
    ...overrides,
  };
  const controller = new ResearchController({
    readSelection: () => selection,
    subscribeSelection: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    source,
    publish: (next) => {
      view = next;
    },
    exportResult: (value) => calls.push(['export', value]),
    now: () => Date.parse('2026-11-07T00:00:00Z'),
  });
  controller.init();
  return {
    controller,
    calls,
    get view() {
      return view;
    },
    change(value) {
      selection = value;
      listener?.();
    },
  };
}
test('research is deliberate and selected-scene bound; export is a detached local snapshot', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  assert.equal(await f.controller.analyze({ size: 128 }), false);
  assert.equal(
    await f.controller.search({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    }),
    true,
  );
  assert.equal(f.controller.choose('unknown'), false);
  assert.equal(f.controller.choose(sceneId), true);
  assert.equal(await f.controller.analyze({ size: 512 }), false);
  assert.equal(await f.controller.analyze({ size: 128 }), true);
  assert.deepEqual(f.calls[1][1], {
    lat: 30.31,
    lon: 78.03,
    sceneId,
    sizePixels: 128,
  });
  assert.equal(f.view.canExport, true);
  f.controller.exportResult();
  assert.notEqual(f.calls.at(-1)[1], f.view.result);
  f.controller.destroy();
  assert.equal(await f.controller.search({}), false);
});
test('new selection and cancellation discard late responses even when transport ignores abort', async () => {
  let resolve;
  const f = fixture({
    search: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = f.controller.search({
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  f.change({
    ...point,
    id: 'other',
    geometry: { type: 'Point', coordinates: [0, 0] },
  });
  resolve({ status: 'available', scenes: [{ id: sceneId }] });
  assert.equal(await pending, false);
  assert.deepEqual(f.view.scenes, []);
  assert.equal(f.view.busy, false);
  f.controller.destroy();
});
test('invalid windows never request; source absence and failures retain explicit error states', async () => {
  const f = fixture({
    search: async () => ({ status: 'rejected', reason: 'daily-limit' }),
  });
  assert.equal(
    await f.controller.search({
      startDate: '2026-01-01',
      endDate: '2026-10-31',
    }),
    false,
  );
  assert.equal(
    await f.controller.search({
      startDate: '2026-12-01',
      endDate: '2026-12-10',
    }),
    false,
  );
  assert.deepEqual(f.calls, []);
  assert.equal(
    await f.controller.search({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    }),
    false,
  );
  assert.equal(f.view.status, 'error');
  assert.match(f.view.error, /daily-limit/);
  f.controller.destroy();
});

test('analysis rejection, transport failure, cancellation and source disappearance stay explicit', async () => {
  const f = fixture({
    analyze: async () => ({ status: 'rejected', reason: 'no-valid-pixels' }),
  });
  await f.controller.search({ startDate: '2026-10-01', endDate: '2026-10-31' });
  f.controller.choose(sceneId);
  assert.equal(await f.controller.analyze(), false);
  assert.match(f.view.error, /no-valid-pixels/);
  f.controller.source.analyze = async () => {
    throw Error('upstream');
  };
  assert.equal(await f.controller.analyze(), false);
  assert.equal(f.view.busy, false);
  let resolve;
  f.controller.source.analyze = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = f.controller.analyze();
  assert.equal(f.view.canCancel, true);
  f.controller.cancel();
  resolve({ status: 'available' });
  assert.equal(await pending, false);
  assert.equal(f.view.canCancel, false);
  f.change(null);
  assert.equal(
    await f.controller.search({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    }),
    false,
  );
  f.controller.destroy();
});
test('controller actions honor Pinia ownership, exports report failures and cleanup revokes actions', async () => {
  const { createPinia } = await import('pinia');
  const { useResearchStore } = await import('./stores/research.js');
  const store = useResearchStore(createPinia());
  let selection = point,
    unsubscribed = 0;
  const controller = new ResearchController({
    store,
    readSelection: () => selection,
    subscribeSelection: () => () => {
      unsubscribed++;
    },
    source: {
      search: async () => ({ status: 'available', scenes: [{ id: sceneId }] }),
      analyze: async () => ({ status: 'available', sceneId }),
    },
    exportResult: () => {
      throw Error('download');
    },
    now: () => Date.parse('2026-11-07'),
  });
  controller.init();
  controller.init();
  await store.act('search', { startDate: '2026-10-01', endDate: '2026-10-31' });
  store.act('choose', sceneId);
  await store.act('analyze', { size: 128 });
  assert.equal(store.act('exportResult'), false);
  assert.match(store.view.error, /export/);
  selection = { ...point, geometry: { type: 'Point', coordinates: [1, 1] } };
  assert.equal(await controller.analyze(), false);
  assert.equal(store.view.scenes.length, 0);
  controller.destroy();
  controller.destroy();
  assert.equal(unsubscribed, 1);
});
