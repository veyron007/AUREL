import test from 'node:test';
import assert from 'node:assert/strict';
import { LensController } from './lensController.js';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture(options = {}) {
  let view;
  const controller = new LensController({
    publish: (next) => {
      view = next;
    },
    ...options,
  });
  controller.init();
  return {
    controller,
    get view() {
      return view;
    },
  };
}
const d = { id: 'dehradun', name: 'Dehradun', lat: 30.3258, lon: 78.0438 };
const a = { id: 'austin', name: 'Austin', lat: 30.2672, lon: -97.7431 };

test('Dehradun to Austin to Dehradun discards late evidence and immediately clears old rows', async () => {
  const requests = [];
  const f = fixture({
    readEvidence: () => {
      const task = deferred();
      requests.push(task);
      return task.promise;
    },
  });
  f.controller.select(d);
  f.controller.select(a);
  assert.equal(f.view.selection.name, 'Austin');
  assert.deepEqual(f.view.evidence, []);
  f.controller.select(d);
  requests[1].resolve([
    { sourceId: 'austin', sourceLabel: 'Austin station', kind: 'observation' },
  ]);
  await Promise.resolve();
  assert.deepEqual(f.view.evidence, []);
  requests[2].resolve([
    { sourceId: 'current', sourceLabel: 'Current', kind: 'manual' },
  ]);
  await Promise.resolve();
  assert.equal(f.view.evidence[0].sourceId, 'current');
  requests[0].resolve([
    { sourceId: 'old', sourceLabel: 'Old Dehradun', kind: 'observation' },
  ]);
  await Promise.resolve();
  assert.equal(f.view.evidence[0].sourceId, 'current');
  f.controller.destroy();
});

test('new lookup clears the prior city and a late search cannot override a picked feature', () => {
  let listener;
  const f = fixture({
    subscribeLocationSearch: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  });
  f.controller.select(d);
  listener({
    state: { status: 'searching', requestId: 2, query: 'Austin' },
    change: { type: 'started' },
  });
  assert.equal(f.view.selection, null);
  assert.deepEqual(f.view.evidence, []);
  f.controller.select(d);
  listener({
    state: { status: 'found', requestId: 2, destination: a },
    change: { type: 'found' },
  });
  assert.equal(f.view.selection.name, 'Dehradun');
  f.controller.destroy();
  assert.equal(listener, null);
});

test('only the current search result establishes a new dossier', () => {
  let listener;
  const f = fixture({
    subscribeLocationSearch: (cb) => {
      listener = cb;
      return () => {};
    },
  });
  listener({
    state: { status: 'searching', requestId: 1, query: 'Austin' },
    change: { type: 'started' },
  });
  listener({
    state: { status: 'searching', requestId: 2, query: 'Dehradun' },
    change: { type: 'started' },
  });
  listener({
    state: { status: 'found', requestId: 1, destination: a },
    change: { type: 'found' },
  });
  assert.equal(f.view.selection, null);
  listener({
    state: { status: 'found', requestId: 2, destination: d },
    change: { type: 'found' },
  });
  assert.equal(f.view.selection.name, 'Dehradun');
  f.controller.destroy();
});

test('draft notes survive selection changes and failed save, and successful addition clears only its own draft', async () => {
  const task = deferred();
  let noteCall;
  const f = fixture({
    addNote: (selection, text) => {
      noteCall = { selection, text };
      return task.promise;
    },
  });
  f.controller.select(d);
  f.controller.setNote('Meeting point');
  f.controller.select(a);
  f.controller.setNote('Austin draft');
  f.controller.select(d);
  assert.equal(f.view.note, 'Meeting point');
  const saving = f.controller.addNote();
  f.controller.select(a);
  task.resolve(true);
  await saving;
  assert.equal(f.view.note, 'Austin draft');
  assert.equal(noteCall.selection.name, 'Dehradun');
  f.controller.select(d);
  assert.equal(f.view.note, '');
  f.controller.destroy();
});

test('failed note action retains text and exposes actionable error', async () => {
  const f = fixture({
    addNote: async () => {
      throw new Error('private API token detail');
    },
  });
  f.controller.select(d);
  f.controller.setNote('Keep me');
  assert.equal(await f.controller.addNote(), false);
  assert.equal(f.view.note, 'Keep me');
  assert.ok(f.view.error);
  assert.ok(!f.view.error.includes('private'));
  f.controller.destroy();
});

test('destroy revokes subscriptions, pending evidence and actions', async () => {
  const task = deferred();
  let detached = 0,
    saveCalls = 0;
  const f = fixture({
    readEvidence: () => task.promise,
    subscribeSelection: () => () => detached++,
    subscribeEvidence: () => () => detached++,
    savePlace: () => saveCalls++,
  });
  f.controller.select(d);
  f.controller.destroy();
  task.resolve([{ sourceId: 'late' }]);
  await Promise.resolve();
  assert.equal(f.view, null);
  await f.controller.savePlace();
  assert.equal(saveCalls, 0);
  assert.equal(detached, 2);
  f.controller.destroy();
  assert.equal(detached, 2);
});

