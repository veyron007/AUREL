import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import {
  useWorkspaceStore,
  WORKSPACE_PREFERENCE_KEY,
  workspaceSheetForPanel,
} from './workspace.js';

test('workspace destinations delegate existing tools and reject unknown destinations', () => {
  const store = useWorkspaceStore(createPinia());
  const calls = [];
  const token = store.connect({ openPanel: (id) => calls.push(id) });
  store.chooseDestination('plan');
  assert.equal(store.destination, 'plan');
  assert.deepEqual(calls, ['planner-panel']);
  store.chooseDestination('not-a-task');
  assert.equal(store.destination, 'plan');
  store.detach(token);
  store.chooseDestination('library');
  assert.deepEqual(calls, ['planner-panel']);
});

test('appearance storage is bounded and never touches any credentials or scene state', () => {
  const store = useWorkspaceStore(createPinia());
  const writes = [];
  const storage = {
    getItem: () => 'field',
    setItem: (...args) => writes.push(args),
  };
  store.restoreAppearance(storage);
  assert.equal(store.appearance, 'field');
  store.setAppearance('instrument', storage);
  store.setAppearance('invalid', storage);
  assert.deepEqual(writes, [[WORKSPACE_PREFERENCE_KEY, 'instrument']]);
  assert.equal(store.appearance, 'instrument');
  store.restoreAppearance({ getItem: () => '{broken}' });
  assert.equal(store.appearance, 'instrument');
});

test('blocked storage and sheet size changes do not interrupt exploration', () => {
  const store = useWorkspaceStore(createPinia());
  const storage = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('full');
    },
  };
  assert.doesNotThrow(() => store.restoreAppearance(storage));
  assert.doesNotThrow(() => store.setAppearance('field', storage));
  store.setSheetSize('full');
  assert.equal(store.sheetSize, 'full');
  store.setSheetSize('invalid');
  assert.equal(store.sheetSize, 'full');
});

test('a throwing browser localStorage getter leaves a functional session', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw Error('denied');
    },
  });
  try {
    const store = useWorkspaceStore(createPinia());
    assert.doesNotThrow(() => store.restoreAppearance());
    assert.doesNotThrow(() => store.setAppearance('field'));
    assert.equal(store.appearance, 'field');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
    else delete globalThis.localStorage;
  }
});

test('workspace tools select phone sheets that actually expose their panels', () => {
  for (const panel of [
    'recent-imagery-panel',
    'weather-panel',
    'global-context-panel',
  ])
    assert.equal(workspaceSheetForPanel(panel), 'context');
  assert.equal(workspaceSheetForPanel('utilities-panel'), 'layers');
  assert.equal(workspaceSheetForPanel('scene-panel'), 'layers');
  assert.equal(workspaceSheetForPanel('location-bar'), 'search');
  assert.equal(workspaceSheetForPanel('control-panel'), 'more');
});
