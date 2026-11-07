import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchlistController } from './watchlistController.js';
import { emptyWatchRuntime, validateWatchRecord } from '../watchlists/model.js';
import { validateCataloguePayload } from '../orbitWitness/catalogueModel.js';

const origin = Date.parse('2026-11-07T06:00:00Z');
const place = {
  id: 'mussoorie',
  name: 'Mussoorie',
  geometry: { type: 'Point', coordinates: [78.0644, 30.4598] },
};
const copy = (x) => structuredClone(x);
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function fixture({ answers }) {
  let clock = origin;
  const records = new Map();
  const timers = new Map();
  let timerId = 0;
  const checks = [];
  const repo = {
    list: async () => ({
      watches: [...records.values()].map(copy),
      corrupt: [],
    }),
    get: async (id) => copy(records.get(id)),
    save: async (d) => {
      // Mirrors the IndexedDB repository: the runtime shape follows the kind.
      const r = validateWatchRecord({
        definition: { ...d, revision: 1 },
        runtime: emptyWatchRuntime(d.kind),
        lease: null,
      });
      records.set(d.id, r);
      return copy(r);
    },
    claim: async (id, ownerId, at) => {
      const r = records.get(id);
      r.lease = { ownerId, token: 't', until: at + 90000 };
      return copy(r);
    },
    renew: async (id, owner, token, at) => {
      records.get(id).lease.until = at + 90000;
      return copy(records.get(id));
    },
    commit: async (id, owner, token, runtime) => {
      const r = records.get(id);
      r.runtime = copy(runtime);
      validateWatchRecord(r);
      return copy(r);
    },
    release: async (id) => {
      records.get(id).lease = null;
      return copy(records.get(id));
    },
    remove: async (id) => records.delete(id),
    clearNotifications: async (id) => copy(records.get(id)),
    close() {},
  };
  const opened = [];
  const controller = new WatchlistController({
    repository: repo,
    source: {
      check: async () =>
        assert.fail('FIRMS must not be called for a scene watch'),
    },
    sceneSource: {
      async check(definition) {
        checks.push(definition.id);
        return {
          context: validateCataloguePayload(
            answers[Math.min(checks.length - 1, answers.length - 1)](clock),
          ),
          retryAt: null,
        };
      },
    },
    onOpenScene: async (args) => (opened.push(args), { ok: true }),
    readSavedPlaces: () => [],
    now: () => clock,
    visibility: () => true,
    subscribeVisibility: () => () => {},
    timers: {
      setTimeout: (fn, ms) => (
        timers.set(++timerId, { fn, at: clock + ms }),
        timerId
      ),
      clearTimeout: (id) => timers.delete(id),
    },
  });
  return {
    controller,
    checks,
    opened,
    records,
    async advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= clock) {
          timers.delete(id);
          await timer.fn();
        }
      await settle();
    },
  };
}

const response =
  (scenes, status = 'ok') =>
  (clock) => ({
    version: 1,
    retrievedAt: new Date(clock).toISOString(),
    sources: [
      { id: 'earth-search', status, count: scenes.length },
      { id: 'cmr-stac-lpcloud', status, count: 0 },
    ],
    scenes: status === 'ok' ? scenes : [],
  });
const old = {
  id: 'S2B_43RGP_20261104_0_L2A',
  collection: 'sentinel-2-l2a',
  source: 'earth-search',
  platform: 'sentinel-2b',
  datetime: '2026-11-04T05:40:35.189Z',
  cloudCover: 0.1,
};
const fresh = {
  id: 'S2A_43RGP_20261107_0_L2A',
  collection: 'sentinel-2-l2a',
  source: 'earth-search',
  platform: 'sentinel-2a',
  datetime: '2026-11-07T05:40:40.000Z',
  cloudCover: 22,
};

test('a scene watch is created from the place on screen and fires once per new scene', async () => {
  const f = fixture({
    answers: [
      response([old]),
      response([], 'unavailable'),
      response([old, fresh]),
      response([old, fresh]),
    ],
  });
  await f.controller.init();
  assert.equal(
    await f.controller.create({ kind: 'scene', place, intervalMinutes: 60 }),
    true,
  );
  const [watch] = f.controller.view.watches;
  assert.equal(watch.kind, 'scene');
  assert.equal(watch.intervalMinutes, 60);
  assert.equal(await f.controller.start(watch.id), true);
  await f.advance(0);
  assert.equal(f.checks.length, 1, 'baseline check');
  assert.equal(f.controller.view.watches[0].notifications.length, 0);
  await f.advance(3600000);
  assert.equal(
    f.checks.length,
    2,
    'cooldown respected: one check per interval',
  );
  assert.match(f.controller.view.watches[0].reason, /availability is unknown/);
  await f.advance(3600000);
  await f.advance(3600000);
  assert.equal(f.checks.length, 4);
  const notes = f.controller.view.watches[0].notifications;
  assert.equal(notes.length, 1, 'the new scene fired exactly once');
  assert.equal(notes[0].observations[0].sceneId, fresh.id);
  assert.equal(
    await f.controller.openScene(watch.id, notes[0].observations[0].id),
    true,
  );
  assert.equal(f.opened[0].observation.sceneId, fresh.id);
  assert.deepEqual(f.opened[0].place.coordinates, [78.0644, 30.4598]);
  assert.match(f.controller.view.feedback, /beside the previous scene/);
  await f.controller.destroy();
});

test('scene watches refuse sub-hourly intervals and need a scene source', async () => {
  const f = fixture({ answers: [response([])] });
  await f.controller.init();
  assert.equal(
    await f.controller.create({ kind: 'scene', place, intervalMinutes: 30 }),
    false,
  );
  assert.match(f.controller.view.error, /at least 60 minutes/);
  const bare = new WatchlistController({
    repository: {
      list: async () => ({ watches: [], corrupt: [] }),
      close() {},
    },
    subscribeVisibility: () => () => {},
  });
  await bare.init();
  assert.equal(bare.view.sceneWatchAvailable, false);
  assert.equal(await bare.create({ kind: 'scene', place }), false);
  await bare.destroy();
});
