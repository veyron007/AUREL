import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { useRaindropStore } from './stores/raindrop.js';
import { RaindropController } from './raindropController.js';

const NOW = Date.parse('2026-09-15T13:10:00Z');
const result = {
  point: { lon: 78.08, lat: 30.36 },
  drop: {
    path: [
      [78.08, 30.36],
      [78.07, 30.3],
    ],
    outlet: [78.081, 30.359],
    catchment: {
      areaKm2: 12,
      imergWeights: [{ key: '2580:1203', center: [78.05, 30.35], km2: 12 }],
    },
  },
  basin: { id: 4121435040, upKm2: 155.4, subKm2: 155.4 },
};
function imergEnvelope(lo, steps = 48, latest = '2026-09-15T12:00:00Z') {
  return {
    state: 'ready',
    latest,
    retrievedAt: '2026-09-15T13:00:00Z',
    steps: Array.from({ length: steps }, (_, i) => ({
      time: new Date(Date.parse(latest) - i * 1800_000).toISOString(),
      published: true,
      values: { '2580:1203': { lo, hi: lo * 1.06 } },
    })),
  };
}
function setup({ responses = {}, analysis } = {}) {
  const store = useRaindropStore(createPinia());
  const requests = [],
    rendered = [],
    timers = [];
  let stored = [];
  let rain = 1;
  const controller = new RaindropController({
    store,
    now: () => NOW,
    analysis: analysis || { analyze: async () => structuredClone(result) },
    render: {
      show: (r) => rendered.push(r),
      clear: () => rendered.push('clear'),
    },
    readSelection: () => ({ lon: 78.08, lat: 30.36, name: 'Rajpur Road' }),
    fetchJson: async (path) => {
      requests.push(path);
      const route = path.split('?')[0];
      if (responses[route]) return responses[route](path);
      if (route === '/api/hydro/imerg')
        return imergEnvelope(rain, path.includes('window=3h') ? 6 : 48);
      if (route === '/api/hydro/forecast')
        return {
          state: 'ready',
          unitsReserved: 1,
          retrievedAt: '2026-09-15T13:00:00Z',
          points: [
            {
              time: Array.from({ length: 48 }, (_, i) =>
                new Date(Date.parse('2026-09-15T13:00:00Z') + i * 3600_000)
                  .toISOString()
                  .replace('.000Z', 'Z'),
              ),
              precipitation: Array(48).fill(0.5),
            },
          ],
        };
      return { state: 'unavailable', reason: 'upstream-unavailable' };
    },
    storage: { read: () => stored, write: (rows) => (stored = rows) },
    schedule: (fn) => timers.push(fn) && timers.length,
    unschedule: () => timers.splice(0),
  });
  controller.init();
  return {
    controller,
    store,
    requests,
    rendered,
    timers,
    setRain: (value) => (rain = value),
  };
}

test('construction requests nothing; a drop renders, reads IMERG and forecast, never GloFAS', async () => {
  const { controller, store, requests, rendered } = setup();
  assert.equal(requests.length, 0);
  assert.equal(store.view.status, 'idle');
  await controller.traceSelection();
  assert.equal(store.view.status, 'ready');
  assert.equal(rendered.length, 1);
  assert.equal(store.view.result.placeName, 'Rajpur Road');
  assert.deepEqual(
    requests.map((r) => r.split('?')[0]),
    ['/api/hydro/imerg', '/api/hydro/forecast'],
  );
  const imerg = store.view.cards.imerg;
  assert.equal(imerg.class, 'derived');
  assert.equal(imerg.unit, 'mm');
  assert.ok(
    Math.abs(imerg.windows['3h'].lo - 3) < 1e-9,
    '6 half-hours × 1 mm/h × 0.5 h',
  );
  assert.equal(imerg.windows['24h'].steps, 48);
  assert.equal(store.view.cards.forecast.class, 'modelled');
  assert.equal(store.view.cards.forecast.totals[2].totalMm, 12);
  assert.equal(store.view.cards.glofas, null);
});

