#!/usr/bin/env node
/** Project-owned loopback launcher. Never signals a PID discovered by name or port. */
import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  open,
  realpath,
  chmod,
  lstat,
} from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
const SCRIPT = fileURLToPath(import.meta.url),
  ROOT = path.resolve(path.dirname(SCRIPT), '..');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const projectId = (root) => createHash('sha256').update(root).digest('hex');
const validPort = (value) =>
  Number.isInteger(value) && value > 0 && value < 65536;
export function parseCommand(args) {
  const [command, ...rest] = args;
  if (
    !['start', 'stop', 'status'].includes(command) ||
    !(
      rest.length === 0 ||
      (rest.length === 2 && rest[0] === '--port' && /^\d+$/.test(rest[1]))
    )
  )
    throw Error('Use start|stop|status [--port 4173].');
  const port = rest.length ? Number(rest[1]) : 4173;
  if (!validPort(port)) throw Error('Invalid local port.');
  return { command, port };
}
export function portOccupied(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(true));
  });
}
function validRecord(value, root) {
  if (
    !value ||
    value.version !== 1 ||
    value.projectId !== projectId(root) ||
    !validPort(value.port) ||
    !validPort(value.controlPort) ||
    !Number.isInteger(value.pid) ||
    value.pid < 1 ||
    !/^[a-f0-9]{64}$/.test(value.token)
  )
    throw Error('Invalid local session record; preserved for inspection.');
  return value;
}
async function request(record, route) {
  const response = await fetch(
    `http://127.0.0.1:${record.controlPort}/${route}`,
    {
      method: route === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${record.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    },
  );
  if (!response.ok)
    throw Error('Local session ownership could not be verified.');
  const body = await response.text();
  if (body.length > 4096) throw Error('Invalid local session response.');
  const value = JSON.parse(body);
  if (
    value.projectId !== record.projectId ||
    value.pid !== record.pid ||
    value.port !== record.port
  )
    throw Error('Local session identity mismatch.');
  return value;
}
export function createLocalSession({
  root = ROOT,
  port = 4173,
  workerPath = SCRIPT,
} = {}) {
  if (!validPort(port)) throw Error('Invalid local port.');
  root = realpathSync(root);
  const base = path.join(
    tmpdir(),
    `aurel-local-sessions-${process.getuid?.() ?? projectId(homedir()).slice(0, 16)}`,
  );
  const directory = path.join(base, projectId(root)),
    statePath = path.join(directory, 'local-session.json'),
    lockPath = path.join(directory, 'local-session.lock');
  async function read() {
    try {
      return validRecord(
        JSON.parse(await readFile(statePath, 'utf8')),
        await realpath(root),
      );
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  if (directory === root || directory.startsWith(root + path.sep))
    throw Error('Session control storage must be outside the project.');
  async function exclusive(operation) {
    for (const location of [base, directory]) {
      await mkdir(location, { recursive: true, mode: 0o700 });
      const stat = await lstat(location);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw Error('Private session storage ownership could not be verified.');
      await chmod(location, 0o700);
    }
    let lock;
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch {
      throw Error(
        `Another local-session command is active. If interrupted, inspect and remove ${lockPath}.`,
      );
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => {});
    }
  }
  async function status() {
    const record = await read();
    let running = false;
    if (record)
      try {
        await request(record, 'status');
        running = true;
      } catch {}
    return {
      running,
      port: record?.port || port,
      portOccupied: await portOccupied(record?.port || port),
      controlPort: record?.controlPort || null,
      controlPortOccupied: record
        ? await portOccupied(record.controlPort)
        : false,
      ...(running ? { pid: record.pid } : {}),
      ...(record && !running
        ? {
            notice:
              'Saved session is unreachable; unrelated processes remain untouched.',
          }
        : {}),
    };
  }
  async function stop() {
    return exclusive(async () => {
      const record = await read();
      if (record) {
        try {
          await request(record, 'status');
          await request(record, 'stop');
        } catch {
          const current = await status();
          if (current.portOccupied || current.controlPortOccupied)
            return current;
        }
        for (let i = 0; i < 100; i++) {
          if (
            !(await portOccupied(record.port)) &&
            !(await portOccupied(record.controlPort))
          ) {
            await unlink(statePath).catch(() => {});
            return {
              running: false,
              port: record.port,
              portOccupied: false,
              controlPortOccupied: false,
            };
          }
          await wait(50);
        }
        return {
          ...(await status()),
          notice:
            'Shutdown has not released all owned ports yet; no unrelated process was signalled.',
        };
      }
      return status();
    });
  }
  async function start() {
    return exclusive(async () => {
      const old = await read(),
        current = await status();
      if (current.running) return current;
      if (
        current.portOccupied ||
        current.controlPortOccupied ||
        (await portOccupied(port))
      )
        throw Error('Local port is occupied. No existing process was stopped.');
      if (old) await unlink(statePath);
      const canonical = await realpath(root),
        token = randomBytes(32).toString('hex');
      const log = await open(
        path.join(directory, 'local-session.log'),
        'a',
        0o600,
      );
      const child = spawn(process.execPath, [workerPath, 'serve'], {
        cwd: canonical,
        detached: true,
        stdio: ['ignore', log.fd, log.fd, 'ipc'],
      });
      await log.close();
      try {
        const record = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                Error(
                  `Local server startup timed out. Inspect ${path.join(directory, 'local-session.log')}.`,
                ),
              ),
            30000,
          );
          const finish = (error, value) => {
            clearTimeout(timeout);
            child.removeListener('error', onError);
            child.removeListener('exit', onExit);
            error ? reject(error) : resolve(value);
          };
          const onError = (error) => finish(error),
            onExit = () =>
              finish(
                Error(
                  `Local server exited before readiness. Inspect ${path.join(directory, 'local-session.log')}.`,
                ),
              );
          child.once('error', onError);
          child.once('exit', onExit);
          child.once('message', (value) => {
            try {
              finish(null, validRecord(value, canonical));
            } catch (error) {
              finish(error);
            }
          });
          child.send({ root: canonical, port, token });
        });
        await writeFile(statePath, JSON.stringify(record) + '\n', {
          mode: 0o600,
        });
        child.disconnect();
        child.unref();
        return status();
      } catch (error) {
        child.kill('SIGTERM');
        if (child.connected) child.disconnect();
        throw error;
      }
    });
  }
  return { start, stop, status, storageDirectory: directory };
}
/** Worker owns both listeners; a random per-launch capability authorizes only this session. */
export async function serveOwned({
  root,
  port,
  token,
  serverFactory = async (options) =>
    (await import('vite')).createServer(options),
  exit = (code) => process.exit(code),
}) {
  root = await realpath(root);
  if (!validPort(port) || !/^[a-f0-9]{64}$/.test(token))
    throw Error('Invalid owned session startup.');
  const app = await serverFactory({
    root,
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await app.listen();
  const identity = {
    version: 1,
    projectId: projectId(root),
    port,
    pid: process.pid,
  };
  let closing = false;
  const control = createServer((req, res) => {
    const supplied = Buffer.from(req.headers.authorization || ''),
      expected = Buffer.from(`Bearer ${token}`);
    if (
      req.headers.origin ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(403).end();
      return;
    }
    if (!(
      (req.method === 'GET' && req.url === '/status') ||
      (req.method === 'POST' && req.url === '/stop')
    )) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(identity));
    if (req.url === '/stop') void close();
  });
  const close = async () => {
    if (closing) return;
    closing = true;
    process.removeListener('SIGTERM', close);
    process.removeListener('SIGINT', close);
    const deadline = setTimeout(() => exit(1), 5000);
    deadline.unref();
    try {
      await Promise.all([
        app.close(),
        new Promise((resolve) => control.close(resolve)),
      ]);
      clearTimeout(deadline);
      exit(0);
    } catch {
      clearTimeout(deadline);
      exit(1);
    }
  };
  await new Promise((resolve, reject) => {
    control.once('error', reject);
    control.listen(0, '127.0.0.1', resolve);
  });
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  const record = { ...identity, controlPort: control.address().port, token };
  process.send?.(record);
  return { record, close };
}
async function main() {
  if (process.argv[2] === 'serve' && process.send) {
    process.once('message', (config) => {
      serveOwned(config).catch(() => {
        console.error('Local server startup failed.');
        process.exit(1);
      });
    });
    return;
  }
  const { command, port } = parseCommand(process.argv.slice(2));
  const result = await createLocalSession({ port })[command]();
  console.log(JSON.stringify(result, null, 2));
  if (
    command === 'stop' &&
    (result.running || result.portOccupied || result.controlPortOccupied)
  )
    process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
