import assert from 'node:assert/strict';
import test from 'node:test';

import { createSharedTicker } from './sharedTicker.js';

function page(hidden = false) {
  return Object.assign(new EventTarget(), { hidden });
}

test('one interval serves every subscriber and stops with the last one', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const visibility = page();
  const ticker = createSharedTicker({ intervalMs: 1_000, visibility });
  const seen = [];
  const offA = ticker.subscribe(() => seen.push('a'));
  const offB = ticker.subscribe(() => seen.push('b'));
  assert.equal(ticker.running(), true);
  t.mock.timers.tick(2_000);
  assert.deepEqual(seen, ['a', 'b', 'a', 'b']);
  offA();
  t.mock.timers.tick(1_000);
  assert.deepEqual(seen.slice(4), ['b']);
  offB();
  assert.equal(ticker.running(), false);
});

test('a hidden page runs no interval; shown again it ticks at once and resumes', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const visibility = page();
  const ticker = createSharedTicker({ intervalMs: 1_000, visibility });
  let ticks = 0;
  const off = ticker.subscribe(() => ticks++);
  visibility.hidden = true;
  visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ticker.running(), false);
  t.mock.timers.tick(120_000);
  assert.equal(ticks, 0);
  visibility.hidden = false;
  visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ticks, 1, 'catch-up tick on return');
  t.mock.timers.tick(1_000);
  assert.equal(ticks, 2);
  off();
});

test('a subscriber that throws does not stop the others', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ticker = createSharedTicker({ intervalMs: 1_000, visibility: page() });
  let ticks = 0;
  const offBad = ticker.subscribe(() => {
    throw new Error('fixture');
  });
  const offGood = ticker.subscribe(() => ticks++);
  t.mock.timers.tick(1_000);
  assert.equal(ticks, 1);
  offBad();
  offGood();
});

test('subscribing while hidden waits for the page to be shown', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const visibility = page(true);
  const ticker = createSharedTicker({ intervalMs: 1_000, visibility });
  let ticks = 0;
  const off = ticker.subscribe(() => ticks++);
  assert.equal(ticker.running(), false);
  visibility.hidden = false;
  visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ticker.running(), true);
  assert.equal(ticks, 1);
  off();
});
