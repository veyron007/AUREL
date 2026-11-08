import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { usePlannerStore } from '../../stores/planner.js';
import PlannerPanelBody from './PlannerPanelBody.vue';
import { panelWithBody } from '../../../testSupport/panelBody.mjs';

const PlannerPanel = panelWithBody('planner-panel', PlannerPanelBody);

function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = usePlannerStore(pinia);
  const calls = [];
  store.connect(
    Object.fromEntries(
      ['analyze', 'cancel', 'save', 'focusSample'].map((name) => [
        name,
        (...args) => {
          calls.push([name, ...args]);
          return true;
        },
      ]),
    ),
  );
  const app = createApp(PlannerPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { store, calls };
}
const empty = {
  status: 'empty',
  busy: false,
  error: null,
  snapshot: null,
  canSave: false,
};

test('planning is explicit with labelled local departure and timezone controls', async (t) => {
  const { calls } = mount(t, empty);
  await nextTick();
  assert.equal(calls.length, 0);
  assert.match(
    document.querySelector('#planner-panel').textContent,
    /route|place/i,
  );
  const departure = document.querySelector('#planner-departure');
  assert.ok(document.querySelector('label[for="planner-departure"]'));
  assert.ok(document.querySelector('label[for="planner-timezone"]'));
  departure.value = '2026-11-10T07:30';
  departure.dispatchEvent(new Event('input', { bubbles: true }));
  document
    .querySelector('#planner-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, [
    [
      'analyze',
      { localDateTime: '2026-11-10T07:30', timeZone: 'Asia/Kolkata' },
    ],
  ]);
});

test('loading work can be cancelled and prevents another analysis or premature save', async (t) => {
  const { calls } = mount(t, { ...empty, status: 'loading', busy: true });
  await nextTick();
  assert.equal(document.querySelector('#planner-analyze').disabled, true);
  assert.equal(document.querySelector('#planner-save').disabled, true);
  document.querySelector('#planner-cancel').click();
  assert.deepEqual(calls, [['cancel']]);
});

test('analysis errors are announced without removing departure values', async (t) => {
  const { store } = mount(t, empty);
  await nextTick();
  const departure = document.querySelector('#planner-departure');
  departure.value = '2026-11-10T07:30';
  departure.dispatchEvent(new Event('input', { bubbles: true }));
  store.publish({
    ...empty,
    status: 'error',
    error: 'Weather source unavailable',
  });
  await nextTick();
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /Weather source unavailable/,
  );
  assert.equal(departure.value, '2026-11-10T07:30');
});

const snapshot = {
  version: 1,
  capturedAt: '2026-11-10T00:00:00.000Z',
  departureAt: '2026-11-10T02:00:00.000Z',
  timeZone: 'Asia/Kolkata',
  localDate: '2026-11-10',
  route: { name: 'Dehradun to Mussoorie', distanceM: 32000, durationS: 3600 },
  profile: {
    datum: 'EGM2008',
    samples: [
      { distanceM: 0, lat: 30, lon: 78, elevationM: 650 },
      { distanceM: 10000, lat: 30.1, lon: 78, elevationM: null },
      { distanceM: 20000, lat: 30.2, lon: 78, elevationM: 1200 },
      { distanceM: 32000, lat: 30.4, lon: 78, elevationM: 1950 },
    ],
    minM: 650,
    maxM: 1950,
    sampleSpacingM: 10000,
    resolutionM: null,
    complete: false,
    sourceId: 'terrain',
    sourceLabel: 'Terrain model',
    retrievedAt: '2026-11-10T00:00:00.000Z',
    attribution: 'Model attribution',
    license: null,
    link: null,
  },
  daylight: {
    sunrise: '2026-11-10T01:10:00.000Z',
    sunset: '2026-11-10T12:00:00.000Z',
    civilDawn: null,
    civilDusk: null,
    daylightSeconds: 39000,
    polarState: 'normal',
    method: 'Solar position calculation',
  },
  checkpoints: [],
  fireContext: null,
};

