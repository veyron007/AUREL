import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useRaindropStore } from '../../stores/raindrop.js';
import RaindropPanel from './RaindropPanel.vue';

const ACTIONS = ['pick', 'traceSelection', 'cancel', 'clear', 'replay', 'readGlofas', 'addWatch', 'removeWatch', 'resumeWatches'];
function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia(),
    store = useRaindropStore(pinia),
    calls = [];
  store.connect(Object.fromEntries(ACTIONS.map((name) => [name, (...args) => calls.push([name, ...args])])));
  const app = createApp(RaindropPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { store, calls };
}
const idle = { status: 'idle', error: null, busy: false, picking: false, hasSelection: false, result: null, cards: {}, watches: [], watchesPaused: false, canWatch: false };
const ready = {
  ...idle,
  status: 'ready',
  hasSelection: true,
  canWatch: true,
  result: {
    point: { lon: 78.08, lat: 30.36 },
    rivers: ['Rispana', 'Saswa Nadi', 'Song', 'Ganga', 'Padma', 'Meghna'],
    window: { resolution: { stepArcSec: 3, eastWestM: 80, northSouthM: 93 } },
    dem: { kind: 'bundled' },
    disclosure: { raisedCells: 16143, maxRaiseM: 59.25 },
    drop: {
      localLengthKm: 63.2,
      steps: 605,
      ambiguousSteps: 105,
      outlet: [78.081, 30.359],
      outletMoved: true,
      catchment: { areaKm2: 0.16, touchesEdge: false },
    },
    farField: { status: 'ok', end: 'ocean', lengthKm: 2146 },
    basin: { id: 4121435040, upKm2: 155.4 },
  },
  cards: {
    imerg: {
      state: 'ready',
      latest: '2026-09-15T12:00:00Z',
      latencyMin: 40,
      coverage: 1,
      requestShare: 1,
      windows: {
        '1h': { lo: 1.4, hi: 1.5, complete: true, steps: 2, presentSteps: 2 },
        '3h': { lo: 4.2, hi: 4.5, complete: true, steps: 6, presentSteps: 6 },
        '24h': { lo: 30, hi: 32, complete: false, steps: 48, presentSteps: 40 },
      },
    },
    forecast: { state: 'blocked', reason: 'minute-limit' },
    glofas: { state: 'ready', percentile: 83, n: 92, cell: { lat: 30.375, lon: 78.075 } },
  },
};

test('idle panel offers a globe drop and links IMD and CWC as the authority', async (t) => {
  const { calls } = mount(t, idle);
  await nextTick();
  assert.equal(document.querySelector('#raindrop-selection').disabled, true);
  document.querySelector('#raindrop-pick').click();
  assert.deepEqual(calls, [['pick']]);
  const links = [...document.querySelectorAll('.raindrop-authority a')].map((a) => a.href);
  assert.ok(links.some((href) => href.startsWith('https://mausam.imd.gov.in')));
  assert.ok(links.some((href) => href.startsWith('https://ffs.india-water.gov.in')));
});

test('a result shows rivers, the method card, classes and every card state', async (t) => {
  const { calls } = mount(t, ready);
  await nextTick();
  const text = document.body.textContent;
  assert.match(text, /Rispana → Saswa Nadi → Song → Ganga/);
  assert.match(text, /ocean outlet of the HydroRIVERS network/);
  for (const phrase of ['3″ cells, about 80 m × 93 m', 'Priority-Flood', '16,143 cells raised', '105 of 605 steps', 'Culverts, storm drains', 'Simulated', 'Derived', 'Modelled', 'Percentile 83', '40 of 48 half-hours', 'minute-limit', 'HydroSHEDS v1 © World Wildlife Fund'])
    assert.ok(text.includes(phrase), phrase);
  assert.ok(!/m³\/s/.test(text), 'no discharge value is shown');
  document.querySelector('#raindrop-threshold').value = '25';
  document.querySelector('#raindrop-threshold').dispatchEvent(new Event('input'));
  document.querySelector('#raindrop-watch-form').dispatchEvent(new Event('submit'));
  assert.deepEqual(calls.at(-1), ['addWatch', 25]);
});

test('no Raindrop string claims depth, inundation, stage, discharge values or evacuation', () => {
  const files = [
    'src/ui/views/panels/RaindropPanel.vue',
    'src/ui/raindropController.js',
    'src/app/raindropTools.js',
    ...fs.readdirSync('src/hydro').filter((f) => f.endsWith('.js')).map((f) => `src/hydro/${f}`),
  ];
  const forbidden = /flood depth|inundat|evacuat|river stage|danger level|safe to cross|water depth/i;
  for (const file of files) assert.ok(!forbidden.test(fs.readFileSync(file, 'utf8')), file);
});
