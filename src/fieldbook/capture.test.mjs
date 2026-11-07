import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureRoute,
  captureManualDrawings,
  restoreManualDrawings,
  captureAttachment,
  captureScene,
} from './capture.js';
import { createRouteSnapshot } from '../layers/directions/snapshot.js';
const now = '2026-11-06T10:00:00.000Z';

test('route capture detaches geometry and records retrieval, not observation time', () => {
  const snapshot = createRouteSnapshot(
    {
      mode: 'foot',
      distanceM: 20,
      durationS: 30,
      geometry: [
        [78, 30],
        [78.1, 30.1],
      ],
      steps: [],
    },
    { lon: 78, lat: 30 },
    { lon: 78.1, lat: 30.1 },
    Date.parse(now),
  );
  const row = captureRoute({ getRouteSnapshot: () => snapshot }, { now });
  assert.equal(row.retrievedAt, now);
  assert.equal(row.applicableTime, null);
  assert.deepEqual(row.geometry.coordinates, snapshot.geometry);
  row.geometry.coordinates[0][0] = 0;
  assert.equal(snapshot.geometry[0][0], 78);
  assert.equal(captureRoute({ getRouteSnapshot: () => null }), null);
});

test('manual capture whitelists records and closes rings without mutating live drawing', () => {
  const mark = {
    id: 'live-1',
    manual: true,
    type: 'area',
    name: 'Park',
    color: 'cyan',
    hidden: true,
    ring: [
      [78, 30],
      [79, 30],
      [79, 31],
    ],
    secret: 'never-copy',
  };
  const rows = captureManualDrawings(
    { list: () => [mark, { manual: false, type: 'pin' }] },
    { now },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].geometry.coordinates[0].length, 4);
  assert.equal(mark.ring.length, 3);
  assert.equal(rows[0].hidden, true);
  assert.equal('secret' in rows[0], false);
  rows[0].geometry.coordinates[0][0][0] = 0;
  assert.equal(mark.ring[0][0], 78);
});

test('manual restore validates every row before drawing and retains hidden state', async () => {
  const rows = captureManualDrawings(
    {
      list: () => [
        {
          manual: true,
          type: 'pin',
          anchor: { lon: 78, lat: 30 },
          hidden: true,
          color: 'cyan',
          name: 'Pin',
        },
      ],
    },
    { now },
  );
  const calls = [];
  const engine = {
    annotate: async (specs, opts) => {
      calls.push({ specs, opts });
      return { ok: true, ids: ['new-1'], results: [{ ok: true, id: 'new-1' }] };
    },
    setHidden: (...args) => calls.push(args),
  };
  await assert.rejects(
    restoreManualDrawings(engine, [
      ...rows,
      {
        ...rows[0],
        id: 'bad',
        geometry: { type: 'Point', coordinates: [999, 30] },
      },
    ]),
  );
  assert.equal(calls.length, 0);
  await restoreManualDrawings(engine, rows);
  assert.equal(calls[0].specs[0].manual, true);
  assert.equal(calls[0].specs[0].longitude, 78);
  assert.deepEqual(calls[1], ['new-1', true]);
  assert.equal(calls[0].opts.clearPrevious, false);
});

test('explicit local attachments are bounded, passive, and reject executable formats', async () => {
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
  const row = await captureAttachment(file, { now });
  assert.equal(row.bytes, 5);
  assert.equal(atob(row.data), 'hello');
  await assert.rejects(
    captureAttachment(
      new File(['<script>'], 'page.html', { type: 'text/html' }),
    ),
    /supported/,
  );
  await assert.rejects(
    captureAttachment({
      name: 'huge.txt',
      size: 3 * 1024 * 1024,
      arrayBuffer() {
        throw new Error('must not read');
      },
    }),
    /size/,
  );
  await assert.rejects(
    captureAttachment({
      name: 'bad.txt',
      size: 1,
      arrayBuffer: async () => new Uint8Array(2).buffer,
    }),
    /size/,
  );
});

test('scene capture uses owner snapshot and fails closed without owner', () => {
  assert.throws(
    () => captureScene({ getProjectSnapshot: () => null }),
    /scene/,
  );
});

