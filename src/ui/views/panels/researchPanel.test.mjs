import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useResearchStore } from '../../stores/research.js';
import ResearchPanelBody from './ResearchPanelBody.vue';
import { panelWithBody } from '../../../testSupport/panelBody.mjs';

const ResearchPanel = panelWithBody('research-panel', ResearchPanelBody);
function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia(),
    store = useResearchStore(pinia),
    calls = [];
  store.connect(
    Object.fromEntries(
      ['search', 'choose', 'analyze', 'cancel', 'exportResult'].map((name) => [
        name,
        (...args) => {
          calls.push([name, ...args]);
          return true;
        },
      ]),
    ),
  );
  const app = createApp(ResearchPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { store, calls };
}
const empty = {
  selection: null,
  status: 'empty',
  busy: false,
  canCancel: false,
  error: null,
  feedback: null,
  scenes: [],
  selectedSceneId: null,
  result: null,
  canAnalyze: false,
  canExport: false,
  query: null,
};
const scene = {
  id: 'scene-one',
  acquiredAt: '2026-10-10T05:00:00.000Z',
  cloudCoverPct: 12.4,
  resolutionM: 10,
  maskResolutionM: 20,
  processingBaseline: '04.00',
};
const result = {
  version: 1,
  status: 'available',
  sceneId: 'scene-one',
  acquiredAt: scene.acquiredAt,
  retrievedAt: '2026-11-07T06:00:00.000Z',
  requested: { lat: 30.3, lon: 78.1, sizePixels: 128 },
  grid: {
    epsg: 32644,
    width: 2,
    height: 2,
    transform: [10, 0, 200000, 0, -10, 3300000],
    resolutionM: 10,
  },
  values: [-0.5, null, 0, 0.8],
  statistics: {
    totalPixels: 4,
    validPixels: 3,
    maskedPixels: 1,
    min: -0.5,
    max: 0.8,
    mean: 0.1,
  },
  footprint: { type: 'Polygon', coordinates: [] },
  transfer: { bytes: 1000, requests: 3, maxBytes: 25165824, maxRequests: 64 },
  provenance: {
    method: 'NDVI=(NIR-RED)/(NIR+RED)',
    processingBaseline: '04.00',
    bands: [
      { name: 'B04', scale: 0.0001, offset: -0.1, noData: 0 },
      { name: 'B08', scale: 0.0001, offset: -0.1, noData: 0 },
    ],
    mask: {
      source: 'SCL',
      resolutionM: 20,
      resampling: 'nearest',
      acceptedClasses: [4, 5, 6],
    },
    reflectanceResampling: 'none',
    minimumDenominator: 1e-6,
    sourceId: 'earth-search-sentinel-2-l2a',
    sourceLabel: 'Sentinel-2 L2A',
    license: 'Open data',
    attribution: 'Copernicus',
    link: 'https://example.org',
    limitations: [],
  },
};

test('research requires deliberate scene search, selection and bounded analysis', async (t) => {
  const { store, calls } = mount(t, empty);
  await nextTick();
  assert.equal(calls.length, 0);
  assert.equal(document.getElementById('research-search').disabled, true);
  store.publish({
    ...empty,
    selection: { name: 'Dehradun' },
    scenes: [scene],
    selectedSceneId: scene.id,
    canAnalyze: true,
  });
  await nextTick();
  const size = document.getElementById('research-size');
  assert.equal(size.value, '128');
  document.getElementById('research-analyze').click();
  assert.deepEqual(calls, [['analyze', { size: 128 }]]);
  size.value = '256';
  size.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('research-analyze').click();
  assert.deepEqual(calls.at(-1), ['analyze', { size: 256 }]);
});
test('NDVI canvas leaves masked pixels transparent and presents source resolution and scaling', async (t) => {
  const painted = [];
  t.mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => ({
    createImageData: (w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData: (pixels) => painted.push(pixels),
  }));
  const { calls } = mount(t, {
    ...empty,
    status: 'ready',
    result,
    canExport: true,
  });
  await nextTick();
  await nextTick();
  assert.equal(painted.length, 1);
  assert.equal(painted[0].data[3], 255);
  assert.equal(painted[0].data[7], 0);
  assert.equal(painted[0].data[11], 255);
  const text = document.getElementById('research-panel').textContent;
  assert.match(text, /75.0%/);
  assert.match(text, /20 m/);
  assert.match(text, /-0.1/);
  assert.match(text, /EPSG:32644/);
  document.getElementById('research-export').click();
  assert.deepEqual(calls, [['exportResult']]);
});
test('rejected or all-masked research never appears as zero vegetation', async (t) => {
  mount(t, {
    ...empty,
    status: 'error',
    error: 'No valid pixels after masking',
    result: {
      version: 1,
      status: 'rejected',
      reason: 'no-valid-pixels',
      sceneId: 'scene-one',
      statistics: null,
    },
  });
  await nextTick();
  assert.equal(document.querySelector('#research-heatmap'), null);
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /No valid pixels/,
  );
  assert.equal(document.getElementById('research-export').disabled, true);
});

test('explicit analysis brings the raster into view without moving keyboard focus', async (t) => {
  t.mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  }));
  const { store } = mount(t, {
    ...empty,
    selection: { name: 'Dehradun' },
    selectedSceneId: scene.id,
    scenes: [scene],
    canAnalyze: true,
  });
  await nextTick();
  const scrolls = [];
  document.querySelector('.research-panel-inner').scrollTo = (options) =>
    scrolls.push(options);
  const scroller = document.querySelector('.research-panel-inner');
  scroller.scrollTop = 50;
  scroller.getBoundingClientRect = () => ({ top: 100 });
  document.getElementById(
    'research-analyze',
  ).parentElement.getBoundingClientRect = () => ({ top: 400 });
  document.querySelector(
    '#research-panel .ui-panel__head',
  ).getBoundingClientRect = () => ({ height: 64 });
  const previous = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  t.after(() => {
    window.matchMedia = previous;
  });
  store.connect({
    analyze: async () => {
      store.publish({ ...empty, result, canExport: true, status: 'ready' });
      return true;
    },
  });
  const button = document.getElementById('research-analyze');
  button.focus();
  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].behavior, 'auto');
  assert.equal(
    scrolls[0].top,
    274,
    'result controls clear the visible sticky header',
  );
  assert.equal(document.activeElement, button);
});

test('scene search, scene choice and cancellation stay separate deliberate actions', async (t) => {
  const { store, calls } = mount(t, {
    ...empty,
    selection: { name: 'Dehradun' },
    scenes: [scene],
  });
  await nextTick();
  for (const [id, value] of [
    ['research-start', '2025-10-01'],
    ['research-end', '2025-10-20'],
  ]) {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document
    .getElementById('research-search-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  document.querySelector('.research-scenes button').click();
  assert.deepEqual(calls, [
    ['search', { startDate: '2025-10-01', endDate: '2025-10-20' }],
    ['choose', scene.id],
  ]);
  store.publish({ ...empty, status: 'analyzing', busy: true, canCancel: true });
  await nextTick();
  assert.equal(document.getElementById('research-analyze').disabled, true);
  document.getElementById('research-cancel').click();
  assert.deepEqual(calls.at(-1), ['cancel']);
});
test('canvas failure keeps scientific statistics and an exportable result', async (t) => {
  t.mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => null);
  mount(t, { ...empty, status: 'ready', result, canExport: true });
  await nextTick();
  await nextTick();
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /could not draw/,
  );
  assert.match(
    document.querySelector('.research-metrics').textContent,
    /75.0%/,
  );
  assert.equal(document.getElementById('research-export').disabled, false);
});
