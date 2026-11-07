/**
 * Serves the agent desk relay at /api/agent-desk on the development and
 * preview servers.
 *
 *   POST /api/agent-desk/requests  an MCP server submits a Field Kit request
 *   GET  /api/agent-desk/next      the AUREL tab long-polls for the next one
 *   POST /api/agent-desk/results   the AUREL tab answers it
 *
 * Every route takes local requests only, with the same checks as /mcp
 * (loopback address and Host, no proxy headers, sharing off). Submissions
 * must not carry an Origin: browsers always send one on POST, so no web page,
 * including AUREL's own, can submit a request as if it were an agent. Polls
 * and answers must come from the app's own origin.
 */

import { isLocalMcpRequest } from '../mcp/plugin.js';
import { SESSION_ID, createAgentDeskRelay } from './relay.js';

export const AGENT_DESK_BASE = '/api/agent-desk';
const MAX_REQUEST_BYTES = 256 * 1024;
/** A render_view answer carries a PNG of at most 1600 px width. */
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const BODY_TIMEOUT_MS = 30_000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(Object.assign(new Error('timeout'), { status: 408 })),
      BODY_TIMEOUT_MS,
    );
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(Object.assign(new Error('too large'), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        finish(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', (error) => finish(error));
  });
}

function isLocal(req, env) {
  return isLocalMcpRequest({
    remoteAddress: req.socket?.remoteAddress,
    localPort: req.socket?.localPort,
    host: req.headers.host || '',
    origin: req.headers.origin,
    headers: req.headers,
    env,
  });
}

function isJson(req) {
  return /^application\/json\b/i.test(req.headers['content-type'] || '');
}

/** The middleware for one relay; exported for tests. */
export function createAgentDeskMiddleware({
  relay = createAgentDeskRelay(),
  env = process.env,
} = {}) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '');
    if (!isLocal(req, env))
      return send(res, 403, {
        error: 'The agent desk only accepts local requests',
      });
    const fromPage = req.headers.origin != null;
    try {
      if (route === '/requests' && req.method === 'POST') {
        if (fromPage || !isJson(req))
          return send(res, 403, {
            error: 'Agent requests come from a local MCP server',
          });
        const body = await readJson(req, MAX_REQUEST_BYTES);
        if (typeof body?.op !== 'string' || typeof body?.client !== 'string')
          return send(res, 400, { error: 'Bad request' });
        const disconnect = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) disconnect.abort();
        });
        const answer = await relay.submit(
          { op: body.op, args: body.args ?? {}, client: body.client },
          { signal: disconnect.signal },
        );
        return send(res, 200, answer);
      }
      if (route === '/next' && req.method === 'GET') {
        const session = url.searchParams.get('session') || '';
        if (!SESSION_ID.test(session))
          return send(res, 400, { error: 'Bad session' });
        const disconnect = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) disconnect.abort();
        });
        const next = await relay.poll(session, { signal: disconnect.signal });
        if (disconnect.signal.aborted) return undefined;
        return next ? send(res, 200, next) : send(res, 204);
      }
      if (route === '/results' && req.method === 'POST') {
        if (!fromPage || !isJson(req))
          return send(res, 403, { error: 'Answers come from the AUREL page' });
        const body = await readJson(req, MAX_RESULT_BYTES);
        const accepted =
          typeof body?.session === 'string' &&
          typeof body?.id === 'string' &&
          relay.complete(body.session, body.id, body.answer);
        return send(res, accepted ? 200 : 409, { accepted: Boolean(accepted) });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      if (res.headersSent) return res.destroy();
      return send(
        res,
        [400, 408, 413].includes(error?.status) ? error.status : 400,
        {
          error: 'Bad request',
        },
      );
    }
  };
}

/** Vite plugin that mounts the relay. One relay serves the whole server. */
export function agentDeskPlugin(options = {}) {
  const middleware = createAgentDeskMiddleware(options);
  // Returns nothing: Vite would call a returned function as a post hook.
  const install = (server) => {
    server.middlewares.use(AGENT_DESK_BASE, middleware);
  };
  return {
    name: 'aurel-agent-desk',
    configureServer: install,
    configurePreviewServer: install,
  };
}
