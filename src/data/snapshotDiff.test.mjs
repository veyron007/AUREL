import assert from 'node:assert/strict';
import test from 'node:test';

import { planKeyedUpdate, snapshotSignature } from './snapshotDiff.js';

const keyOf = (row) => row.id;

test('the signature ignores row order and changes with any field', () => {
  const a = [
    { id: 'b', mag: 3 },
    { id: 'a', mag: 4 },
  ];
  const b = [
    { id: 'a', mag: 4 },
    { id: 'b', mag: 3 },
  ];
  assert.equal(snapshotSignature(a, keyOf), snapshotSignature(b, keyOf));
  assert.notEqual(
    snapshotSignature(a, keyOf),
    snapshotSignature(
      [
        { id: 'a', mag: 4 },
        { id: 'b', mag: 3.1 },
      ],
      keyOf,
    ),
  );
  assert.notEqual(
    snapshotSignature(a, keyOf),
    snapshotSignature([{ id: 'a', mag: 4 }], keyOf),
  );
});

test('a keyed update keeps unchanged items and rebuilds only changed or new ones', () => {
  const previous = new Map([
    ['a', { signature: JSON.stringify({ id: 'a', mag: 4 }), item: 'A' }],
    ['b', { signature: JSON.stringify({ id: 'b', mag: 3 }), item: 'B' }],
    ['c', { signature: JSON.stringify({ id: 'c', mag: 2 }), item: 'C' }],
  ]);
  const plan = planKeyedUpdate(
    previous,
    [
      { id: 'd', mag: 5 },
      { id: 'b', mag: 3.5 },
      { id: 'a', mag: 4 },
    ],
    keyOf,
  );
  assert.deepEqual(
    plan.order.map((step) => [step.key, step.previous?.item ?? null]),
    [
      ['d', null],
      ['b', null],
      ['a', 'A'],
    ],
  );
  assert.deepEqual(
    plan.drop.map((entry) => entry.item),
    ['B', 'C'],
  );
});
