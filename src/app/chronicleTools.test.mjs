import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { useLensStore } from '../ui/stores/lens.js';
import { createChronicleBindings } from './chronicleTools.js';

function fixture() {
  const pinia = createPinia(),
    calls = [];
  let capture = null,
    enabled = false;
  const descriptor = (day) => ({
    asset: { productId: 'S30', requestedDate: day },
  });
  const owner = {
    searchWindow: async (query) => {
      calls.push(['search', query]);
      return {
        candidates: [
          { key: 'S30:2026-10-22', product: 'S30', day: '2026-10-22' },
        ],
        error: null,
      };
    },
    probeCandidate: async (id) => ({
      status: 'present',
      descriptor: descriptor(id.split(':')[1]),
    }),
    restoreComparison: async (query) => {
      calls.push(['compare', query]);
      capture = {
        before: descriptor(query.a.day),
        after: descriptor(query.b.day),
        splitPosition: 0.4,
        extent: [
          query.box.west,
          query.box.south,
          query.box.east,
          query.box.north,
        ],
      };
      return { ok: true };
    },
    captureComparisonInputs: () => capture,
    subscribe: () => () => {},
    setMode: (mode) => calls.push(['mode', mode]),
    setAssignment: (slot, key) => calls.push(['pin', slot, key]),
  };
  const bindings = createChronicleBindings({
    pinia,
    dataManager: {
      layers: new Map([['recent-imagery', { module: owner }]]),
      setEnabled: async () => {
        enabled = true;
        calls.push(['enable']);
      },
      isEnabled: () => enabled,
    },
    fieldbook: {
      saveComparison: async (...args) => {
        calls.push(['save', ...args]);
        return { comparisonId: 'saved' };
      },
      addChangeNote: async () => true,
    },
  });
  return { pinia, calls, owner, bindings, descriptor };
}
test('Chronicle only acquires imagery explicitly and preserves exact acquisition days', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  const result = await f.bindings.searchImagery({
    extent: [78, 30, 78.1, 30.1],
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert.equal(result.candidates[0].descriptor, null);
  assert.equal(f.calls[1][1].fromDay, '2026-10-01');
  assert.equal(
    (await f.bindings.probeImagery('S30:2026-10-22')).descriptor.asset
      .requestedDate,
    '2026-10-22',
  );
  assert.deepEqual(
    await f.bindings.compareImagery({
      extent: [78, 30, 78.1, 30.1],
      a: f.descriptor('2026-10-22'),
      b: f.descriptor('2026-10-25'),
    }),
    { ok: true, splitPosition: 0.4 },
  );
  await f.bindings.saveComparison({}, {});
  assert.equal(f.calls.at(-1)[0], 'save');
  f.bindings.destroy();
  assert.deepEqual(f.calls.slice(-3), [
    ['mode', 'image'],
    ['pin', 'a', null],
    ['pin', 'b', null],
  ]);
  await assert.rejects(f.bindings.searchImagery({}), /abort/i);
});
test('Chronicle disposal detaches selection and never clears a different imagery owner selection', async () => {
  const f = fixture();
  let changes = 0;
  f.bindings.subscribeSelection(() => changes++);
  useLensStore(f.pinia).publish({ selection: { id: 'place' } });
  assert.equal(changes, 1);
  await f.bindings.compareImagery({
    extent: [78, 30, 78.1, 30.1],
    a: f.descriptor('2026-10-22'),
    b: f.descriptor('2026-10-25'),
  });
  f.owner.captureComparisonInputs = () => ({
    before: f.descriptor('2026-09-01'),
    after: f.descriptor('2026-09-02'),
  });
  const count = f.calls.length;
  f.bindings.destroy();
  useLensStore(f.pinia).publish({ selection: null });
  assert.equal(changes, 1);
  assert.equal(f.calls.length, count);
});

test('restored comparisons retain the saved divider position', async () => {
  const f = fixture();
  await f.bindings.compareImagery({
    extent: [78, 30, 78.1, 30.1],
    a: f.descriptor('2026-10-22'),
    b: f.descriptor('2026-10-25'),
    splitPosition: 0.72,
  });
  assert.equal(f.calls.find((row) => row[0] === 'compare')[1].split, 0.72);
  f.bindings.destroy();
});
