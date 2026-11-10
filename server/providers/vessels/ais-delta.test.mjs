import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FULL_SYNC_CURSOR,
  createVesselDeltaMirror,
} from '../../../src/sources/live/vesselDelta.js';
import { buildVesselSyncBody, createVesselChangeLog } from './ais-delta.js';
import { createSortedSnapshot, visibleRow } from './ais-snapshot.js';

const STALE_MS = 30 * 60_000;

/** Deterministic PRNG so a failure reproduces. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** The store's put/drop rules (ais-store.js) over an in-memory map. */
function createStore({ clock, maxTombstones, bootId = 'b007' }) {
  const vessels = new Map();
  const changes = createVesselChangeLog({ maxTombstones, bootId });
  const snapshot = createSortedSnapshot({
    entries: () => vessels.values(),
    lookup: (key) => vessels.get(key),
    staleMs: STALE_MS,
    ttlMs: 2_000,
    now: () => clock.now,
  });
  return {
    vessels,
    changes,
    put(row) {
      vessels.set(row.mmsi, { ...row, _seq: changes.nextSeq() });
      snapshot.markChanged(row.mmsi);
    },
    drop(mmsi) {
      vessels.delete(mmsi);
      changes.recordRemoval(mmsi);
      snapshot.markChanged(mmsi);
    },
    /** What `/api/vessels?since=` sends, after JSON. */
    answer(maxRows, area, since) {
      const body = buildVesselSyncBody({
        window: snapshot.window(maxRows, area),
        since: changes.parseCursor(since),
        cursor: changes.cursor(),
        removedSince: changes.removedSince,
        storedRows: () => vessels.values(),
      });
      return JSON.parse(JSON.stringify(body));
    },
    /** What a plain `/api/vessels` sends, after JSON. */
    full(maxRows, area) {
      return JSON.parse(JSON.stringify(snapshot.rows(maxRows, area)));
    },
  };
}

/** One client poll the way createVesselSource makes it. */
function poll(store, mirror, maxRows, area) {
  const key = JSON.stringify({ maxRows, area });
  const first = store.answer(maxRows, area, mirror.sinceFor(key));
  const rows = mirror.apply(key, first, maxRows);
  if (rows) return { rows, delta: first.delta, resynced: false };
  const full = store.answer(maxRows, area, FULL_SYNC_CURSOR);
  return {
    rows: mirror.apply(key, full, maxRows),
    delta: false,
    resynced: true,
  };
}

function randomVessel(random, mmsi, now) {
  return {
    mmsi,
    lat: Number((random() * 120 - 60).toFixed(4)),
    lon: Number((random() * 340 - 170).toFixed(4)),
    name: `V${mmsi}`,
    type: random() < 0.5 ? 'Cargo' : '',
    speed: Math.round(random() * 200) / 10,
    _updatedAt: now,
  };
}

/** A random step: arrivals, moves, renames, removals and time passing. */
function mutate(store, random, clock, ids) {
  const steps = 1 + Math.floor(random() * 40);
  for (let i = 0; i < steps; i++) {
    const roll = random();
    const mmsi = ids[Math.floor(random() * ids.length)];
    const existing = store.vessels.get(mmsi);
    if (roll < 0.55 || !existing) {
      store.put(randomVessel(random, mmsi, clock.now));
    } else if (roll < 0.7) {
      // A static report: new name, same position time.
      store.put({
        ...visibleRow(existing),
        _updatedAt: existing._updatedAt,
        name: `N${i}`,
      });
    } else if (roll < 0.85) {
      store.drop(mmsi);
    }
    // Several updates often land in the same millisecond.
    if (random() < 0.3) clock.now += Math.floor(random() * 3);
  }
  clock.now += Math.floor(random() * 90_000);
}

const AREAS = [null, { lat: 10, lon: 20, radiusKm: 3_000 }];

test('applying deltas yields exactly the full snapshot (randomized)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const random = rng(seed);
    const clock = { now: 1_800_000_000_000 };
    const store = createStore({ clock });
    const ids = Array.from({ length: 400 }, (_, i) => String(200000000 + i));
    for (const area of AREAS) {
      for (const maxRows of [50, 5_000]) {
        const mirror = createVesselDeltaMirror();
        let deltas = 0;
        for (let step = 0; step < 60; step++) {
          mutate(store, random, clock, ids);
          const result = poll(store, mirror, maxRows, area);
          if (result.delta) deltas++;
          assert.deepStrictEqual(
            result.rows,
            store.full(maxRows, area),
            `seed ${seed} step ${step} maxRows ${maxRows}`,
          );
        }
        assert.ok(deltas > 30, `deltas were used (${deltas})`);
      }
    }
  }
});