test('profile gaps remain gaps and keyboard sample controls delegate map focus', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    status: 'partial',
    canSave: true,
    snapshot,
  });
  await nextTick();
  assert.equal(document.querySelectorAll('.planner-profile-path').length, 1);
  assert.equal(document.querySelectorAll('.planner-profile-point').length, 1);
  const rows = [
    ...document.querySelectorAll('.planner-profile-table tbody tr'),
  ];
  assert.equal(rows.length, 4);
  assert.match(rows[1].textContent, /Unknown/);
  assert.match(
    document.querySelector('.planner-profile').textContent,
    /EGM2008/,
  );
  const sample = document.querySelector('#planner-sample');
  sample.value = '2';
  sample.dispatchEvent(new Event('input', { bubbles: true }));
  assert.deepEqual(calls, [['focusSample', 2]]);
  document.querySelector('#planner-save').click();
  assert.deepEqual(calls.at(-1), ['save']);
});

test('unknown route duration and missing terrain stay explicit without invented precision', async (t) => {
  mount(t, {
    ...empty,
    status: 'partial',
    snapshot: {
      ...snapshot,
      route: { ...snapshot.route, durationS: null },
      profile: null,
    },
  });
  await nextTick();
  assert.match(
    document.querySelector('.planner-summary').textContent,
    /Estimated travel timeUnknown/,
  );
  assert.match(
    document.querySelector('.planner-profile').textContent,
    /No terrain profile/,
  );
  assert.equal(document.querySelector('.planner-profile-path'), null);
  assert.match(
    document.querySelector('.planner-daylight').textContent,
    /01:10:00 UTC/,
  );
});

test('checkpoint cards render model units, UTC validity and stale status without station claims', async (t) => {
  const weather = {
    state: 'stale',
    sourceLabel: 'Open-Meteo weather models',
    resolutionM: null,
    timeResolutionSeconds: 3600,
    nativeTimeResolutionSeconds: null,
    hours: [
      {
        time: '2026-11-10T02:00:00.000Z',
        temperatureC: 15,
        precipitationMm: null,
        precipitationProbabilityPct: 35,
        windSpeedMps: 2.5,
        windGustMps: 6,
      },
    ],
    units: {
      temperatureC: '°C',
      precipitationMm: 'mm',
      precipitationProbabilityPct: '%',
      windSpeedMps: 'm/s',
      windGustMps: 'm/s',
    },
    retrievedAt: '2026-11-09T23:00:00.000Z',
    issuedAt: null,
    validFrom: '2026-11-10T02:00:00.000Z',
    validTo: '2026-11-10T03:00:00.000Z',
    attribution: 'Open-Meteo',
    license: 'CC BY 4.0',
  };
  const airQuality = {
    ...weather,
    state: 'ready',
    sourceLabel: 'CAMS global air-quality model',
    resolutionM: 45000,
    nativeTimeResolutionSeconds: 10800,
    hours: [
      { time: '2026-11-10T02:00:00.000Z', pm25: 22.5, pm10: 40, usAqi: 75 },
    ],
    units: { pm25: 'μg/m³', pm10: 'μg/m³', usAqi: 'US AQI' },
  };
  mount(t, {
    ...empty,
    status: 'partial',
    snapshot: {
      ...snapshot,
      checkpoints: [
        {
          lat: 30.3,
          lon: 78.1,
          distanceM: 0,
          context: { weather, airQuality },
        },
      ],
    },
  });
  await nextTick();
  const content = document.querySelector('.planner-checkpoints').textContent;
  assert.match(content, /15 °C/);
  assert.match(content, /2.5 m\/s/);
  assert.match(content, /22.5 μg\/m³/);
  assert.match(content, /Stale/);
  assert.match(content, /45,000 m/);
  assert.match(content, /180 min/);
  assert.match(content, /Issue timeUnknown/);
  assert.match(content, /PrecipitationUnknown/);
  assert.match(content, /not a nearby station reading/);
});

test('empty thermal detections keep the time window and do not imply safety', async (t) => {
  mount(t, {
    ...empty,
    status: 'ready',
    snapshot: {
      ...snapshot,
      fireContext: {
        status: 'ok',
        source: 'NASA FIRMS',
        fetchedAt: Date.parse('2026-11-10T00:00:00.000Z'),
        window: {
          start: '2026-11-09T00:00:00.000Z',
          end: '2026-11-10T00:00:00.000Z',
        },
        bounds: { west: 77.9, south: 30, east: 78.2, north: 30.5 },
        sources: [],
        count: 0,
        matchedCount: 0,
        truncated: false,
        observations: [],
        limitations: [],
      },
    },
  });
  await nextTick();
  const content = document.querySelector('.planner-fire-context').textContent;
  assert.match(content, /NASA FIRMS/);
  assert.match(content, /Missing detections do not establish safety/);
  assert.match(content, /2026-11-09 00:00:00 UTC/);
});

