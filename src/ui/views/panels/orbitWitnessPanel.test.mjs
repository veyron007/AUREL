import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useOrbitWitnessStore } from '../../stores/orbitWitness.js';
import { OrbitWitnessController } from '../../orbitWitnessController.js';
import { missionElementSets } from '../../../orbitWitness/tle.js';
import { FIXTURE_TLE, MUSSOORIE } from '../../../orbitWitness/testFixtures.mjs';
import OrbitWitnessPanelBody from './OrbitWitnessPanelBody.vue';
import { panelWithBody } from '../../../testSupport/panelBody.mjs';

const OrbitWitnessPanel = panelWithBody('orbit-witness-panel', OrbitWitnessPanelBody);

const selection = {
  id: 'mussoorie',
  name: 'Mussoorie',
  geometry: { type: 'Point', coordinates: [MUSSOORIE.lon, MUSSOORIE.lat] },
};

async function mount(t) {
  document.body.replaceChildren();
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useOrbitWitnessStore(pinia);
  const director = {
    running: false,
    subscribe: () => () => {},
    ride: async () => true,
  };
  const controller = new OrbitWitnessController({
    store,
    now: () => Date.parse('2026-11-07T06:00:00Z'),
    readSelection: () => selection,
    elements: { read: async () => ({ sets: missionElementSets(FIXTURE_TLE), stale: false }) },
    cloud: { forecast: async () => ({ status: 'unavailable', hours: [] }) },
    catalogue: { search: async () => ({ status: 'unavailable', sources: [], scenes: [] }) },
    overlay: { show: async () => true, clear() {}, destroy() {} },
    director,
    createWatch: async () => true,
  });
  controller.init();
  const app = createApp(OrbitWitnessPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => {
    app.unmount();
    controller.destroy();
  });
  return { controller };
}

test('the card lists passes per mission with all four lanes labelled', async (t) => {
  const { controller } = await mount(t);
  assert.match(document.body.textContent, /Predicted pass/);
  assert.match(document.body.textContent, /Dramatised ride/);
  assert.equal(document.querySelectorAll('[data-mission]').length, 0, 'nothing fetched on open');
  await controller.predict();
  await nextTick();
  const missions = [...document.querySelectorAll('[data-mission]')].map((node) => node.dataset.mission);
  assert.deepEqual(missions, ['sentinel-2a', 'sentinel-2b', 'sentinel-2c', 'landsat-8', 'landsat-9', 'iss']);
  const s2b = document.querySelector('[data-mission="sentinel-2b"]');
  assert.match(s2b.textContent, /propagated, epoch 2026-11-06 20:45 UTC/);
  const pass = s2b.querySelector('[data-pass]');
  for (const lane of ['predicted', 'planned', 'product', 'cloud'])
    assert.ok(pass.querySelector(`[data-lane="${lane}"]`), lane);
  assert.match(pass.textContent, /modelled/);
  assert.match(pass.textContent, /Unknown: a catalogue did not answer completely|Future pass/);
  assert.match(document.body.textContent, /catalogues unreachable · products unknown/);
  // Landsat states that no admissible plan exists.
  assert.match(document.querySelector('[data-mission="landsat-9"]').textContent, /USGS acquisition calendar ends/);
});

test('riding shows the dramatisation caption outside the panel', async (t) => {
  const { controller } = await mount(t);
  await controller.predict();
  await nextTick();
  document.querySelector('[data-mission="sentinel-2b"] [data-orbit-witness-ride]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  const caption = document.getElementById('orbit-witness-ride-caption');
  assert.ok(caption);
  assert.match(caption.textContent, /simulated/);
  assert.match(caption.textContent, /Dramatised ride · orbit propagated, epoch 2026-11-06 20:45 UTC/);
});
