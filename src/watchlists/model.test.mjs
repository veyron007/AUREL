import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWatchDefinition,
  emptyWatchRuntime,
  reduceWatchCheck,
  validateWatchRecord,
  validateWatchRuntime,
} from './model.js';
const now = Date.parse('2026-11-07T12:00:00Z');
const place = {
  id: 'dehradun',
  name: 'Dehradun',
  geometry: { type: 'Point', coordinates: [78.03, 30.31] },
  extent: [78, 30.2, 78.1, 30.4],
};
export function area(at, rows = []) {
  return {
    status: 'ok',
    source: 'NASA FIRMS',
    fetchedAt: at,
    window: {
      start: new Date(at - 86400000).toISOString(),
      end: new Date(at).toISOString(),
    },
    bounds: { west: 78, south: 30.2, east: 78.1, north: 30.4 },
    sources: [{ id: 'VIIRS_NOAA20_NRT', status: 'ok', count: rows.length }],
    matchedCount: rows.length,
    count: rows.length,
    truncated: false,
    observations: rows,
    limitations: [],
  };
}
export function observation(id, at) {
  return {
    id,
    lat: 30.3,
    lon: 78.03,
    acquiredAt: new Date(at).toISOString(),
    source: 'VIIRS_NOAA20_NRT',
    sensor: 'VIIRS',
    satellite: 'NOAA20',
    confidence: 'n',
    frpMw: 5,
  };
}
test('definitions copy saved places, enforce bounded area and at least30min', () => {
  const definition = createWatchDefinition(
    { place, title: 'Home', intervalMinutes: 30 },
    { id: 'watch-1', now },
  );
  assert.equal(definition.intervalMs, 1800000);
  assert.notEqual(definition.place, place);
  assert.throws(() =>
    createWatchDefinition({ place, intervalMinutes: 1 }, { now }),
  );
  assert.throws(() =>
    createWatchDefinition(
      { place: { ...place, extent: [75, 28, 80, 32] } },
      { now },
    ),
  );
  assert.throws(() =>
    validateWatchRecord({
      definition,
      runtime: { ...emptyWatchRuntime(), secret: 'x' },
      lease: null,
    }),
  );
});
test('first baseline is silent; late-retrieved old observations are distinct from new occurrence', () => {
  const first = area(now, [observation('old', now - 3600000)]);
  let state = reduceWatchCheck(emptyWatchRuntime(), first, {
    now,
    baseline: true,
  });
  assert.equal(state.notifications.length, 0);
  assert.equal(state.seen.length, 1);
  const at = now + 1800000;
  state = reduceWatchCheck(
    state,
    area(at, [
      ...first.observations,
      observation('late', now - 300000),
      observation('new', now + 600000),
    ]),
    { now: at },
  );
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].newlyOccurredCount, 1);
  assert.equal(state.notifications[0].newlyRetrievedCount, 1);
  const unchanged = reduceWatchCheck(
    state,
    area(at, [observation('invented', now + 600000)]),
    { now: at + 1800000 },
  );
  assert.equal(unchanged.notifications.length, 1);
  assert.equal(unchanged.coverage, 'stale');
});
test('a newly recovered source and resume baseline do not flood notices', () => {
  let state = reduceWatchCheck(emptyWatchRuntime(), area(now), {
    now,
    baseline: true,
  });
  const later = now + 1800000,
    value = area(later, [
      { ...observation('first-snpp', later - 60000), source: 'VIIRS_SNPP_NRT' },
    ]);
  value.sources.push({ id: 'VIIRS_SNPP_NRT', status: 'ok', count: 1 });
  state = reduceWatchCheck(state, value, { now: later });
  assert.equal(state.notifications.length, 0);
  state = reduceWatchCheck(
    state,
    area(later + 1800000, [observation('wake', later + 600000)]),
    { now: later + 1800000, baseline: true },
  );
  assert.equal(state.notifications.length, 0);
});

test('runtime validation rejects malformed ledgers, counts, source states and unbounded timers', () => {
  const baseline = reduceWatchCheck(emptyWatchRuntime(), area(now), {
    now,
    baseline: true,
  });
  const populated = reduceWatchCheck(
    baseline,
    area(now + 1800000, [observation('new', now + 1000)]),
    { now: now + 1800000 },
  );
  const mutations = [
    (r) => (r.nextAllowedAt = Number.MAX_SAFE_INTEGER),
    (r) => (r.coverage = 'invented'),
    (r) => (r.errorCount = 0.5),
    (r) => (r.baselineSources = ['evil']),
    (r) => (r.sources[0].status = 'fake'),
    (r) => (r.sources[0].count = -1),
    (r) => r.seen.push({ ...r.seen[0] }),
    (r) => (r.notifications[0].unlistedCount = 200),
    (r) => (r.notifications[0].observations[0].lat = 100),
    (r) => (r.notifications[0].observations[0].source = 'evil'),
    (r) => (r.notifications[0].createdAt = 'tomorrow'),
  ];
  for (const mutate of mutations) {
    const r = structuredClone(populated);
    mutate(r);
    assert.throws(() => validateWatchRuntime(r));
  }
  assert.throws(() =>
    reduceWatchCheck(baseline, area(now + 1800000), {
      now: now + 1800000,
      bounds: { west: 0, south: 0, east: 1, north: 1 },
    }),
  );
  const unknownId = { ...observation('', now + 1000), id: '' };
  const fallback = reduceWatchCheck(
    baseline,
    area(now + 1800000, [unknownId]),
    { now: now + 1800000 },
  );
  assert.match(fallback.seen[0].id, /NOAA20.*30.3000/);
  const definition = createWatchDefinition({ place }, { id: 'w', now });
  assert.equal(
    validateWatchRecord({
      definition,
      runtime: populated,
      lease: { ownerId: 'o', token: 't', until: now + 90000 },
    }).lease.ownerId,
    'o',
  );
});
