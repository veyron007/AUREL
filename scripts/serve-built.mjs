#!/usr/bin/env node
/**
 * `npm run serve`: the built app with every local `/api` route.
 *
 * Builds with `vite build` when `dist/` is missing or older than its inputs,
 * then starts `vite preview` with the same standalone configuration as
 * `npm run dev`, so every provider route answers unchanged. The launchers
 * (local:start, Docker, Pinokio) use this; `npm run dev` stays the path for
 * editing code.
 *
 * Provider Settings works here too: this launcher gives the preview server a
 * restart (rebuild when needed, then serve again), which a saved key triggers.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freeOnlyBrowserKeys } from '../server/standalone/free-only.js';
import { isDirectInvocation } from './pinokio-install.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = realpathSync(path.resolve(path.dirname(MODULE_PATH), '..'));

/** Written into dist/ after a successful build by this launcher. */
export const STAMP_FILE = '.gev-served-build.json';
const STAMP_VERSION = 1;

/** Everything the browser build reads. Provider code runs live, not built. */
export const BUILD_INPUTS = Object.freeze({
  files: Object.freeze([
    'index.html',
    'style.css',
    'package.json',
    'package-lock.json',
    'vite.config.js',
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
  ]),
  dirs: Object.freeze(['src', 'public', 'build', 'server/standalone']),
});

const IGNORED_INPUT =
  /(?:^|[\\/])(?:node_modules|\.[^\\/]+)(?:[\\/]|$)|\.test\.mjs$/;

async function mtimeOf(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function newestInDir(dir) {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !IGNORED_INPUT.test(path.relative(dir, file)));
  const times = await Promise.all(files.map(mtimeOf));
  return Math.max(0, ...times);
}

/** The newest modification time among the build's inputs, in milliseconds. */
export async function newestInputMtime(root) {
  const times = await Promise.all([
    ...BUILD_INPUTS.files.map((file) => mtimeOf(path.join(root, file))),
    ...BUILD_INPUTS.dirs.map((dir) => newestInDir(path.join(root, dir))),
  ]);
  return Math.max(0, ...times);
}

/**
 * A digest of the environment values the build writes into the bundle, so a
 * changed browser token (for example from Provider Settings) rebuilds.
 */
export function browserEnvDigest(env) {
  const exposed = { ...freeOnlyBrowserKeys(env), photonUrl: env.PHOTON_URL };
  return createHash('sha256').update(JSON.stringify(exposed)).digest('hex');
}

async function readStamp(distDir) {
  try {
    const stamp = JSON.parse(
      await readFile(path.join(distDir, STAMP_FILE), 'utf8'),
    );
    return stamp?.version === STAMP_VERSION ? stamp : null;
  } catch {
    return null;
  }
}

/**
 * Whether dist/ must be rebuilt, and why.
 * @param {{root: string, env: Record<string, string|undefined>}} input
 * @returns {Promise<{stale: boolean, reason: string}>}
 */
export async function buildStatus({ root, env }) {
  const distDir = path.join(root, 'dist');
  if (!(await mtimeOf(path.join(distDir, 'index.html'))))
    return { stale: true, reason: 'no build yet' };
  const stamp = await readStamp(distDir);
  if (!stamp) return { stale: true, reason: 'the build was not made here' };
  if (stamp.envDigest !== browserEnvDigest(env))
    return { stale: true, reason: 'browser settings changed' };
  if ((await newestInputMtime(root)) > stamp.builtAt)
    return { stale: true, reason: 'source changed since the last build' };
  return { stale: false, reason: 'up to date' };
}

/** Run `vite build` in a child process, so its memory leaves with it. */
export function runViteBuild(root) {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vite, 'build'], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`vite build failed (${signal || `exit ${code}`})`)),
    );
  });
}

/** Build when stale and record the stamp. Returns whether it built. */
export async function ensureBuild({
  root,
  env,
  runBuild = runViteBuild,
  log = console.log,
}) {
  const status = await buildStatus({ root, env });
  if (!status.stale) return false;
  log(
    `[serve] Building the app (${status.reason}); a first build can take a minute. ` +
      'Later starts skip it while nothing changes.',
  );
  const builtAt = Date.now();
  await runBuild(root);
  const stamp = {
    version: STAMP_VERSION,
    builtAt,
    envDigest: browserEnvDigest(env),
  };
  await writeFile(
    path.join(root, 'dist', STAMP_FILE),
    `${JSON.stringify(stamp)}\n`,
  );
  return true;
}

