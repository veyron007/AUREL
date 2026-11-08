import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearOverlayBitmaps,
  getOverlayBitmapDiagnostics,
  beginOverlayBitmapFrame,
  installOverlayBitmaps,
  paintOverlayBody,
  resetOverlayBitmapDiagnostics,
  setOverlayBitmapDpr,
  uninstallOverlayBitmaps,
} from './worldOverlayBitmaps.js';
import { paintOverlayEntry } from './worldOverlayDraw.js';

function recordingContext(canvas = null) {
  const calls = [];
  const ctx = { calls, canvas };
  for (const name of [
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'lineTo',
    'arcTo',
    'arc',
    'closePath',
    'fill',
    'stroke',
    'fillRect',
    'fillText',
    'drawImage',
    'setTransform',
    'roundRect',
  ])
    ctx[name] = (...args) => calls.push([name, ...args]);
  return ctx;
}

function surfaceFactory(made) {
  return (width, height) => {
    const surface = { width, height };
    surface.ctx = recordingContext(surface);
    surface.getContext = () => surface.ctx;
    made.push(surface);
    return surface;
  };
}

const rect = Object.freeze({ x: 40, y: 30, w: 120, h: 32 });

function entry(title = 'VESSEL ONE') {
  return {
    title,
    details: ['12 KT'],
    accent: '#6be8ff',
    variant: 'card',
  };
}

const drawBody = (ctx, _entry, box) => ctx.fillText('body', box.x, box.y);

test('without a surface factory every body paints directly', () => {
  uninstallOverlayBitmaps();
  const ctx = recordingContext();
  paintOverlayBody(ctx, entry(), 'card', rect, 1, null, drawBody);
  assert.deepEqual(ctx.calls, [['fillText', 'body', 40, 30]]);
});

test('a body paints directly until it holds for three frames, then blits one aligned bitmap', () => {
  const made = [];
  installOverlayBitmaps({ createSurface: surfaceFactory(made) });
  setOverlayBitmapDpr(2);
  resetOverlayBitmapDiagnostics();
  const ctx = recordingContext();
  const card = entry();
  paintOverlayBody(ctx, card, 'card', rect, 1, null, drawBody);
  paintOverlayBody(ctx, card, 'card', rect, 1, null, drawBody);
  assert.deepEqual(
    ctx.calls.map(([name]) => name),
    ['fillText', 'fillText'],
  );
  for (let i = 0; i < 3; i++)
    paintOverlayBody(ctx, card, 'card', rect, 1, null, drawBody);
  assert.equal(made.length, 1, 'one bitmap for a stable body');
  const [surface] = made;
  // Body drawn at the device scale with a whole-device-pixel margin.
  assert.deepEqual(surface.ctx.calls[0], ['setTransform', 2, 0, 0, 2, 3, 3]);
  assert.equal(surface.width, 120 * 2 + 6);
  const blits = ctx.calls.filter(([name]) => name === 'drawImage');
  assert.equal(blits.length, 3);
  // Destination lands the margin on whole device pixels: x*2 - 3 is integral.
  assert.deepEqual(blits[0].slice(2), [40 - 1.5, 30 - 1.5, 123, 35]);
  assert.equal(getOverlayBitmapDiagnostics().hits, 3);
  uninstallOverlayBitmaps();
});

test('a scale that changes every frame never builds bitmaps', () => {
  const made = [];
  installOverlayBitmaps({ createSurface: surfaceFactory(made) });
  setOverlayBitmapDpr(1);
  const ctx = recordingContext();
  const card = entry();
  for (let i = 0; i < 6; i++)
    paintOverlayBody(ctx, card, 'card', rect, 1 + i * 0.01, null, drawBody);
  assert.equal(made.length, 0);
  assert.equal(ctx.calls.filter(([n]) => n === 'fillText').length, 6);
  uninstallOverlayBitmaps();
});

test('changed text rebuilds; equal content on a new entry reuses the bitmap', () => {
  const made = [];
  installOverlayBitmaps({ createSurface: surfaceFactory(made) });
  setOverlayBitmapDpr(1);
  const ctx = recordingContext();
  const first = entry('A');
  for (let i = 0; i < 3; i++)
    paintOverlayBody(ctx, first, 'card', rect, 1, null, drawBody);
  const republished = entry('A');
  for (let i = 0; i < 3; i++)
    paintOverlayBody(ctx, republished, 'card', rect, 1, null, drawBody);
  assert.equal(made.length, 1);
  const renamed = { ...republished, title: 'B' };
  for (let i = 0; i < 3; i++)
    paintOverlayBody(ctx, renamed, 'card', rect, 1, null, drawBody);
  assert.equal(made.length, 2);
  uninstallOverlayBitmaps();
});

test('the texel budget evicts the least recently used bodies', () => {
  const made = [];
  installOverlayBitmaps({
    createSurface: surfaceFactory(made),
    texelBudget: 126 * 38 * 4,
  });
  setOverlayBitmapDpr(1);
  const ctx = recordingContext();
  for (let i = 0; i < 8; i++) {
    const card = entry(`CARD ${i}`);
    for (let frame = 0; frame < 3; frame++)
      paintOverlayBody(ctx, card, 'card', rect, 1, null, drawBody);
  }
  const { count, texels, evictions } = getOverlayBitmapDiagnostics();
  assert.ok(count <= 4);
  assert.ok(texels <= 126 * 38 * 4);
  assert.ok(evictions >= 4);
  clearOverlayBitmaps();
  assert.equal(getOverlayBitmapDiagnostics().count, 0);
  uninstallOverlayBitmaps();
});

test('a cached card body draws the same operations as the direct paint', () => {
  const placement = {
    corner: 'above',
    rect: { x: 10, y: 20, w: 140, h: 44 },
    leadFromX: 80,
    leadFromY: 90,
    leadToX: 80,
    leadToY: 64,
    leaderOffset: 0,
    paintScale: 1,
  };
  uninstallOverlayBitmaps();
  const direct = recordingContext();
  paintOverlayEntry(direct, entry(), placement, 1);
  const made = [];
  installOverlayBitmaps({ createSurface: surfaceFactory(made) });
  setOverlayBitmapDpr(1);
  const cached = recordingContext();
  const card = entry();
  for (let frame = 0; frame < 3; frame++)
    paintOverlayEntry(cached, card, placement, 1);
  const bodyOps = made[0].ctx.calls.slice(1).map(([name]) => name);
  const directOps = direct.calls.map(([name]) => name);
  // Direct: save, leader (beginPath moveTo lineTo stroke), body..., restore.
  const directBody = directOps.slice(5, -1);
  assert.deepEqual(bodyOps, directBody);
  uninstallOverlayBitmaps();
});

test('at most eight new bitmaps are drawn per frame', () => {
  const made = [];
  installOverlayBitmaps({ createSurface: surfaceFactory(made) });
  setOverlayBitmapDpr(1);
  const ctx = recordingContext();
  const cards = Array.from({ length: 20 }, (_, i) => entry(`BURST ${i}`));
  for (let frame = 0; frame < 3; frame++) {
    beginOverlayBitmapFrame();
    for (const card of cards)
      paintOverlayBody(ctx, card, 'card', rect, 1, null, drawBody);
  }
  assert.equal(made.length, 8);
  beginOverlayBitmapFrame();
  for (const card of cards)
    paintOverlayBody(ctx, card, 'card', rect, 1, null, drawBody);
  assert.equal(made.length, 16);
  uninstallOverlayBitmaps();
});
