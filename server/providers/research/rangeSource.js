const MAX_BYTES = 24 * 1024 * 1024;
const MAX_SLICE = 4 * 1024 * 1024;
const MAX_REQUESTS = 64;
export function admittedCogUrl(value) {
  if (typeof value !== 'string' || value.length > 400)
    throw new Error('unsupported-asset');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'sentinel-cogs.s3.us-west-2.amazonaws.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/sentinel-s2-l2a-cogs\/\d{1,2}\/[A-Z]\/[A-Z]{2}\/\d{4}\/\d{1,2}\/S2[ABC]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A\/(B04|B08|SCL)\.tif$/.test(
      url.pathname,
    )
  )
    throw new Error('unsupported-asset');
  return url.href;
}
export function createRangeBudget({
  maxBytes = MAX_BYTES,
  maxRequests = MAX_REQUESTS,
} = {}) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES ||
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > MAX_REQUESTS
  )
    throw new Error('invalid-budget');
  let bytes = 0,
    requests = 0;
  return {
    reserve(length) {
      if (
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > MAX_SLICE ||
        bytes + length > maxBytes ||
        requests + 1 > maxRequests
      )
        throw new Error('range-budget-exceeded');
      bytes += length;
      requests++;
    },
    snapshot: () => ({ bytes, requests, maxBytes, maxRequests }),
  };
}
async function exactBody(response, length, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid-range-response');
  const bytes = new Uint8Array(length);
  let offset = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > length)
        throw new Error('invalid-range-response');
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== length) throw new Error('invalid-range-response');
    return bytes.buffer;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** GeoTIFF custom source: never accepts a 200/full-file fallback. */
export function createRangeSource(
  value,
  { fetchImpl = fetch, budget = createRangeBudget() } = {},
) {
  const url = admittedCogUrl(value);
  let fileSize = null,
    etag = null;
  return {
    get fileSize() {
      return fileSize;
    },
    async fetch(slices, signal) {
      if (!Array.isArray(slices) || slices.length > MAX_REQUESTS)
        throw new Error('invalid-range');
      const results = [];
      for (const { offset, length } of slices) {
        signal?.throwIfAborted();
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(length) ||
          length < 1 ||
          offset + length > 1024 * 1024 * 1024
        )
          throw new Error('invalid-range');
        budget.reserve(length);
        const response = await fetchImpl(url, {
          signal,
          redirect: 'error',
          headers: {
            Range: `bytes=${offset}-${offset + length - 1}`,
            ...(etag ? { 'If-Match': etag } : {}),
          },
        });
        if (response.status === 429) {
          await response.body?.cancel().catch(() => {});
          const retry = response.headers.get('retry-after');
          const seconds = Number(retry);
          const delay =
            Number.isFinite(seconds) && seconds > 0
              ? seconds * 1000
              : Date.parse(retry) - Date.now();
          throw Object.assign(new Error('rate-limited'), {
            retryMs: Math.min(
              86400000,
              Math.max(600000, Number.isFinite(delay) ? delay : 0),
            ),
          });
        }
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.headers.get('content-range') || '',
        );
        const nextEtag = response.headers.get('etag');
        const valid =
          response.status === 206 &&
          match &&
          Number(match[1]) === offset &&
          Number(match[2]) === offset + length - 1 &&
          Number(match[3]) > Number(match[2]) &&
          Number(match[3]) <= 1024 * 1024 * 1024 &&
          typeof nextEtag === 'string' &&
          /^"[\x21\x23-\x7e]{1,126}"$/.test(nextEtag) &&
          (fileSize === null || fileSize === Number(match[3])) &&
          (!etag || nextEtag === etag) &&
          (!response.headers.has('content-length') ||
            Number(response.headers.get('content-length')) === length);
        if (!valid) {
          await response.body?.cancel().catch(() => {});
          throw new Error('invalid-range-response');
        }
        fileSize = Number(match[3]);
        etag ||= nextEtag;
        results.push(await exactBody(response, length, signal));
      }
      return results;
    },
    async close() {},
  };
}
