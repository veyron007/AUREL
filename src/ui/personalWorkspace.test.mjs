import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createPersonalWorkspace } from './personalWorkspace.js';
import { useWorkspaceStore } from './stores/workspace.js';
import { useFieldbookStore } from './stores/fieldbook.js';

function fixture({ failSave = false } = {}) {
  const pinia = createPinia();
  const saved = [];
  let closed = 0;
  const repository = {
    list: async () => ({ projects: [], corrupt: [] }),
    save: async (value) => {
      if (failSave) throw Error('storage unavailable');
      const next = { ...value, revision: value.revision + 1 };
      saved.push(next);
      return next;
    },
    close: () => {
      closed += 1;
    },
  };
  const workspace = createPersonalWorkspace({ pinia, repository });
  return {
    pinia,
    workspace,
    saved,
    get closed() {
      return closed;
    },
  };
}
const place = { name: 'Dehradun', lat: 30.3258, lon: 78.0438 };

test('Lens save commits a local project before reporting success; notes persist too', async () => {
  const f = fixture();
  await f.workspace.ready;
  f.workspace.lens.select(place);
  assert.equal(await f.workspace.lens.savePlace(), true);
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].places[0].name, 'Dehradun');
  f.workspace.lens.setNote('Walk near the clock tower.');
  assert.equal(await f.workspace.lens.addNote(), true);
  assert.equal(f.saved[1].notes[0].text, 'Walk near the clock tower.');
  f.workspace.destroy();
  assert.equal(f.closed, 1);
});

test('failed persistence keeps the Fieldbook draft and Lens note, without a success claim', async () => {
  const f = fixture({ failSave: true });
  await f.workspace.ready;
  f.workspace.lens.select(place);
  f.workspace.lens.setNote('Keep this note.');
  assert.equal(await f.workspace.lens.addNote(), false);
  assert.equal(
    f.workspace.lens.notes.get(f.workspace.lens.selection.id),
    'Keep this note.',
  );
  assert.equal(
    useFieldbookStore(f.pinia).view.draft.notes[0].text,
    'Keep this note.',
  );
  assert.equal(f.workspace.lens.feedback, null);
  f.workspace.destroy();
});

test('saved evidence retains observation dates and explicit meter uncertainty', async () => {
  const pinia = createPinia();
  const workspace = createPersonalWorkspace({
    pinia,
    repository: {
      list: async () => ({ projects: [], corrupt: [] }),
      save: async (project) => ({ ...project, revision: 1 }),
      close() {},
    },
    readMapSource: () => ({
      id: 'local-test',
      label: 'Local evidence fixture',
      applicableTime: Date.parse('2020-01-01T00:00:00.000Z'),
      retrievedAt: Date.parse('2026-11-06T00:00:00.000Z'),
      uncertaintyM: 12,
    }),
  });
  await workspace.ready;
  workspace.lens.select(place);
  await workspace.lens.refresh();
  await workspace.lens.savePlace();
  await workspace.lens.refresh();
  const evidence = workspace.lens.evidence.at(-1);
  assert.equal(evidence.uncertainty, 12);
  assert.equal(evidence.applicableTime, Date.parse('2020-01-01T00:00:00.000Z'));
  assert.equal(evidence.retrievedAt, Date.parse('2026-11-06T00:00:00.000Z'));
  workspace.destroy();
});

test('only explicit selection reveals Lens; teardown revokes subscriptions and actions', async () => {
  const pinia = createPinia();
  const panels = [];
  let dispose = 0;
  const store = useWorkspaceStore(pinia);
  store.connect({ openPanel: (id) => panels.push(id) });
  const workspace = createPersonalWorkspace({
    pinia,
    repository: {
      list: async () => ({ projects: [], corrupt: [] }),
      close() {},
    },
    subscribeSelection: () => () => {
      dispose += 1;
    },
  });
  await workspace.ready;
  workspace.lens.select(place, { reveal: false });
  assert.deepEqual(panels, []);
  workspace.lens.select(place);
  assert.deepEqual(panels, ['lens-panel']);
  assert.equal(store.destination, 'explore');
  workspace.destroy();
  workspace.destroy();
  assert.equal(dispose, 1);
  assert.equal(await workspace.lens.savePlace(), false);
});