/** process.env over the checkout's dotenv files, as the Vite config sees it. */
function effectiveEnv(vite, root) {
  return { ...vite.loadEnv('production', root, ''), ...process.env };
}

/**
 * Build if needed and serve. The returned handle restarts in place (Provider
 * Settings calls it through `server.restart()`) and closes.
 * @param {{root?: string, host?: string, port: number, vite: typeof import('vite'), log?: Function, runBuild?: Function, onRestartFailure?: Function}} options
 */
export async function startServedBuild({
  root = ROOT,
  host,
  port,
  vite,
  log = console.log,
  runBuild = runViteBuild,
  onRestartFailure = (error) => {
    console.error(`[serve] Restart failed: ${error.message}`);
    process.exit(1);
  },
}) {
  // Read once by key-setup.js at load; set before Vite loads the config. A
  // process-local flag, not an environment variable, so a shell export or a
  // child process can never switch Provider Settings on for a plain preview.
  globalThis.__GEV_SERVED_BUILD_AT_BOOT = true;
  let server = null;
  let pending = null;
  const restartPlugin = {
    name: 'gev-served-build-restart',
    configurePreviewServer(previewServer) {
      previewServer.restart = () => restart();
    },
  };
  const build = () =>
    ensureBuild({ root, env: effectiveEnv(vite, root), runBuild, log });
  const serve = async () => {
    server = await vite.preview({
      root,
      plugins: [restartPlugin],
      preview: { host, port, strictPort: true },
    });
    return server;
  };
  // Rebuild while the current build keeps serving. A failed rebuild leaves the
  // running server in place; only a failure to reopen the port is fatal.
  const restart = () =>
    (pending ??= (async () => {
      log('[serve] Restarting.');
      try {
        await build();
      } catch (error) {
        log(
          `[serve] Rebuild failed, still serving the previous build: ${error.message}`,
        );
        return;
      }
      await server?.close();
      server = null;
      await serve();
    })()
      .catch(onRestartFailure)
      .finally(() => {
        pending = null;
      }));
  await build();
  await serve();
  return {
    get server() {
      return server;
    },
    restart,
    async close() {
      await pending;
      await server?.close();
      server = null;
    },
  };
}

/** Parse `[--build-only] [--port N] [--host H]`. */
export function parseServeArgs(args, env = process.env) {
  const options = {
    buildOnly: false,
    port: Number.parseInt(env.PORT, 10) || 4173,
    host: env.HOST || undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--build-only') options.buildOnly = true;
    else if (flag === '--port' && /^\d+$/.test(args[index + 1] ?? ''))
      options.port = Number(args[++index]);
    else if (flag === '--host' && args[index + 1]) options.host = args[++index];
    else
      throw new Error(
        `Unknown option ${flag}. Use [--build-only] [--port N] [--host H].`,
      );
  }
  if (options.port < 1 || options.port > 65535)
    throw new Error('Invalid port.');
  return options;
}

async function main() {
  const options = parseServeArgs(process.argv.slice(2));
  // Vite resolves the project from the working directory.
  process.chdir(ROOT);
  const vite = await import('vite');
  if (options.buildOnly) {
    const built = await ensureBuild({
      root: ROOT,
      env: effectiveEnv(vite, ROOT),
    });
    console.log(
      built ? '[serve] Build ready.' : '[serve] Build already current.',
    );
    return;
  }
  const served = await startServedBuild({ ...options, vite });
  served.server.printUrls();
  console.log(
    '[serve] Serving the built app. Code edits need a restart; use npm run dev to edit live.',
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await served.close();
      process.exit(0);
    });
}

if (isDirectInvocation(process.argv[1], MODULE_PATH)) {
  main().catch((error) => {
    console.error(`[serve] Start refused: ${error.message}`);
    process.exitCode = 1;
  });
}
