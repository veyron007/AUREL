// i18n-ignore-file: unit test fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { ChronicleController } from './chronicleController.js';
import { useChronicleStore } from './stores/chronicle.js';
import {
  comparisonInput,
  comparisonSnapshot,
} from '../fieldbook/comparisonFixtures.mjs';

const now = () => Date.parse('2026-11-07T12:00:00Z');
const place = () => ({
  name: 'Dehradun',
  lat: 30.2,
  lon: 78.05,
  extent: [78, 30.1, 78.1, 30.3],
});
const input = (day) => comparisonInput(`2026-11-0${day}`);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function setup(options = {}) {
  let selection = place(),
    changed;
  const calls = [];
  const store = useChronicleStore(createPinia());
  const controller = new ChronicleController({
    now,
    store,
    readSelection: () => selection,
    subscribeSelection: (cb) => {
      changed = cb;
      return () => calls.push('unsubscribe');
    },
    searchImagery: async () => ({
      status: 'ready',
      candidates: [1, 5].map((day) => ({
        id: `day${day}`,
        requestedDate: `2026-11-0${day}`,
        status: 'catalogue',
      })),
    }),
    probeImagery: async (id) => ({
      status: 'present',
      descriptor: input(Number(id.slice(-1))),
    }),
    compareImagery: async () => {
      calls.push('compare');
      return { ok: true, splitPosition: 0.4 };
    },
    clearComparison: () => calls.push('clear'),
    saveComparison: async (subject, snapshot) => {
      calls.push({ subject, snapshot });
      return { projectId: 'p1', comparisonId: 'c1' };
    },
    addChangeNote: async (id, note) => {
      calls.push({ id, note });
      return { id: 'n1', ...note, createdAt: new Date(now()).toISOString() };
    },
    ...options,
  });
  controller.init();
  return {
    controller,
    store,
    calls,
    select(value) {
      selection = value;
      changed();
    },
  };
}
async function selectedPair(env) {
  await env.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  await env.controller.choose({ slot: 'a', id: 'day1' });
  await env.controller.choose({ slot: 'b', id: 'day5' });
}

test('mount and reopen saved metadata never search/probe/compare; store dispatch is detached on destroy', async () => {
  setActivePinia(createPinia());
  const env = setup({
    searchImagery: () => {
      throw Error('automatic fetch');
    },
  });
  assert.equal(env.store.view.status, 'empty');
  const snapshot = comparisonSnapshot();
  assert.equal(
    env.store.act('reopen', { id: 'old', projectId: 'p', snapshot }),
    true,
  );
  assert.equal(env.store.view.comparisonActive, false);
  assert.equal(env.store.view.slots.a.time.date, '2026-01-01');
  assert.deepEqual(env.calls, []);
  env.controller.destroy();
  assert.equal(env.store.act('search', {}), undefined);
  assert.deepEqual(env.calls, ['unsubscribe']);
});

test('search validates place, bounded dates and area before invoking provider', async () => {
  let requests = 0;
  const env = setup({
    searchImagery: async () => {
      requests++;
      return { status: 'ready', candidates: [] };
    },
  });
  env.select(null);
  assert.equal(
    await env.controller.search({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    }),
    false,
  );
  env.select(place());
  for (const window of [
    { startDate: '2026-01-01', endDate: '2026-11-07' },
    { startDate: '2026-11-01', endDate: '2026-11-08' },
    { startDate: '2026-02-30', endDate: '2026-03-01' },
  ])
    assert.equal(await env.controller.search(window), false);
  env.select({ ...place(), extent: [70, 20, 80, 35] });
  assert.equal(
    await env.controller.search({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    }),
    false,
  );
  assert.equal(requests, 0);
  env.select({ lat: 30.2, lon: 78.05 });
  assert.equal(
    await env.controller.search({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    }),
    true,
  );
  assert.equal(requests, 1);
  assert.equal(env.store.view.status, 'unavailable');
});

