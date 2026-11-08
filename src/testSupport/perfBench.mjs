import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

/**
 * Shared helpers for `*.perf.test.mjs` benchmarks: a seeded PRNG so synthetic
 * inputs never vary between runs, and a warm-then-measure timer that reports
 * the median and maximum of several timed runs.
 */

/** Deterministic mulberry32 PRNG returning floats in [0, 1). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Median of a non-empty list of numbers (does not mutate the input). */
export function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Run `fn(i)` `warmup` times untimed, then `runs` times timed.
 * @returns {{medianMs:number, maxMs:number, minMs:number, result:*}}
 *   `result` is the last timed run's return value, for correctness checks.
 */
export function measureRuns(fn, { warmup = 3, runs = 7 } = {}) {
  for (let i = 0; i < warmup; i++) fn(i);
  const durations = [];
  let result;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    result = fn(warmup + i);
    durations.push(performance.now() - start);
  }
  return {
    medianMs: medianOf(durations),
    maxMs: Math.max(...durations),
    minMs: Math.min(...durations),
    result,
  };
}

/** Async twin of measureRuns for entry points that return promises. */
export async function measureRunsAsync(fn, { warmup = 2, runs = 5 } = {}) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const durations = [];
  let result;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    result = await fn(warmup + i);
    durations.push(performance.now() - start);
  }
  return {
    medianMs: medianOf(durations),
    maxMs: Math.max(...durations),
    minMs: Math.min(...durations),
    result,
  };
}

/** One diagnostic line: `label median=..ms max=..ms budget=..ms`. */
export function formatTiming(label, timing, budgetMs) {
  return `${label}: median=${timing.medianMs.toFixed(2)}ms max=${timing.maxMs.toFixed(2)}ms budget=${budgetMs}ms`;
}

/**
 * Report every timing as a test diagnostic, then assert each median is
 * within its named budget (medians, not maxima, so one GC pause is not a fail).
 */
export function assertWithinBudgets(t, timings, budgets) {
  const entries = Object.entries(timings);
  for (const [name, timing] of entries) {
    t.diagnostic(formatTiming(name, timing, budgets[name]));
  }
  for (const [name, timing] of entries) {
    assert.ok(
      timing.medianMs <= budgets[name],
      `${name}: ${timing.medianMs.toFixed(2)}ms median exceeds ${budgets[name]}ms`,
    );
  }
}
