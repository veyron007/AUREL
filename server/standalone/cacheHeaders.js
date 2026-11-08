/**
 * Cache-Control for the static files the preview server serves.
 *
 * - `/assets/*` holds only Vite's content-hashed build output, so a name never
 *   changes meaning and browsers may keep it for a year without asking.
 * - `/cesium/Cesium.js?v=<installed version>` (the tag build/vite.js writes) is
 *   versioned the same way.
 * - Every other `/cesium/*` file (workers, widgets, textures) has no version in
 *   its URL, so it is kept for one day and then revalidated by ETag.
 *
 * The document, `/api` and everything else keep the server's own headers. In
 * dev, `/cesium/*` is always revalidated: switching GEV_CESIUM_UNMINIFIED
 * changes the files behind the same URLs.
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const DAILY_CACHE = 'public, max-age=86400';
export const REVALIDATE_CACHE = 'no-cache';

function pathAndQuery(url) {
  try {
    const parsed = new URL(String(url || '/'), 'http://localhost');
    return {
      path: decodeURIComponent(parsed.pathname),
      query: parsed.searchParams,
    };
  } catch {
    return { path: '', query: new URLSearchParams() };
  }
}

/**
 * The Cache-Control a static request should carry, or null to leave the
 * server's default in place.
 * @param {{url: string, preview: boolean, cesiumVersion: string}} input
 * @returns {string|null}
 */
export function cacheControlFor({ url, preview, cesiumVersion }) {
  const { path, query } = pathAndQuery(url);
  if (!path.startsWith('/cesium/')) {
    return preview && /^\/assets\/[^/]+$/.test(path) ? IMMUTABLE_CACHE : null;
  }
  if (!preview) return REVALIDATE_CACHE;
  const versioned =
    path === '/cesium/Cesium.js' &&
    Boolean(cesiumVersion) &&
    query.get('v') === cesiumVersion;
  return versioned ? IMMUTABLE_CACHE : DAILY_CACHE;
}

/**
 * Whether a built file exists for a request path, so a missing name (a 404 or
 * a document fallback) never receives a long lifetime.
 */
export function isBuiltFile(distDir, requestPath) {
  const target = path.resolve(distDir, `.${requestPath}`);
  if (!target.startsWith(path.resolve(distDir) + path.sep)) return false;
  return existsSync(target) && statSync(target).isFile();
}

/** Vite plugin applying cacheControlFor before the static file servers run. */
export function cacheHeadersPlugin({ cesiumVersion }) {
  const install = (preview) => (server) => {
    const { root, build } = server.config;
    const distDir = path.resolve(root, build.outDir);
    server.middlewares.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const value = cacheControlFor({ url: req.url, preview, cesiumVersion });
      const known =
        !preview || isBuiltFile(distDir, pathAndQuery(req.url).path);
      // Static servers keep a header that is already set (sirv, serve-static).
      if (value && known) res.setHeader('Cache-Control', value);
      next();
    });
  };
  return {
    name: 'gev-cache-headers',
    enforce: 'pre',
    configureServer: install(false),
    configurePreviewServer: install(true),
  };
}
