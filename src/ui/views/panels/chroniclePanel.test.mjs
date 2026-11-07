import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useChronicleStore } from '../../stores/chronicle.js';
import ChroniclePanel from './ChroniclePanel.vue';

function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = useChronicleStore(pinia);
  const calls = [];
  store.connect(
    Object.fromEntries(
      [
        'search',
        'choose',
        'compare',
        'clearComparison',
        'save',
        'addNote',
        'cancel',
      ].map((name) => [
        name,
        (...args) => {
          calls.push([name, ...args]);
          return true;
        },
      ]),
    ),
  );
  const app = createApp(ChroniclePanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { store, calls };
}
const empty = {
  selection: null,
  status: 'empty',
  busy: false,
  error: null,
  feedback: null,
  candidates: [],
  slots: { a: null, b: null },
  comparisonActive: false,
  canCompare: false,
  canSave: false,
  query: null,
  savedComparison: null,
  notes: [],
  lanes: { imagery: [], observations: [], forecasts: [], notes: [] },
};
const image = (date) => ({
  sourceId: 'nasa-gibs',
  sourceLabel: 'NASA GIBS HLS S30',
  time: { kind: 'day', date },
  retrievedAt: '2026-11-07T06:00:00.000Z',
  probedAt: '2026-11-07T06:00:00.000Z',
  license: 'NASA Earth science data policy',
  attribution: 'NASA GIBS / HLS',
  asset: { kind: 'gibs', productId: 'S30', requestedDate: '2026-11-01' },
  georeference: { crs: 'EPSG:4326', extent: [78, 30, 78.1, 30.4] },
  nativeResolutionM: 30,
  cloudCoverPct: null,
  cloudScope: 'scene',
  granuleIds: [],
  availability: 'present',
  coverage: 'partial',
  alignment: 'unverified',
});

test('Chronicle never searches on mount and needs an explicit dated area query', async (t) => {
  const { store, calls } = mount(t, empty);
  await nextTick();
  assert.equal(calls.length, 0);
  assert.equal(document.querySelector('#chronicle-search').disabled, true);
  store.publish({ ...empty, selection: { name: 'Dehradun' } });
  await nextTick();
  for (const [id, value] of [
    ['chronicle-start', '2026-01-01'],
    ['chronicle-end', '2026-01-31'],
  ]) {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    assert.ok(document.querySelector(`label[for="${id}"]`));
  }
  document
    .getElementById('chronicle-search-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, [
    ['search', { startDate: '2026-01-01', endDate: '2026-01-31' }],
  ]);
});
test('verified dated candidates require explicit A/B assignment and unavailable candidates cannot be chosen', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    selection: { name: 'Dehradun' },
    status: 'ready',
    candidates: [
      {
        id: 'one',
        label: 'January',
        requestedDate: '2026-01-02',
        status: 'present',
        descriptor: image('2026-01-01'),
      },
      {
        id: 'missing',
        label: 'Missing',
        requestedDate: '2026-02-01',
        status: 'empty',
        descriptor: null,
      },
    ],
  });
  await nextTick();
  const pick = document.querySelector('[data-candidate="one"] [data-slot="a"]');
  pick.click();
  assert.deepEqual(calls, [['choose', { slot: 'a', id: 'one' }]]);
  assert.equal(
    document.querySelector('[data-candidate="missing"] [data-slot="b"]')
      .disabled,
    true,
  );
  assert.match(
    document.querySelector('[data-candidate="one"]').textContent,
    /2026-01-01/,
  );
});
test('two-image comparison exposes acquisition time, uncertainty and separate evidence lanes', async (t) => {
  mount(t, {
    ...empty,
    status: 'ready',
    slots: { a: image('2026-01-01'), b: image('2026-10-01') },
    canCompare: true,
    lanes: {
      imagery: [
        {
          id: 'a',
          label: 'January imagery',
          start: '2026-01-01T00:00:00.000Z',
          end: null,
        },
      ],
      observations: [],
      forecasts: [],
      notes: [
        { id: 'n', label: 'Undated interpretation', start: null, end: null },
      ],
    },
  });
  await nextTick();
  assert.equal(document.querySelector('#chronicle-compare').disabled, false);
  assert.match(
    document.querySelector('[data-image-side="a"]').textContent,
    /Acquisition date2026-01-01/,
  );
  assert.match(
    document.querySelector('[data-image-side="a"]').textContent,
    /Scene cloud coverUnknown/,
  );
  assert.match(
    document.querySelector('[data-image-side="a"]').textContent,
    /AlignmentUnverified/,
  );
  assert.equal(document.querySelectorAll('.chronicle-lane').length, 5);
  assert.ok(document.querySelector('[data-lane="precipitation"]'));
  assert.match(
    document.querySelector('[data-lane="notes"]').textContent,
    /Date unknown/,
  );
});
test('failed interpretation save retains text and requires an explicit evidence classification', async (t) => {
  const { store, calls } = mount(t, {
    ...empty,
    status: 'ready',
    savedComparison: { projectId: 'p', comparisonId: 'c' },
  });
  await nextTick();
  store.connect({
    addNote: (note) => {
      calls.push(['note', note]);
      return false;
    },
  });
  const input = document.getElementById('chronicle-note');
  input.value = 'Possible new river channel';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const kind = document.getElementById('chronicle-interpretation');
  kind.value = 'inferred';
  kind.dispatchEvent(new Event('change', { bubbles: true }));
  document
    .getElementById('chronicle-note-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
  assert.deepEqual(calls, [
    [
      'note',
      { text: 'Possible new river channel', interpretation: 'inferred' },
    ],
  ]);
  assert.equal(input.value, 'Possible new river channel');
});

test('catalogue candidates allow an explicit pixel check without claiming acquisition metadata', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    selection: { name: 'Dehradun' },
    status: 'ready',
    candidates: [
      {
        id: 'catalogue',
        label: 'HLS catalogue',
        requestedDate: '2026-02-01',
        status: 'catalogue',
        descriptor: null,
      },
    ],
  });
  await nextTick();
  const row = document.querySelector('[data-candidate="catalogue"]');
  assert.match(row.textContent, /Requested date/);
  assert.doesNotMatch(row.textContent, /Acquisition date/);
  const button = row.querySelector('[data-slot="b"]');
  assert.equal(button.disabled, false);
  button.click();
  assert.deepEqual(calls, [['choose', { slot: 'b', id: 'catalogue' }]]);
});

