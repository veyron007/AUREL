import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOW_STROKES,
  createScanlinePatternCache,
  createSensorPalette,
  filterColor,
  parseCssColor,
  parseSensorFilter,
  strokeWithGlow,
} from './detectionSurfaceLook.js';
import { DETECTION_THEME_MAP } from '../overlays/worldOverlayTokens.js';

test('colours parse from rgb, rgba and hex', () => {
  assert.deepEqual(parseCssColor('#ff5a47'), { r: 255, g: 90, b: 71, a: 1 });
  assert.deepEqual(parseCssColor('rgba(0, 244, 255, 0.4)'), {
    r: 0,
    g: 244,
    b: 255,
    a: 0.4,
  });
  assert.deepEqual(parseCssColor('rgb(1,2,3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.equal(parseCssColor('hsl(1, 2%, 3%)'), null);
});

test('every theme filter is a contrast and a saturate', () => {
  for (const theme of Object.values(DETECTION_THEME_MAP)) {
    const { contrast, saturate } = parseSensorFilter(theme.filter);
    assert.ok(contrast >= 1 && contrast < 1.5, theme.filter);
    assert.ok(saturate >= 1 && saturate < 1.5, theme.filter);
    assert.equal(
      theme.filter.replace(/contrast\([\d.]+\)|saturate\([\d.]+\)/g, '').trim(),
      '',
      'no other filter function would be lost',
    );
  }
});

test('the filter matches the CSS contrast and saturate definitions', () => {
  const identity = filterColor(
    { r: 10, g: 200, b: 90, a: 0.5 },
    {
      contrast: 1,
      saturate: 1,
    },
  );
  assert.deepEqual(
    [identity.r, identity.g, identity.b].map(Math.round),
    [10, 200, 90],
  );
  assert.equal(identity.a, 0.5);
  // contrast(2): mid-grey stays, 0.75 -> 1, 0.25 -> 0.
  const contrasted = filterColor(
    { r: 191.25, g: 127.5, b: 63.75, a: 1 },
    { contrast: 2, saturate: 1 },
  );
  assert.deepEqual(
    [contrasted.r, contrasted.g, contrasted.b].map(Math.round),
    [255, 128, 0],
  );
  // saturate(0) is the CSS luminance grey.
  const grey = filterColor(
    { r: 255, g: 0, b: 0, a: 1 },
    { contrast: 1, saturate: 0 },
  );
  assert.deepEqual([grey.r, grey.g, grey.b].map(Math.round), [54, 54, 54]);
});

test('a palette transforms each colour once and passes unknown text through', () => {
  const palette = createSensorPalette('contrast(1.12) saturate(1.12)');
  const red = palette('#ff5a47');
  assert.match(red, /^rgba\(255, \d+, \d+, 1\)$/);
  assert.equal(palette('#ff5a47'), red);
  assert.equal(palette(null), null);
});

function recorder() {
  const calls = [];
  const ctx = {
    calls,
    set strokeStyle(v) {
      calls.push(['strokeStyle', v]);
    },
    set lineWidth(v) {
      calls.push(['lineWidth', v]);
    },
    set globalAlpha(v) {
      calls.push(['globalAlpha', v]);
    },
    stroke(path) {
      calls.push(['stroke', path]);
    },
  };
  return ctx;
}

test('a batch strokes its faint glow underneath, then the line', () => {
  const ctx = recorder();
  const path = {};
  strokeWithGlow(ctx, path, 'LINE', 'GLOW', 0.5, 1);
  const strokes = ctx.calls.filter(([name]) => name === 'stroke');
  assert.equal(strokes.length, GLOW_STROKES.length + 1);
  assert.deepEqual(ctx.calls.slice(-4), [
    ['globalAlpha', 0.5],
    ['lineWidth', 1],
    ['strokeStyle', 'LINE'],
    ['stroke', path],
  ]);
  assert.deepEqual(ctx.calls.slice(0, 4), [
    ['strokeStyle', 'GLOW'],
    ['globalAlpha', 0.5 * GLOW_STROKES[0].alpha],
    ['lineWidth', 1 + GLOW_STROKES[0].extraWidth],
    ['stroke', path],
  ]);
});

test('the scanline tile is one lit row in four, cached per colour', () => {
  const made = [];
  const cache = createScanlinePatternCache((width, height) => {
    const fills = [];
    made.push({ width, height, fills });
    return {
      getContext: () => ({
        set fillStyle(v) {
          fills.push(['fillStyle', v]);
        },
        fillRect: (...args) => fills.push(['fillRect', ...args]),
      }),
    };
  });
  const ctx = { createPattern: (tile, repeat) => ({ tile, repeat }) };
  const pattern = cache(ctx, 'rgba(1, 2, 3, 0.5)');
  assert.equal(cache(ctx, 'rgba(1, 2, 3, 0.5)'), pattern);
  assert.equal(pattern.repeat, 'repeat');
  assert.deepEqual(made, [
    {
      width: 1,
      height: 4,
      fills: [
        ['fillStyle', 'rgba(1, 2, 3, 0.5)'],
        ['fillRect', 0, 0, 1, 1],
      ],
    },
  ]);
});
