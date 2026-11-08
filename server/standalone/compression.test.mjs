import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { build, createServer as createViteServer, preview } from 'vite';
import {
  appendVary,
  compressionMiddleware,
  compressionPlugin,
  isCompressibleType,
  isCredentialRoute,
  negotiateEncoding,
} from './compression.js';
import { makeFixtureRoot } from '../../src/tooling/fixtureRoot.mjs';

const BIG_JSON = JSON.stringify({
  rows: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `row ${i}` })),
});

function get(port, target, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: target, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function decode(response) {
  const encoding = response.headers['content-encoding'];
  if (encoding === 'br') return zlib.brotliDecompressSync(response.body);
  if (encoding === 'gzip') return zlib.gunzipSync(response.body);
  return response.body;
}

/** A plain server with the middleware in front of fixed routes. */
async function fixtureServer(t, routes) {
  const middleware = compressionMiddleware();
  const server = createServer((req, res) =>
    middleware(req, res, () => routes[req.url]?.(req, res)),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test('negotiation prefers Brotli, then gzip, and honours q=0', () => {
  assert.equal(negotiateEncoding('gzip, deflate, br'), 'br');
  assert.equal(negotiateEncoding('gzip'), 'gzip');
  assert.equal(negotiateEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(negotiateEncoding('identity'), null);
  assert.equal(negotiateEncoding(''), null);
  assert.equal(negotiateEncoding('*'), 'br');
});

test('only text formats are compressible', () => {
  for (const type of [
    'application/json',
    'application/json; charset=utf-8',
    'text/javascript',
    'application/javascript',
    'text/css',
    'text/html',
    'application/geo+json',
    'application/geo+json-seq',
    'application/x-ndjson',
    'image/svg+xml',
    'application/manifest+json',
  ])
    assert.ok(isCompressibleType(type), type);
  for (const type of [
    'text/event-stream',
    'image/png',
    'image/jpeg',
    'video/mp4',
    'application/octet-stream',
    'font/woff2',
    'multipart/x-mixed-replace; boundary=frame',
    '',
  ])
    assert.ok(!isCompressibleType(type), type);
});

test('Vary gains Accept-Encoding once', () => {
  assert.equal(appendVary(''), 'Accept-Encoding');
  assert.equal(appendVary('Origin'), 'Origin, Accept-Encoding');
  assert.equal(appendVary('accept-encoding'), 'accept-encoding');
});

test('large JSON is sent as Brotli or gzip and decodes to the same bytes', async (t) => {
  const port = await fixtureServer(t, {
    '/json': (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('ETag', '"abc"');
      res.end(BIG_JSON);
    },
  });
  for (const [accept, expected] of [
    ['gzip, deflate, br', 'br'],
    ['gzip', 'gzip'],
  ]) {
    const response = await get(port, '/json', { 'accept-encoding': accept });
    assert.equal(response.headers['content-encoding'], expected);
    assert.equal(response.headers.vary, 'Accept-Encoding');
    assert.equal(response.headers.etag, 'W/"abc"');
    assert.ok(response.body.length < BIG_JSON.length / 4);
    assert.equal(decode(response).toString(), BIG_JSON);
  }
  const plain = await get(port, '/json');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers.vary, 'Accept-Encoding');
  assert.equal(plain.body.toString(), BIG_JSON);
});

test('images, small bodies, encoded bodies, HEAD and 304 pass through', async (t) => {
  const png = Buffer.alloc(50_000, 7);
  const port = await fixtureServer(t, {
    '/png': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
    },
    '/small': (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    },
    '/encoded': (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      });
      res.end(zlib.gzipSync(BIG_JSON));
    },
    '/not-modified': (req, res) => {
      res.writeHead(304, { 'Content-Type': 'application/json' });
      res.end();
    },
    '/head': (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', String(BIG_JSON.length));
      res.end(req.method === 'HEAD' ? undefined : BIG_JSON);
    },
  });
  const accept = { 'accept-encoding': 'br, gzip' };
  const image = await get(port, '/png', accept);
  assert.equal(image.headers['content-encoding'], undefined);
  assert.deepEqual(image.body, png);
  const small = await get(port, '/small', accept);
  assert.equal(small.headers['content-encoding'], undefined);
  const encoded = await get(port, '/encoded', accept);
  assert.equal(encoded.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(encoded.body).toString(), BIG_JSON);
  const notModified = await get(port, '/not-modified', accept);
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers['content-encoding'], undefined);
  const head = await get(port, '/head', accept, 'HEAD');
  assert.equal(head.headers['content-encoding'], undefined);
  assert.equal(head.headers['content-length'], String(BIG_JSON.length));
});

