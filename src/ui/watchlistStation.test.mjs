import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchlistController } from './watchlistController.js';
import { emptyWatchRuntime, validateWatchRecord } from '../watchlists/model.js';
import { hourRows } from '../testSupport/airQualityFixtures.mjs';

const HOUR = 3_600_000;
const origin = Date.parse('2026-11-07T06:20:00Z');
const station = {
  id: 'openaq:9001',
  name: 'Fixture monitor A',
  lat: 30.32,
  lon: 78.04,
  sensors: [{ sensorId: 90011, pollutant: 'pm25', unit: 'µg/m³' }],
};
const copy = (value) => structuredClone(value);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An in-memory repository that validates like the IndexedDB one. */
function memoryRepository() {
  const records = new Map();
  let sequence = 0;
  const keep = (id, record) => {
    records.set(id, validateWatchRecord(record));
    return copy(records.get(id));
  };
  return {
    records,
    list: async () => ({
      watches: [...records.values()].map(copy),
      corrupt: [],
    }),
    get: async (id) => copy(records.get(id)),
    save: async (definition) =>
      keep(definition.id, {
        definition: { ...definition, revision: 1 },
        runtime: emptyWatchRuntime(),
        lease: null,
      }),
    claim: async (id, ownerId, at) =>
      keep(id, {
        ...records.get(id),
        lease: { ownerId, token: String(++sequence), until: at + 90_000 },
      }),
    renew: async (id) => copy(records.get(id)),
    commit: async (id, owner, token, runtime) =>
      keep(id, { ...records.get(id), runtime }),
    release: async (id) => keep(id, { ...records.get(id), lease: null }),
    remove: async (id) => records.delete(id),
    clearNotifications: async (id) => copy(records.get(id)),
    close() {},
  };
}

function seriesFor(value, clock) {
  if (value === 'needs-key')
    return {
      state: 'needs-key',
      reason: 'no-key',
      retrievedAt: null,
      hours: [],
    };
  return {
    state: 'ok',
    retrievedAt: new Date(clock).toISOString(),
    hours: hourRows({ now: clock, value }),
  };
}

function fixture(values) {
  let clock = origin;
  const pending = new Map();
  let sequence = 0;
  const asked = [];
  const controller = new WatchlistController({
    repository: memoryRepository(),
    readSavedPlaces: () => [],
    now: () => clock,
    visibility: () => true,
    subscribeVisibility: () => () => {},
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++sequence;
        pending.set(id, { fn, at: clock + ms });
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    source: {
      check: async () => {
        throw new Error('FIRMS must not be asked for a station watch');
      },
    },
    stationSource: {
      check: async (condition) => {
        asked.push(condition.sensorId);
        const value = values[Math.min(asked.length - 1, values.length - 1)];
        return { series: seriesFor(value, clock), retryAt: null };
      },
    },
  });
  return {
    controller,
    asked,
    async advance(ms) {
      clock += ms;
      for (const [id, job] of [...pending].filter(([, v]) => v.at <= clock)) {
        pending.delete(id);
        job.fn();
      }
      await settle();
    },
  };
}

test('a station watch is created explicitly and fires once on a crossing', async () => {
  const f = fixture([40, 40, 150, 150]);
  await f.controller.init();
  assert.equal(
    await f.controller.createStationWatch({
      station,
      pollutant: 'pm25',
      category: 'poor',
    }),
    true,
  );
  const [watch] = f.controller.view.watches;
  assert.equal(watch.kind, 'station');
  assert.equal(watch.intervalMinutes, 60);
  assert.equal(watch.condition.pollutant, 'PM2.5');
  assert.equal(watch.condition.threshold, 91);
  assert.equal(f.asked.length, 0, 'creating does not start monitoring');
  await f.controller.start(watch.id);
  await settle();
  for (let i = 0; i < 3; i += 1) await f.advance(HOUR);
  assert.deepEqual(f.asked, [90011, 90011, 90011, 90011]);
  const notes = f.controller.view.watches[0].notifications;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, 'aq-crossing');
  assert.equal(notes[0].category, 'poor');
  await f.controller.destroy();
});

test('a missing OpenAQ key stops a station watch with its own reason', async () => {
  const f = fixture(['needs-key']);
  await f.controller.init();
  await f.controller.createStationWatch({ station });
  const [watch] = f.controller.view.watches;
  await f.controller.start(watch.id);
  await settle();
  await settle();
  const after = f.controller.view.watches[0];
  assert.equal(after.state, 'needs-key');
  assert.match(after.reason, /OpenAQ/);
  await f.controller.destroy();
});

test('without a station source, a station watch is refused', async () => {
  const controller = new WatchlistController({
    repository: memoryRepository(),
    subscribeVisibility: () => () => {},
  });
  await controller.init();
  assert.equal(await controller.createStationWatch({ station }), false);
  assert.match(controller.view.error, /station watch/);
  await controller.destroy();
});
