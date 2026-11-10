// A deferred panel body holds a fixed-height place, loads on first open (or
// once start-up settles), and turns an import failure into a translated
// message with a retry (PERFORMANCE-PLAN.md WP2.4).
import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import DeferredPanelBody from './DeferredPanelBody.vue';
import { usePanelChromeStore } from '../stores/panelChrome.js';
import { whenStartupCoverGone, whenStartupSettled } from './deferredBody.js';
import LensPanel from '../views/panels/LensPanel.vue';

const Body = { render: () => h('p', { class: 'loaded-body' }, 'Body text') };
const settle = async () => {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
};

function mount(t, props) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const chrome = usePanelChromeStore(pinia);
  const app = createApp({
    render: () =>
      h(DeferredPanelBody, { panelId: 'demo-panel', name: 'Demo', ...props }),
  }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  return chrome;
}

test('start-up settles at once on a page without the loading cover', async () => {
  await whenStartupSettled({
    document: { getElementById: () => null },
    performance: null,
    setTimeout: (callback) => setTimeout(callback, 0),
  });
});

test('start-up waits for the cover to lift, then for an idle moment', async () => {
  const marks = [];
  let observer = null;
  let idle = 0;
  const settled = whenStartupSettled({
    document: { getElementById: () => ({}) },
    performance: {
      getEntriesByName: (name) => marks.filter((mark) => mark === name),
    },
    PerformanceObserver: class {
      constructor(callback) {
        observer = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestIdleCallback: (callback) => {
      idle += 1;
      callback();
    },
  });
  let done = false;
  settled.then(() => (done = true));
  await settle();
  assert.equal(done, false, 'the cover is still up');
  marks.push('splash-hidden');
  observer({
    getEntriesByName: (name) => marks.filter((mark) => mark === name),
  });
  await settled;
  assert.equal(idle, 1);
});

test('the body loads and replaces its fixed-height placeholder', async (t) => {
  let imports = 0;
  mount(t, {
    height: 220,
    load: async () => {
      imports += 1;
      return { default: Body };
    },
  });
  const placeholder = document.querySelector('.deferred-panel-body');
  assert.equal(placeholder?.style.minHeight, '220px');
  assert.equal(placeholder.getAttribute('aria-busy'), 'true');
  await settle();
  assert.equal(
    document.querySelector('.loaded-body')?.textContent,
    'Body text',
  );
  assert.equal(document.querySelector('.deferred-panel-body'), null);
  assert.equal(imports, 1, 'imported once');
});

test('a failed import is a translated message with a working retry', async (t) => {
  let attempts = 0;
  mount(t, {
    load: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk missing');
      return { default: Body };
    },
  });
  t.mock.method(console, 'warn', () => {});
  await settle();
  const failure = document.querySelector('.deferred-panel-body--failed');
  assert.match(failure.textContent, /Demo could not be loaded/);
  failure.querySelector('button').click();
  await settle();
  assert.equal(
    document.querySelector('.loaded-body')?.textContent,
    'Body text',
  );
  assert.equal(attempts, 2);
});

test('the Lens panel keeps its header in the shell and loads its body', async (t) => {
  document.body.replaceChildren();
  const pinia = createPinia();
  const app = createApp(LensPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  const panel = document.getElementById('lens-panel');
  assert.match(panel.querySelector('.panel-title').textContent, /Lens/);
  await settle();
  assert.ok(
    panel.querySelector('.lens-empty, .lens-identity'),
    'body rendered',
  );
});

test('the cover-gone wait resolves when the cover lifts, before any idle moment', async () => {
  const marks = [];
  let observer = null;
  let idle = 0;
  const gone = whenStartupCoverGone({
    document: { getElementById: () => ({}) },
    performance: {
      getEntriesByName: (name) => marks.filter((mark) => mark === name),
    },
    PerformanceObserver: class {
      constructor(callback) {
        observer = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestIdleCallback: () => {
      idle += 1;
    },
  });
  let done = false;
  gone.then(() => (done = true));
  await settle();
  assert.equal(done, false, 'the cover is still up');
  marks.push('splash-hidden');
  observer({
    getEntriesByName: (name) => marks.filter((mark) => mark === name),
  });
  await gone;
  assert.equal(idle, 0, 'no idle wait');
});
