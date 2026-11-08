import assert from 'node:assert/strict';
import test from 'node:test';

import { createFlightSource } from './standalone.js';

test('the flights source posts a type batch and validates the reply', async () => {
  const calls = [];
  const source = createFlightSource({
    fetchImpl: async (url, init) => {
      calls.push([url, init.method, JSON.parse(init.body)]);
      return Response.json({
        results: { abc123: { found: true, typeCode: 'B738' }, bad: 'x' },
        pending: ['abc124', 7],
      });
    },
  });
  const reply = await source.getTypeBatch(['abc123', 'abc124']);
  assert.deepEqual(calls, [
    ['/api/adsbdb/types', 'POST', { hexes: ['abc123', 'abc124'] }],
  ]);
  assert.deepEqual(reply, {
    results: { abc123: { found: true, typeCode: 'B738' } },
    pending: ['abc124'],
  });
});

test('a failed type batch rejects so the caller drops it silently', async () => {
  const source = createFlightSource({
    fetchImpl: async () => Response.json({ error: 'x' }, { status: 500 }),
  });
  await assert.rejects(source.getTypeBatch(['abc123']));
});