test('planning scope is explicit and route mode and endpoints remain visible', async (t) => {
  const { store, calls } = mount(t, {
    ...empty,
    scope: 'place',
    hasPlace: true,
    hasRoute: true,
    routeSummary: {
      mode: 'walk',
      distanceM: 2500,
      from: { lat: 30.3, lon: 78.1 },
      to: { lat: 30.4, lon: 78.2 },
    },
  });
  store.connect({ setScope: (scope) => calls.push(['scope', scope]) });
  await nextTick();
  assert.equal(document.querySelector('#planner-scope-place').checked, true);
  const route = document.querySelector('#planner-scope-route');
  route.checked = true;
  route.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual(calls, [['scope', 'route']]);
  store.publish({
    ...empty,
    scope: 'route',
    hasPlace: false,
    hasRoute: true,
    routeSummary: {
      mode: 'walk',
      distanceM: 2500,
      from: { lat: 30.3, lon: 78.1 },
      to: { lat: 30.4, lon: 78.2 },
    },
  });
  await nextTick();
  assert.equal(document.querySelector('#planner-scope-place').disabled, true);
  assert.match(
    document.querySelector('.planner-route-summary').textContent,
    /walk/,
  );
  assert.match(
    document.querySelector('.planner-route-summary').textContent,
    /30.3000/,
  );
});

test('successful explicit analysis reveals results, collapses settings and preserves a keyboard edit path', async (t) => {
  const { store } = mount(t, empty);
  await nextTick();
  const scrolls = [];
  const container = document.querySelector('.planner-panel-inner');
  container.scrollTo = (options) => scrolls.push(options);
  container.scrollTop = 50;
  container.getBoundingClientRect = () => ({ top: 100 });
  document.querySelector('.planner-result-actions').getBoundingClientRect =
    () => ({ top: 400 });
  document.querySelector(
    '#planner-panel .ui-panel__head',
  ).getBoundingClientRect = () => ({ height: 68 });
  const oldMatchMedia = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  t.after(() => {
    window.matchMedia = oldMatchMedia;
  });
  store.connect({
    analyze: async () => {
      store.publish({
        ...empty,
        status: 'ready',
        snapshot: { ...snapshot },
        canSave: true,
      });
      return true;
    },
  });
  const input = document.querySelector('#planner-departure');
  input.value = '2026-11-10T07:30';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const button = document.querySelector('#planner-analyze');
  button.focus();
  document
    .querySelector('#planner-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.querySelector('#planner-settings').open, false);
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].behavior, 'auto');
  assert.equal(
    scrolls[0].top,
    270,
    'result controls clear the visible sticky header',
  );
  assert.equal(document.activeElement, button);
  assert.equal(button.closest('details'), null);
  assert.equal(document.querySelector('#planner-save').disabled, false);
  document.querySelector('#planner-settings').open = true;
  document
    .querySelector('#planner-settings')
    .dispatchEvent(new Event('toggle'));
  await nextTick();
  assert.equal(input.value, '2026-11-10T07:30');
  document.querySelector(
    '#planner-panel .ui-panel__head',
  ).getBoundingClientRect = () => ({ height: 0 });
  document
    .querySelector('#planner-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scrolls.length, 2);
  assert.equal(
    scrolls[1].top,
    338,
    'hidden mobile titles reserve no empty header space',
  );
});

test('background snapshot presentation and failed analysis do not scroll the reader', async (t) => {
  const { store } = mount(t, empty);
  await nextTick();
  const scrolls = [];
  document.querySelector('.planner-panel-inner').scrollTo = (options) =>
    scrolls.push(options);
  store.publish({ ...empty, status: 'ready', snapshot, canSave: true });
  await nextTick();
  assert.equal(scrolls.length, 0);
  store.publish(empty);
  await nextTick();
  store.connect({
    analyze: async () => {
      store.publish({ ...empty, status: 'error', error: 'Unavailable' });
      return false;
    },
  });
  document
    .querySelector('#planner-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
  await nextTick();
  assert.equal(document.querySelector('#planner-settings').open, true);
  assert.equal(scrolls.length, 0);
});

test('an in-progress local save has no misleading cancel action', async (t) => {
  mount(t, { ...empty, status: 'ready', busy: true, canSave: false, snapshot });
  await nextTick();
  assert.equal(document.querySelector('#planner-cancel'), null);
  assert.equal(document.querySelector('#planner-save').disabled, true);
});
