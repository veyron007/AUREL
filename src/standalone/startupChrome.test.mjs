import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../app/startupChrome.js', import.meta.url),
  'utf8',
)
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');

function fixture({ elapsed = 0, waitForView } = {}) {
  const timers = new Map();
  const listeners = new Map();
  const events = [];
  let restored;
  let nextTimer = 0;
  const controller = new AbortController();
  const context = {
    console,
    performance: { now: () => elapsed },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    // Imports are stripped above; the startup mark is covered by its own test.
    markStartup() {},
    STARTUP_MARKS: Object.freeze({ splashHidden: 'splash-hidden' }),
    initFirstRunExperience() {
      events.push('welcome');
      return { destroy: () => events.push('welcome:destroy') };
    },
    async initKeySetup() {
      return { destroy: () => events.push('settings:destroy') };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const stop = context.startApplicationChrome({
    initializeSettings: context.initKeySetup,
    loadingScreen: {
      classList: { add: (value) => events.push(value) },
      replaceChildren: () => events.push('children:removed'),
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
    styleManager: {
      initialRestorePromise: new Promise((resolve) => {
        restored = resolve;
      }),
    },
    dataManager: {},
    signal: controller.signal,
    ...(waitForView ? { waitForView } : {}),
  });
  return {
    events,
    listeners,
    stop,
    restored,
    controller,
    fire(delay) {
      for (const [id, task] of timers) {
        if (task.delay === delay) {
          timers.delete(id);
          task.fn();
        }
      }
    },
    timers,
  };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test('welcome waits for restoration, minimum delay, and the cover transition', async () => {
  const f = fixture();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, []);
  f.restored();
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  f.listeners.get('transitionend')();
  f.fire(400);
  assert.deepEqual(f.events, [
    'hidden',
    'children:removed',
    'retired',
    'welcome',
  ]);
  await f.stop();
  assert.deepEqual(f.events.slice(-2), ['welcome:destroy', 'settings:destroy']);
  assert.equal(f.timers.size, 0);
});

test('reduced motion uses the bounded fallback after the cover hides', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  f.fire(400);
  assert.deepEqual(f.events, [
    'hidden',
    'children:removed',
    'retired',
    'welcome',
  ]);
  await f.stop();
});

test('the minimum splash counts from navigation start, not from bootstrap', async () => {
  const late = fixture({ elapsed: 2500 });
  late.fire(0);
  late.restored();
  await flush();
  assert.deepEqual(late.events, ['hidden']);
  await late.stop();
  const early = fixture({ elapsed: 300 });
  early.restored();
  await flush();
  assert.deepEqual(early.events, []);
  early.fire(700);
  await flush();
  assert.deepEqual(early.events, ['hidden']);
  await early.stop();
});

test('shutdown while restore is pending never reveals late welcome UI', async () => {
  const f = fixture();
  f.controller.abort();
  await f.stop();
  f.restored();
  await flush();
  f.fire(1000);
  f.fire(400);
  assert.deepEqual(f.events, ['settings:destroy']);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});

test('shutdown during the cover transition cancels the listener and fallback', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  const transition = f.listeners.get('transitionend');
  f.controller.abort();
  await f.stop();
  transition();
  f.fire(400);
  assert.deepEqual(f.events, ['hidden', 'settings:destroy']);
});

test('the cover waits for the start-up view before it hides', async () => {
  let viewReady;
  const f = fixture({
    waitForView: () =>
      new Promise((resolve) => {
        viewReady = resolve;
      }),
  });
  f.restored();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, [], 'restored, but the view is still loading');
  viewReady('loaded');
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  await f.stop();
});
