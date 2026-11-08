import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createPaletteTools } from './paletteTools.js';
import { usePaletteStore } from '../ui/stores/palette.js';
import { useLocationStore } from '../ui/stores/location.js';
import { useWorkspaceStore } from '../ui/stores/workspace.js';
import { useGlobeActionsStore } from '../ui/stores/globeActions.js';
import { useVoiceStore } from '../ui/stores/voice.js';

function setup(t) {
  document.body.replaceChildren();
  document.body.dataset.workspaceAppearance = 'observatory';
  const pinia = createPinia();
  const calls = [];
  const layers = [
    {
      id: 'earthquakes',
      name: 'Earthquakes',
      enabled: false,
      showInTogglePanel: true,
      stats: {},
    },
    {
      id: 'internal',
      name: 'Internal',
      enabled: false,
      showInTogglePanel: false,
      stats: {},
    },
  ];
  const dataManager = {
    getAll: () => layers,
    isEnabled: (id) => layers.find((layer) => layer.id === id)?.enabled,
    setEnabled: async (id, enabled, options) =>
      calls.push(['layer', id, enabled, options.origin]),
  };
  const location = useLocationStore(pinia);
  location.connect({
    suggestPlaces: (text) => calls.push(['suggest', text]),
    closeSuggestions: () => calls.push(['close-suggestions']),
    chooseSuggestion: (index) => calls.push(['place', index]),
  });
  location.publish({
    suggest: {
      items: [{ key: 'a', title: 'Dehradun', kind: 'City' }],
      status: '',
    },
  });
  useWorkspaceStore(pinia).connect({
    openPanel: (id) => calls.push(['panel', id]),
  });
  useGlobeActionsStore(pinia).connect({ reset: () => calls.push(['reset']) });
  const voice = useVoiceStore(pinia);
  voice.publish({ button: { pressed: false } });
  voice.connect({ emit: (name) => calls.push(['voice', name]) });
  const tools = createPaletteTools({
    pinia,
    dataManager,
    documentRef: document,
  });
  t.after(() => {
    tools.destroy();
    delete document.body.dataset.workspaceAppearance;
  });
  return { tools, store: usePaletteStore(pinia), calls, location };
}

const press = (init) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
};
const titles = (view) =>
  view.sections.flatMap((section) => section.rows.map((row) => row.title));

test('⌘K opens the palette in the workspace and lists existing owners', (t) => {
  const { store, calls } = setup(t);
  const event = press({ key: 'k', metaKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(store.view.open, true);
  assert.deepEqual(calls[0], ['suggest', '']);
  const shown = titles(store.view);
  for (const expected of [
    'Open Explore',
    'Open Library',
    'Reset to full globe view',
    'Start voice',
    'Earthquakes (24h)',
    'Dehradun',
  ])
    assert.ok(shown.includes(expected), expected);
  assert.ok(
    !shown.includes('Internal'),
    'layers outside the catalog are not offered',
  );
  press({ key: 'k', ctrlKey: true });
  assert.equal(store.view.open, false);
});

test('rows run the location, layer, workspace, globe and voice owners', async (t) => {
  const { store, calls } = setup(t);
  const run = async (query, title) => {
    store.act('open');
    store.act('setQuery', query);
    const row = store.view.sections
      .flatMap((section) => section.rows)
      .find((entry) => entry.title === title);
    assert.ok(row, title);
    store.act('activate', row.index);
    await nextTick();
  };
  await run('earth', 'Earthquakes (24h)');
  assert.deepEqual(
    calls.find((call) => call[0] === 'layer'),
    ['layer', 'earthquakes', true, 'user'],
  );
  await run('plan', 'Open Plan');
  assert.ok(
    calls.some((call) => call[0] === 'panel' && call[1] === 'planner-panel'),
  );
  await run('globe', 'Reset to full globe view');
  assert.ok(calls.some((call) => call[0] === 'reset'));
  await run('voice', 'Start voice');
  assert.ok(calls.some((call) => call[0] === 'voice' && call[1] === 'button'));
  await run('', 'Dehradun');
  assert.ok(calls.some((call) => call[0] === 'place' && call[1] === 0));
  assert.equal(store.view.open, false);
});

test('"/" opens outside fields, new suggestions refresh, and destroy stops listening', async (t) => {
  const { tools, store, location } = setup(t);
  press({ key: '/' });
  assert.equal(store.view.open, true);
  location.publish({
    suggest: { items: [{ key: 'b', title: 'Mussoorie' }], status: '' },
  });
  await nextTick();
  assert.ok(titles(store.view).includes('Mussoorie'));
  tools.destroy();
  assert.equal(store.view.open, false);
  press({ key: '/' });
  assert.equal(store.view.open, false);
});

test('outside the workspace the shortcut is left to the browser', (t) => {
  const { store } = setup(t);
  delete document.body.dataset.workspaceAppearance;
  const event = press({ key: 'k', metaKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(store.view.open, false);
});
