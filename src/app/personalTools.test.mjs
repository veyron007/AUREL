import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createPersonalToolBindings } from './personalTools.js';
import { createRouteSnapshot } from '../layers/directions/snapshot.js';
const snapshot = () =>
  createRouteSnapshot(
    {
      mode: 'foot',
      geometry: [
        [78, 30],
        [79, 31],
      ],
      distanceM: 100,
      durationS: 300,
      steps: [],
    },
    { lon: 78, lat: 30 },
    { lon: 79, lat: 31 },
    1000,
  );
function fixture(overrides = {}) {
  const calls = [];
  let enabled = false;
  const layer = {
    getRouteSnapshot: snapshot,
    restoreSavedRoute(value) {
      calls.push(['restore', value]);
      return true;
    },
  };
  const args = {
    viewer: { camera: { flyTo: (options) => calls.push(['fly', options]) } },
    styleManager: {
      _runExplicitNavigation: (_name, action) => {
        calls.push(['navigate']);
        return action();
      },
      subscribeLocationSearch: () => () => {},
    },
    dataManager: {
      layers: new Map([['directions', { module: layer }]]),
      getAll: () => [{ id: 'directions', enabled: true }],
      isEnabled: () => enabled,
      setEnabled: async (id, on, opts) => {
        calls.push(['enable', id, on, opts]);
        enabled = on;
        return true;
      },
    },
    mapStackController: {
      getActiveStack: () => ({
        id: 'osm',
        label: 'OpenStreetMap',
        url: 'must not expose',
      }),
    },
    operations: {
      annotationResolver: {
        pickWorldFromScreen: () => ({ lat: 30, lon: 78, height: 500 }),
      },
    },
    annotations: { list: () => [] },
    sceneDirector: {
      restoreProjectSnapshot: async (doc, opts) => {
        calls.push(['scene', doc, opts]);
        return true;
      },
    },
    ...overrides,
  };
  return { args, calls, bindings: createPersonalToolBindings(args) };
}
test('adapter captures center and source through owners and focuses through navigation authority', () => {
  const { bindings, calls } = fixture();
  assert.deepEqual(bindings.readMapSource(), {
    id: 'osm',
    label: 'OpenStreetMap',
  });
  assert.deepEqual(bindings.readCurrentPlace().geometry.coordinates, [78, 30]);
  bindings.focusPlace({ geometry: { type: 'Point', coordinates: [78, 30] } });
  assert.equal(calls[0][0], 'navigate');
  assert.equal(calls[1][0], 'fly');
  assert.ok(Cesium.Cartographic.fromCartesian(calls[1][1].destination));
  bindings.destroy();
  assert.equal(bindings.focusPlace({ lat: 30, lon: 78 }), false);
});
test('route restoration enables then installs saved geometry without setParams or provider fetch', async () => {
  const { bindings, calls } = fixture();
  const row = await bindings.captureCurrent('route');
  await bindings.restoreCapture('route', row);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['enable', 'restore'],
  );
  assert.deepEqual(calls[1][1], snapshot());
  bindings.destroy();
});
test('destruction aborts pending enable and prevents late saved route installation', async () => {
  let finish;
  const calls = [];
  const { bindings } = fixture({
    dataManager: {
      layers: new Map([
        [
          'directions',
          {
            module: {
              restoreSavedRoute() {
                calls.push('restore');
                return true;
              },
            },
          },
        ],
      ]),
      isEnabled: () => true,
      setEnabled: (_id, _on, { signal }) =>
        new Promise((resolve) => {
          finish = () => {
            assert.equal(signal.aborted, true);
            resolve(true);
          };
        }),
    },
  });
  const restore = bindings.restoreCapture('route', { snapshot: snapshot() });
  bindings.destroy();
  finish();
  await assert.rejects(restore, /closed/);
  assert.deepEqual(calls, []);
});
test('selection listeners whitelist records and unsubscribe on destroy', async () => {
  const { bindings } = fixture();
  const rows = [];
  bindings.subscribeSelection((row) => rows.push(row));
  window.dispatchEvent(
    new CustomEvent('gev:entity-selected', {
      detail: {
        id: 'x',
        layerId: 'test',
        latitude: 30,
        longitude: 78,
        properties: { name: 'Park' },
        secret: 'private',
        entity: {},
      },
    }),
  );
  assert.equal(rows.at(-1).name, 'Park');
  assert.equal('secret' in rows.at(-1), false);
  bindings.destroy();
  window.dispatchEvent(new CustomEvent('gev:entity-selection-cleared'));
  assert.equal(rows.length, 1);
});

test('evidence and search subscriptions are released; sky picks stay unknown', () => {
  const subscriptions = [],
    removed = [];
  const owner = {
    subscribe: (listener) => {
      subscriptions.push(listener);
      return () => removed.push('source');
    },
  };
  const { bindings } = fixture({
    styleManager: { subscribeLocationSearch: owner.subscribe },
    dataManager: { ...owner, subscribeActivity: owner.subscribe },
    mapStackController: owner,
    operations: { annotationResolver: { pickWorldFromScreen: () => null } },
  });
  let events = 0;
  bindings.subscribeEvidence(() => events++);
  bindings.subscribeLocationSearch(() => events++);
  subscriptions.forEach((listener) => listener({}));
  assert.equal(events, 4);
  assert.equal(bindings.readCurrentPlace(), null);
  assert.equal(bindings.readMapSource(), null);
  bindings.destroy();
  subscriptions.forEach((listener) => listener({}));
  assert.equal(events, 4);
  assert.equal(removed.length, 4);
  assert.deepEqual(bindings.readLayers(), []);
});

