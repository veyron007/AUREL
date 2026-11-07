import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSameNode } from '../testSupport/domAssert.mjs';
import { installVueDom } from '../testSupport/vueDom.mjs';

let PanelNavigation;
let createUiRuntime;
let nextTick;
let uninstall;
before(async () => {
  uninstall = installVueDom();
  ({ nextTick } = await import('vue'));
  ({ PanelNavigation } = await import('./panelNavigation.js'));
  ({ createUiRuntime } = await import('./vueRuntime.js'));
});
after(() => uninstall());

function panel(id, { collapsed = true, hidden = false, title = '' } = {}) {
  const element = document.createElement('div');
  element.id = id;
  element.dataset.panelId = id;
  element.className = collapsed
    ? 'panel-collapsible collapsed'
    : 'panel-collapsible';
  // Data Layers shows only while `active` (the `f` shortcut toggles it).
  if (id === 'data-panel') element.classList.add('active');
  element.hidden = hidden;
  if (title) element.innerHTML = `<span class="panel-title">${title}</span>`;
  return element;
}

function setup() {
  document.body.innerHTML = '';
  const left = document.createElement('div');
  left.id = 'left-panel-stack';
  left.append(panel('data-panel', { collapsed: false }), panel('scene-panel'));
  const right = document.createElement('div');
  right.id = 'right-context-rail';
  right.append(
    panel('pp-toggles'),
    panel('weather-panel', { hidden: true }),
    panel('global-context-panel'),
    panel('host-panel', { title: 'HOST' }),
  );
  document.body.append(left, right);
  const calls = [];
  const ui = createUiRuntime();
  const navigation = new PanelNavigation({
    ui,
    stacks: { left, right },
    setPanelCollapsed: (...args) => calls.push(args),
  });
  navigation.init();
  return { left, right, calls, ui, navigation };
}

const railItems = (stack) =>
  [...stack.querySelectorAll('.gev-panel-rail [data-rail-item]')].map(
    (button) => [button.dataset.railItem, button.getAttribute('aria-pressed')],
  );

test('each stack gets a rail of its offered panels, marking the open one', async () => {
  const { left, right, ui, navigation } = setup();
  await nextTick();
  assert.equal(
    left.firstElementChild.className,
    'gev-panel-rail gev-panel-rail--left',
  );
  assert.deepEqual(railItems(left), [
    ['data-panel', 'true'],
    ['scene-panel', 'false'],
  ]);
  // Hidden panels are not offered; a host's panel gets a generic item.
  assert.deepEqual(railItems(right), [
    ['pp-toggles', 'false'],
    ['global-context-panel', 'false'],
    ['host-panel', 'false'],
  ]);
  assert.equal(
    right
      .querySelector('[data-rail-item="host-panel"]')
      .getAttribute('aria-label'),
    'HOST',
  );
  assert.equal(
    left.querySelector('nav').getAttribute('aria-label'),
    'Left panels',
  );
  navigation.destroy();
  ui.destroy();
});

test('selecting an item toggles its panel explicitly', async () => {
  const { left, calls, ui, navigation } = setup();
  await nextTick();
  left.querySelector('[data-rail-item="scene-panel"]').click();
  left.querySelector('[data-rail-item="data-panel"]').click();
  assert.deepEqual(calls, [
    ['scene-panel', false, { explicit: true }],
    ['data-panel', true, { explicit: true }],
  ]);
  navigation.destroy();
  ui.destroy();
});

test('selecting right after a same-task collapse reads the panel, not the store', async () => {
  const { left, calls, ui, navigation } = setup();
  await nextTick();
  // A host collapses Data Layers and selects its item in one task, before
  // the store follows the class change.
  left.querySelector('#data-panel').classList.add('collapsed');
  navigation.select('data-panel');
  assert.deepEqual(calls, [['data-panel', false, { explicit: true }]]);
  navigation.destroy();
  ui.destroy();
});

