import { admitSameSiteKeyless } from '../common/same-site.js';
import { readRequestBody } from '../common/request.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { createSentinelNdviService } from './service.js';
import { validateSearchInput, validateAnalysisInput } from './metadata.js';
function searchQuery(url) {
  if (url.search.length > 256) throw new Error('invalid-request');
  const value = {};
  for (const [key, input] of url.searchParams) {
    if (
      Object.hasOwn(value, key) ||
      !['lat', 'lon', 'fromDay', 'toDay'].includes(key)
    )
      throw new Error('invalid-request');
    if (['lat', 'lon'].includes(key)) {
      if (!/^-?\d+(?:\.\d+)?$/.test(input)) throw new Error('invalid-request');
      value[key] = Number(input);
    } else value[key] = input;
  }
  return validateSearchInput(value);
}
export function createResearchMiddleware({ service, ...options } = {}) {
  const source = service || createSentinelNdviService(options);
  const admit = makeRateLimiter({ windowMs: 60000, max: 8, globalMax: 16 });
  return async function researchMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    const search = url.pathname === '/api/research/sentinel-scenes';
    if (!search && url.pathname !== '/api/research/sentinel-ndvi')
      return next();
    const respond = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(value));
    };
    if (admitSameSiteKeyless(req, res)) return;
    const method = search ? 'GET' : 'POST';
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return respond(405, { error: 'Method not allowed' });
    }
    if (!admit(clientKey(req))) {
      res.setHeader('Retry-After', '60');
      return respond(429, { error: 'Research request limit reached' });
    }
    const lifetime = new AbortController();
    const abort = () => {
      if (!res.writableEnded) lifetime.abort(new Error('client-disconnected'));
    };
    req.once('aborted', abort);
    res.once('close', abort);
    try {
      let input;
      try {
        if (search) input = searchQuery(url);
        else {
          if (
            url.search ||
            !/^application\/json(?:\s*;|$)/i.test(
              req.headers['content-type'] || '',
            )
          )
            throw new Error('invalid-request');
          if (Number(req.headers['content-length']) > 1024)
            return respond(413, { error: 'Request body exceeds limit' });
          const body = await readRequestBody(
            req,
            1024,
            AbortSignal.any([lifetime.signal, AbortSignal.timeout(5000)]),
          );
          input = validateAnalysisInput(JSON.parse(body));
        }
      } catch (error) {
        return respond(error.code === 'BODY_TOO_LARGE' ? 413 : 400, {
          error: 'Invalid bounded research request',
        });
      }
      const result = await source[search ? 'search' : 'analyze'](input, {
        signal: lifetime.signal,
      });
      respond(200, result);
    } catch {
      if (!lifetime.signal.aborted)
        respond(503, {
          version: 1,
          status: 'rejected',
          reason: 'upstream-unavailable',
        });
    } finally {
      req.off('aborted', abort);
      res.off('close', abort);
    }
  };
}
export function researchProxy(options = {}) {
  const middleware = createResearchMiddleware(options);
  const install = (server) => {
    server.middlewares.use(middleware);
  };
  return {
    name: 'bounded-sentinel-research',
    configureServer: install,
    configurePreviewServer: install,
  };
}
