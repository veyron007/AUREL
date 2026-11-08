/**
 * How the launchers (local:start, Docker, Pinokio) serve the app.
 *
 * The default is the built app (scripts/serve-built.mjs): about 350 requests
 * and minified Cesium instead of the dev server's 1,600 module requests.
 * `GEV_LAUNCH_MODE=dev` keeps the dev server for someone editing code through
 * a launcher, for example in a bind-mounted Docker checkout.
 */
import { startServedBuild } from './serve-built.mjs';

export const LAUNCH_MODES = Object.freeze(['built', 'dev']);

/**
 * The launch mode named by the environment; unset means the built app.
 * @param {Record<string, string|undefined>} env
 * @returns {'built'|'dev'}
 */
export function resolveLaunchMode(env = process.env) {
  const value = String(env.GEV_LAUNCH_MODE ?? '')
    .trim()
    .toLowerCase();
  if (!value) return 'built';
  if (LAUNCH_MODES.includes(value)) return value;
  throw new Error(
    `GEV_LAUNCH_MODE must be ${LAUNCH_MODES.join(' or ')}, not "${value}".`,
  );
}

async function startDevServer({ vite, root, host, port }) {
  const server = await vite.createServer({
    root,
    server: { host, port, strictPort: true },
  });
  await server.listen();
  return { printUrls: () => server.printUrls(), close: () => server.close() };
}

async function startBuiltServer({ vite, root, host, port }) {
  const served = await startServedBuild({ vite, root, host, port });
  return {
    printUrls: () => served.server?.printUrls(),
    close: () => served.close(),
  };
}

/**
 * Start the app in the configured mode and say which one it is.
 * @returns {Promise<{close: () => Promise<void>}>}
 */
export async function startLaunchServer({
  vite,
  root,
  host,
  port,
  tag,
  env = process.env,
  log = console.log,
}) {
  const mode = resolveLaunchMode(env);
  const start = mode === 'dev' ? startDevServer : startBuiltServer;
  const server = await start({ vite, root, host, port });
  server.printUrls();
  log(
    mode === 'dev'
      ? `[${tag}] Development server: code edits apply live.`
      : `[${tag}] Serving the built app. Code edits need a restart; GEV_LAUNCH_MODE=dev serves live edits.`,
  );
  return { close: server.close };
}
