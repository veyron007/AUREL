import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateLogoGaze, initLogoGaze } from './logoGaze.js';

const rect = { left: 100, top: 50, width: 80, height: 40 };

test('logo gaze is neutral when the cursor is centered', () => {
  assert.deepEqual(calculateLogoGaze(140, 70, rect), { x: 0, y: 0 });
});

test('logo gaze follows direction and caps at the requested offset', () => {
  const gaze = calculateLogoGaze(1140, 70, rect, 28);
  assert.ok(Math.abs(gaze.x - 28) < 1e-9);
  assert.equal(gaze.y, 0);
});

test('logo gaze uses the more visible default travel', () => {
  const gaze = calculateLogoGaze(1140, 70, rect);
  assert.ok(Math.abs(gaze.x - 34) < 1e-9);
  assert.equal(gaze.y, 0);
});

test('logo gaze ramps proportionally inside the full-gaze distance', () => {
  const gaze = calculateLogoGaze(300, 70, rect, 28);
  assert.ok(Math.abs(gaze.x - 14) < 1e-9);
  assert.equal(gaze.y, 0);
});

test('logo gaze preserves diagonal direction while staying bounded', () => {
  const gaze = calculateLogoGaze(640, 570, rect, 28);
  assert.ok(Math.abs(Math.hypot(gaze.x, gaze.y) - 28) < 1e-9);
  assert.ok(gaze.x > 0);
  assert.ok(gaze.y > 0);
});

test('logo gaze fails closed for invalid geometry', () => {
  assert.deepEqual(calculateLogoGaze(10, 10, { ...rect, width: 0 }), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(calculateLogoGaze(Number.NaN, 10, rect), { x: 0, y: 0 });
});

test('the logo box is read once and again only after a resize', async (t) => {
  const listeners = new Map();
  const win = {
    matchMedia: () => ({ matches: false }),
    fetch: async () => ({ ok: false }),
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = win;
  globalThis.document = {
    documentElement: { addEventListener() {}, removeEventListener() {} },
  };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });
  let reads = 0;
  const element = {
    dataset: {},
    getBoundingClientRect: () => {
      reads += 1;
      return { left: 0, top: 0, width: 40, height: 40 };
    },
  };
  const dispose2 = initLogoGaze({ querySelectorAll: () => [element] });
  const move = listeners.get('pointermove');
  move({ clientX: 100, clientY: 100, pointerType: 'mouse' });
  move({ clientX: 120, clientY: 90, pointerType: 'mouse' });
  assert.equal(reads, 1);
  listeners.get('resize')();
  move({ clientX: 10, clientY: 10, pointerType: 'mouse' });
  assert.equal(reads, 2);
  dispose2();
});
