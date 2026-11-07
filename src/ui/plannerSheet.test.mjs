import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerController } from './plannerController.js';
import {
  unavailableFieldProvider,
  fieldQueryPoint,
} from '../sources/fieldContextModel.js';
import { createRouteSnapshot } from '../layers/directions/snapshot.js';
import { validateAnalysisSnapshot } from '../fieldbook/analysis.js';
import { sheetPayload } from '../testSupport/mountainWeatherFixtures.mjs';

const date = '2026-11-07T06:00:00.000Z';
const route = () =>
  createRouteSnapshot(
    {
      mode: 'car',
      geometry: [
        [78.0438, 30.3258],
        [78.04, 30.49],
      ],
      distanceM: 23000,
      durationS: 3000,
      steps: [],
    },
    { lon: 78.0438, lat: 30.3258 },
    { lon: 78.04, lat: 30.49 },
    Date.parse(date),
  );
const context = (point) => ({
  version: 1,
  requested: point,
  queried: fieldQueryPoint(point),
  weather: unavailableFieldProvider('weather'),
  airQuality: unavailableFieldProvider('airQuality'),
});
function planner(getMountainWeather) {
  const saves = [],
    views = [];
  const controller = new PlannerController({
    readRoute: route,
    readSelection: () => null,
    getTerrain: async (points) => ({
      results: points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        elevation: 650 + (point.lat - 30.3258) * 8000,
        provenance: { tileset: 'mapterhorn-egm08', version: '5' },
      })),
    }),
    getContext: async (point) => context(point),
    getFireContext: async () => null,
    getMountainWeather,
    saveSnapshot: async (subject, snapshot) => {
      saves.push(snapshot);
      return true;
    },
    publish: (view) => views.push(view),
  });
  controller.init();
  controller.setScope('route');
  return { controller, saves, views };
}
const options = { localDateTime: '2026-11-07T12:00', timeZone: 'Asia/Kolkata' };

test('a checkpoint sheet loads only on request, at the profile height, and saves with the snapshot', async () => {
  const requests = [];
  const f = planner(async (point, { from }) => {
    requests.push({ point, from });
    return sheetPayload({ point });
  });
  assert.equal(await f.controller.analyze(options), true);
  assert.equal(requests.length, 0);
  assert.equal(f.views.at(-1).canLoadSheets, true);
  const last = f.controller.snapshot.checkpoints.length - 1;
  assert.equal(await f.controller.loadSheet(last), true);
  assert.equal(requests.length, 1);
  const checkpoint = f.controller.snapshot.checkpoints[last];
  assert.equal(checkpoint.mountainWeather.elevationSource, 'route-profile');
  assert.equal(
    requests[0].point.elevationM,
    Math.round(650 + (30.49 - 30.3258) * 8000),
  );
  assert.ok(Object.isFrozen(checkpoint.mountainWeather.sheet));
  assert.equal(f.views.at(-1).sheets[last], 'ready');
  assert.equal(f.controller.snapshot.checkpoints[0].mountainWeather, undefined);
  assert.equal(await f.controller.save(), true);
  assert.doesNotThrow(() => validateAnalysisSnapshot(f.saves[0]));
  assert.equal(
    f.saves[0].checkpoints[last].mountainWeather.sheet.forecast.models.length,
    3,
  );
  f.controller.destroy();
});

test('a failed sheet leaves the snapshot intact and a new analysis cancels a pending sheet', async () => {
  const f = planner(async () => {
    throw new Error('offline');
  });
  await f.controller.analyze(options);
  const before = f.controller.snapshot;
  assert.equal(await f.controller.loadSheet(0), false);
  assert.equal(f.controller.snapshot, before);
  assert.equal(f.views.at(-1).sheets[0], 'error');
  let release;
  const slow = planner(
    (point, { signal }) =>
      new Promise((resolve, reject) => {
        release = () => resolve(sheetPayload({ point }));
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  );
  await slow.controller.analyze(options);
  const pending = slow.controller.loadSheet(0);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(slow.views.at(-1).sheets[0], 'loading');
  await slow.controller.analyze(options);
  release?.();
  assert.equal(await pending, false);
  assert.equal(
    slow.controller.snapshot.checkpoints[0].mountainWeather,
    undefined,
  );
  assert.deepEqual(slow.views.at(-1).sheets, {});
  assert.equal(await slow.controller.loadSheet(99), false);
  f.controller.destroy();
  slow.controller.destroy();
});

test('without a mountain source the Planner offers no sheet action', async () => {
  const f = planner(undefined);
  await f.controller.analyze(options);
  assert.equal(f.views.at(-1).canLoadSheets, false);
  assert.equal(await f.controller.loadSheet(0), false);
  f.controller.destroy();
});
