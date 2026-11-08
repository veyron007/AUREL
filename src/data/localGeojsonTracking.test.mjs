import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';

import { createRecordTracker } from './localGeojsonTracking.js';

function fakeViewer() {
  const listeners = new Set();
  const added = [];
  const viewer = {
    _tracked: undefined,
    get trackedEntity() {
      return this._tracked;
    },
    set trackedEntity(entity) {
      this._tracked = entity;
      for (const listener of [...listeners]) listener(entity);
    },
    trackedEntityChanged: {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    entities: {
      add(options) {
        const entity = { ...options };
        added.push(entity);
        return entity;
      },
      remove(entity) {
        const index = added.indexOf(entity);
        if (index >= 0) added.splice(index, 1);
        return index >= 0;
      },
    },
    isDestroyed: () => false,
  };
  return { viewer, added, listeners };
}

const AT = Cesium.Cartesian3.fromDegrees(78, 30, 0);

test('a double-clicked record is tracked through a positioned helper', () => {
  const { viewer, added } = fakeViewer();
  const tracker = createRecordTracker(viewer);
  tracker.track(AT, 'dc-1');
  assert.equal(added.length, 1);
  assert.equal(viewer.trackedEntity, added[0]);
  assert.equal(added[0].position, AT);
  assert.equal(added[0].name, 'dc-1');
  assert.ok(added[0].point, 'a point gives the helper a ready bounding sphere');
});

test('tracking something else removes the helper', () => {
  const { viewer, added, listeners } = fakeViewer();
  const tracker = createRecordTracker(viewer);
  tracker.track(AT, 'dc-1');
  viewer.trackedEntity = { id: 'aircraft' };
  assert.equal(added.length, 0);
  assert.equal(tracker.helper, null);
  assert.equal(listeners.size, 0);
  assert.deepEqual(viewer.trackedEntity, { id: 'aircraft' });
});

test('a second record replaces the first helper', () => {
  const { viewer, added } = fakeViewer();
  const tracker = createRecordTracker(viewer);
  tracker.track(AT, 'dc-1');
  tracker.track(Cesium.Cartesian3.fromDegrees(10, 10, 0), 'dc-2');
  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'dc-2');
  assert.equal(viewer.trackedEntity, added[0]);
});

test('release untracks and removes the helper; no position does nothing', () => {
  const { viewer, added } = fakeViewer();
  const tracker = createRecordTracker(viewer);
  tracker.track(undefined, 'none');
  assert.equal(added.length, 0);
  tracker.track(AT, 'dc-1');
  tracker.release();
  assert.equal(viewer.trackedEntity, undefined);
  assert.equal(added.length, 0);
  tracker.release();
});
