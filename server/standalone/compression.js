import zlib from 'node:zlib';

/**
 * Response compression for the dev and preview servers.
 *
 * Vite's dev server compresses nothing, and its preview server installs its
 * own gzip middleware after every `configurePreviewServer` hook, so it never
 * reaches the `/api` routes the providers mount there. This plugin runs first
 * (`enforce: 'pre'`, installed directly in the hooks) and owns content
 * negotiation for every response: it hides the client's Accept-Encoding from
 * later middleware so nothing compresses twice.
 *
 * It never buffers a stream: each chunk written by a route is flushed through
 * the compressor at once. Event streams, media, images, already-encoded
 * bodies, partial content, HEAD requests and bodyless statuses pass through
 * untouched.
 */

/** Responses smaller than this are sent as they are. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;
/** Brotli quality 5 is close to gzip's speed with a clearly better ratio. */
export const BROTLI_QUALITY = 5;

const COMPRESSIBLE_TYPE =
  /^(?:text\/(?!event-stream)[\w.+-]+|application\/(?:[\w.+-]*\+)?(?:json|javascript|ecmascript|xml)(?:-seq)?|application\/(?:x-)?(?:ndjson|geojsonl?|wasm-text|manifest\+json)|image\/svg\+xml)\s*(?:;|$)/i;
const BODYLESS_STATUS = new Set([204, 206, 304]);

/** Whether a Content-Type names a text format worth compressing. */
export function isCompressibleType(contentType) {
  return COMPRESSIBLE_TYPE.test(String(contentType || '').trim());
}

/**
 * The encoding to send for an Accept-Encoding header: Brotli when offered,
 * else gzip, else none. An explicit `q=0` refuses an encoding.
 */
export function negotiateEncoding(acceptEncoding) {
  const offered = new Map(
    String(acceptEncoding || '')
      .split(',')
      .map((part) =>
        part
          .trim()
          .toLowerCase()
          .split(/\s*;\s*/),
      )
      .filter(([name]) => name)
      .map(([name, ...params]) => {
        const q = params.find((param) => param.startsWith('q='));
        return [name, q ? Number.parseFloat(q.slice(2)) : 1];
      }),
  );
  const accepts = (name) => (offered.get(name) ?? offered.get('*') ?? 0) > 0;
  if (accepts('br')) return 'br';
  if (accepts('gzip')) return 'gzip';
  return null;
}

/** A Vary header value with Accept-Encoding added once. */
export function appendVary(current) {
  const values = String(current || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => value === '*' || /^accept-encoding$/i.test(value)))
    return values.join(', ');
  return [...values, 'Accept-Encoding'].join(', ');
}

function createEncoder(encoding, sizeHint) {
  if (encoding === 'br')
    return zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        ...(sizeHint > 0
          ? { [zlib.constants.BROTLI_PARAM_SIZE_HINT]: sizeHint }
          : {}),
      },
    });
  return zlib.createGzip();
}

function flushEncoder(encoder, encoding) {
  encoder.flush(
    encoding === 'br'
      ? zlib.constants.BROTLI_OPERATION_FLUSH
      : zlib.constants.Z_SYNC_FLUSH,
  );
}

function chunkSize(chunk, encoding) {
  if (chunk === undefined || chunk === null || typeof chunk === 'function')
    return 0;
  return Buffer.byteLength(
    chunk,
    typeof encoding === 'string' ? encoding : undefined,
  );
}

function applyHeaders(res, headers) {
  if (Array.isArray(headers)) {
    const pairs = Array.isArray(headers[0])
      ? headers
      : headers.flatMap((value, index) =>
          index % 2 === 0 ? [[value, headers[index + 1]]] : [],
        );
    for (const [name, value] of pairs) res.setHeader(name, value);
    return;
  }
  for (const [name, value] of Object.entries(headers || {}))
    res.setHeader(name, value);
}

/** Whether a response, at the moment its headers go out, should be encoded. */
export function shouldCompress({ status, headers, knownSize, streaming }) {
  if (BODYLESS_STATUS.has(status) || status < 200) return false;
  if (headers['content-encoding']) return false;
  if (/\bno-transform\b/i.test(String(headers['cache-control'] || '')))
    return false;
  if (!isCompressibleType(headers['content-type'])) return false;
  const declared = Number.parseInt(headers['content-length'], 10);
  const size = Number.isFinite(declared) ? declared : knownSize;
  // A streamed body of unknown length is compressed; a complete one only
  // when it is big enough to gain from it.
  return streaming && !Number.isFinite(declared)
    ? true
    : size >= COMPRESSION_THRESHOLD_BYTES;
}

