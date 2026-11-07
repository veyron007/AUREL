import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { BreathController, camsModelCard } from './breathController.js';
import { useBreathStore } from './stores/breath.js';
import BreathCard from './views/panels/BreathCard.vue';
import { validateBreathPayload } from '../airQuality/stations.js';
import { normalizeFieldProvider } from '../sources/fieldContextModel.js';
import { breathPayload } from '../testSupport/airQualityFixtures.mjs';

const NOW = Date.parse('2026-11-07T06:20:00Z');
const selection = {
  geometry: { type: 'Point', coordinates: [78.0322, 30.3165] },
};

function camsProvider() {
  const hour = Math.floor(NOW / 3_600_000) * 3_600_000;
  const time = Array.from({ length: 3 }, (_, i) =>
    new Date(hour + i * 3_600_000).toISOString().slice(0, 16),
  );
  return normalizeFieldProvider(
    {
      latitude: 30.3,
      longitude: 78,
      utc_offset_seconds: 0,
      hourly: {
        time,
        pm2_5: [41, 42, 43],
        pm10: [70, 71, 72],
        us_aqi: [115, 116, 117],
      },
      hourly_units: { pm2_5: 'μg/m³', pm10: 'μg/m³', us_aqi: 'USAQI' },
    },
    'airQuality',
    NOW,
  );
}

function fixture({ state = 'ok', fail = false } = {}) {
  const pinia = createPinia();
  const store = useBreathStore(pinia);
  const asked = [];
  const watches = [];
  let current = selection;
  let listener = null;
  const controller = new BreathController({
    store,
    now: () => NOW,
    readSelection: () => current,
    subscribeSelection: (fn) => {
      listener = fn;
      return () => {};
    },
    stations: {
      near: async (point, options) => {
        asked.push({ point, options });
        if (fail) throw new Error('down');
        return validateBreathPayload(
          breathPayload({
            now: NOW,
            state,
            point: { lat: 30.3165, lon: 78.0322 },
          }),
        );
      },
    },
    fieldContext: {
      getContext: async () => ({ airQuality: camsProvider() }),
    },
    createStationWatch: async (options) => {
      watches.push(options);
      return true;
    },
  });
  controller.init();
  return {
    pinia,
    store,
    controller,
    asked,
    watches,
    select(next) {
      current = next;
      listener?.();
    },
  };
}

function mount(t, pinia) {
  document.body.replaceChildren();
  const app = createApp(BreathCard).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
}

test('nothing is requested until the person asks', async () => {
  const f = fixture();
  assert.equal(f.asked.length, 0);
  assert.equal(f.store.view.status, 'idle');
  assert.equal(f.store.view.available, true);
  await f.controller.check();
  assert.equal(f.asked.length, 1);
  assert.equal(f.asked[0].options.detail, true);
  assert.equal(f.store.view.status, 'ready');
});

test('station, index, citizen and model stay four separate cards', async () => {
  const f = fixture();
  await f.controller.check();
  const view = f.store.view;
  assert.equal(view.stations.items.length, 2);
  assert.equal(view.indices.class, 'derived');
  assert.equal(view.indices.stationName, 'Fixture monitor A');
  assert.equal(view.citizen.items.length, 1);
  assert.equal(view.model.class, 'modelled');
  assert.deepEqual(
    view.model.rows.map((row) => row.value),
    [41, 70, 115],
  );
});

test('the CAMS card is the model hour containing now, never station data', () => {
  const card = camsModelCard(camsProvider(), NOW + 3_600_000);
  assert.equal(card.validAt, '2026-11-07T07:00:00.000Z');
  assert.equal(card.rows[2].unit, 'US AQI');
  assert.deepEqual(camsModelCard({ state: 'blocked', reason: 'daily-limit' }), {
    state: 'blocked',
    reason: 'daily-limit',
  });
});

test('a new selection clears the previous place readings', async () => {
  const f = fixture();
  await f.controller.check();
  f.select({ geometry: { coordinates: [77.2, 28.6] } });
  assert.equal(f.store.view.status, 'idle');
  assert.equal(f.store.view.stations, null);
  f.select(null);
  assert.equal(f.store.view.available, false);
});

test('a failed station request is an error, the model card still separate', async () => {
  const f = fixture({ fail: true });
  assert.equal(await f.controller.check(), false);
  assert.match(f.store.view.error, /could not be loaded/);
  assert.equal(f.store.view.model.class, 'modelled');
});

test('watch delegates the chosen station, pollutant and category', async () => {
  const f = fixture();
  await f.controller.check();
  assert.equal(
    await f.controller.watch({
      stationId: 'openaq:9001',
      pollutant: 'pm10',
      category: 'very-poor',
    }),
    true,
  );
  assert.equal(f.watches[0].station.id, 'openaq:9001');
  assert.equal(f.watches[0].category, 'very-poor');
  assert.equal(await f.controller.watch({ stationId: 'openaq:1' }), false);
  assert.equal(
    await f.controller.watch({ stationId: 'openaq:9001', category: 'good' }),
    false,
  );
});

test('the card says "no monitor" and never "clean" when no station is near', async (t) => {
  const f = fixture({ state: 'no-monitor' });
  mount(t, f.pinia);
  await f.controller.check();
  await nextTick();
  const state = document.querySelector('#breath-stations .breath-state');
  assert.equal(state.dataset.state, 'no-monitor');
  assert.match(state.textContent, /No monitor within 25 km/);
  assert.match(state.textContent, /does not mean the air is clean/);
  assert.equal(document.querySelector('#breath-indices'), null);
});

test('the rendered card shows unit, time, basis and class on every number', async (t) => {
  const f = fixture();
  mount(t, f.pinia);
  const calls = [];
  f.store.connect({ check: () => calls.push('check') });
  await nextTick();
  document.querySelector('#breath-check').click();
  assert.deepEqual(calls, ['check']);
  await f.controller.check();
  await nextTick();
  const stations = document.querySelector('#breath-stations').textContent;
  assert.match(stations, /62 µg\/m³/);
  assert.match(stations, /2026-11-07 05:00/);
  assert.match(stations, /Observed/);
  const indices = document.querySelector('#breath-indices').textContent;
  assert.match(indices, /NAQI \(India\)/);
  assert.match(indices, /107/);
  assert.match(indices, /Moderately polluted/);
  assert.match(
    indices,
    /24 h means \(8 h for CO and O3\) ending 2026-11-07 06:00 UTC/,
  );
  assert.match(indices, /Derived/);
  assert.match(
    document.querySelector('#breath-citizen').textContent,
    /Uncalibrated/,
  );
  assert.match(document.querySelector('#breath-model').textContent, /Modelled/);
  assert.equal(document.querySelectorAll('.breath-tier').length, 4);
});
