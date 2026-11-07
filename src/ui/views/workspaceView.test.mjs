import '../../testSupport/registerDom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import WorkspaceView from './WorkspaceView.vue';
import { useWorkspaceStore } from '../stores/workspace.js';
import { usePanelStore } from '../stores/panels.js';

function mount(t) {
  document.body.replaceChildren();
  localStorage.clear();
  const pinia = createPinia();
  const app = createApp(WorkspaceView).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  return { app, store: useWorkspaceStore(pinia), panels: usePanelStore(pinia) };
}

test('four destinations delegate to owners and every legacy tool remains reachable', async (t) => {
  const { store, panels } = mount(t);
  const calls = [];
  store.connect({
    openPanel: (id) => calls.push(id),
    openTray: (id) => calls.push(id),
  });
  panels.setSide('left', [
    { id: 'data-panel', title: 'Layers', available: true, open: false },
  ]);
  panels.setSide('right', [
    { id: 'host-panel', title: 'Custom tool', available: true, open: false },
  ]);
  await nextTick();
  assert.equal(document.querySelectorAll('.workspace-nav button').length, 4);
  document.querySelector('[data-workspace="plan"]').click();
  await nextTick();
  assert.equal(document.body.dataset.workspaceDestination, 'plan');
  assert.deepEqual(calls, ['planner-panel']);
  const more = document.querySelector('.workspace-all-tools');
  assert.match(more.textContent, /Custom tool/);
  const presets = [...more.querySelectorAll('button')].find(
    (node) => node.textContent === 'VISUAL PRESETS',
  );
  presets.click();
  assert.equal(calls.at(-1), 'control-panel');
});

test('sheet sizes and appearance change presentation while retaining tool elements', async (t) => {
  const { store, panels } = mount(t);
  panels.setSide('left', [
    { id: 'data-panel', title: 'Layers', available: true, open: true },
  ]);
  await nextTick();
  const tools = document.querySelector('.workspace-tools');
  document.querySelector('[aria-label="Full-height inspector"]').click();
  store.setAppearance('field');
  await nextTick();
  assert.equal(document.body.dataset.workspaceSheet, 'full');
  assert.equal(document.body.dataset.workspaceAppearance, 'field');
  assert.equal(document.body.dataset.workspaceInspector, 'data-panel');
  assert.equal(document.querySelector('.workspace-tools'), tools);
});

test('comparison describes unavailable imagery without claiming a ready source', async (t) => {
  const { store } = mount(t);
  store.chooseDestination('compare');
  await nextTick();
  assert.match(
    document.querySelector('.workspace-tool-hint').textContent,
    /Enable Recent Imagery/,
  );
  assert.match(
    document.querySelector('.workspace-source').textContent,
    /Loading/,
  );
});

test('pause feeds waits for the owner and reports incomplete shutdown honestly', async (t) => {
  const { store } = mount(t);
  let finish;
  store.connect({
    pauseFeeds: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const button = document.querySelector('[data-pause-feeds]');
  button.click();
  await nextTick();
  assert.equal(button.disabled, true);
  finish({ ok: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.disabled, false);
  assert.match(
    document.querySelector('.workspace-session-status').textContent,
    /could not stop/,
  );
});
