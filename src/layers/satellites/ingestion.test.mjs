import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTleText, tleLineLaunchYear } from '../../sources/tle.js';
import { createIngestion } from './ingestion.js';
import { createOrbits } from './orbits.js';

// The ISS set (1 January 2024) with its catalog field swapped per satellite.
const ISS_LINE1 =
  '1 25544U 98067A   24001.50000000  .00016717  00000-0  30370-3 0  9993';
const ISS_LINE2 =
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579432323';

function tleSet(name, field) {
  return [
    name,
    ISS_LINE1.replace('25544', field),
    ISS_LINE2.replace('25544', field),
  ].join('\n');
}

function ingestionFor(catalogText) {
  const state = {
    _trackingRefreshEpoch: 0,
    _activeUpdateControllers: new Set(),
    _pointCollection: {
      removeAll() {},
      add: (point) => point,
    },
    _points: new Map(),
    _orbitPaths: new Map(),
    _catalog: new Map(),
    _detectionObjects: new Map(),
    _denseLoadToken: 0,
    _catalogRevision: 0,
    _params: { catalog: 'core', showOrbits: false },
  };
  const parts = {
    orbits: {
      parseTLE: parseTleText,
      propagatePosition: () => ({ longitude: 0, latitude: 0, altitude: 4e5 }),
    },
    labels: { _syncIssOverlay() {} },
    controls: { _pointStyleFor: () => ({}) },
    rendering: { _showOrbitPath() {} },
    tracking: {
      async _reconcileTrackedSubjectContext() {},
      _applyPendingTrackingRestore() {},
    },
    catalog: {},
  };
  const source = {
    async readGroup() {
      return { ok: true, text: catalogText };
    },
  };
  const { methods } = createIngestion({ state, services: {}, parts, source });
  return { state, update: () => methods.update({ scene: {} }) };
}

test('every Alpha-5 satellite keeps its own catalog entry through dedupe', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const { state, update } = ingestionFor(
    [
      tleSet('FIRST', 'A0000'),
      tleSet('SECOND', 'B0001'),
      tleSet('THIRD', 'Z9999'),
    ].join('\n'),
  );
  await update();
  assert.deepEqual(
    [...state._catalog].map(([id, entry]) => [id, entry.name]),
    [
      [100000, 'FIRST'],
      [110001, 'SECOND'],
      [339999, 'THIRD'],
    ],
  );
  assert.deepEqual([...state._points.keys()], [100000, 110001, 339999]);
  assert.equal(state._count, 3);
});

test('a mission payload does not match a loaded satellite from another launch year', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  // SXM-11, international designator 2026-148A.
  const { state, update } = ingestionFor(
    [
      'SXM-11',
      '1 69728U 26148A   26208.65166678  .00000015  00000+0  00000+0 0  9990',
      '2 69728   0.0784 264.9826 0001797 240.4588 273.9506  1.00271527   440',
    ].join('\n'),
  );
  await update();
  const { getSatelliteOrbitTrack } = createOrbits({ state });
  const track = (launchTime) =>
    getSatelliteOrbitTrack('Sirius SXM-11', { launchTime });
  assert.equal(track('2026-06-29T02:25:00Z')?.noradId, 69728);
  assert.equal(track('2030-06-29T02:25:00Z'), null);
});

test('a satellite with a blank designator keeps matching by name', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const { state, update } = ingestionFor(
    [
      'SXM-11',
      '1 69728U          26208.65166678  .00000015  00000+0  00000+0 0  9990',
      '2 69728   0.0784 264.9826 0001797 240.4588 273.9506  1.00271527   440',
    ].join('\n'),
  );
  await update();
  const { getSatelliteOrbitTrack } = createOrbits({ state });
  assert.equal(tleLineLaunchYear('1 69728U          26208.65166678'), null);
  assert.equal(
    getSatelliteOrbitTrack('Sirius SXM-11', {
      launchTime: '2030-06-29T02:25:00Z',
    })?.noradId,
    69728,
  );
});

/** An ingestion whose source answers per group from a script of replies. */
function versionedIngestion(replyFor) {
  const { state } = ingestionFor('');
  const calls = { removeAll: 0, parse: 0, etags: [] };
  state._pointCollection = {
    removeAll: () => calls.removeAll++,
    add: (point) => point,
  };
  const parts = {
    orbits: {
      parseTLE: (text) => {
        calls.parse++;
        return parseTleText(text);
      },
      propagatePosition: () => ({ longitude: 0, latitude: 0, altitude: 4e5 }),
    },
    labels: { _syncIssOverlay() {} },
    controls: { _pointStyleFor: () => ({}) },
    rendering: { _showOrbitPath() {} },
    tracking: {
      async _reconcileTrackedSubjectContext() {},
      _applyPendingTrackingRestore() {},
    },
    catalog: {},
  };
  const source = {
    async readGroup(group, { etag } = {}) {
      calls.etags.push([group, etag ?? null]);
      return replyFor(group, etag);
    },
  };
  const { methods } = createIngestion({ state, services: {}, parts, source });
  return { state, calls, update: () => methods.update({ scene: {} }) };
}

const GROUP_FIELD = {
  stations: '00001',
  visual: '00002',
  'gps-ops': '00003',
  'glo-ops': '00004',
  galileo: '00005',
  geo: '00006',
};

test('a refresh where every group answers 304 keeps the catalog without a rebuild', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const { state, calls, update } = versionedIngestion((group, etag) =>
    etag
      ? { ok: true, notModified: true, text: '', stale: false, etag }
      : {
          ok: true,
          text: tleSet(group.toUpperCase(), GROUP_FIELD[group]),
          stale: false,
          etag: `W/"tle-${group}-1"`,
        },
  );
  await update();
  const catalog = [...state._catalog];
  const revision = state._catalogRevision;
  state._lastUpdate = 0;
  await update();
  assert.equal(calls.removeAll, 1);
  assert.equal(calls.parse, 6);
  assert.equal(state._catalogRevision, revision);
  assert.deepEqual([...state._catalog], catalog);
  assert.ok(state._lastUpdate > 0, 'a confirmed refresh still stamps its time');
  assert.deepEqual(
    calls.etags.slice(6).map(([, etag]) => etag),
    Object.keys(GROUP_FIELD).map((group) => `W/"tle-${group}-1"`),
  );
});

test('one changed group rebuilds the same catalog a cold load would, reusing parsed groups', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  let round = 0;
  const reply = (group, etag) => {
    if (etag && group !== 'geo')
      return { ok: true, notModified: true, text: '', stale: false, etag };
    const name = round > 0 && group === 'geo' ? 'GEO-NEW' : group.toUpperCase();
    return {
      ok: true,
      text: tleSet(name, GROUP_FIELD[group]),
      stale: false,
      etag: `W/"tle-${group}-${round}"`,
    };
  };
  const warm = versionedIngestion(reply);
  await warm.update();
  round = 1;
  await warm.update();
  assert.equal(warm.calls.removeAll, 2);
  assert.equal(warm.calls.parse, 7, 'only the changed group is parsed again');
  const cold = versionedIngestion((group) => reply(group, null));
  await cold.update();
  assert.deepEqual(
    [...warm.state._catalog].map(([id, entry]) => [id, entry.name, entry.group]),
    [...cold.state._catalog].map(([id, entry]) => [id, entry.name, entry.group]),
  );
});
