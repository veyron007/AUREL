import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import {
  createLocalSession,
  parseCommand,
  serveOwned,
} from './local-session.mjs';
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
test('launcher accepts only explicit bounded commands and ports', () => {
  assert.deepEqual(parseCommand(['start']), { command: 'start', port: 4173 });
  assert.deepEqual(parseCommand(['status', '--port', '4174']), {
    command: 'status',
    port: 4174,
  });
  for (const args of [
    [],
    ['kill'],
    ['start', '--port', '0'],
    ['start', '--port', '4173oops'],
    ['stop', '--host', '0.0.0.0'],
  ])
    assert.throws(() => parseCommand(args));
});
test('owned launcher starts, authenticates status, stops, and verifies released ports', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aurel-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workerPath = path.join(root, 'worker.mjs');
  await writeFile(
    workerPath,
    `import { serveOwned } from ${JSON.stringify(new URL('./local-session.mjs', import.meta.url).href)};import{createServer}from'node:http';process.once('message',async config=>{await serveOwned({...config,serverFactory:async({server:settings})=>{const httpServer=createServer((req,res)=>res.end('local fixture'));return{listen:()=>new Promise(r=>httpServer.listen(settings.port,settings.host,r)),close:()=>new Promise(r=>httpServer.close(r))}}});});`,
  );
  const port = await freePort(),
    session = createLocalSession({ root, port, workerPath });
  t.after(async () => {
    await session.stop();
    await rm(session.storageDirectory, { recursive: true, force: true });
  });
  assert.ok(!session.storageDirectory.startsWith(root + path.sep));
  assert.equal((await session.status()).running, false);
  const started = await session.start();
  const { stat } = await import('node:fs/promises');
  assert.equal((await stat(session.storageDirectory)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(path.join(session.storageDirectory, 'local-session.json')))
      .mode & 0o777,
    0o600,
  );
  await assert.rejects(
    import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(root, '.gev-cache', 'local-session.json')),
    ),
    { code: 'ENOENT' },
  );
  assert.equal(started.running, true);
  assert.equal(started.port, port);
  assert.equal((await session.start()).running, true);
  const current = await session.status();
  assert.equal(current.running, true);
  const denied = await fetch(`http://127.0.0.1:${current.controlPort}/stop`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong' },
  });
  assert.equal(denied.status, 403);
  assert.equal((await session.status()).running, true);
  const stopped = await session.stop();
  assert.equal(stopped.running, false);
  assert.equal(stopped.portOccupied, false);
  assert.equal(stopped.controlPortOccupied, false);
});
test('foreign listeners are reported and never stopped', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aurel-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const session = createLocalSession({ root, port: server.address().port });
  await assert.rejects(session.start(), /occupied/);
  const stopped = await session.stop();
  assert.equal(stopped.portOccupied, true);
  assert.equal(server.listening, true);
});
test('worker authenticates local control and closes both owned listeners once', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aurel-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await freePort(),
    token = 'a'.repeat(64);
  let closes = 0,
    exited;
  const done = new Promise((resolve) => {
    exited = resolve;
  });
  const owned = await serveOwned({
    root,
    port,
    token,
    serverFactory: async () => ({
      listen: async () => {},
      close: async () => {
        closes++;
      },
    }),
    exit: exited,
  });
  t.after(() => owned.close());
  const url = `http://127.0.0.1:${owned.record.controlPort}`,
    headers = { authorization: `Bearer ${token}` };
  assert.equal((await fetch(url + '/status', { headers })).status, 200);
  assert.equal((await fetch(url + '/wrong', { headers })).status, 404);
  assert.equal(
    (
      await fetch(url + '/status', {
        headers: { ...headers, origin: 'http://evil.test' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(url + '/stop', { method: 'POST', headers })).status,
    200,
  );
  assert.equal(await done, 0);
  await owned.close();
  assert.equal(closes, 1);
});
test('invalid session files and concurrent command locks fail closed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aurel-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  const session = createLocalSession({ root, port: await freePort() });
  await mkdir(session.storageDirectory, { recursive: true, mode: 0o700 });
  t.after(() => rm(session.storageDirectory, { recursive: true, force: true }));
  const file = path.join(session.storageDirectory, 'local-session.json');
  await writeFile(file, '{}');
  await assert.rejects(session.status(), /Invalid local session/);
  await rm(file);
  await writeFile(
    path.join(session.storageDirectory, 'local-session.lock'),
    '',
  );
  await assert.rejects(session.start(), /Another local-session/);
});
