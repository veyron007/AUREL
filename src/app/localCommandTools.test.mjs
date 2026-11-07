import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createLocalCommandTools } from './localCommandTools.js';
import { useLensStore } from '../ui/stores/lens.js';
import { useFieldbookStore } from '../ui/stores/fieldbook.js';
import { useChronicleStore } from '../ui/stores/chronicle.js';
import { useWorkspaceStore } from '../ui/stores/workspace.js';
import { usePanelChromeStore } from '../ui/stores/panelChrome.js';
function setup(t, overrides = {}) {
  const pinia = createPinia(),
    calls = [];
  useLensStore(pinia).publish({
    selection: {
      id: 'd',
      name: 'Dehradun',
      geometry: { type: 'Point', coordinates: [78, 30] },
    },
  });
  useFieldbookStore(pinia).publish({
    draft: { id: 'p', evidence: [{ feedState: 'nominal' }] },
    dirty: true,
  });
  const fieldbook = {
    async capture(kind) {
      calls.push(['capture', kind]);
      return true;
    },
    async save() {
      calls.push(['save']);
      return true;
    },
    toggleBrief() {
      calls.push(['brief']);
    },
  };
  const panelChrome = usePanelChromeStore(pinia),
    owner = panelChrome.connect({});
  useWorkspaceStore(pinia).connect({
    openPanel: (id) => {
      calls.push(['panel', id]);
      panelChrome.publish(owner, id, { collapsed: false });
    },
  });
  const tools = createLocalCommandTools({
    pinia,
    personalWorkspace: {
      fieldbook,
      lens: {
        async savePlace() {
          calls.push(['place']);
          return true;
        },
      },
    },
    dataManager: {
      layers: new Map([
        [
          'directions',
          {
            module: {
              getRouteSnapshot: () => ({
                geometry: {
                  coordinates: [
                    [78, 30],
                    [78.1, 30.1],
                  ],
                },
              }),
            },
          },
        ],
        ['earthquakes', { enabled: false }],
      ]),
      async setEnabled(id, enabled, { signal }) {
        signal.throwIfAborted();
        calls.push(['layer', id, enabled]);
        this.layers.get(id).enabled = enabled;
        return true;
      },
    },
    stageSearch: async (query) => {
      calls.push(['stage', query]);
      return true;
    },
    runCoordinate: async (args) => {
      calls.push(['fly', args]);
      return true;
    },
    ...overrides,
  });
  t.after(() => tools.destroy());
  async function run(text) {
    tools.controller.setInput(text);
    tools.controller.preview();
    return tools.controller.run();
  }
  return { tools, pinia, calls, run };
}
test('binds public save owners and waits for capture before persistence', async (t) => {
  const x = setup(t);
  assert.equal(await x.run('save route'), true);
  assert.deepEqual(x.calls, [['capture', 'route'], ['save']]);
  assert.equal(await x.run('save place'), true);
  assert.equal(await x.run('save project'), true);
  assert.equal(await x.run('brief selected evidence'), true);
  assert.ok(x.calls.some(([name]) => name === 'brief'));
});
test('search stages ambiguous names without navigation; coordinates and layer actions stay curated', async (t) => {
  const x = setup(t);
  assert.equal(await x.run('find Springfield'), true);
  assert.deepEqual(x.calls, [['stage', 'Springfield']]);
  assert.equal(await x.run('go to 30.3,78.1'), true);
  assert.equal(await x.run('show earthquakes'), true);
  assert.equal(await x.run('show google maps'), false);
  assert.equal(await x.run('open planner'), true);
  assert.ok(
    x.calls.some(([name, id]) => name === 'panel' && id === 'planner-panel'),
  );
});
test('missing owners cannot falsely succeed and changes invalidate preview', async (t) => {
  const x = setup(t, { stageSearch: undefined, runCoordinate: undefined });
  assert.equal(await x.run('find Dehradun'), false);
  assert.equal(await x.run('go to 30,78'), false);
  x.tools.controller.setInput('save place');
  x.tools.controller.preview();
  useLensStore(x.pinia).publish({ selection: null });
  assert.equal(await x.tools.controller.run(), false);
  useChronicleStore(x.pinia).publish({ canCompare: false });
  assert.equal(await x.run('compare selected dates'), false);
});
test('cancel after capture does not proceed to save and destroy blocks later execution', async (t) => {
  let finish;
  const calls = [];
  const x = setup(t, {
    personalWorkspace: {
      fieldbook: {
        capture: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        save: async () => {
          calls.push('save');
          return true;
        },
      },
    },
  });
  const pending = x.run('save route');
  x.tools.controller.cancel();
  finish(true);
  assert.equal(await pending, false);
  assert.deepEqual(calls, []);
  x.tools.destroy();
  assert.equal(await x.run('open planner'), false);
});
test('comparison, already-saved drafts, absent layers and failed capture report owner outcomes', async (t) => {
  const x = setup(t, {
    chronicle: { controller: { compare: async () => true } },
  });
  useChronicleStore(x.pinia).publish({
    canCompare: true,
    slots: {
      a: { asset: { requestedDate: '2026-01-01' } },
      b: { asset: { requestedDate: '2026-01-02' } },
    },
  });
  assert.equal(await x.run('compare 2026-01-01 and 2026-01-02'), true);
  assert.equal(await x.run('show satellites'), false);
  useFieldbookStore(x.pinia).publish({
    draft: { id: 'p', evidence: [] },
    dirty: false,
  });
  assert.equal(await x.run('save project'), false);
  assert.equal(await x.run('brief selected evidence'), false);
  const y = setup(t, {
    personalWorkspace: { fieldbook: { capture: async () => false } },
  });
  assert.equal(await y.run('save route'), false);
  assert.equal(await y.run('brief selected evidence'), false);
});
test('layer failure cannot be mistaken for completion and stale briefs preserve their notice', async (t) => {
  const x = setup(t, {
    dataManager: {
      layers: new Map([['earthquakes', { enabled: false }]]),
      setEnabled: async () => false,
    },
  });
  assert.equal(await x.run('show earthquakes'), false);
  useFieldbookStore(x.pinia).publish({
    draft: { id: 'p', evidence: [{ feedState: 'stale' }] },
    brief: { title: 'existing' },
  });
  x.tools.controller.setInput('brief selected evidence');
  x.tools.controller.preview();
  assert.equal(x.tools.controller.proposal.notice, 'stale-evidence');
  assert.equal(await x.tools.controller.run(), true);
  assert.ok(!x.calls.some(([name]) => name === 'brief'));
});