test('multipart drawings preserve holes and unsupported geometry fails without partial capture', () => {
  const outer = [
      [78, 30],
      [79, 30],
      [79, 31],
      [78, 30],
    ],
    hole = [
      [78.1, 30.1],
      [78.2, 30.1],
      [78.2, 30.2],
      [78.1, 30.1],
    ];
  const mark = {
    manual: true,
    type: 'area',
    polygons: [[outer, hole]],
    name: 'Boundary',
    color: 'green',
  };
  const rows = captureManualDrawings({ list: () => [mark] }, { now });
  assert.deepEqual(rows[0].geometry, {
    type: 'MultiPolygon',
    coordinates: [[outer, hole]],
  });
  assert.throws(
    () =>
      captureManualDrawings(
        {
          list: () => [
            mark,
            { manual: true, type: 'pin', anchor: { lon: 181, lat: 30 } },
          ],
        },
        { now },
      ),
    /coordinates/,
  );
});

test('scene capture is detached through its owner and retains the existing schema', async () => {
  const { createDefaultProject } = await import('../scenes/project.js');
  const project = createDefaultProject();
  const row = captureScene(
    { getProjectSnapshot: () => structuredClone(project) },
    { now },
  );
  assert.equal(row.document.version, project.version);
  row.document.scenes[0].title = 'Edited snapshot';
  assert.notEqual(project.scenes[0].title, row.document.scenes[0].title);
});

test('manual restore uses real annotation owner without resolver or route dispatch', async (t) => {
  const { createAnnotationEngine } =
    await import('../annotations/annotationEngine.js');
  const originalRaf = globalThis.requestAnimationFrame,
    originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  let resolved = 0;
  const engine = createAnnotationEngine({
    viewer: {},
    renderer: { add() {}, remove() {}, sync() {}, update() {}, destroy() {} },
    resolveTarget: async () => {
      resolved++;
      throw new Error('must not resolve');
    },
  });
  t.after(() => {
    engine.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });
  const rows = captureManualDrawings(
    {
      list: () => [
        {
          manual: true,
          type: 'pin',
          anchor: { lon: 78, lat: 30 },
          name: 'Meet',
          color: 'cyan',
          hidden: true,
        },
        {
          manual: true,
          type: 'route',
          path: [
            { lon: 78, lat: 30 },
            { lon: 78.1, lat: 30.1 },
          ],
          name: 'Walk',
          color: 'amber',
        },
        {
          manual: true,
          type: 'area',
          ring: [
            [78, 30],
            [79, 30],
            [79, 31],
          ],
          name: 'Park',
          color: 'green',
        },
      ],
    },
    { now },
  );
  const result = await restoreManualDrawings(engine, rows);
  assert.equal(result.drawn, 3);
  assert.equal(resolved, 0);
  const marks = engine.list();
  assert.equal(marks[0].hidden, true);
  assert.equal(marks[1].durationS, null);
  assert.deepEqual(
    marks.map((mark) => mark.name),
    ['Meet', 'Walk', 'Park'],
  );
});

test('capture and restore reject unsupported marks, excessive collections, and unsupported palette', async () => {
  assert.throws(
    () =>
      captureManualDrawings({ list: () => [{ manual: true, type: 'arrow' }] }),
    /type/,
  );
  assert.throws(
    () =>
      captureManualDrawings({
        list: () => Array.from({ length: 1001 }, () => ({ manual: true })),
      }),
    /many/,
  );
  assert.throws(
    () =>
      captureManualDrawings({
        list: () => [{ manual: true, type: 'area', polygons: [[]] }],
      }),
    /polygon/,
  );
  assert.throws(
    () =>
      captureManualDrawings({
        list: () => [{ manual: true, type: 'area', ring: [] }],
      }),
    /ring/,
  );
  assert.throws(
    () =>
      captureManualDrawings({
        list: () => [{ manual: true, type: 'route', path: null }],
      }),
    /path/,
  );
  const row = captureManualDrawings(
    { list: () => [{ manual: true, type: 'pin', anchor: { lon: 0, lat: 0 } }] },
    { now },
  )[0];
  await assert.rejects(
    restoreManualDrawings({}, [{ ...row, color: '#fff' }]),
    /color/,
  );
  assert.equal(
    (await restoreManualDrawings({}, [row], { signal: AbortSignal.abort() }))
      .drawn,
    0,
  );
  assert.equal((await restoreManualDrawings({}, [])).drawn, 0);
  assert.deepEqual(captureManualDrawings(null), []);
});
