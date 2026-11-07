import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneWatchDefinition,
  emptySceneWatchRuntime,
  reduceSceneWatchCheck,
  validateSceneWatchRuntime,
  sceneSearchWindow,
  createSceneWatchSource,
  SCENE_WATCH_LIMITS,
} from './sceneWatch.js';
import {
  createWatchDefinition,
  emptyWatchRuntime,
  validateWatchDefinition,
  validateWatchRecord,
  validateWatchRuntime,
  watchKind,
} from '../watchlists/model.js';
import { validateCataloguePayload } from './catalogueModel.js';

const DAY = 86400000;
const t0 = Date.parse('2026-11-07T06:00:00Z');
const place = {
  id: 'mussoorie',
  name: 'Mussoorie',
  geometry: { type: 'Point', coordinates: [78.0644, 30.4598] },
};
const definition = createSceneWatchDefinition({ place }, { id: 'w1', now: t0 });
const scene = (id, datetime, source = 'earth-search', collection = 'sentinel-2-l2a') => ({
  id,
  collection,
  source,
  platform: source === 'earth-search' ? 'sentinel-2b' : null,
  datetime,
  cloudCover: 12.5,
});
const answer = (at, scenes, statuses = { 'earth-search': 'ok', 'cmr-stac-lpcloud': 'ok' }) =>
  validateCataloguePayload({
    version: 1,
    retrievedAt: new Date(at).toISOString(),
    sources: Object.entries(statuses).map(([id, status]) => ({
      id,
      status,
      count: scenes.filter((row) => row.source === id).length,
      truncated: false,
    })),
    scenes: scenes.filter((row) => ['ok', 'partial'].includes(statuses[row.source])),
  });
const check = (runtime, at, scenes, statuses, baseline = false) =>
  reduceSceneWatchCheck(runtime, answer(at, scenes, statuses), {
    now: at,
    baseline,
    intervalMs: SCENE_WATCH_LIMITS.minIntervalMs,
  });

test('scene watch definitions are version 2, hourly at most, and dispatch through the Watchlist model', () => {
  assert.equal(definition.kind, 'scene');
  assert.equal(definition.version, 2);
  assert.equal(watchKind(definition), 'scene');
  assert.deepEqual(validateWatchDefinition(definition), definition);
  assert.throws(() => createSceneWatchDefinition({ place, intervalMinutes: 30 }, { now: t0 }));
  const record = { definition, runtime: emptyWatchRuntime('scene'), lease: null };
  assert.deepEqual(validateWatchRecord(record).runtime, emptySceneWatchRuntime());
  // A FIRMS record keeps its exact version-1 shape and cannot carry a scene runtime.
  const firms = createWatchDefinition({ place }, { id: 'f1', now: t0 });
  assert.equal(watchKind(firms), 'firms');
  assert.equal(Object.hasOwn(emptyWatchRuntime(), 'kind'), false);
  assert.throws(() => validateWatchRecord({ definition: firms, runtime: emptySceneWatchRuntime(), lease: null }));
  assert.throws(() => validateWatchRecord({ definition, runtime: emptyWatchRuntime(), lease: null }));
  assert.throws(() => validateWatchRuntime({ ...emptySceneWatchRuntime(), kind: 'other' }));
});

test('the first answer is a quiet baseline; a new scene id then fires exactly once', () => {
  const old = scene('S2B_43RGP_20261104_0_L2A', '2026-11-04T05:40:35.189Z');
  let runtime = check(emptySceneWatchRuntime(), t0, [old]);
  assert.equal(runtime.notifications.length, 0);
  assert.equal(runtime.baselineAt, t0);
  const fresh = scene('S2A_43RGP_20261111_0_L2A', '2026-11-11T05:40:40.000Z');
  runtime = check(runtime, t0 + 3600000, [old, fresh]);
  assert.equal(runtime.notifications.length, 1);
  const [row] = runtime.notifications[0].observations;
  assert.equal(row.id, 'earth-search:S2A_43RGP_20261111_0_L2A');
  assert.equal(row.cloudCover, 12.5);
  // The same id in later answers never fires again.
  runtime = check(runtime, t0 + 7200000, [fresh, old]);
  runtime = check(runtime, t0 + 10800000, [fresh]);
  assert.equal(runtime.notifications.length, 1);
});

