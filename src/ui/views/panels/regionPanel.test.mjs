import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useRegionsStore } from '../../stores/regions.js';
import RegionPanelBody from './RegionPanelBody.vue';
import { panelWithBody } from '../../../testSupport/panelBody.mjs';

const RegionPanel = panelWithBody('region-panel', RegionPanelBody);
function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia(),
    store = useRegionsStore(pinia),
    calls = [];
  store.connect(
    Object.fromEntries(
      ['preview', 'enable', 'remove', 'search', 'focus', 'cancel'].map(
        (name) => [
          name,
          (...args) => {
            calls.push([name, ...args]);
            return true;
          },
        ],
      ),
    ),
  );
  const app = createApp(RegionPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { store, calls };
}
const empty = {
  status: 'empty',
  busy: false,
  error: null,
  manifest: null,
  loaded: false,
  indexReady: false,
  query: '',
  results: [],
  canEnable: false,
  canRemove: false,
};
const manifest = {
  version: 1,
  id: 'dehradun-core',
  name: 'Dehradun core',
  extent: [78, 30.2, 78.05, 30.25],
  source: {
    id: 'openstreetmap-geofabrik',
    label: 'OpenStreetMap regional extract',
    extractAt: '2026-11-01T00:00:00.000Z',
    retrievedAt: '2026-11-02T00:00:00.000Z',
    url: 'https://download.geofabrik.de/asia/india/central-zone.html',
    extractSha256: 'a'.repeat(64),
  },
  license: {
    id: 'ODbL-1.0',
    url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: '© OpenStreetMap contributors',
  },
  assets: [
    {
      id: 'geometry',
      path: 'geometry.geojson',
      format: 'geojson',
      byteLength: 1000,
      sha256: 'b'.repeat(64),
    },
    {
      id: 'names',
      path: 'names.json',
      format: 'name-index',
      byteLength: 200,
      sha256: 'c'.repeat(64),
    },
  ],
  counts: {
    features: 12,
    positions: 80,
    names: 3,
    roads: 6,
    buildings: 4,
    water: 1,
    places: 1,
    suppliedHeights: 0,
  },
  coverage: 'partial',
  limitations: ['Partial extract; omissions remain possible.'],
};
test('region pack does not fetch or enable on mount and preview is deliberate', async (t) => {
  const { calls } = mount(t, empty);
  await nextTick();
  assert.equal(calls.length, 0);
  document.getElementById('region-preview').click();
  assert.deepEqual(calls, [['preview']]);
  assert.equal(document.getElementById('region-enable').disabled, true);
  assert.equal(document.getElementById('region-search').disabled, true);
});
test('preview exposes exact bytes, extent, source date and license before explicit enable', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    status: 'preview',
    manifest,
    canEnable: true,
  });
  await nextTick();
  const text = document.getElementById('region-panel').textContent;
  assert.match(text, /1,200 bytes/);
  assert.match(text, /30.25/);
  assert.match(text, /2026-11-01 00:00:00 UTC/);
  assert.match(text, /ODbL-1.0/);
  assert.match(text, /Verification pending/);
  assert.match(text, /Partial coverage/);
  assert.equal(calls.length, 0);
  document.getElementById('region-enable').click();
  assert.deepEqual(calls, [['enable']]);
});
test('only loaded verified names are searched and focus delegates to the existing map owner', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    status: 'ready',
    manifest,
    loaded: true,
    indexReady: true,
    canRemove: true,
    query: 'Rajpur',
    results: [
      { id: 'road:1', name: 'Rajpur Road', kind: 'road', lat: 30.3, lon: 78.1 },
    ],
  });
  await nextTick();
  const input = document.getElementById('region-search');
  input.value = 'Rajpur';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.deepEqual(calls, [['search', 'Rajpur']]);
  document.querySelector('[data-region-result="road:1"]').click();
  assert.deepEqual(calls.at(-1), ['focus', 'road:1']);
  document.getElementById('region-remove').click();
  assert.deepEqual(calls.at(-1), ['remove']);
});
test('verification failure never advertises loaded data or enables local search', async (t) => {
  mount(t, {
    ...empty,
    status: 'error',
    manifest,
    error: 'The local asset digest does not match.',
  });
  await nextTick();
  assert.match(document.querySelector('[role="alert"]').textContent, /digest/);
  assert.equal(document.getElementById('region-search').disabled, true);
  assert.doesNotMatch(
    document.getElementById('region-panel').textContent,
    /Verified and loaded/,
  );
});

test('only cancellable reads offer Cancel and local search never promises a global result', async (t) => {
  const { store, calls } = mount(t, {
    ...empty,
    status: 'loading',
    busy: true,
    canCancel: true,
    manifest,
  });
  await nextTick();
  document.getElementById('region-cancel').click();
  assert.deepEqual(calls, [['cancel']]);
  store.publish({
    ...empty,
    status: 'loading',
    busy: true,
    canCancel: false,
    manifest,
  });
  await nextTick();
  assert.equal(document.getElementById('region-cancel'), null);
  store.publish({
    ...empty,
    status: 'ready',
    manifest,
    loaded: true,
    indexReady: true,
    query: 'Unlisted lane',
  });
  await nextTick();
  assert.match(
    document.querySelector('.region-empty').textContent,
    /No matching names in this local pack/,
  );
  assert.equal(document.querySelector('.region-pack-details').open, false);
});