test('only chosen catalogue entries are probed and missing pixel/time proof cannot compare', async () => {
  const probes = [];
  const env = setup({
    probeImagery: async (id) => {
      probes.push(id);
      return { status: 'empty', descriptor: null };
    },
  });
  await env.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  assert.equal(env.store.view.candidates.length, 2);
  assert.deepEqual(probes, []);
  assert.equal(await env.controller.choose({ slot: 'bad', id: 'day1' }), false);
  assert.equal(
    await env.controller.choose({ slot: 'a', id: 'unknown' }),
    false,
  );
  assert.equal(await env.controller.choose({ slot: 'a', id: 'day1' }), false);
  assert.deepEqual(probes, ['day1']);
  assert.equal(env.store.view.slots.a, null);
  assert.equal(await env.controller.compare(), false);
});

test('pair uses existing owner, stores immutable canonical metadata and classified notes only after durable save', async () => {
  const env = setup();
  await selectedPair(env);
  assert.equal(env.store.view.canCompare, true);
  assert.equal(env.store.view.canSave, false);
  assert.equal(
    await env.controller.addNote({
      text: 'River wider',
      interpretation: 'observed',
    }),
    false,
  );
  assert.equal(await env.controller.compare(), true);
  assert.equal(env.store.view.comparisonActive, true);
  assert.equal(await env.controller.save(), true);
  const save = env.calls.find((call) => call.snapshot);
  assert.equal(save.snapshot.splitPosition, 0.4);
  assert.equal(save.snapshot.method, 'manual-visual');
  assert.equal(Object.isFrozen(env.store.view.slots.a), true);
  assert.equal(
    await env.controller.addNote({
      text: 'Maybe seasonal',
      interpretation: 'certain',
    }),
    false,
  );
  assert.equal(
    await env.controller.addNote({
      text: 'Maybe seasonal',
      interpretation: 'inferred',
    }),
    true,
  );
  assert.equal(env.store.view.lanes.notes[0].interpretation, 'inferred');
  assert.equal(env.store.view.savedComparison.comparisonId, 'c1');
  assert.equal(await env.controller.choose({ slot: 'a', id: 'day5' }), true);
  assert.equal(env.store.view.comparisonActive, false);
  assert.equal(env.store.view.canCompare, false);
  assert.equal(env.store.view.savedComparison, null);
  assert.ok(env.calls.includes('clear'));
});

test('cancellation and selection change reject late searches and probes', async () => {
  const search = deferred();
  let signal;
  const env = setup({
    searchImagery: (_, options) => {
      signal = options.signal;
      return search.promise;
    },
  });
  const running = env.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  assert.equal(env.store.view.canCancel, true);
  env.controller.cancel();
  assert.equal(signal.aborted, true);
  search.resolve({ status: 'ready', candidates: [{ id: 'late' }] });
  assert.equal(await running, false);
  assert.deepEqual(env.store.view.candidates, []);
  const probe = deferred();
  const next = setup({ probeImagery: () => probe.promise });
  await next.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  const choosing = next.controller.choose({ slot: 'a', id: 'day1' });
  next.select({ lat: 28, lon: 77 });
  probe.resolve({ status: 'present', descriptor: input(1) });
  assert.equal(await choosing, false);
  assert.equal(next.store.view.slots.a, null);
  assert.equal(next.store.view.status, 'empty');
});

test('lanes keep retrieval separate and never relabel live observations as imagery dates', async () => {
  const env = setup({
    readEvidence: () => ({
      observations: [
        {
          id: 'o',
          label: 'Air quality',
          applicableTime: null,
          retrievedAt: now(),
        },
      ],
      forecasts: [
        {
          id: 'f',
          label: 'Weather forecast',
          validFrom: '2026-11-07T13:00:00Z',
          validTo: '2026-11-07T14:00:00Z',
        },
      ],
    }),
  });
  await selectedPair(env);
  assert.equal(env.store.view.lanes.observations[0].start, null);
  assert.equal(
    env.store.view.lanes.forecasts[0].start,
    '2026-11-07T13:00:00.000Z',
  );
  assert.equal(
    env.store.view.lanes.imagery[0].start,
    '2026-11-01T00:00:00.000Z',
  );
  assert.equal(env.store.view.lanes.imagery[0].end, '2026-11-02T00:00:00.000Z');
});