test('explicit scene and drawing captures restore through existing owners', async () => {
  const { createDefaultProject } = await import('../scenes/project.js');
  const document = createDefaultProject();
  const calls = [];
  const { bindings } = fixture({
    sceneDirector: {
      getProjectSnapshot: () => structuredClone(document),
      restoreProjectSnapshot: async (value, { signal }) => {
        assert.equal(signal.aborted, false);
        calls.push(['scene', value]);
        return true;
      },
    },
    annotations: {
      list: () => [
        {
          manual: true,
          type: 'pin',
          anchor: { lon: 78, lat: 30 },
          name: 'Meet',
          color: 'cyan',
        },
      ],
      annotate: async (specs) => {
        calls.push(['drawing', specs]);
        return { ok: true, drawn: 1, results: [{ ok: true, id: '1' }] };
      },
    },
  });
  const scene = await bindings.captureCurrent('scene');
  await bindings.restoreCapture('scene', scene);
  const marks = await bindings.captureCurrent('drawing');
  await bindings.restoreCapture('drawing', marks[0]);
  assert.equal(calls[0][0], 'scene');
  assert.equal(calls[1][1][0].manual, true);
  await assert.rejects(bindings.captureCurrent('unsupported'), /Unsupported/);
  await assert.rejects(
    bindings.restoreCapture('unsupported', {}),
    /Unsupported/,
  );
  await assert.rejects(
    bindings.restoreCapture('route', { snapshot: null }),
    /snapshot/,
  );
  bindings.destroy();
  await assert.rejects(bindings.captureCurrent('scene'), /closed/);
});

test('full composition starts and closes owners idempotently', async () => {
  const { createPinia } = await import('pinia');
  const { createPersonalTools } = await import('./personalTools.js');
  let closed = 0;
  const { args } = fixture();
  const workspace = createPersonalTools({
    ...args,
    pinia: createPinia(),
    repository: {
      list: async () => ({ projects: [], corrupt: [] }),
      close: () => {
        closed++;
      },
    },
  });
  await workspace.ready;
  workspace.lens.inspectCurrentView();
  assert.deepEqual(workspace.lens.selection.geometry.coordinates, [78, 30]);
  workspace.destroy();
  workspace.destroy();
  assert.equal(closed, 1);
});

test('tracked selections use the published Cartesian and clearing remains local', () => {
  const { bindings } = fixture();
  const rows = [];
  const unsubscribe = bindings.subscribeSelection((row) => rows.push(row));
  window.dispatchEvent(
    new CustomEvent('gev:awareness-subject-selected', {
      detail: {
        id: 'plane',
        layerId: 'flights',
        label: 'Flight',
        position: Cesium.Cartesian3.fromDegrees(78, 30, 2000),
      },
    }),
  );
  assert.ok(Math.abs(rows[0].geometry.coordinates[0] - 78) < 0.000001);
  window.dispatchEvent(
    new CustomEvent('gev:awareness-subject-cleared', {
      detail: { layerId: 'flights' },
    }),
  );
  assert.equal(rows[1], null);
  unsubscribe();
  unsubscribe();
  bindings.destroy();
});

test('attachment restoration downloads passive local bytes and revokes its object URL', async (t) => {
  const { bindings } = fixture();
  const clicks = [],
    revoked = [];
  const originalCreate = document.createElement.bind(document);
  t.mock.method(document, 'createElement', (tag, ...args) => {
    const element = originalCreate(tag, ...args);
    if (tag === 'a')
      element.click = () =>
        clicks.push({ download: element.download, href: element.href });
    return element;
  });
  t.mock.method(URL, 'createObjectURL', (blob) => {
    assert.equal(blob.type, 'application/octet-stream');
    return 'blob:local-attachment';
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const row = await bindings.captureCurrent(
    'attachment',
    new File(['hello'], 'notes.txt'),
  );
  await bindings.restoreCapture('attachment', row);
  assert.equal(clicks[0].download, 'notes.txt');
  bindings.destroy();
  assert.deepEqual(revoked, ['blob:local-attachment']);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(revoked.length, 1);
});

test('a pre-existing selected context does not reveal Lens on subscription', async (t) => {
  const { selectTrackedSubjectContext, clearTrackedSubjectContext } =
    await import('../data/contextStore.js');
  selectTrackedSubjectContext({
    id: 'startup-selection',
    layerId: 'startup-test',
    latitude: 30,
    longitude: 78,
    name: 'Existing',
  });
  t.after(() => clearTrackedSubjectContext('startup-test'));
  const { bindings, args } = fixture();
  args.dataManager.isEnabled = () => true;
  const seen = [];
  bindings.subscribeSelection((value) => seen.push(value));
  assert.deepEqual(seen, []);
  bindings.destroy();
});

test('saved place navigation honors reduced motion', (t) => {
  t.mock.method(window, 'matchMedia', (query) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
  }));
  const { bindings, calls } = fixture();
  bindings.focusPlace({ lat: 30, lon: 78 });
  assert.equal(calls.find((call) => call[0] === 'fly')[1].duration, 0);
  bindings.destroy();
});
