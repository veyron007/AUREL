// i18n-ignore-file: horizon controller fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { HorizonController, horizonDefaults } from './horizonController.js';
import { computeHorizon } from '../horizon/compute.js';
import { syntheticPayload } from '../horizon/testFixtures.mjs';

function harness({ selection = { name: 'Lal Tibba', lat: 30.4597, lon: 78.1058 }, horizonAt } = {}) {
  let current = selection,
    listener = null;
  const published = [],
    drawn = [],
    saved = [];
  let cleared = 0;
  const controller = new HorizonController({
    readSelection: () => current,
    subscribeChanges: (next) => {
      listener = next;
      return () => (listener = null);
    },
    horizonAt:
      horizonAt ??
      (async (input) =>
        computeHorizon({
          payload: syntheticPayload({ lat: input.lat, lon: input.lon, groundM: 2000 }),
          observerHeightM: input.observerHeightM,
          localDate: input.localDate,
          timeZone: input.timeZone,
          shadowAt: input.shadowAt,
          gnomonM: input.gnomonM,
          now: '2026-11-07T00:00:00.000Z',
        })),
    drawHorizon: (result) => drawn.push(result),
    clearHorizon: () => cleared++,
    saveSnapshot: async (subject, snapshot) => {
      saved.push({ subject, snapshot });
      return true;
    },
    store: {
      connect: (actions) => ({ actions }),
      detach() {},
      publish: (view) => published.push(view),
    },
    now: () => '2026-11-07T00:05:00.000Z',
  });
  controller.init();
  return {
    controller,
    published,
    drawn,
    saved,
    get cleared() {
      return cleared;
    },
    select(next) {
      current = next;
      listener?.();
    },
  };
}

test('defaults name today, local noon, 1.7 m eye and a 1 m gnomon', () => {
  const defaults = horizonDefaults(Date.parse('2026-12-21T05:00:00Z'));
  assert.deepEqual(defaults, {
    localDate: '2026-12-21',
    shadowTime: '12:00',
    timeZone: 'Asia/Kolkata',
    observerHeightM: 1.7,
    gnomonM: 1,
  });
});

test('nothing is computed on init; analyze publishes an envelope, draws the ring and saves', async () => {
  const h = harness();
  assert.equal(h.published.at(-1).status, 'empty');
  assert.equal(h.published.at(-1).hasPlace, true);
  assert.equal(h.drawn.length, 0);
  assert.equal(
    await h.controller.analyze({ localDate: '2026-12-21', shadowTime: '12:30', timeZone: 'Asia/Kolkata' }),
    true,
  );
  const view = h.published.at(-1);
  assert.equal(view.status, 'ready');
  assert.equal(view.canSave, true);
  assert.equal(view.envelope.label, 'geometric visibility, terrain-only');
  assert.equal(view.envelope.shadow.at, '2026-12-21T07:00:00.000Z');
  assert.equal(h.drawn.length, 1);
  assert.equal(await h.controller.save(), true);
  assert.equal(h.saved[0].snapshot.capturedAt, '2026-11-07T00:05:00.000Z');
  assert.equal(h.saved[0].subject.geometry.coordinates[0], 78.1058);
});

test('a new place clears the result and the ring; errors are shown, not thrown', async () => {
  const h = harness();
  await h.controller.analyze({ localDate: '2026-12-21' });
  const before = h.cleared;
  h.select({ name: 'Clock Tower', lat: 30.3244, lon: 78.0418 });
  assert.equal(h.published.at(-1).envelope, null);
  assert.ok(h.cleared > before);
  assert.match(h.published.at(-1).error, /place changed/);
  const failing = harness({
    horizonAt: async () => {
      throw new Error('The DEM host is limiting requests; try again later.');
    },
  });
  assert.equal(await failing.controller.analyze({ localDate: '2026-12-21' }), false);
  assert.equal(failing.published.at(-1).status, 'error');
  assert.match(failing.published.at(-1).error, /limiting/);
  const empty = harness({ selection: null });
  assert.equal(await empty.controller.analyze({ localDate: '2026-12-21' }), false);
  assert.match(empty.published.at(-1).error, /Select a place/);
});

test('cancel stops a pending computation without publishing its result', async () => {
  let release;
  const h = harness({
    horizonAt: (input, { signal }) =>
      new Promise((resolve, reject) => {
        release = resolve;
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  const pending = h.controller.analyze({ localDate: '2026-12-21' });
  assert.equal(h.published.at(-1).busy, true);
  h.controller.cancel();
  release?.({});
  assert.equal(await pending, false);
  assert.equal(h.published.at(-1).busy, false);
  assert.equal(h.drawn.length, 0);
  h.controller.destroy();
});
