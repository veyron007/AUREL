import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vite from 'vite';
import {
  STAMP_FILE,
  browserEnvDigest,
  buildStatus,
  ensureBuild,
  parseServeArgs,
  startServedBuild,
} from './serve-built.mjs';
import { resolveLaunchMode } from './launch-mode.mjs';
import { makeFixtureRoot } from '../src/tooling/fixtureRoot.mjs';

async function fixture(t) {
  const root = await makeFixtureRoot('gev-serve-built-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><p>app</p>');
  await writeFile(path.join(root, 'src', 'main.js'), 'export {};\n');
  // Inputs predate any build here, even on a coarse or skewed clock.
  const earlier = new Date(Date.now() - 60_000);
  for (const file of ['index.html', 'src/main.js'])
    await utimes(path.join(root, file), earlier, earlier);
  return root;
}

/** Stands in for `vite build`: writes a document and counts the runs. */
function fakeBuild() {
  const runs = [];
  const runBuild = async (root) => {
    runs.push(root);
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(
      path.join(root, 'dist', 'index.html'),
      `<!doctype html><p>build ${runs.length}</p>`,
    );
  };
  return { runs, runBuild };
}

const quiet = () => {};
const future = (seconds) => new Date(Date.now() + seconds * 1000);
const past = () => new Date(Date.now() - 60_000);

test('arguments: port and host come from flags or the environment', () => {
  assert.deepEqual(parseServeArgs([], {}), {
    buildOnly: false,
    port: 4173,
    host: undefined,
  });
  assert.deepEqual(parseServeArgs([], { PORT: '4190', HOST: '0.0.0.0' }), {
    buildOnly: false,
    port: 4190,
    host: '0.0.0.0',
  });
  assert.deepEqual(
    parseServeArgs(['--build-only', '--port', '4191', '--host', '127.0.0.1']),
    { buildOnly: true, port: 4191, host: '127.0.0.1' },
  );
  assert.throws(() => parseServeArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseServeArgs(['--port', '70000']), /Invalid port/);
});

test('launch mode defaults to the built app and accepts dev', () => {
  assert.equal(resolveLaunchMode({}), 'built');
  assert.equal(resolveLaunchMode({ GEV_LAUNCH_MODE: ' Dev ' }), 'dev');
  assert.equal(resolveLaunchMode({ GEV_LAUNCH_MODE: 'built' }), 'built');
  assert.throws(() => resolveLaunchMode({ GEV_LAUNCH_MODE: 'prod' }), /dev/);
});

test('the build runs once, then again only when inputs or browser settings change', async (t) => {
  const root = await fixture(t);
  const { runs, runBuild } = fakeBuild();
  const env = { MAPILLARY_CLIENT_TOKEN: 'a' };
  assert.deepEqual(await buildStatus({ root, env }), {
    stale: true,
    reason: 'no build yet',
  });
  assert.equal(await ensureBuild({ root, env, runBuild, log: quiet }), true);
  const stamp = JSON.parse(
    await readFile(path.join(root, 'dist', STAMP_FILE), 'utf8'),
  );
  assert.equal(stamp.envDigest, browserEnvDigest(env));
  assert.equal(await ensureBuild({ root, env, runBuild, log: quiet }), false);
  assert.equal(runs.length, 1);

  // A test file is not a build input.
  await writeFile(path.join(root, 'src', 'main.test.mjs'), 'x');
  await utimes(path.join(root, 'src', 'main.test.mjs'), future(5), future(5));
  assert.equal((await buildStatus({ root, env })).stale, false);

  await utimes(path.join(root, 'src', 'main.js'), future(5), future(5));
  assert.equal(
    (await buildStatus({ root, env })).reason,
    'source changed since the last build',
  );
  await ensureBuild({ root, env, runBuild, log: quiet });
  assert.equal(runs.length, 2);
  // Back to an ordinary past time, so only the next change counts.
  await utimes(path.join(root, 'src', 'main.js'), past(), past());

  // .env and browser tokens are build inputs; server-only keys are not.
  assert.equal(
    (await buildStatus({ root, env: { ...env, FIRMS_MAP_KEY: 'k' } })).stale,
    false,
  );
  assert.equal(
    (await buildStatus({ root, env: { MAPILLARY_CLIENT_TOKEN: 'b' } })).reason,
    'browser settings changed',
  );
  await writeFile(path.join(root, '.env'), 'X=1\n');
  await utimes(path.join(root, '.env'), future(10), future(10));
  assert.equal((await buildStatus({ root, env })).stale, true);
});

test('a dist/ this launcher did not stamp is rebuilt', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'index.html'), 'old');
  assert.deepEqual(await buildStatus({ root, env: {} }), {
    stale: true,
    reason: 'the build was not made here',
  });
});

test('the served build answers, restarts in place, and closes', async (t) => {
  const root = await fixture(t);
  const previous = globalThis.__GEV_SERVED_BUILD_AT_BOOT;
  t.after(() => {
    globalThis.__GEV_SERVED_BUILD_AT_BOOT = previous;
  });
  const { runs, runBuild } = fakeBuild();
  const failures = [];
  const served = await startServedBuild({
    root,
    host: '127.0.0.1',
    port: 0,
    vite,
    log: quiet,
    runBuild,
    onRestartFailure: (error) => failures.push(error),
  });
  t.after(() => served.close());
  assert.equal(globalThis.__GEV_SERVED_BUILD_AT_BOOT, true);
  assert.equal(process.env.GEV_SERVED_BUILD, undefined);
  const url = () =>
    `http://127.0.0.1:${served.server.httpServer.address().port}/`;
  assert.match(await (await fetch(url())).text(), /build 1/);

  // A source change before the restart (as after a saved browser key).
  await utimes(path.join(root, 'src', 'main.js'), future(5), future(5));
  const first = served.server;
  await first.restart();
  assert.notEqual(served.server, first);
  assert.match(await (await fetch(url())).text(), /build 2/);
  assert.equal(runs.length, 2);
  assert.deepEqual(failures, []);
});

test('a failed rebuild keeps the previous build serving', async (t) => {
  const root = await fixture(t);
  const previous = globalThis.__GEV_SERVED_BUILD_AT_BOOT;
  t.after(() => {
    globalThis.__GEV_SERVED_BUILD_AT_BOOT = previous;
  });
  const { runBuild } = fakeBuild();
  let failNext = false;
  const flakyBuild = async (dir) => {
    if (failNext) throw new Error('disk full');
    await runBuild(dir);
  };
  const failures = [];
  const logs = [];
  const served = await startServedBuild({
    root,
    host: '127.0.0.1',
    port: 0,
    vite,
    log: (line) => logs.push(line),
    runBuild: flakyBuild,
    onRestartFailure: (error) => failures.push(error),
  });
  t.after(() => served.close());
  const url = () =>
    `http://127.0.0.1:${served.server.httpServer.address().port}/`;
  await utimes(path.join(root, 'src', 'main.js'), future(5), future(5));
  failNext = true;
  const first = served.server;
  await first.restart();
  assert.equal(served.server, first);
  assert.match(await (await fetch(url())).text(), /build 1/);
  assert.deepEqual(failures, []);
  assert.ok(logs.some((line) => /Rebuild failed.*disk full/.test(line)));
});
