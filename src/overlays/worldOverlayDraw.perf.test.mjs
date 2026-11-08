import assert from 'node:assert/strict';
import test from 'node:test';
import { perfBudgetTestOptions } from '../../scripts/run-perf-tests.mjs';
import { assertWithinBudgets, measureRuns } from '../testSupport/perfBench.mjs';
import {
  clearWorldOverlayTextMeasureCache,
  getWorldOverlayTextMeasureCacheSize,
  measureOverlayEntry,
  TEXT_MEASURE_GENERATION_SIZE,
  paintOverlayEntry,
  placementVariants,
} from './worldOverlayDraw.js';
import { normalizeOverlayEntry } from './worldOverlay.js';

// World-overlay text layout and paint for one frame: measure every candidate
// (cached text widths), build its placement variants, and paint the winners
// through paintOverlayEntry into a non-recording Canvas2D stub. The cohort
// mirrors the all-live allocation row (864 candidates, ~400 painted;
// worldOverlayAllocation.test.mjs). Collision/winner selection lives in
// worldOverlay.js's frame loop (not exported) and is not measured here.
//  - steady: warm text-measure cache, the per-frame cost while parked.
//  - overflow: the same cohort and frame, but with per-entry detail lines so
//    its ~1,600 unique strings exceed the former 1,024-entry cache.
//  - churn: 2,000 never-seen titles per frame, so every measure misses
//    (worst case after a data refresh renames every label).
//
// Measured 2026-11-08, Apple M4, Node v26.13.0 — per-run median of 15 (7 for
// churn) after warm-up, median (range) over 3 runs.
// Before Phase 4B (one 1,024-entry cache with an O(n) eviction scan):
//   steady=0.23ms (0.23-0.31)  overflow=16.0ms (14.8-16.5)
//   churn=33.2ms (28.8-33.3)
// After Phase 4B (two O(1) generations of 4,096 strings):
//   steady=0.22ms  overflow=0.22ms  churn=1.8ms
// Budgets are roughly 5x those medians with a 1.5 ms noise floor, so the
// eviction-scan cliff cannot come back unnoticed.

const CANDIDATE_COUNT = 864;
const PAINTED_COUNT = 400;
const CHURN_TITLE_COUNT = 2_000;
// The former single-generation cache held 1,024 entries; the overflow cohort
// is sized against that historic cliff.
const FORMER_CACHE_LIMIT = 1_024;
const VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const CHAR_WIDTH_PX = 6;
// Distinct detail lines per cohort: 24 keeps the steady cohort's unique
// strings (titles + details, ~950) inside the text-measure cache; 900 makes
// almost every card's details unique and overflows it.
const STEADY_DETAIL_VARIETY = 24;
const OVERFLOW_DETAIL_VARIETY = 900;
const SOURCE_ID = 'perf-overlay';
const STEADY_RUNS = Object.freeze({ warmup: 200, runs: 15 });
const CHURN_RUNS = Object.freeze({ warmup: 5, runs: 7 });
const BUDGET_MS = Object.freeze({ steady: 1.5, overflow: 1.5, churn: 10 });

/** Variant mix by index: mostly ambient labels and cards, few protected. */
const VARIANT_CYCLE = Object.freeze([
  'label',
  'label',
  'label',
  'card',
  'card',
  'track',
  'label',
  'card',
  'label',
  'tactical',
]);
const ORIGIN = Object.freeze({ x: 6_378_137, y: 0, z: 0 });

/** Canvas2D stub that records nothing; recording would dominate the time. */
function silentContext() {
  const noop = () => {};
  return {
    font: '',
    filter: 'none',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: 'transparent',
    measureText: (text) => ({ width: String(text).length * CHAR_WIDTH_PX }),
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    roundRect: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    drawImage: noop,
    setLineDash: noop,
  };
}

function rawEntry(i, titlePrefix, detailVariety) {
  const kind = VARIANT_CYCLE[i % VARIANT_CYCLE.length];
  const tactical = kind === 'tactical';
  const variant = tactical ? 'card' : kind;
  return {
    id: `${titlePrefix}-${i}`,
    position: ORIGIN,
    variant,
    cardStyle: tactical ? 'tactical' : undefined,
    title: `${titlePrefix} ${i} ${'NORTH HARBOUR'.slice(0, 4 + (i % 9))}`,
    details:
      variant === 'label'
        ? []
        : variant === 'track'
          ? [`${(i % detailVariety) * 10}° · ${i % 30}KT`]
          : [`OPERATOR ${i % detailVariety}`, `${(i % detailVariety) * 25} MW`],
    anchorDot: variant === 'card' && i % 2 === 0,
    selected: i % 97 === 0,
    priority: i % 50,
  };
}

