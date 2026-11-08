import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_MOVING_ATTRIBUTE,
  installCameraMotionFlag,
} from './cameraMotionFlag.js';

function event() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    raise() {
      for (const listener of [...listeners]) listener();
    },
    get size() {
      return listeners.size;
    },
  };
}

function fixture({ holds = [], recording = false } = {}) {
  const camera = { moveStart: event(), moveEnd: event() };
  const attributes = new Map();
  const root = {
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  const state = { holds, recording };
  const dispose = installCameraMotionFlag({
    camera,
    root,
    readHolds: () => state.holds,
    isRecording: () => state.recording,
  });
  return { camera, attributes, state, dispose };
}

test('a camera move sets the flag until the camera settles', () => {
  const { camera, attributes } = fixture();
  assert.equal(attributes.has(CAMERA_MOVING_ATTRIBUTE), false);
  camera.moveStart.raise();
  assert.equal(attributes.get(CAMERA_MOVING_ATTRIBUTE), '');
  camera.moveEnd.raise();
  assert.equal(attributes.has(CAMERA_MOVING_ATTRIBUTE), false);
});

test('sustained camera modes and recordings keep the resting look', () => {
  for (const holds of [['tracked-entity'], ['camera-orbit'], ['cockpit']]) {
    const { camera, attributes } = fixture({ holds: ['flights', ...holds] });
    camera.moveStart.raise();
    assert.equal(attributes.has(CAMERA_MOVING_ATTRIBUTE), false, holds[0]);
  }
  const { camera, attributes } = fixture({ recording: true });
  camera.moveStart.raise();
  assert.equal(attributes.has(CAMERA_MOVING_ATTRIBUTE), false);
});

test('other render holds do not stop the flag', () => {
  const { camera, attributes } = fixture({ holds: ['flights', 'traffic'] });
  camera.moveStart.raise();
  assert.equal(attributes.has(CAMERA_MOVING_ATTRIBUTE), true);
});

test('a failing hold read keeps the resting look and warns', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const camera = { moveStart: event(), moveEnd: event() };
  const attributes = new Map();
  installCameraMotionFlag({
    camera,
    root: {
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
    },
    readHolds: () => {
      throw new Error('no governor');
    },
    isRecording: () => false,
  });
  camera.moveStart.raise();
  assert.equal(attributes.size, 0);
  assert.equal(warn.mock.callCount(), 1);
});

test('disposing removes the listeners and clears the flag', () => {
  const { camera, attributes, dispose } = fixture();
  camera.moveStart.raise();
  dispose();
  dispose();
  assert.equal(attributes.size, 0);
  assert.equal(camera.moveStart.size, 0);
  assert.equal(camera.moveEnd.size, 0);
  camera.moveStart.raise();
  assert.equal(attributes.size, 0);
});

test('a missing camera or root is an explicit error', () => {
  assert.throws(
    () => installCameraMotionFlag({ camera: null, root: {} }),
    /needs a camera and a root/,
  );
});