test('rejected evidence keeps honest unknown quality and allows retry', async () => {
  let failed = true;
  const f = fixture({
    readEvidence: () => (failed ? Promise.reject(Error('secret')) : []),
  });
  f.controller.select(d);
  await Promise.resolve();
  assert.equal(f.view.selection.name, 'Dehradun');
  assert.equal(f.view.status, 'partial');
  assert.ok(!f.view.error.includes('secret'));
  failed = false;
  await f.controller.refresh();
  assert.equal(f.view.status, 'ready');
  f.controller.destroy();
});

test('current view and workspace actions call named existing owners', () => {
  const calls = [];
  const f = fixture({
    readCurrentPlace: () => d,
    openWorkspace: (id) => calls.push(id),
    focusSelection: (selection) => calls.push(selection.name),
  });
  f.controller.inspectCurrentView();
  assert.equal(f.view.selection.name, 'Dehradun');
  f.controller.openWorkspace('plan');
  f.controller.openWorkspace('compare');
  f.controller.openWorkspace('invalid');
  f.controller.focus();
  assert.deepEqual(calls, ['plan', 'compare', 'Dehradun']);
  f.controller.destroy();
});

test('store actions are wired once and dispatch the same existing owners', async () => {
  const { createPinia } = await import('pinia');
  const { useLensStore } = await import('./stores/lens.js');
  const store = useLensStore(createPinia());
  const calls = [];
  let selected, changed;
  const f = fixture({
    store,
    readCurrentPlace: () => d,
    savePlace: async () => true,
    addNote: async () => true,
    subscribeSelection: (cb) => {
      selected = cb;
      return () => {};
    },
    subscribeEvidence: (cb) => {
      changed = cb;
      return () => {};
    },
    focusSelection: () => calls.push('focus'),
    clearSelection: () => calls.push('clear'),
    openWorkspace: (id) => calls.push(id),
  });
  f.controller.init();
  store.act('inspectCurrentView');
  await Promise.resolve();
  assert.equal(store.view.selection.name, 'Dehradun');
  store.act('setNote', 'A note');
  assert.equal(await store.act('addNote'), true);
  assert.equal(await store.act('savePlace'), true);
  store.act('focus');
  store.act('openWorkspace', 'compare');
  await store.act('refresh');
  selected(a);
  await changed();
  assert.equal(store.view.selection.name, 'Austin');
  selected(null);
  assert.equal(store.view.selection, null);
  store.act('clear');
  assert.deepEqual(calls, ['focus', 'compare', 'clear']);
  f.controller.destroy();
  assert.equal(store.view, null);
});

test('missing and failed lookups leave an empty dossier, initial results do not steal focus', () => {
  let search;
  const reveals = [];
  const f = fixture({
    subscribeLocationSearch: (cb) => {
      search = cb;
      return () => {};
    },
    onSelection: (selection, options) => reveals.push(options),
  });
  search({ state: { status: 'found', destination: d }, initial: true });
  assert.equal(reveals[0].reveal, false);
  for (const status of ['missing', 'failed', 'cancelled']) {
    search({ state: { status: 'searching', requestId: 1 } });
    search({ state: { status, requestId: 1 } });
    assert.equal(f.view.status, 'empty');
    assert.equal(f.view.selection, null);
  }
  f.controller.select({ lat: 100, lon: 0 });
  assert.equal(f.view.selection, null);
  f.controller.destroy();
  assert.equal(f.controller.inspectCurrentView(), false);
});

test('false action result and overlapping button presses preserve the current note', async () => {
  const task = deferred();
  const f = fixture({
    savePlace: () => task.promise,
    addNote: async () => false,
  });
  f.controller.select(d);
  assert.equal(await f.controller.addNote(), false);
  f.controller.setNote('retain');
  assert.equal(await f.controller.addNote(), false);
  assert.equal(f.view.note, 'retain');
  const pending = f.controller.savePlace();
  assert.equal(await f.controller.savePlace(), false);
  task.resolve(false);
  assert.equal(await pending, false);
  assert.equal(f.view.busy, false);
  f.controller.destroy();
});

test('late successful actions after destruction cannot mutate the detached view', async () => {
  const task = deferred();
  const f = fixture({ savePlace: () => task.promise });
  f.controller.select(d);
  const pending = f.controller.savePlace();
  f.controller.destroy();
  task.resolve(true);
  assert.equal(await pending, false);
  assert.equal(f.view, null);
});

test('selection changes and disposal abort optional in-flight evidence work', () => {
  const signals = [];
  const f = fixture({
    readEvidence: (_selection, { signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    },
  });
  f.controller.select(d);
  f.controller.select(a);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  f.controller.clear();
  assert.equal(signals[1].aborted, true);
  f.controller.select(d);
  f.controller.destroy();
  assert.equal(signals[2].aborted, true);
});

test('selected source evidence uses only explicit times and keeps context update time separate', async () => {
  const f = fixture();
  f.controller.select({
    ...d,
    layerId: 'firms',
    source: 'FIRMS',
    updatedAt: 1700000000000,
  });
  await Promise.resolve();
  const row = f.view.evidence.find((item) => item.scope === 'selection');
  assert.equal(row.sourceId, 'firms');
  assert.equal(row.applicableTime, null);
  assert.equal(row.retrievedAt, null);
  f.controller.destroy();
});
