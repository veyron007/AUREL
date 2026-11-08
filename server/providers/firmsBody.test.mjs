import assert from 'node:assert/strict';
import test from 'node:test';

import { filterTrailing24h } from '../../src/data/firmsCsv.js';
import {
  createFirmsBodyCache,
  firmsCacheControl,
  firmsFilterCutoff,
  ifNoneMatchHits,
} from './firmsBody.js';

const TTL_MS = 30 * 60_000;
const AT = Date.UTC(2026, 10, 8, 12, 0);
const SOURCES = [{ source: 'VIIRS_NOAA20_NRT', count: 3, ok: true }];

function fire(date, time, extra = {}) {
  return { acqDate: date, acqTime: time, lat: 1, lon: 2, frp: 3, ...extra };
}

const ENTRY = Object.freeze({
  at: AT,
  sources: SOURCES,
  fires: [
    fire('2026-11-07', '1210'), // ages out 10 min after AT
    fire('2026-11-08', '0900'),
    fire('2026-11-08', '1130'),
  ],
});

/** The pre-ETag serve path: re-filter at request time, stringify every time. */
function legacyBody(entry, stale, now) {
  const fires = filterTrailing24h(entry.fires, now);
  return JSON.stringify({
    fetchedAt: entry.at,
    stale,
    ttlMs: TTL_MS,
    sources: entry.sources,
    count: fires.length,
    fires,
  });
}

test('a fresh entry is serialized once and reused until it is replaced', () => {
  let stringifyCalls = 0;
  const cache = createFirmsBodyCache({
    ttlMs: TTL_MS,
    stringify: (value) => {
      stringifyCalls++;
      return JSON.stringify(value);
    },
  });
  const first = cache.get(ENTRY, false, AT + 60_000);
  const second = cache.get(ENTRY, false, AT + 25 * 60_000);
  assert.equal(stringifyCalls, 1);
  assert.equal(first.body, second.body);
  assert.equal(first.etag, second.etag);
});

test('the fresh body equals the legacy body at the moment of refresh', () => {
  const cache = createFirmsBodyCache({ ttlMs: TTL_MS });
  assert.equal(cache.get(ENTRY, false, AT).body, legacyBody(ENTRY, false, AT));
});

test('client clamp of the cached body returns the same records as the legacy path', () => {
  const cache = createFirmsBodyCache({ ttlMs: TTL_MS });
  const later = AT + 20 * 60_000;
  const served = JSON.parse(cache.get(ENTRY, false, later).body);
  const legacy = JSON.parse(legacyBody(ENTRY, false, later));
  assert.deepEqual(filterTrailing24h(served.fires, later), legacy.fires);
});

test('a refresh changes the ETag', () => {
  const cache = createFirmsBodyCache({ ttlMs: TTL_MS });
  const before = cache.get(ENTRY, false, AT).etag;
  const refreshed = { ...ENTRY, at: AT + TTL_MS };
  assert.notEqual(cache.get(refreshed, false, AT + TTL_MS).etag, before);
});

test('the stale flag changes the ETag and the body', () => {
  const cache = createFirmsBodyCache({ ttlMs: TTL_MS });
  const fresh = cache.get(ENTRY, false, AT);
  const stale = cache.get(ENTRY, true, AT + TTL_MS + 1);
  assert.notEqual(stale.etag, fresh.etag);
  assert.equal(JSON.parse(stale.body).stale, true);
});

test('a stale entry is re-filtered once per TTL bucket and never serves fires older than one bucket past 24 h', () => {
  const now = AT + 3 * TTL_MS + 5 * 60_000;
  const cutoff = firmsFilterCutoff(ENTRY, true, now, TTL_MS);
  assert.ok(cutoff <= now && now - cutoff < TTL_MS);
  const cache = createFirmsBodyCache({ ttlMs: TTL_MS });
  const body = JSON.parse(cache.get(ENTRY, true, now).body);
  assert.deepEqual(body.fires, filterTrailing24h(ENTRY.fires, cutoff));
  assert.equal(body.count, body.fires.length);
});

test('If-None-Match matching follows weak comparison and lists', () => {
  const etag = 'W/"firms-1-f-1"';
  assert.equal(ifNoneMatchHits(etag, etag), true);
  assert.equal(ifNoneMatchHits('"firms-1-f-1"', etag), true);
  assert.equal(ifNoneMatchHits('"x", W/"firms-1-f-1"', etag), true);
  assert.equal(ifNoneMatchHits('*', etag), true);
  assert.equal(ifNoneMatchHits('"firms-2-f-2"', etag), false);
  assert.equal(ifNoneMatchHits(undefined, etag), false);
  assert.equal(ifNoneMatchHits('', etag), false);
});

test('Cache-Control lets a fresh body live only until the next upstream refresh', () => {
  assert.equal(
    firmsCacheControl(ENTRY, false, AT + 10 * 60_000, TTL_MS),
    'private, max-age=1200',
  );
  assert.equal(
    firmsCacheControl(ENTRY, false, AT + TTL_MS + 5, TTL_MS),
    'private, max-age=0',
  );
  assert.equal(firmsCacheControl(ENTRY, true, AT, TTL_MS), 'no-cache');
});

test('the /api/firms middleware answers a repeat poll with a bodyless 304', async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { firmsProxy } = await import('./firms.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'firms-etag-'));
  const cwd = process.cwd();
  const key = process.env.FIRMS_MAP_KEY;
  t.after(async () => {
    process.chdir(cwd);
    if (key === undefined) delete process.env.FIRMS_MAP_KEY;
    else process.env.FIRMS_MAP_KEY = key;
    await rm(dir, { recursive: true, force: true });
  });
  const now = Date.now();
  const iso = new Date(now - 3_600_000).toISOString();
  const recent = fire(iso.slice(0, 10), iso.slice(11, 16).replace(':', ''));
  await mkdir(path.join(dir, '.gev-cache'));
  await writeFile(
    path.join(dir, '.gev-cache', 'firms.json'),
    JSON.stringify({ at: now, sources: SOURCES, fires: [recent] }),
  );
  process.chdir(dir);
  process.env.FIRMS_MAP_KEY = 'fixture-key';
  let handler;
  firmsProxy().configureServer({
    middlewares: { use: (_path, fn) => (handler = fn) },
  });
  const call = (headers = {}) =>
    new Promise((resolve) => {
      const res = {
        headersSent: false,
        writeHead(status, head) {
          this.status = status;
          this.head = head;
          this.headersSent = true;
        },
        end(body) {
          resolve({ status: this.status, head: this.head, body });
        },
      };
      handler({ url: '/', headers }, res);
    });
  const first = await call();
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).fires.length, 1);
  assert.match(first.head['Cache-Control'], /^private, max-age=\d+$/);
  const repeat = await call({ 'if-none-match': first.head.ETag });
  assert.equal(repeat.status, 304);
  assert.equal(repeat.body, undefined);
  assert.equal(repeat.head.ETag, first.head.ETag);
});