test('reopened evidence renders its dates without searching or opening a map comparison', async (t) => {
  const { calls } = mount(t, {
    ...empty,
    status: 'saved',
    savedComparison: { projectId: 'p', comparisonId: 'c' },
    slots: { a: image('2026-01-01'), b: image('2026-10-01') },
    canCompare: true,
  });
  await nextTick();
  assert.equal(calls.length, 0);
  assert.equal(document.querySelectorAll('#chronicle-panel img').length, 0);
  document.querySelector('#chronicle-compare').click();
  assert.deepEqual(calls, [['compare']]);
});
test('only cancellable source work exposes Cancel and failures preserve the chosen pair', async (t) => {
  const { store, calls } = mount(t, {
    ...empty,
    status: 'probing',
    busy: true,
    canCancel: true,
    slots: { a: image('2026-01-01'), b: null },
  });
  await nextTick();
  const cancel = [...document.querySelectorAll('#chronicle-panel button')].find(
    (button) => button.textContent.trim() === 'Cancel',
  );
  assert.ok(cancel);
  cancel.click();
  assert.deepEqual(calls, [['cancel']]);
  store.publish({
    ...empty,
    status: 'error',
    error: 'Pixels unavailable for this date',
    slots: { a: image('2026-01-01'), b: null },
  });
  await nextTick();
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /Pixels unavailable/,
  );
  assert.match(
    document.querySelector('[data-image-side="a"]').textContent,
    /2026-01-01/,
  );
  store.publish({
    ...empty,
    status: 'saved',
    busy: true,
    canCancel: false,
    savedComparison: { projectId: 'p', comparisonId: 'c' },
  });
  await nextTick();
  assert.equal(
    [...document.querySelectorAll('#chronicle-panel button')].some(
      (button) => button.textContent.trim() === 'Cancel',
    ),
    false,
  );
});

test('invalid pair warning explains why comparison is disabled without labelling either side earlier', async (t) => {
  mount(t, {
    ...empty,
    slots: { a: image('2026-10-01'), b: image('2026-01-01') },
    canCompare: false,
    pairWarning:
      'Choose two verified acquisitions in chronological order before comparing.',
  });
  await nextTick();
  assert.match(
    document.querySelector('.chronicle-pair-warning').textContent,
    /chronological order/,
  );
  assert.equal(document.getElementById('chronicle-compare').disabled, true);
  assert.equal(
    document.querySelector('[data-image-side="a"] h3').textContent,
    'Image A',
  );
  assert.equal(
    document.querySelector('[data-image-side="b"] h3').textContent,
    'Image B',
  );
});