test('GloFAS is read only on request and shows a rank, not values', async () => {
  const series = {
    state: 'ready',
    unitsReserved: 7,
    retrievedAt: '2026-09-15T13:00:00Z',
    cell: { lat: 30.375, lon: 78.075 },
    time: Array.from({ length: 98 }, (_, i) =>
      new Date(Date.parse('2026-06-16T00:00:00Z') + i * 86400_000)
        .toISOString()
        .slice(0, 10),
    ),
    values: Array.from({ length: 98 }, (_, i) => i),
  };
  const { controller, store, requests } = setup({
    responses: { '/api/hydro/glofas': () => series },
  });
  await controller.traceAt(78.08, 30.36);
  await controller.readGlofas();
  assert.equal(requests.at(-1), '/api/hydro/glofas?lat=30.359&lon=78.081');
  const card = store.view.cards.glofas;
  assert.equal(card.state, 'ready');
  assert.equal(card.percentile, 100);
  assert.equal(card.unit, 'percentile');
  assert.ok(!('values' in card));
});

test('adapter failures become explicit card states', async () => {
  const { controller, store } = setup({
    responses: {
      '/api/hydro/imerg': () => ({
        state: 'unavailable',
        reason: 'upstream-unavailable',
      }),
      '/api/hydro/forecast': () => ({
        state: 'blocked',
        reason: 'daily-limit',
        unitsReserved: 0,
      }),
      '/api/hydro/glofas': () => {
        throw new TypeError('Failed to fetch');
      },
    },
  });
  await controller.traceAt(78.08, 30.36);
  assert.equal(store.view.cards.imerg.state, 'unavailable');
  assert.equal(store.view.cards.forecast.state, 'blocked');
  assert.equal(store.view.cards.forecast.reason, 'daily-limit');
  await controller.readGlofas();
  assert.equal(store.view.cards.glofas.reason, 'offline');
});

test('analysis errors are coded, and a cancelled run leaves no result', async () => {
  const failing = setup({
    analysis: {
      analyze: async () => {
        throw Object.assign(new Error('x'), { code: 'offline-outside-pack' });
      },
    },
  });
  await failing.controller.traceAt(80, 20);
  assert.equal(failing.store.view.error, 'offline-outside-pack');
  const slow = setup({
    analysis: {
      analyze: () =>
        new Promise((resolve) => setTimeout(() => resolve(result), 20)),
    },
  });
  const pending = slow.controller.traceAt(78.08, 30.36);
  slow.controller.cancel();
  await pending;
  assert.equal(slow.store.view.result, null);
  assert.equal(slow.controller.traceAt(500, 0), undefined);
  assert.equal(slow.store.view.error, 'invalid-point');
});

test('a basin watch fires once on a crossing, uses the HydroBASINS id and pauses with the session', async () => {
  const { controller, store, timers, setRain } = setup();
  await controller.traceAt(78.08, 30.36);
  setRain(1);
  assert.equal(controller.addWatch(10), true);
  assert.equal(controller.addWatch(10), false, 'one watch per basin');
  assert.equal(store.view.canWatch, false, 'form hidden once watched');
  await controller.checkWatches();
  const [watch] = store.view.watches;
  assert.match(watch.basinId, /^hybas12:4121435040:/);
  assert.equal(watch.runtime.notifications.length, 0);
  assert.equal(timers.length, 1, 'one 30-minute timer');
  setRain(5); // 6 × 5 × 0.5 = 15 mm > 10 mm
  const fired = await controller.checkWatches();
  assert.equal(fired.length, 1);
  assert.equal(
    (await controller.checkWatches()).length,
    0,
    'same window, no second firing',
  );
  controller.pause();
  assert.equal(timers.length, 0);
  assert.equal((await controller.checkWatches()).length, 0, 'paused');
  assert.equal(store.view.watchesPaused, true);
  await controller.resumeWatches();
  assert.equal(timers.length, 1);
  controller.removeWatch(store.view.watches[0].id);
  assert.equal(store.view.watches.length, 0);
  assert.equal(timers.length, 0);
  controller.destroy();
});