test('failed comparison and storage never claim rendered or saved success, save is not cancelable', async () => {
  const env = setup({
    compareImagery: async () => ({ ok: false, reason: 'Date unavailable' }),
  });
  await selectedPair(env);
  assert.equal(await env.controller.compare(), false);
  assert.equal(env.store.view.canSave, false);
  const disk = deferred();
  const next = setup({ saveComparison: () => disk.promise });
  await selectedPair(next);
  await next.controller.compare();
  const save = next.controller.save();
  assert.equal(next.store.view.canCancel, false);
  assert.equal(next.controller.cancel(), false);
  disk.resolve(false);
  assert.equal(await save, false);
  assert.equal(next.store.view.savedComparison, null);
});

test('provider exceptions and malformed proofs are visible without losing unrelated selections', async () => {
  const failing = setup({
    searchImagery: async () => {
      throw Error('offline');
    },
  });
  assert.equal(
    await failing.controller.search({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    }),
    false,
  );
  assert.equal(failing.store.view.status, 'error');
  const absent = setup({ searchImagery: null });
  assert.equal(
    await absent.controller.search({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    }),
    false,
  );
  const malformed = setup({
    probeImagery: async () => ({
      status: 'present',
      descriptor: { ...input(1), time: null },
    }),
  });
  await malformed.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  assert.equal(
    await malformed.controller.choose({ slot: 'a', id: 'day1' }),
    false,
  );
  assert.equal(malformed.store.view.status, 'error');
  assert.equal(malformed.store.view.slots.a, null);
  const failedNote = setup({
    addChangeNote: async () => {
      throw Error('disk full');
    },
  });
  await selectedPair(failedNote);
  await failedNote.controller.compare();
  await failedNote.controller.save();
  assert.equal(
    await failedNote.controller.addNote({
      text: 'A real note',
      interpretation: 'unresolved',
    }),
    false,
  );
  assert.deepEqual(failedNote.store.view.notes, []);
});

test('saving requires the owner still display exactly the selected acquisitions and extent', async () => {
  let displayed = null;
  const env = setup({ readComparison: () => displayed });
  await selectedPair(env);
  displayed = {
    before: input(1),
    after: input(5),
    extent: [78, 30.1, 78.1, 30.3],
    splitPosition: 0.65,
  };
  assert.equal(await env.controller.compare(), true);
  displayed = { ...displayed, after: input(6) };
  assert.equal(await env.controller.save(), false);
  assert.equal(env.store.view.savedComparison, null);
  displayed = { ...displayed, after: input(5) };
  assert.equal(await env.controller.save(), true);
  assert.equal(
    env.calls.find((row) => row.snapshot).snapshot.splitPosition,
    0.65,
  );
  assert.equal(env.controller.clearComparison(), true);
  assert.equal(env.store.view.canSave, false);
});

test('reopening linked metadata strips internal links and preserves explicit acquisition dates', () => {
  const env = setup();
  const snapshot = comparisonSnapshot();
  snapshot.before = { ...snapshot.before, evidenceId: 'e1' };
  snapshot.after = { ...snapshot.after, evidenceId: 'e2' };
  assert.equal(
    env.controller.reopen({
      id: 'c1',
      projectId: 'p1',
      snapshot,
      subject: place(),
      notes: [
        {
          id: 'n1',
          text: 'An inference',
          interpretation: 'inferred',
          createdAt: '2026-11-07T10:00:00Z',
        },
      ],
    }),
    true,
  );
  assert.equal(env.store.view.slots.a.evidenceId, undefined);
  assert.equal(env.store.view.lanes.notes[0].start, '2026-11-07T10:00:00.000Z');
  assert.equal(
    env.controller.reopen({
      snapshot: { ...snapshot, method: 'automatic-difference' },
    }),
    false,
  );
  assert.equal(env.store.view.slots.a.time.date, '2026-01-01');
});

