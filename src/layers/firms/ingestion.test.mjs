import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_FIRE_FILTER } from '../../data/firmsIntensity.js';
import { createIngestion } from './ingestion.js';

const HOUR_MS = 3_600_000;

function record(ageMs, extra = {}) {
  const at = new Date(Date.now() - ageMs);
  const iso = at.toISOString();
  return {
    lat: 10,
    lon: 20,
    frp: 5,
    confidence: 'n',
    daynight: 'D',
    acqDate: iso.slice(0, 10),
    acqTime: iso.slice(11, 16).replace(':', ''),
    instrument: 'VIIRS',
    ...extra,
  };
}

function harness(snapshots) {
  const calls = { render: 0, etags: [] };
  const layerState = {
    _dataSource: {},
    _enabled: true,
    _filter: { ...DEFAULT_FIRE_FILTER },
    _cellCacheByGrid: new Map(),
    _allFires: [],
    _allFiresByFrp: [],
    _snapshotEtag: null,
  };
  const queue = [...snapshots];
  const ingestion = createIngestion({
    layerState,
    services: { context: { clearSelectedEntityContextForLayer() {} } },
    components: {
      rendering: { renderCurrentLod: () => calls.render++ },
      selection: { selectFire() {} },
    },
    config: { id: 'local-firms' },
    feed: {
      async getSnapshot({ etag }) {
        calls.etags.push(etag);
        return queue.shift();
      },
    },
  });
  return { ingestion, layerState, calls };
}

test('a 304 poll does no adapt, sort or render work', async () => {
  const fetchedAt = Date.now() - 60_000;
  const { ingestion, layerState, calls } = harness([
    { fetchedAt, stale: false, fires: [record(HOUR_MS)], etag: 'W/"a"' },
    { notModified: true },
  ]);
  await ingestion.loadHeatmap();
  const fires = layerState._allFires;
  await ingestion.loadHeatmap();
  assert.equal(calls.render, 1);
  assert.equal(layerState._allFires, fires);
  assert.deepEqual(calls.etags, [null, 'W/"a"']);
  assert.equal(layerState._lastUpdate, fetchedAt);
});

test('a 200 with an unchanged fetchedAt only updates the stale flag', async () => {
  const fetchedAt = Date.now() - 60_000;
  const fires = [record(HOUR_MS)];
  const { ingestion, layerState, calls } = harness([
    { fetchedAt, stale: false, fires, etag: 'W/"a"' },
    { fetchedAt, stale: true, fires, etag: 'W/"b"' },
  ]);
  await ingestion.loadHeatmap();
  const adapted = layerState._allFires;
  await ingestion.loadHeatmap();
  assert.equal(calls.render, 1);
  assert.equal(layerState._allFires, adapted);
  assert.equal(layerState._stale, true);
  assert.equal(layerState._snapshotEtag, 'W/"b"');
});

test('ingest clamps to the trailing 24 h exactly as the old serve-time filter did', async () => {
  const { ingestion, layerState } = harness([
    {
      fetchedAt: Date.now(),
      stale: false,
      fires: [record(25 * HOUR_MS, { frp: 1 }), record(HOUR_MS, { frp: 2 })],
      etag: 'W/"a"',
    },
  ]);
  await ingestion.loadHeatmap();
  assert.deepEqual(
    layerState._allFires.map((fire) => fire.frp),
    [2],
  );
});

test('a new fetchedAt rebuilds', async () => {
  const { ingestion, layerState, calls } = harness([
    { fetchedAt: 1, stale: false, fires: [record(HOUR_MS)], etag: 'W/"a"' },
    {
      fetchedAt: 2,
      stale: false,
      fires: [record(HOUR_MS), record(HOUR_MS)],
      etag: 'W/"b"',
    },
  ]);
  await ingestion.loadHeatmap();
  await ingestion.loadHeatmap();
  assert.equal(calls.render, 2);
  assert.equal(layerState._allFires.length, 2);
});

test('a 304 still drops detections that aged out of the 24 h window', async (t) => {
  const DAY_MS = 24 * HOUR_MS;
  const { ingestion, layerState, calls } = harness([
    {
      fetchedAt: Date.now(),
      stale: false,
      fires: [record(HOUR_MS, { lat: 1 }), record(DAY_MS - 5 * 60_000)],
      etag: 'W/"a"',
    },
    { notModified: true },
    { notModified: true },
  ]);
  await ingestion.loadHeatmap();
  assert.equal(layerState._allFires.length, 2);
  const realNow = Date.now;
  const later = realNow() + 10 * 60_000;
  Date.now = () => later;
  t.after(() => {
    Date.now = realNow;
  });
  await ingestion.loadHeatmap();
  assert.equal(layerState._allFires.length, 1);
  assert.equal(layerState._allFiresByFrp.length, 1);
  assert.equal(layerState._totalCount, 1);
  assert.equal(calls.render, 2);
  // Nothing more to drop: the next 304 does no work.
  await ingestion.loadHeatmap();
  assert.equal(calls.render, 2);
});