test('a delta carries only changed rows and removals', () => {
  const clock = { now: 1_800_000_000_000 };
  const store = createStore({ clock });
  for (let i = 0; i < 100; i++)
    store.put({ mmsi: String(i), lat: 1, lon: 1, _updatedAt: clock.now + i });
  const mirror = createVesselDeltaMirror();
  poll(store, mirror, 1_000, null);
  clock.now += 1_000;
  store.put({ mmsi: '5', lat: 2, lon: 2, _updatedAt: clock.now });
  store.drop('7');
  const key = JSON.stringify({ maxRows: 1_000, area: null });
  const answer = store.answer(1_000, null, mirror.sinceFor(key));
  assert.equal(answer.delta, true);
  assert.deepEqual(
    answer.rows.map((row) => row.mmsi),
    ['5'],
  );
  assert.deepEqual(answer.removed, ['7']);
  assert.equal(answer.count, 99);
});

test('a vessel that leaves the area is reported removed', () => {
  const clock = { now: 1_800_000_000_000 };
  const store = createStore({ clock });
  const area = { lat: 0, lon: 0, radiusKm: 500 };
  store.put({ mmsi: '1', lat: 0, lon: 0, _updatedAt: clock.now });
  store.put({ mmsi: '2', lat: 1, lon: 1, _updatedAt: clock.now });
  const mirror = createVesselDeltaMirror();
  poll(store, mirror, 100, area);
  store.put({ mmsi: '2', lat: 40, lon: 40, _updatedAt: clock.now + 5 });
  const result = poll(store, mirror, 100, area);
  assert.equal(result.delta, true);
  assert.deepEqual(result.rows, store.full(100, area));
  assert.deepEqual(
    result.rows.map((row) => row.mmsi),
    ['1'],
  );
});

test('a changed area, another server process or a forgotten cursor get the full window', () => {
  const clock = { now: 1_800_000_000_000 };
  const store = createStore({ clock, maxTombstones: 4 });
  for (let i = 0; i < 20; i++)
    store.put({ mmsi: String(i), lat: 0, lon: 0, _updatedAt: clock.now });
  const mirror = createVesselDeltaMirror();
  const keyA = JSON.stringify({ maxRows: 100, area: null });
  poll(store, mirror, 100, null);
  assert.notEqual(mirror.sinceFor(keyA), FULL_SYNC_CURSOR);
  // Area change: the key differs, so the request is a full one.
  assert.equal(mirror.sinceFor('other'), FULL_SYNC_CURSOR);
  // Another server process: the boot id differs.
  const other = createStore({ clock, bootId: 'c0ffee' });
  assert.equal(other.changes.parseCursor(mirror.sinceFor(keyA)), null);
  // More removals than remembered since the cursor.
  const cursor = mirror.sinceFor(keyA);
  for (let i = 0; i < 10; i++) store.drop(String(i));
  assert.equal(store.changes.parseCursor(cursor), null);
  const result = poll(store, mirror, 100, null);
  assert.equal(result.delta, false);
  assert.deepEqual(result.rows, store.full(100, null));
});

test('a delta that does not add up is dropped and the full window fetched', () => {
  const clock = { now: 1_800_000_000_000 };
  const store = createStore({ clock });
  for (let i = 0; i < 10; i++)
    store.put({ mmsi: String(i), lat: 0, lon: 0, _updatedAt: clock.now + i });
  const mirror = createVesselDeltaMirror();
  const key = JSON.stringify({ maxRows: 100, area: null });
  poll(store, mirror, 100, null);
  const answer = store.answer(100, null, mirror.sinceFor(key));
  assert.equal(mirror.apply(key, { ...answer, digest: -1 }, 100), null);
  assert.equal(mirror.sinceFor(key), FULL_SYNC_CURSOR);
});

test('rows from a server without cursor mode pass through unchanged', () => {
  const mirror = createVesselDeltaMirror();
  const rows = [{ mmsi: '1', lat: 0, lon: 0 }];
  assert.equal(mirror.apply('k', { rows }, 100), rows);
  assert.equal(mirror.sinceFor('k'), FULL_SYNC_CURSOR);
});

test('the cursor rejects malformed and future values', () => {
  const log = createVesselChangeLog({ bootId: 'ab' });
  log.nextSeq();
  assert.equal(log.parseCursor('ab.1'), 1);
  assert.equal(log.parseCursor('ab.2'), null);
  assert.equal(log.parseCursor('ab.-1'), null);
  assert.equal(log.parseCursor('0'), null);
  assert.equal(log.parseCursor(null), null);
  assert.equal(log.parseCursor('ab.1;x'), null);
});
