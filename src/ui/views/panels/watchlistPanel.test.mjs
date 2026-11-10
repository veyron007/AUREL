import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useWatchlistsStore } from '../../stores/watchlists.js';
import WatchlistPanelBody from './WatchlistPanelBody.vue';
import { panelWithBody } from '../../../testSupport/panelBody.mjs';

const WatchlistPanel = panelWithBody('watchlist-panel', WatchlistPanelBody);
function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia(),
    store = useWatchlistsStore(pinia),
    calls = [];
  store.connect(
    Object.fromEntries(
      [
        'create',
        'start',
        'stop',
        'remove',
        'clearNotifications',
        'refresh',
      ].map((name) => [
        name,
        (...args) => {
          calls.push([name, ...args]);
          return true;
        },
      ]),
    ),
  );
  const app = createApp(WatchlistPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { store, calls };
}
const empty = {
  loading: false,
  busy: false,
  error: null,
  feedback: null,
  places: [],
  watches: [],
  limitations: [],
  canCreate: true,
};
const watch = {
  id: 'watch-one',
  title: 'Dehradun study area',
  placeName: 'Dehradun',
  bounds: { west: 78, south: 30.2, east: 78.2, north: 30.4 },
  intervalMinutes: 30,
  state: 'stopped',
  reason: null,
  baselinePending: true,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastRetrievedAt: null,
  nextCheckAt: null,
  errorCount: 0,
  coverage: 'unknown',
  sources: [],
  notifications: [],
};

test('saved watch areas never start on mount and creation is an explicit bounded action', async (t) => {
  const { store, calls } = mount(t, empty);
  await nextTick();
  assert.equal(calls.length, 0);
  assert.equal(document.getElementById('watchlist-create').disabled, true);
  store.publish({
    ...empty,
    places: [
      { id: 'p', name: 'Dehradun', available: true, bounds: watch.bounds },
    ],
  });
  await nextTick();
  const place = document.getElementById('watchlist-place');
  place.value = 'p';
  place.dispatchEvent(new Event('change', { bubbles: true }));
  const title = document.getElementById('watchlist-title');
  title.value = 'Morning check';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  document
    .getElementById('watchlist-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, [
    ['create', { placeId: 'p', title: 'Morning check', intervalMinutes: 30 }],
  ]);
});
test('start and stop are deliberate and removal is not triggered by stopping', async (t) => {
  const { store, calls } = mount(t, { ...empty, watches: [watch] });
  await nextTick();
  document.querySelector('[data-watch-start]').click();
  assert.deepEqual(calls, [['start', 'watch-one']]);
  store.publish({ ...empty, watches: [{ ...watch, state: 'checking' }] });
  await nextTick();
  document.querySelector('[data-watch-stop]').click();
  assert.deepEqual(calls.at(-1), ['stop', 'watch-one']);
  assert.equal(
    calls.some(([name]) => name === 'remove'),
    false,
  );
});
test('new occurrences and older first-retrieved observations remain separate with acquisition times', async (t) => {
  mount(t, {
    ...empty,
    watches: [
      {
        ...watch,
        baselinePending: false,
        state: 'running',
        coverage: 'partial',
        lastAttemptAt: '2026-11-07T06:00:00.000Z',
        lastSuccessAt: '2026-11-07T05:00:00.000Z',
        lastRetrievedAt: '2026-11-07T06:00:00.000Z',
        notifications: [
          {
            id: 'notice',
            createdAt: '2026-11-07T06:00:00.000Z',
            newlyOccurredCount: 1,
            newlyRetrievedCount: 3,
            unlistedCount: 0,
            observations: [
              {
                id: 'obs',
                lat: 30.3,
                lon: 78.1,
                acquiredAt: '2026-11-06T20:00:00.000Z',
                source: 'VIIRS',
              },
            ],
          },
        ],
      },
    ],
  });
  await nextTick();
  const text = document.querySelector('.watchlist-notification').textContent;
  assert.match(text, /Newly occurring1/);
  assert.match(text, /Older observations first retrieved3/);
  assert.match(text, /2026-11-06 20:00:00 UTC/);
  assert.match(
    document.querySelector('.watchlist-card').textContent,
    /Source checksPartial/,
  );
});
test('baseline and paused errors cannot look like a successful empty check', async (t) => {
  mount(t, {
    ...empty,
    watches: [
      {
        ...watch,
        state: 'paused-errors',
        coverage: 'unavailable',
        reason: 'Repeated source failures',
        errorCount: 3,
      },
    ],
  });
  await nextTick();
  const text = document.querySelector('.watchlist-card').textContent;
  assert.match(text, /Starting record pending/);
  assert.match(text, /Paused after errors/);
  assert.match(text, /Last successful checkNever checked/);
  assert.match(text, /Repeated source failures/);
  assert.equal(document.querySelector('[data-watch-start]').disabled, false);
});

test('another tab owner cannot be started, stopped or removed from this panel', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    watches: [{ ...watch, state: 'other-tab' }],
  });
  await nextTick();
  for (const selector of [
    '[data-watch-start]',
    '[data-watch-stop]',
    '[data-watch-remove]',
  ]) {
    const button = document.querySelector(selector);
    assert.equal(button.disabled, true);
    button.click();
  }
  assert.equal(calls.length, 0);
});
test('paused monitoring is distinct from unavailable coverage and removal is explicit', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    watches: [{ ...watch, state: 'paused-hidden', coverage: 'unknown' }],
  });
  await nextTick();
  const text = document.querySelector('.watchlist-card').textContent;
  assert.match(text, /Paused while hidden/);
  assert.match(text, /Source checksUnknown/);
  document.querySelector('[data-watch-remove]').click();
  assert.deepEqual(calls, [['remove', 'watch-one']]);
  const intervals = [
    ...document.querySelectorAll('#watchlist-interval option'),
  ].map((option) => Number(option.value));
  assert.ok(intervals.every((value) => value >= 30));
});