test('the rails follow disclosure and availability changes', async () => {
  const { left, right, ui, navigation } = setup();
  document.getElementById('data-panel').classList.add('collapsed');
  document.getElementById('scene-panel').classList.remove('collapsed');
  document.getElementById('weather-panel').hidden = false;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  assert.deepEqual(railItems(left), [
    ['data-panel', 'false'],
    ['scene-panel', 'true'],
  ]);
  assert.deepEqual(railItems(right), [
    ['pp-toggles', 'false'],
    ['weather-panel', 'false'],
    ['global-context-panel', 'false'],
    ['host-panel', 'false'],
  ]);
  // `f` hides Data Layers outright, so the rail stops offering it.
  document.getElementById('data-panel').classList.remove('active');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  assert.deepEqual(railItems(left), [['scene-panel', 'true']]);
  navigation.destroy();
  ui.destroy();
});

test('destroy removes the rails and stops following the stacks', async () => {
  const { left, right, calls, ui, navigation } = setup();
  navigation.destroy();
  navigation.destroy();
  assertSameNode(left.querySelector('.gev-panel-rail'), null);
  assertSameNode(right.querySelector('.gev-panel-rail'), null);
  navigation.select('data-panel');
  assert.deepEqual(calls, []);
  ui.destroy();
});

test('workspace navigation opens one existing inspector across both sides', async () => {
  const { calls, ui, navigation } = setup();
  document.getElementById('global-context-panel').classList.remove('collapsed');
  navigation.sync();
  navigation.openPanel('scene-panel');
  assert.deepEqual(calls, [
    ['data-panel', true, { explicit: true }],
    ['global-context-panel', true, { explicit: true }],
    ['scene-panel', false, { explicit: true }],
  ]);
  navigation.destroy();
  navigation.openPanel('data-panel');
  assert.equal(calls.length, 3);
  ui.destroy();
});

test('workspace comparison offers the data catalog when imagery is not mounted', () => {
  const { calls, ui, navigation } = setup();
  navigation.openPanel('recent-imagery-panel');
  assert.deepEqual(calls, [['data-panel', false, { explicit: true }]]);
  navigation.openPanel('unknown-panel');
  assert.equal(calls.length, 1);
  navigation.destroy();
  ui.destroy();
});

test('workspace closes panels freshly borrowed by the mobile sheet before its store sync', () => {
  const { calls, ui, navigation } = setup();
  navigation._openMobileSheet = () =>
    document
      .getElementById('global-context-panel')
      .classList.remove('collapsed');
  navigation.openPanel('scene-panel');
  assert.deepEqual(calls, [
    ['data-panel', true, { explicit: true }],
    ['global-context-panel', true, { explicit: true }],
    ['scene-panel', false, { explicit: true }],
  ]);
  navigation.destroy();
  ui.destroy();
});

test('restored open panels share one presentation without changing saved disclosure', () => {
  const { calls, ui, navigation } = setup();
  const data = document.getElementById('data-panel');
  const context = document.getElementById('global-context-panel');
  context.classList.remove('collapsed');
  navigation.sync();
  assert.equal(data.dataset.workspaceSuppressed, 'false');
  assert.equal(context.dataset.workspaceSuppressed, 'true');
  assert.equal(context.classList.contains('collapsed'), false);
  assert.equal(calls.length, 0);
  data.classList.add('collapsed');
  navigation.sync();
  assert.equal(context.dataset.workspaceSuppressed, 'false');
  navigation.destroy();
  assert.equal(context.hasAttribute('data-workspace-suppressed'), false);
  ui.destroy();
});

test('mobile workspace navigation keeps focus out of a borrowed panel that closes', () => {
  const { ui, navigation } = setup();
  document.body.classList.add('mobile-shell');
  const workspace = document.body.appendChild(document.createElement('div'));
  workspace.id = 'aurel-workspace';
  const activator = workspace.appendChild(document.createElement('button'));
  const borrowed = document
    .getElementById('data-panel')
    .appendChild(document.createElement('button'));
  activator.focus();
  navigation._openMobileSheet = () => borrowed.focus();
  navigation.openPanel('scene-panel');
  assertSameNode(document.activeElement, activator);
  navigation.destroy();
  document.body.classList.remove('mobile-shell');
  ui.destroy();
});
