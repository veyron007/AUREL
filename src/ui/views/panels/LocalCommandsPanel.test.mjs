import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useLocalCommandsStore } from '../../stores/localCommands.js';
import LocalCommandsPanel from './LocalCommandsPanel.vue';
function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia(),
    store = useLocalCommandsStore(pinia),
    calls = [];
  store.connect(
    Object.fromEntries(
      ['setInput', 'preview', 'run', 'cancel', 'clear'].map((name) => [
        name,
        (...args) => calls.push([name, ...args]),
      ]),
    ),
  );
  const app = createApp(LocalCommandsPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { store, calls };
}
const empty = {
  input: '',
  proposal: null,
  status: 'empty',
  error: null,
  busy: false,
  canRun: false,
  canCancel: false,
};
const button = (label) =>
  [...document.querySelectorAll('button')].find(
    (element) => element.textContent.trim() === label,
  );
test('typed input and mission templates stage only; preview form and Run are separate actions', async (t) => {
  const x = mount(t, empty);
  await nextTick();
  const input = document.getElementById('local-command-input');
  assert.ok(document.querySelector('label[for="local-command-input"]'));
  input.value = 'find Dehradun';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  button('Prepare workspace command').click();
  assert.deepEqual(x.calls, [
    ['setInput', 'find Dehradun'],
    ['setInput', 'open lens'],
  ]);
  x.store.publish({ ...empty, input: 'find Dehradun' });
  await nextTick();
  document
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(x.calls.at(-1), ['preview']);
  x.store.publish({
    ...empty,
    input: 'find Dehradun',
    status: 'preview',
    canRun: true,
    proposal: {
      command: { type: 'search_places', args: { query: 'Dehradun' } },
      notice: 'choose-search-result',
    },
  });
  await nextTick();
  assert.match(document.body.textContent, /No place is selected automatically/);
  button('Run this action').click();
  assert.deepEqual(x.calls.at(-1), ['run']);
});
test('pending controls prevent overlap and cancellation has honest status; hostile text stays inert', async (t) => {
  const x = mount(t, {
    ...empty,
    input: 'open planner',
    status: 'running',
    busy: true,
    canCancel: true,
    proposal: {
      command: {
        type: 'search_places',
        args: { query: '<img src=x onerror=alert(1)>' },
      },
    },
  });
  await nextTick();
  assert.equal(document.querySelector('input').disabled, true);
  assert.equal(button('Run this action').disabled, true);
  assert.equal(document.querySelector('img'), null);
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Waiting for the action/,
  );
  button('Cancel pending action').click();
  assert.deepEqual(x.calls, [['cancel']]);
  x.store.publish({ ...empty, status: 'cancelled' });
  await nextTick();
  assert.match(document.body.textContent, /Changes already completed are kept/);
  assert.match(document.body.textContent, /No language model is enabled/);
});
test('blocked input explains why, and staged search completion never claims navigation', async (t) => {
  const x = mount(t, { ...empty, status: 'preview', error: 'blocked-input' });
  await nextTick();
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /without links, scripts or provider credentials/,
  );
  assert.equal(button('Run this action'), undefined);
  x.store.publish({
    ...empty,
    status: 'completed',
    proposal: {
      command: { type: 'search_places', args: { query: 'Springfield' } },
    },
  });
  await nextTick();
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Search staged. Review the query and submit it/,
  );
  x.store.publish({
    ...empty,
    status: 'completed',
    proposal: {
      command: {
        type: 'set_layer_visibility',
        args: { layerId: 'earthquakes', enabled: true },
      },
    },
  });
  await nextTick();
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Check the layer for data availability/,
  );
  x.store.publish({
    ...empty,
    status: 'completed',
    proposal: { command: { type: 'save_place', args: {} } },
  });
  await nextTick();
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Action confirmed by its owner/,
  );
});