function lowerCaseHeaders(res) {
  return Object.fromEntries(
    Object.entries(res.getHeaders()).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
}

/**
 * Wrap one response so its body is encoded with `encoding` (or left alone)
 * once the route has decided its headers. Returns nothing; the response's own
 * methods are replaced for this request only.
 */
function wrapResponse(res, encoding) {
  const original = {
    writeHead: res.writeHead,
    write: res.write,
    end: res.end,
    flushHeaders: res.flushHeaders,
  };
  let started = false;
  let encoder = null;
  let pendingStatus = 0;
  let pendingMessage;

  const start = ({ knownSize, streaming }) => {
    started = true;
    const status = pendingStatus || res.statusCode;
    const headers = lowerCaseHeaders(res);
    if (isCompressibleType(headers['content-type']))
      res.setHeader('Vary', appendVary(headers.vary));
    if (encoding && shouldCompress({ status, headers, knownSize, streaming })) {
      encoder = createEncoder(encoding, knownSize);
      res.setHeader('Content-Encoding', encoding);
      res.removeHeader('Content-Length');
      const etag = res.getHeader('ETag');
      // The encoded body differs byte for byte, so a strong validator weakens.
      if (typeof etag === 'string' && etag.startsWith('"'))
        res.setHeader('ETag', `W/${etag}`);
      encoder.on('data', (chunk) => {
        if (!original.write.call(res, chunk)) encoder.pause();
      });
      res.on('drain', () => encoder?.resume());
      encoder.on('drain', () => res.emit('drain'));
      encoder.on('end', () => original.end.call(res));
      encoder.on('error', (error) => res.destroy(error));
      res.once('close', () => {
        if (!res.writableFinished) encoder?.destroy();
      });
    }
    if (pendingStatus)
      original.writeHead.call(res, pendingStatus, pendingMessage);
  };

  res.writeHead = function writeHead(status, message, headers) {
    const [reason, list] =
      typeof message === 'string' ? [message, headers] : [undefined, message];
    if (list) applyHeaders(res, list);
    pendingStatus = status;
    pendingMessage = reason;
    res.statusCode = status;
    if (started) original.writeHead.call(res, status, reason);
    return res;
  };

  res.flushHeaders = function flushHeaders() {
    if (!started) start({ knownSize: 0, streaming: true });
    return original.flushHeaders.call(res);
  };

  res.write = function write(chunk, chunkEncoding, callback) {
    if (!started)
      start({ knownSize: chunkSize(chunk, chunkEncoding), streaming: true });
    if (!encoder) return original.write.apply(res, arguments);
    const accepted = encoder.write(chunk, chunkEncoding, callback);
    // Streams must not wait for the compressor's internal buffer to fill.
    flushEncoder(encoder, encoding);
    return accepted;
  };

  res.end = function end(chunk, chunkEncoding, callback) {
    if (!started)
      start({ knownSize: chunkSize(chunk, chunkEncoding), streaming: false });
    if (!encoder) return original.end.apply(res, arguments);
    if (typeof chunk === 'function') encoder.end(chunk);
    else if (typeof chunkEncoding === 'function')
      encoder.end(chunk, chunkEncoding);
    else encoder.end(chunk, chunkEncoding, callback);
    return res;
  };
}

/** Connect middleware that compresses text responses for capable clients. */
export function compressionMiddleware() {
  return (req, res, next) => {
    if (req.method === 'HEAD' || req.headers.upgrade) return next();
    const encoding = negotiateEncoding(req.headers['accept-encoding']);
    // Later compressors (Vite preview's own gzip) must not encode again.
    if (encoding) req.headers['accept-encoding'] = 'identity';
    wrapResponse(res, encoding);
    next();
  };
}

/** Vite plugin installing the middleware ahead of every provider route. */
export function compressionPlugin() {
  const install = (server) => {
    server.middlewares.use(compressionMiddleware());
  };
  return {
    name: 'gev-compression',
    enforce: 'pre',
    configureServer: install,
    configurePreviewServer: install,
  };
}
