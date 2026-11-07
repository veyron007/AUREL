import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerController } from './plannerController.js';
import {
  unavailableFieldProvider,
  fieldQueryPoint,
} from '../sources/fieldContextModel.js';
import { createRouteSnapshot } from '../layers/directions/snapshot.js';
const date = '2026-11-07T06:00:00.000Z';
const route = () =>
  createRouteSnapshot(
    {
      mode: 'foot',
      geometry: [
        [78, 30],
        [78.4, 30.4],
      ],
      distanceM: 60000,
      durationS: 30000,
      steps: [],
    },
    { lon: 78, lat: 30 },
    { lon: 78.4, lat: 30.4 },
    Date.parse(date),
  );
const context = (point = { lat: 30, lon: 78 }) => ({
  version: 1,
  requested: point,
  queried: fieldQueryPoint(point),
  weather: {
    ...unavailableFieldProvider('weather'),
    state: 'ready',
    reason: null,
    grid: point,
    retrievedAt: date,
    validFrom: date,
    validTo: '2026-11-07T07:00:00.000Z',
    hours: [
      {
        time: date,
        temperatureC: 22,
        precipitationMm: 0,
        precipitationProbabilityPct: 0,
        windSpeedMps: 2,
        windGustMps: 3,
        weatherCode: 0,
      },
    ],
  },
  airQuality: unavailableFieldProvider('airQuality'),
});
const options = { localDateTime: '2026-11-07T12:00', timeZone: 'Asia/Kolkata' };
test('departure outside only the air-quality window is explicitly partial', async () => {
  const f = fixture({
    getFireContext: undefined,
    getContext: async (point) => ({
      ...context(point),
      airQuality: {
        ...unavailableFieldProvider('airQuality'),
        state: 'ready',
        reason: null,
        grid: point,
        retrievedAt: date,
        validFrom: '2026-11-07T05:00:00.000Z',
        validTo: date,
        hours: [
          { time: '2026-11-07T05:00:00.000Z', pm25: 10, pm10: 15, usAqi: 25 },
        ],
      },
    }),
  });
  assert.equal(await f.controller.analyze(options), true);
  assert.equal(f.controller.status, 'partial');
  assert.match(f.controller.error, /outside.*forecast window/);
  assert.equal(
    f.controller.snapshot.checkpoints[0].context.weather.state,
    'ready',
  );
  assert.equal(
    f.controller.snapshot.checkpoints[0].context.airQuality.validTo,
    date,
  );
  f.controller.destroy();
});
function fixture(overrides = {}) {
  const calls = [],
    views = [],
    saves = [];
  const controller = new PlannerController({
    readRoute: route,
    readSelection: () => ({ name: 'Dehradun', lat: 30, lon: 78 }),
    getTerrain: async (points, { signal }) => {
      calls.push(['terrain', points.length]);
      assert.equal(signal.aborted, false);
      return {
        results: points.map((point) => ({
          lat: point.lat,
          lon: point.lon,
          elevation: 700,
          provenance: {
            tileset: 'mapterhorn-egm08',
            version: '5',
            retrievedAt: date,
          },
        })),
      };
    },
    getContext: async (point) => {
      calls.push(['weather', point]);
      return context(point);
    },
    getFireContext: async () => null,
    saveSnapshot: async (subject, snapshot) => {
      saves.push({ subject, snapshot });
      return true;
    },
    publish: (view) => views.push(view),
    ...overrides,
  });
  controller.init();
  controller.setScope('route');
  return { controller, calls, views, saves };
}
test('analysis is explicit, bounded, and saves exact historical output without fetching again', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  assert.equal(await f.controller.analyze(options), true);
  assert.deepEqual(
    f.calls.filter((call) => call[0] === 'terrain').map((call) => call[1]),
    [64, 64],
  );
  assert.equal(f.calls.filter((call) => call[0] === 'weather').length, 3);
  const saved = f.views.at(-1).snapshot;
  assert.equal(saved.profile.complete, true);
  assert.equal(saved.departureAt, '2026-11-07T06:30:00.000Z');
  const calls = f.calls.length;
  assert.equal(await f.controller.save(), true);
  assert.equal(f.calls.length, calls);
  assert.deepEqual(f.saves[0].snapshot, saved);
  f.controller.destroy();
});
test('changed route drops late terrain and forecast results', async () => {
  let finish,
    current = route();
  const f = fixture({
    readRoute: () => current,
    getTerrain: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const analysis = f.controller.analyze(options);
  current = { ...current, mode: 'bike' };
  finish({ results: [] });
  assert.equal(await analysis, false);
  assert.equal(f.views.at(-1).snapshot, null);
  assert.equal(f.calls.length, 0);
  f.controller.destroy();
});
test('cancel and teardown abort requests and prevent late publications', async () => {
  let finish, signal;
  const f = fixture({
    getTerrain: (_points, opts) => {
      signal = opts.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const analysis = f.controller.analyze(options);
  f.controller.cancel();
  assert.equal(signal.aborted, true);
  finish({ results: [] });
  assert.equal(await analysis, false);
  const count = f.views.length;
  f.controller.destroy();
  assert.equal(await f.controller.analyze(options), false);
  assert.equal(f.views.length, count);
});
test('place-only analysis has no terrain request, preserves missing weather and rejects unknown local times', async () => {
  const f = fixture({
    readRoute: () => null,
    getContext: async () => {
      throw new Error('offline');
    },
  });
  f.controller.setScope('place');
  assert.equal(await f.controller.analyze(options), true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.views.at(-1).status, 'partial');
  assert.equal(f.views.at(-1).snapshot.profile, null);
  const [checkpoint] = f.views.at(-1).snapshot.checkpoints;
  assert.equal(checkpoint.lat, 30);
  assert.equal(checkpoint.lon, 78);
  assert.equal(checkpoint.context.weather.state, 'unavailable');
  assert.equal(checkpoint.context.airQuality.state, 'unavailable');
  assert.equal(
    await f.controller.analyze({
      localDateTime: '2026-03-08T02:30',
      timeZone: 'America/New_York',
    }),
    false,
  );
  assert.equal(f.views.at(-1).status, 'error');
  f.controller.destroy();
});

test('a new Lens place cannot silently select an old route; scope switch is explicit', async () => {
  const views = [];
  let routeReads = 0;
  const controller = new PlannerController({
    readRoute: () => {
      routeReads++;
      return route();
    },
    readSelection: () => ({ name: 'Dehradun', lat: 30.3258, lon: 78.0438 }),
    publish: (view) => views.push(view),
  });
  controller.init();
  assert.equal(controller.scope, 'place');
  assert.equal(await controller.analyze(options), true);
  assert.equal(controller.snapshot.route, null);
  assert.equal(controller.snapshot.profile, null);
  assert.equal(controller.subject.name, 'Dehradun');
  assert.equal(controller.setScope('unknown'), false);
  assert.equal(controller.setScope('route'), true);
  assert.equal(controller.snapshot, null);
  assert.ok(routeReads > 0);
  controller.destroy();
});

test('owner subscriptions cancel a changing selection while harmless activity retains analysis', async () => {
  let notify,
    selected = { name: 'Dehradun', lat: 30, lon: 78 },
    unsubscribed = 0;
  const f = fixture({
    readRoute: () => null,
    readSelection: () => selected,
    subscribeChanges: (callback) => {
      notify = callback;
      return () => unsubscribed++;
    },
  });
  f.controller.setScope('place');
  notify();
  await f.controller.analyze(options);
  const snapshot = f.controller.snapshot;
  notify();
  assert.equal(f.controller.snapshot, snapshot);
  selected = { name: 'Austin', lat: 30, lon: -97 };
  notify();
  assert.equal(f.controller.snapshot, null);
  assert.match(f.views.at(-1).error, /changed/);
  f.controller.destroy();
  notify();
  assert.equal(unsubscribed, 1);
});

test('a route arriving after place analysis updates route availability without invalidating the place snapshot', async () => {
  let notify,
    currentRoute = null;
  const f = fixture({
    readRoute: () => currentRoute,
    subscribeChanges: (callback) => {
      notify = callback;
    },
  });
  f.controller.setScope('place');
  assert.equal(await f.controller.analyze(options), true);
  const snapshot = f.controller.snapshot;
  const calls = f.calls.length;
  assert.equal(f.views.at(-1).hasRoute, false);
  currentRoute = route();
  notify();
  assert.equal(f.views.at(-1).hasRoute, true);
  assert.equal(f.views.at(-1).routeSummary.mode, 'foot');
  assert.equal(f.controller.snapshot, snapshot);
  assert.equal(f.views.at(-1).snapshot, snapshot);
  assert.equal(f.calls.length, calls);
  currentRoute = null;
  notify();
  assert.equal(f.views.at(-1).hasRoute, false);
  assert.equal(f.controller.snapshot, snapshot);
  f.controller.destroy();
});

test('partial terrain, unavailable fire and out-of-window forecast stay partial; failed save retains snapshot', async () => {
  let step = 0,
    focused = null;
  const f = fixture({
    getTerrain: async (points) => {
      step++;
      if (step === 1)
        throw Object.assign(new Error('partial'), {
          partial: points.map(() => null),
        });
      return {
        results: points.map((point) => ({
          lat: point.lat,
          lon: point.lon,
          elevation: 500,
        })),
        tileset: 'mapterhorn-egm08',
        version: '5',
        retrievedAt: date,
      };
    },
    getFireContext: async () => {
      throw new Error('offline');
    },
    saveSnapshot: async () => false,
    focusSample: (point) => {
      focused = point;
      return true;
    },
  });
  assert.equal(
    await f.controller.analyze({
      ...options,
      localDateTime: '2027-01-01T12:00',
    }),
    true,
  );
  assert.equal(f.controller.status, 'partial');
  assert.match(f.controller.error, /outside/);
  assert.equal(f.controller.snapshot.profile.complete, false);
  assert.equal(await f.controller.save(), false);
  assert.ok(f.controller.snapshot);
  assert.match(f.controller.error, /not saved/);
  assert.equal(f.controller.focusSample(100), true);
  assert.equal(focused.elevationM, 500);
  assert.equal(f.controller.focusSample(-1), false);
  f.controller.destroy();
  assert.equal(f.controller.focusSample(0), false);
});

test('an absent context provider retains the selected place in the saved snapshot', async () => {
  const f = fixture({ getContext: undefined, getFireContext: undefined });
  f.controller.setScope('place');
  assert.equal(await f.controller.analyze(options), true);
  const snapshot = f.controller.snapshot;
  assert.equal(snapshot.checkpoints.length, 1);
  assert.deepEqual(snapshot.checkpoints[0].context.requested, {
    lat: 30,
    lon: 78,
  });
  assert.equal(snapshot.checkpoints[0].context.weather.state, 'unavailable');
  assert.equal(f.controller.status, 'partial');
  assert.equal(await f.controller.save(), true);
  assert.deepEqual(f.saves[0].snapshot.checkpoints, snapshot.checkpoints);
  f.controller.destroy();
});

test('real Pinia action ownership prevents a superseded controller from publishing', async () => {
  const { createPinia } = await import('pinia');
  const { usePlannerStore } = await import('./stores/planner.js');
  const store = usePlannerStore(createPinia());
  const f = fixture({ store });
  await store.act('analyze', options);
  assert.ok(store.view.snapshot);
  store.act('focusSample', 0);
  store.act('cancel');
  store.act('setScope', 'place');
  const replacement = new PlannerController({
    store,
    readSelection: () => ({ lat: 1, lon: 1 }),
  });
  replacement.init();
  const view = store.view;
  assert.equal(await f.controller.analyze(options), false);
  f.controller.destroy();
  assert.equal(store.view, view);
  replacement.destroy();
});

test('malformed inputs and empty selection fail before any source dispatch', async () => {
  const f = fixture({ readRoute: () => null, readSelection: () => null });
  assert.equal(await f.controller.analyze(options), false);
  assert.equal(f.calls.length, 0);
  assert.equal(
    await f.controller.analyze({ departureAt: 'not-a-date' }),
    false,
  );
  assert.equal(
    await f.controller.analyze({
      localDate: '2026-11-06',
      departureAt: '2026-11-07T00:00:00Z',
    }),
    false,
  );
  f.controller.destroy();
});