function buildEntries(count, titlePrefix, detailVariety) {
  return Array.from({ length: count }, (_, i) =>
    normalizeOverlayEntry(SOURCE_ID, rawEntry(i, titlePrefix, detailVariety)),
  );
}

/** Distinct strings a frame measures (titles, track text and detail lines). */
function uniqueTextCount(entries) {
  const texts = new Set();
  for (const entry of entries) {
    texts.add(entry.title);
    if (entry.variant === 'track')
      texts.add(`${entry.title} · ${entry.details[0]}`);
    for (const line of entry.details) texts.add(line);
  }
  return texts.size;
}

/** Deterministic screen anchor spread over the viewport. */
function anchorFor(i) {
  return {
    x: 40 + ((i * 197) % (VIEWPORT.width - 80)),
    y: 40 + ((i * 113) % (VIEWPORT.height - 80)),
  };
}

/**
 * One overlay frame: measure + place every candidate, paint the first
 * `paintedCount`. Layout and placement objects are pooled like the host's.
 */
function createFrame(ctx) {
  const layouts = [];
  const placements = [];
  return function frame(entries, paintedCount) {
    let painted = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const layout = measureOverlayEntry(ctx, entry, (layouts[i] ||= {}));
      const anchor = anchorFor(i);
      const variants = placementVariants(
        {
          anchorX: anchor.x,
          anchorY: anchor.y,
          width: layout.w,
          height: layout.h,
          viewportWidth: VIEWPORT.width,
          viewportHeight: VIEWPORT.height,
        },
        (placements[i] ||= []),
      );
      if (i < paintedCount) {
        paintOverlayEntry(ctx, entry, variants[0], 1);
        painted += 1;
      }
    }
    return painted;
  };
}

const STEADY_ENTRIES = buildEntries(
  CANDIDATE_COUNT,
  'SITE',
  STEADY_DETAIL_VARIETY,
);
const OVERFLOW_ENTRIES = buildEntries(
  CANDIDATE_COUNT,
  'SITE',
  OVERFLOW_DETAIL_VARIETY,
);

test('overlay frame measures, places and paints the synthetic cohort', () => {
  clearWorldOverlayTextMeasureCache();
  const frame = createFrame(silentContext());
  assert.equal(frame(STEADY_ENTRIES, PAINTED_COUNT), PAINTED_COUNT);
  const variants = new Set(STEADY_ENTRIES.map((entry) => entry.variant));
  assert.deepEqual([...variants].sort(), ['card', 'label', 'track']);
  assert.ok(STEADY_ENTRIES.some((entry) => entry.cardStyle === 'tactical'));
  assert.ok(uniqueTextCount(STEADY_ENTRIES) < FORMER_CACHE_LIMIT);
  assert.ok(uniqueTextCount(OVERFLOW_ENTRIES) > FORMER_CACHE_LIMIT);
  assert.ok(
    getWorldOverlayTextMeasureCacheSize() <= TEXT_MEASURE_GENERATION_SIZE * 2,
  );
  clearWorldOverlayTextMeasureCache();
});

test(
  `${CANDIDATE_COUNT}-candidate overlay text frame stays within budget`,
  perfBudgetTestOptions(),
  (t) => {
    clearWorldOverlayTextMeasureCache();
    const frame = createFrame(silentContext());
    const steady = measureRuns(
      () => frame(STEADY_ENTRIES, PAINTED_COUNT),
      STEADY_RUNS,
    );
    assert.equal(steady.result, PAINTED_COUNT);

    clearWorldOverlayTextMeasureCache();
    const overflowFrame = createFrame(silentContext());
    const overflow = measureRuns(
      () => overflowFrame(OVERFLOW_ENTRIES, PAINTED_COUNT),
      STEADY_RUNS,
    );

    const totalChurnFrames = CHURN_RUNS.warmup + CHURN_RUNS.runs;
    const churnCohorts = Array.from({ length: totalChurnFrames }, (_, pass) =>
      buildEntries(CHURN_TITLE_COUNT, `CHURN${pass}`, OVERFLOW_DETAIL_VARIETY),
    );
    clearWorldOverlayTextMeasureCache();
    const churnFrame = createFrame(silentContext());
    const churn = measureRuns(
      (i) => churnFrame(churnCohorts[i], PAINTED_COUNT),
      CHURN_RUNS,
    );
    assert.ok(
      getWorldOverlayTextMeasureCacheSize() <= TEXT_MEASURE_GENERATION_SIZE * 2,
    );
    clearWorldOverlayTextMeasureCache();

    const timings = { steady, overflow, churn };
    assertWithinBudgets(t, timings, BUDGET_MS);
  },
);
