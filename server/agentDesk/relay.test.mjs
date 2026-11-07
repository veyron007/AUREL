import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAgentDeskClient } from './client.js';
import { createAgentDeskMiddleware } from './plugin.js';
import { createAgentDeskRelay, isRelayAnswer } from './relay.js';

const SESSION = 'session-abcdefghijklmnop';
const OK = { ok: true, result: { place_id: 'p' } };

test('with no tab polling, a request is refused with no_app_session at once', async () => {
  const relay = createAgentDeskRelay();
  const answer = await relay.submit({
    op: 'fieldbook_add_place',
    args: {},
    client: 'c',
  });
  assert.equal(answer.refusal.code, 'no_app_session');
});

test('a polling tab receives the request and its answer returns to the agent', async () => {
  const relay = createAgentDeskRelay();
  const polled = relay.poll(SESSION);
  const submitted = relay.submit({
    op: 'fieldbook_add_place',
    args: { a: 1 },
    client: 'claude-code',
  });
  const request = await polled;
  assert.deepEqual(
    { op: request.op, args: request.args, client: request.client },
    { op: 'fieldbook_add_place', args: { a: 1 }, client: 'claude-code' },
  );
  assert.equal(
    relay.complete('session-someone-else-xx', request.id, OK),
    false,
  );
  assert.equal(relay.complete(SESSION, request.id, OK), true);
  assert.deepEqual(await submitted, OK);
  assert.equal(relay.complete(SESSION, request.id, OK), false);
});

test('an unreadable answer from the tab becomes a typed refusal', async () => {
  const relay = createAgentDeskRelay();
  const polled = relay.poll(SESSION);
  const submitted = relay.submit({ op: 'x', args: {}, client: 'c' });
  const request = await polled;
  relay.complete(SESSION, request.id, {
    ok: false,
    refusal: { code: 'made_up', message: 'x' },
  });
  assert.equal((await submitted).refusal.code, 'unsupported');
  assert.equal(isRelayAnswer(OK), true);
  assert.equal(isRelayAnswer({ ok: true }), false);
});

test('a request the tab does not answer in time is refused with timeout', async () => {
  const timers = [];
  const relay = createAgentDeskRelay({
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  relay.poll(SESSION);
  const submitted = relay.submit({ op: 'render_view', args: {}, client: 'c' });
  timers.find((timer) => timer.ms === 30000).fn();
  assert.equal((await submitted).refusal.code, 'timeout');
});

test('a tab that stopped polling is gone after the presence window', async () => {
  let clock = 0;
  const relay = createAgentDeskRelay({ now: () => clock, pollMs: 5 });
  await relay.poll(SESSION);
  clock = 36000;
  const answer = await relay.submit({ op: 'x', args: {}, client: 'c' });
  assert.equal(answer.refusal.code, 'no_app_session');
  assert.equal(await relay.poll('bad id'), null);
});

async function serve(middleware) {
  const server = createServer((req, res) => {
    if (!req.url.startsWith('/api/agent-desk')) return res.end();
    req.url = req.url.slice('/api/agent-desk'.length) || '/';
    middleware(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

test('the HTTP relay refuses page-origin submissions, non-page answers and foreign origins', async () => {
  const relay = createAgentDeskRelay({ pollMs: 50 });
  const { base, close } = await serve(
    createAgentDeskMiddleware({ relay, env: {} }),
  );
  try {
    const json = { 'Content-Type': 'application/json' };
    const fromPage = await fetch(`${base}/api/agent-desk/requests`, {
      method: 'POST',
      headers: { ...json, Origin: base },
      body: JSON.stringify({ op: 'x', client: 'c' }),
    });
    assert.equal(fromPage.status, 403);
    const foreign = await fetch(`${base}/api/agent-desk/requests`, {
      method: 'POST',
      headers: { ...json, Origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(foreign.status, 403);
    const agent = await fetch(`${base}/api/agent-desk/requests`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ op: 'x', args: {}, client: 'c' }),
    });
    assert.equal((await agent.json()).refusal.code, 'no_app_session');
    const answerWithoutPage = await fetch(`${base}/api/agent-desk/results`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ session: SESSION, id: 'x', answer: OK }),
    });
    assert.equal(answerWithoutPage.status, 403);
    const badSession = await fetch(`${base}/api/agent-desk/next?session=x`);
    assert.equal(badSession.status, 400);
    const idle = await fetch(`${base}/api/agent-desk/next?session=${SESSION}`);
    assert.equal(idle.status, 204);
  } finally {
    await close();
  }
});

test('the MCP-side client carries a request through the HTTP relay to a polling page', async () => {
  const relay = createAgentDeskRelay();
  const { base, close } = await serve(
    createAgentDeskMiddleware({ relay, env: {} }),
  );
  try {
    const client = createAgentDeskClient({
      fetchImpl: (path, init) => fetch(new URL(path, base), init),
      clientName: () => 'Claude Code',
    });
    const next = fetch(`${base}/api/agent-desk/next?session=${SESSION}`).then(
      (response) => response.json(),
    );
    const answer = client.request('fieldbook_add_place', { name: 'x' });
    const request = await next;
    assert.equal(request.client, 'claude-code');
    const posted = await fetch(`${base}/api/agent-desk/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ session: SESSION, id: request.id, answer: OK }),
    });
    assert.equal(posted.status, 200);
    assert.deepEqual(await answer, OK);
  } finally {
    await close();
  }
});

test('the client turns an unreachable or older server into no_app_session', async () => {
  const down = createAgentDeskClient({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    clientName: () => 'c',
  });
  assert.equal((await down.request('x', {})).refusal.code, 'no_app_session');
  const old = createAgentDeskClient({
    fetchImpl: async () => new Response('Not found', { status: 404 }),
    clientName: () => 'c',
  });
  const answer = await old.request('x', {});
  assert.equal(answer.refusal.code, 'no_app_session');
  assert.match(answer.refusal.message, /404/);
});

test('the Vite plugin mounts the relay and returns no post hook', async () => {
  const { agentDeskPlugin } = await import('./plugin.js');
  const mounted = [];
  const plugin = agentDeskPlugin();
  const result = plugin.configureServer({
    middlewares: { use: (...args) => mounted.push(args) && (() => {}) },
  });
  assert.equal(result, undefined);
  assert.equal(mounted[0][0], '/api/agent-desk');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
