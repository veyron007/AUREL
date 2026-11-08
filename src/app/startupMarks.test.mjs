import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markStartup,
  markWhenGlobeTilesLoad,
  STARTUP_MARK_ORDER,
  STARTUP_MARKS,
} from './startupMarks.js';

/** A minimal Performance stand-in that records mark names. */
function fakeTiming() {
  const marks = [];
  return {
    marks,
    mark: (name) => marks.push(name),
    getEntriesByName: (name) => marks.filter((mark) => mark === name),
  };
}

/** A Cesium-like event with listener removal. */
function fakeEvent() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    raise: (value) => [...listeners].forEach((listener) => listener(value)),
    size: () => listeners.size,
  };
}

test('startup marks are listed once in report order', () => {
  assert.deepEqual(STARTUP_MARK_ORDER, [
    'cesium-ready',
    'viewer-created',
    'first-tile',
    'bootstrap-done',
    'splash-hidden',
  ]);
  assert.ok(Object.isFrozen(STARTUP_MARKS));
});

test('each startup mark is recorded only the first time it is reached', () => {
  const timing = fakeTiming();
  assert.equal(markStartup(STARTUP_MARKS.viewerCreated, timing), true);
  assert.equal(markStartup(STARTUP_MARKS.viewerCreated, timing), false);
  assert.deepEqual(timing.marks, ['viewer-created']);
  assert.equal(markStartup('cesium-ready', {}), false, 'no Performance API');
});

test('first-tile waits for a drained queue with every tile loaded, then stops listening', () => {
  const timing = fakeTiming();
  const event = fakeEvent();
  const globe = { tileLoadProgressEvent: event, tilesLoaded: false };
  markWhenGlobeTilesLoad(globe, timing);
  event.raise(12);
  event.raise(0);
  assert.deepEqual(timing.marks, [], 'queue drained but tiles still loading');
  globe.tilesLoaded = true;
  event.raise(0);
  assert.deepEqual(timing.marks, ['first-tile']);
  assert.equal(event.size(), 0);
});

test('a globe without a tile event is ignored and the stop function is safe', () => {
  const stop = markWhenGlobeTilesLoad(undefined, fakeTiming());
  assert.doesNotThrow(stop);
  const event = fakeEvent();
  markWhenGlobeTilesLoad({ tileLoadProgressEvent: event }, fakeTiming())();
  assert.equal(event.size(), 0);
});