/** Read an event stream until `count` events arrive, while it stays open. */
function readEvents(port, target, count, headers) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: target, headers },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
          if (text.split('\n\n').length > count) {
            req.destroy();
            resolve({ headers: res.headers, text });
          }
        });
      },
    );
    req.on('error', (error) =>
      error.code === 'ECONNRESET' ? undefined : reject(error),
    );
    req.end();
  });
}

test('event streams and streamed JSON reach the client chunk by chunk', async (t) => {
  const timers = new Set();
  t.after(() => timers.forEach(clearInterval));
  const stream = (type, line) => (req, res) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    let n = 0;
    res.write(line(n++));
    const timer = setInterval(() => res.write(line(n++)), 20);
    timers.add(timer);
    req.on('close', () => clearInterval(timer));
  };
  const port = await fixtureServer(t, {
    '/events': stream('text/event-stream', (n) => `data: ${n}\n\n`),
    // Never ends: only per-chunk flushing lets the client see it.
    '/ndjson': stream('application/x-ndjson', (n) => `{"n":${n}}\n\n`),
  });
  const accept = { 'accept-encoding': 'br, gzip' };
  const events = await readEvents(port, '/events', 3, accept);
  assert.equal(events.headers['content-encoding'], undefined);
  assert.match(events.text, /data: 0\n\ndata: 1\n\ndata: 2\n\n/);
  const streamed = await new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/ndjson', headers: accept },
      (res) => {
        const decoder = zlib.createBrotliDecompress();
        let text = '';
        decoder.on('data', (chunk) => {
          text += chunk;
          if (text.includes('{"n":2}')) {
            req.destroy();
            resolve({ headers: res.headers, text });
          }
        });
        res.pipe(decoder);
      },
    );
    req.on('error', (error) =>
      error.code === 'ECONNRESET' ? undefined : reject(error),
    );
    req.end();
  });
  assert.equal(streamed.headers['content-encoding'], 'br');
  assert.match(streamed.text, /^\{"n":0\}/);
});

test('dev and preview servers compress /api routes and built assets once', async (t) => {
  const root = await makeFixtureRoot('gev-compression-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><title>x</title><script type="module" src="/src/main.js"></script>',
  );
  await writeFile(
    path.join(root, 'src', 'main.js'),
    `export const rows = ${BIG_JSON};\nconsole.info(rows.rows.length);\n`,
  );
  // A block body: Vite calls a function returned from these hooks.
  const install = (server) => {
    server.middlewares.use('/api/fixture', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(BIG_JSON);
    });
  };
  const plugins = [
    compressionPlugin(),
    {
      name: 'fixture-provider',
      configureServer: install,
      configurePreviewServer: install,
    },
  ];
  const base = {
    root,
    configFile: false,
    envFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins,
  };
  await build(base);
  const accept = { 'accept-encoding': 'gzip, deflate, br' };
  for (const isPreview of [false, true]) {
    const server = await (isPreview ? preview : createViteServer)({
      ...base,
      server: { host: '127.0.0.1', port: 0, hmr: false },
      preview: { host: '127.0.0.1', port: 0 },
    });
    if (!isPreview) await server.listen();
    try {
      const { port } = server.httpServer.address();
      const api = await get(port, '/api/fixture', accept);
      assert.equal(api.headers['content-encoding'], 'br', 'api');
      assert.equal(decode(api).toString(), BIG_JSON);
      const html = (await get(port, '/')).body.toString();
      const script = /src="([^"]+\.js)"/.exec(html)[1];
      const asset = await get(port, script, accept);
      assert.equal(asset.headers['content-encoding'], 'br', script);
      assert.match(decode(asset).toString(), /row 1999/);
    } finally {
      await server.close();
    }
  }
});

test('credential-bearing routes are never compressed', () => {
  assert.equal(isCredentialRoute('/api/setup/keys'), true);
  assert.equal(isCredentialRoute('/api/setup/status?x=1'), true);
  assert.equal(isCredentialRoute('/API/Realtime/token'), true);
  assert.equal(isCredentialRoute('/api/gemini/token'), true);
  assert.equal(isCredentialRoute('/api/gemini/chat'), false);
  assert.equal(isCredentialRoute('/api/firms'), false);
  assert.equal(isCredentialRoute('/api/setupx'), false);
});

test('the middleware leaves a credential route untouched', () => {
  const req = {
    method: 'POST',
    url: '/api/realtime/token',
    headers: { 'accept-encoding': 'br, gzip' },
  };
  const res = { writeHead() {}, write() {}, end() {} };
  const original = res.end;
  let called = false;
  compressionMiddleware()(req, res, () => (called = true));
  assert.equal(called, true);
  assert.equal(res.end, original);
  assert.equal(req.headers['accept-encoding'], 'br, gzip');
});
