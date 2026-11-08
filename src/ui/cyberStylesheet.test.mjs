// Cyber's stylesheet loads on demand: it is not in the startup CSS, every rule
// in it is scoped to the Cyber theme (so loading it early changes nothing),
// and it is inserted once per document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CYBER_STYLESHEET_URL,
  loadCyberStylesheet,
  preloadCyberStylesheetWhenIdle,
} from './cyberStylesheet.js';
import { vendorChunk } from '../../build/vite.js';

const read = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

/** Selectors of the top-level rules (and rules inside @media/@supports). */
function topLevelSelectors(css) {
  const selectors = [];
  let depth = 0;
  let prelude = '';
  const stack = [];
  for (const char of css) {
    if (char === '{') {
      const head = prelude.trim();
      const parentIsGroup = stack.length === 0 || stack.at(-1) === 'group';
      const isAt = head.startsWith('@');
      const isGroup = isAt && /^@(media|supports|container|layer)\b/.test(head);
      if (!isAt && parentIsGroup) selectors.push(head);
      stack.push(isGroup ? 'group' : isAt ? 'at' : 'rule');
      depth += 1;
      prelude = '';
    } else if (char === '}') {
      stack.pop();
      depth -= 1;
      prelude = '';
    } else if (char === ';' && depth >= 0) {
      prelude = '';
    } else prelude += char;
  }
  return selectors.flatMap(splitSelectorList);
}

/** Split a selector list on its top-level commas (not those inside :is()). */
function splitSelectorList(list) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  return [...parts, current.trim()];
}

const CYBER_SCOPE =
  /\[data-ui-theme=['"]cyber['"]\]|\[data-variant=['"]cyber['"]\]/;

test('every Cyber rule is scoped to the Cyber theme', () => {
  const selectors = topLevelSelectors(read('./styles/cyber.css'));
  assert.ok(selectors.length > 250, 'the parser found the rules');
  const keyframeSteps = /^(from|to|\d+(\.\d+)?%)$/;
  const unscoped = selectors.filter(
    (selector) =>
      !keyframeSteps.test(selector) &&
      (!CYBER_SCOPE.test(selector) || /:not\(\[data-ui-theme/.test(selector)),
  );
  assert.deepEqual(unscoped, []);
});

test('the startup stylesheet does not import Cyber', () => {
  const style = readFileSync(
    new URL('../../style.css', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(style, /cyber\.css/);
  assert.match(CYBER_STYLESHEET_URL, /cyber\.css$/);
});

function fakeDocument() {
  const appended = [];
  const link = () => {
    const listeners = {};
    return {
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener: (type, listener) => (listeners[type] = listener),
      fire: (type) => listeners[type]?.(),
      remove() {
        appended.splice(appended.indexOf(this), 1);
      },
    };
  };
  return {
    appended,
    head: { append: (element) => appended.push(element) },
    createElement: () => link(),
  };
}

test('the stylesheet is inserted once and resolves when it loads', async () => {
  const doc = fakeDocument();
  const first = loadCyberStylesheet(doc);
  const second = loadCyberStylesheet(doc);
  assert.equal(first, second);
  assert.equal(doc.appended.length, 1);
  const [link] = doc.appended;
  assert.equal(link.rel, 'stylesheet');
  assert.equal(link.href, CYBER_STYLESHEET_URL);
  link.fire('load');
  assert.equal(await first, true);
});

test('a failed load removes its link so a later call retries', async () => {
  const doc = fakeDocument();
  const failed = loadCyberStylesheet(doc);
  doc.appended[0].fire('error');
  await assert.rejects(failed, /did not load/);
  assert.equal(doc.appended.length, 0);
  const retry = loadCyberStylesheet(doc);
  assert.notEqual(retry, failed);
  doc.appended[0].fire('load');
  assert.equal(await retry, true);
});

test('without a document nothing is loaded', async () => {
  assert.equal(await loadCyberStylesheet(null), false);
  assert.equal(await loadCyberStylesheet({ dataset: {} }), false);
  assert.doesNotThrow(() => preloadCyberStylesheetWhenIdle(undefined));
});

test('idle preloading waits for an idle callback', () => {
  const doc = fakeDocument();
  let idle;
  preloadCyberStylesheetWhenIdle({
    document: doc,
    requestIdleCallback: (callback) => (idle = callback),
  });
  assert.equal(doc.appended.length, 0);
  idle();
  assert.equal(doc.appended.length, 1);
});

test('Vue, Pinia and vue-i18n share the vendor chunk', () => {
  for (const id of [
    '/x/node_modules/vue/dist/vue.runtime.esm-bundler.js',
    '/x/node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js',
    '/x/node_modules/pinia/dist/pinia.mjs',
    '/x/node_modules/vue-i18n/dist/vue-i18n.mjs',
    'C:\\x\\node_modules\\@intlify\\shared\\dist\\shared.mjs',
  ])
    assert.equal(vendorChunk(id), 'vendor', id);
  for (const id of [
    '/x/src/main.js',
    '/x/node_modules/satellite.js/dist/index.js',
    '/x/node_modules/vue-router-like/index.js',
  ])
    assert.equal(vendorChunk(id), undefined, id);
});
