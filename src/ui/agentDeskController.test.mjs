import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinia } from 'pinia';
import { memoryFieldbookRepository } from '../testSupport/fieldKitFakes.mjs';
import {
  AGENT_WRITES_KEY,
  AgentDeskController,
} from './agentDeskController.js';
import { useAgentDeskStore } from './stores/agentDesk.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function controller(options = {}) {
  const store = useAgentDeskStore(createPinia());
  const desk = new AgentDeskController({
    store,
    fieldbook: memoryFieldbookRepository(),
    storage: memoryStorage(),
    fetchImpl: async () => new Response(null, { status: 204 }),
    sleep: () => new Promise(() => {}),
    now: () => Date.parse('2026-11-08T00:30:00.000Z'),
    ...options,
  });
  return { store, desk };
}

test('writes are off by default and the toggle lives in session storage only', () => {
  const storage = memoryStorage();
  const { store, desk } = controller({ storage });
  desk.init();
  assert.equal(store.view.writesAllowed, false);
  store.act('setWritesAllowed', true);
  assert.equal(store.view.writesAllowed, true);
  assert.equal(storage.values.get(AGENT_WRITES_KEY), 'on');
  store.act('setWritesAllowed', false);
  assert.equal(storage.values.has(AGENT_WRITES_KEY), false);
  desk.destroy();
  const resumed = controller({
    storage: memoryStorage({ [AGENT_WRITES_KEY]: 'on' }),
  });
  assert.equal(resumed.desk.writesAllowed, true);
  const broken = controller({
    storage: {
      getItem() {
        throw new Error('blocked');
      },
    },
  });
  assert.equal(broken.desk.writesAllowed, false);
});

test('only the literal "on" turns writes on', () => {
  for (const value of ['true', '1', 'ON', 'yes']) {
    const { desk } = controller({
      storage: memoryStorage({ [AGENT_WRITES_KEY]: value }),
    });
    assert.equal(desk.writesAllowed, false, value);
  }
});

test('handled requests are refused while off, written while on, and logged', async () => {
  const fieldbook = memoryFieldbookRepository();
  const { store, desk } = controller({ fieldbook });
  desk.init();
  const request = {
    id: 'r1',
    op: 'fieldbook_add_place',
    args: { name: 'Lal Tibba', lat: 30.4594, lon: 78.0957 },
    client: 'claude-code',
  };
  const refused = await desk.handle(request);
  assert.equal(refused.refusal.code, 'writes_disabled');
  desk.setWritesAllowed(true);
  const written = await desk.handle(request);
  assert.equal(written.ok, true);
  assert.equal(fieldbook.records.size, 1);
  assert.deepEqual(
    store.view.activity.map((row) => [
      row.op,
      row.client,
      row.outcome,
      row.code,
    ]),
    [
      ['fieldbook_add_place', 'claude-code', 'written', null],
      ['fieldbook_add_place', 'claude-code', 'refused', 'writes_disabled'],
    ],
  );
});

test('the loop polls the relay, answers the request and reports the result', async () => {
  const calls = [];
  let served = false;
  let resolveDone;
  const done = new Promise((resolve) => (resolveDone = resolve));
  const { store, desk } = controller({
    startDelayMs: 0,
    sleep: async (ms, signal) => {
      if (ms > 0)
        await new Promise((resolve) =>
          signal.addEventListener('abort', resolve),
        );
    },
    fetchImpl: async (url, init = {}) => {
      calls.push([
        String(url).replace(/session=\w+/, 'session=S'),
        init.method ?? 'GET',
      ]);
      if (String(url).includes('/next')) {
        if (served) return new Promise(() => {});
        served = true;
        return Response.json({
          id: 'r1',
          op: 'fieldbook_add_place',
          args: { name: 'x', lat: 1, lon: 1 },
          client: 'codex',
        });
      }
      resolveDone(JSON.parse(init.body));
      return Response.json({ accepted: true });
    },
  });
  desk.init();
  const posted = await done;
  assert.equal(posted.id, 'r1');
  assert.equal(posted.answer.refusal.code, 'writes_disabled');
  assert.match(posted.session, /^[0-9a-f]{36}$/);
  assert.deepEqual(calls.slice(0, 2), [
    ['/api/agent-desk/next?session=S', 'GET'],
    ['/api/agent-desk/results', 'POST'],
  ]);
  assert.equal(store.view.connected, true);
  desk.destroy();
});

test('a server without the relay backs off and shows not connected', async () => {
  const waits = [];
  let desk;
  const made = controller({
    startDelayMs: 0,
    sleep: async (ms) => {
      waits.push(ms);
      if (waits.length > 2) desk.destroy();
    },
    fetchImpl: async () => new Response('missing', { status: 404 }),
  });
  desk = made.desk;
  desk.init();
  await desk._running;
  assert.deepEqual(waits.slice(1), [60000, 60000]);
  assert.equal(made.store.view.connected, false);
});

test('destroy stops publishing and releases the control', () => {
  const { store, desk } = controller();
  desk.init();
  desk.destroy();
  desk.destroy();
  assert.equal(store.act('setWritesAllowed', true), undefined);
});
