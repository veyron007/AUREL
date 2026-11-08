import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';

import { adsbdbProxy } from './enrichment.js';

function isolateDisk(t, snapshot = null) {
  t.mock.method(fsp, 'readFile', async () => {
    if (!snapshot) throw Error('no cache');
    return JSON.stringify(snapshot);
  });
  t.mock.method(fsp, 'mkdir', async () => {});
  t.mock.method(fsp, 'writeFile', async () => {});
}

function install() {
  let handler;
  adsbdbProxy().configureServer({
    middlewares: { use: (_route, fn) => (handler = fn) },
  });
  return async (url, { method = 'GET', body = null } = {}) => {
    const req = body === null ? Readable.from([]) : Readable.from([body]);
    Object.assign(req, { url, method, headers: {} });
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end(text) {
        this.body = text;
      },
    };
    await handler(req, res);
    return { status: res.status, json: JSON.parse(res.body) };
  };
}

function aircraftJson(hex) {
  return {
    response: {
      aircraft: {
        icao_type: `T${hex.slice(0, 3)}`,
        manufacturer: 'Maker',
        type: hex,
        registration: `R-${hex}`,
      },
    },
  };
}

test('one batch answers every aircraft the per-aircraft route would', async (t) => {
  isolateDisk(t);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const hex = String(url).split('/').at(-1);
    if (hex === '00000f') return new Response('', { status: 404 });
    return Response.json(aircraftJson(hex));
  });
  const hexes = ['abc123', 'ABC124', '00000f'];
  const request = install();
  const batch = await request('/types', {
    method: 'POST',
    body: JSON.stringify({ hexes }),
  });
  assert.equal(batch.status, 200);
  assert.deepEqual(batch.json.pending, []);
  const single = install();
  for (const hex of hexes) {
    const one = await single(`/type/${hex}`);
    assert.deepEqual(batch.json.results[hex.toLowerCase()], one.json);
  }
});

test('cached aircraft are answered without any upstream request', async (t) => {
  const now = Date.now();
  isolateDisk(t, {
    routes: {},
    aircraft: {
      abc123: {
        at: now,
        data: { typeCode: 'B738', typeName: 'B', registration: 'R' },
      },
      abc124: { at: now, data: null },
    },
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new Error('must not fetch');
  });
  const batch = await install()('/types', {
    method: 'POST',
    body: JSON.stringify({ hexes: ['abc123', 'abc124'] }),
  });
  assert.equal(calls, 0);
  assert.deepEqual(batch.json, {
    results: {
      abc123: {
        found: true,
        typeCode: 'B738',
        typeName: 'B',
        registration: 'R',
      },
      abc124: { found: false },
    },
    pending: [],
  });
});

test('the batch route validates method and body', async (t) => {
  isolateDisk(t);
  const request = install();
  assert.equal((await request('/types')).status, 405);
  for (const body of ['nope', '{"hexes":["xyz"]}', 'x'.repeat(9000)])
    assert.equal(
      (await request('/types', { method: 'POST', body })).status,
      400,
    );
});

test('keys still waiting upstream come back as pending, not as misses', async (t) => {
  isolateDisk(t);
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = install()('/types', {
    method: 'POST',
    body: JSON.stringify({ hexes: ['abc123'] }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(5_000);
  const batch = await pending;
  assert.deepEqual(batch.json, { results: {}, pending: ['abc123'] });
});