test('partial catalogues sanitize duplicate rows and use already proved rows without extra probes', async () => {
  let probed = 0;
  const env = setup({
    searchImagery: async () => ({
      status: 'partial',
      candidates: [
        null,
        {
          id: 'x',
          label: 'Image',
          requestedDate: '2026-11-01',
          descriptor: input(1),
        },
        { id: 'x' },
        { id: 'bad', descriptor: { time: 'invalid' } },
      ],
    }),
    probeImagery: async () => {
      probed++;
      return { status: 'error' };
    },
  });
  await env.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  assert.equal(env.store.view.status, 'partial');
  assert.equal(env.store.view.candidates.length, 2);
  assert.equal(await env.controller.choose({ slot: 'a', id: 'x' }), true);
  assert.equal(probed, 0);
  assert.equal(await env.controller.choose({ slot: 'b', id: 'bad' }), false);
  assert.equal(probed, 1);
  env.controller.destroy();
  env.controller.destroy();
  assert.equal(await env.controller.choose({ slot: 'a', id: 'x' }), false);
});

test('replaced store owners cannot publish late results or answer actions', async () => {
  const waiting = deferred();
  const old = setup({ searchImagery: () => waiting.promise });
  const running = old.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  const replacement = new ChronicleController({
    store: old.store,
    readSelection: place,
    now,
  });
  replacement.init();
  replacement.init();
  waiting.resolve({ status: 'ready', candidates: [{ id: 'late' }] });
  assert.equal(await running, false);
  assert.equal(old.store.view.status, 'empty');
  old.controller.destroy();
  assert.equal(old.store.owns(replacement.owner, 'search'), true);
});

test('a missing selection notification still cancels late work instead of leaving a busy panel', async () => {
  let selection = place();
  const waiting = deferred();
  const env = setup({
    readSelection: () => selection,
    subscribeSelection: null,
    searchImagery: () => waiting.promise,
  });
  const pending = env.controller.search({
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  selection = { lat: 28, lon: 77 };
  waiting.resolve({ status: 'ready', candidates: [] });
  assert.equal(await pending, false);
  assert.equal(env.store.view.busy, false);
  assert.equal(env.store.view.status, 'empty');
});

test('a renderer mismatch after successful activation releases only its owned comparison', async () => {
  const env = setup({
    readComparison: () => ({
      before: input(1),
      after: input(6),
      extent: [78, 30.1, 78.1, 30.3],
      splitPosition: 0.5,
    }),
  });
  await selectedPair(env);
  assert.equal(await env.controller.compare(), false);
  assert.deepEqual(env.calls, ['compare', 'clear']);
  assert.equal(env.store.view.comparisonActive, false);
});

test('display proof compares semantic input fields regardless of JSON property order', async () => {
  const reorder = (input) => ({
    ...input,
    asset: {
      requestedDate: input.asset.requestedDate,
      productId: input.asset.productId,
      kind: input.asset.kind,
    },
    time: { date: input.time.date, kind: input.time.kind },
  });
  const env = setup({
    readComparison: () => ({
      before: reorder(input(1)),
      after: reorder(input(5)),
      extent: [78, 30.1, 78.1, 30.3],
      splitPosition: 0.5,
    }),
  });
  await selectedPair(env);
  assert.equal(await env.controller.compare(), true);
  assert.equal(await env.controller.save(), true);
});

test('reversed dates publish a visible chronology explanation', async () => {
  const env = setup();
  await selectedPair(env);
  await env.controller.choose({ slot: 'a', id: 'day5' });
  await env.controller.choose({ slot: 'b', id: 'day1' });
  assert.equal(env.store.view.canCompare, false);
  assert.match(env.store.view.pairWarning, /chronological/);
});