test('the same acquisition in two catalogues is two products, each announced once', () => {
  let runtime = check(emptySceneWatchRuntime(), t0, []);
  const es = scene('S2A_43RGP_20261111_0_L2A', '2026-11-11T05:40:40Z');
  const hls = scene('HLS.S30.T43RGP.2026315T052841.v2.0', '2026-11-11T05:40:40Z', 'cmr-stac-lpcloud', 'HLSS30_2.0');
  runtime = check(runtime, t0 + 3600000, [es, hls]);
  assert.equal(runtime.notifications.at(-1).observations.length, 2);
  runtime = check(runtime, t0 + 7200000, [es, hls]);
  assert.equal(runtime.notifications.length, 1);
});

test('a catalogue outage is unknown: nothing fires, nothing is forgotten', () => {
  const old = scene('S2B_43RGP_20261104_0_L2A', '2026-11-04T05:40:35Z');
  let runtime = check(emptySceneWatchRuntime(), t0, [old]);
  const seen = runtime.seen;
  runtime = check(runtime, t0 + 3600000, [], { 'earth-search': 'unavailable', 'cmr-stac-lpcloud': 'timeout' });
  assert.equal(runtime.coverage, 'unavailable');
  assert.deepEqual(runtime.seen, seen);
  assert.equal(runtime.lastSuccessAt, t0);
  // When it returns, the already-seen scene stays quiet.
  runtime = check(runtime, t0 + 7200000, [old]);
  assert.equal(runtime.notifications.length, 0);
});

test('a catalogue that first answers later is baselined quietly, not flooded', () => {
  let runtime = check(emptySceneWatchRuntime(), t0, [], { 'earth-search': 'ok', 'cmr-stac-lpcloud': 'unavailable' });
  const hls = scene('HLS.S30.T43RGP.2026308T052841.v2.0', '2026-11-04T05:40:35Z', 'cmr-stac-lpcloud', 'HLSS30_2.0');
  runtime = check(runtime, t0 + 3600000, [hls]);
  assert.equal(runtime.notifications.length, 0);
  assert.deepEqual(runtime.baselineSources.sort(), ['cmr-stac-lpcloud', 'earth-search']);
});

test('a repeated cached answer is stale and never re-announces', () => {
  let runtime = check(emptySceneWatchRuntime(), t0, []);
  const repeat = reduceSceneWatchCheck(runtime, answer(t0, [scene('X', '2026-11-06T05:00:00Z')]), { now: t0 + 3600000 });
  assert.equal(repeat.coverage, 'stale');
  assert.equal(repeat.notifications.length, 0);
});

test('seen ids are kept while the window can return them, then pruned', () => {
  const old = scene('OLD', new Date(t0 - 3 * DAY).toISOString());
  let runtime = check(emptySceneWatchRuntime(), t0, [old]);
  runtime = check(runtime, t0 + 9 * DAY, []);
  assert.ok(runtime.seen.some((row) => row.id === 'earth-search:OLD'));
  runtime = check(runtime, t0 + 12 * DAY, []);
  assert.equal(runtime.seen.some((row) => row.id === 'earth-search:OLD'), false);
});

test('notification rows are bounded; extra scenes are counted, not listed', () => {
  let runtime = check(emptySceneWatchRuntime(), t0, []);
  const many = Array.from({ length: 30 }, (_, i) =>
    scene(`S${i}`, new Date(t0 + 1000 * i).toISOString()),
  );
  runtime = check(runtime, t0 + 3600000, many);
  const note = runtime.notifications[0];
  assert.equal(note.observations.length, SCENE_WATCH_LIMITS.notificationRows);
  assert.equal(note.unlistedCount, 5);
  assert.doesNotThrow(() => validateSceneWatchRuntime(runtime));
});

test('the check searches a bounded past window and keeps the HTTP cooldown', async () => {
  assert.deepEqual(sceneSearchWindow(definition, t0), {
    bbox: [definition.bounds.west, definition.bounds.south, definition.bounds.east, definition.bounds.north],
    from: '2026-10-29',
    to: '2026-11-07',
  });
  const calls = [];
  const source = createSceneWatchSource({
    now: () => t0,
    catalogue: {
      async search(query) {
        calls.push(query);
        return { status: 'unavailable', reason: 'rate-limited', retryAfter: '7200', sources: [], scenes: [] };
      },
    },
  });
  const result = await source.check(definition);
  assert.equal(calls.length, 1);
  assert.equal(result.retryAt, t0 + 7200000);
});
