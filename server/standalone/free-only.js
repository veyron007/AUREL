import { keylessHudSummaryResponse } from '../../src/hudSummaryResponse.js';
import { FREE_ONLY_STATUS } from './free-only-status.js';
export { FREE_ONLY_STATUS } from './free-only-status.js';

/** Standalone admission is independent of saved credentials. No paid opt-out. */
const BLOCKED = Object.freeze([
  ['/api/google', 'google-maps'],
  ['/api/openai', 'openai'],
  ['/api/realtime', 'openai'],
  ['/api/gemini', 'gemini'],
  ['/api/tomtom', 'tomtom'],
  ['/api/flights/track', 'opensky'],
]);

export function freeOnlyCapability(target) {
  const raw = String(target || '/')
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/');
  let parsed = raw;
  try {
    parsed = new URL(raw, 'http://localhost').pathname;
  } catch {
    /* check raw */
  }
  return (
    BLOCKED.find(([prefix]) =>
      [raw, parsed].some((path) => {
        const lower = path.toLowerCase();
        return (
          lower === prefix ||
          lower.startsWith(prefix + '/') ||
          lower.startsWith(prefix + '.')
        );
      }),
    )?.[1] ?? null
  );
}

export function freeOnlyBrowserKeys(env = {}) {
  return {
    googleApiKey: undefined,
    cesiumToken: undefined,
    mapillaryToken: env.MAPILLARY_CLIENT_TOKEN,
  };
}

export function freeOnlyPlugin() {
  const install = (server) => {
    server.middlewares.use((req, res, next) => {
      const pathname = String(req.url || '')
        .split('?', 1)[0]
        .toLowerCase();
      const respond = (status, data) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(data));
      };
      if (
        pathname === '/api/google/tiles-token' &&
        ['GET', 'HEAD'].includes(req.method)
      ) {
        res.statusCode = 204;
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return;
      }
      if (pathname === '/api/free-only/status')
        return respond(200, FREE_ONLY_STATUS);
      if (pathname === '/api/openai/hud-summary/status')
        return respond(200, { configured: false, freeOnly: true });
      if (pathname === '/api/openai/hud-summary')
        return respond(200, keylessHudSummaryResponse('').payload);
      if (pathname === '/api/tomtom/status')
        return respond(200, {
          hasKey: false,
          freeOnly: true,
          dailyCount: 0,
          budget: 0,
        });
      const provider = freeOnlyCapability(req.url);
      if (!provider) return next();
      respond(403, {
        code: 'FREE_ONLY_BLOCKED',
        freeOnly: true,
        provider,
        error:
          'This provider is paused by Free-only. Saved keys are preserved.',
        places: [],
        results: [],
        status: 'REQUEST_DENIED',
      });
    });
  };
  return {
    name: 'standalone-free-only',
    enforce: 'pre',
    configureServer: install,
    configurePreviewServer: install,
  };
}
