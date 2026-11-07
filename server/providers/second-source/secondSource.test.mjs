import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequestLedger } from './ledger.js';
import { fetchBounded, retryAfterMs } from './transport.js';
import { createEmscAdapter, parseEmscEvents } from './emsc.js';
import { createGeofonAdapter, parseGeofonEvents } from './geofon.js';
import { createAdsbFiAdapter, parseAircraftV2, validHex } from './aircraft.js';
import { validQuakeQuery } from './quakeQuery.js';
import { createSecondSourceService, secondSourceProxy } from './index.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-07T04:20:00Z');
const UTTARKASHI = {
  lat: 30.8109,
  lon: 78.4864,
  timeMs: Date.parse('2026-10-10T14:37:31.202Z'),
};
const HONSHU = {
  lat: 34.99,
  lon: 142.16,
  timeMs: Date.parse('2026-11-06T10:39:28Z'),
};
const noSleep = async () => {};

function clock(start = NOW) {
  let at = start;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}
function looseLedger(now) {
  return createRequestLedger({
    sourceId: 'test',
    budget: { minIntervalMs: 1, perMinute: 1000, perDay: 1000 },
    now,
  });
}
const respond = (body, status = 200, headers = {}) =>
  new Response(status === 204 ? null : body, { status, headers });

test('ledger refuses before dispatch on spacing, minute and daily caps', () => {
  const time = clock();
  const ledger = createRequestLedger({
    sourceId: 'emsc',
    budget: { minIntervalMs: 1000, perMinute: 2, perDay: 3 },
    now: time.now,
  });
  assert.equal(ledger.reserve().ok, true);
  const spacing = ledger.reserve();
  assert.deepEqual(
    [spacing.ok, spacing.reason, spacing.retryAfterMs],
    [false, 'min-interval', 1000],
  );
  time.advance(1000);
  assert.equal(ledger.reserve().ok, true);
  time.advance(1000);
  assert.equal(ledger.reserve().reason, 'minute-limit');
  time.advance(60_000);
  assert.equal(ledger.reserve().ok, true);
  time.advance(60_000);
  assert.equal(ledger.reserve().reason, 'daily-limit');
  const row = ledger.snapshot();
  assert.equal(row.lastDay, 3);
  assert.equal(row.totals.dispatched, 3);
  assert.equal(row.totals.denied, 3);
  time.advance(24 * 3_600_000);
  assert.equal(ledger.reserve().ok, true, 'the trailing day releases');
});

test('ledger cools down on 429 honouring a bounded Retry-After', () => {
  const time = clock();
  const ledger = createRequestLedger({
    sourceId: 'adsb-fi',
    budget: { minIntervalMs: 1, perMinute: 100, perDay: 100 },
    now: time.now,
  });
  ledger.reserve();
  ledger.settle({ ok: false, status: 429, retryAfterMs: 2_000_000 });
  const denied = ledger.reserve();
  assert.equal(denied.reason, 'cooldown');
  assert.equal(denied.retryAfterMs, 600_000, 'capped at ten minutes');
  assert.equal(ledger.snapshot().cooldownStatus, 429);
  time.advance(600_000);
  assert.equal(ledger.reserve().ok, true);
  assert.equal(retryAfterMs(new Headers({ 'retry-after': '7' })), 7000);
  assert.equal(retryAfterMs(new Headers()), null);
});

test('transport retries 5xx with backoff, never retries 4xx, and reserves every attempt', async () => {
  const time = clock();
  const ledger = looseLedger(time.now);
  const waits = [];
  const sleep = async (ms) => {
    waits.push(ms);
    time.advance(ms);
  };
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    return calls === 1 ? respond('busy', 503) : respond('{"ok":1}');
  };
  const ok = await fetchBounded({
    ledger,
    url: 'https://example.test/a',
    agent: 't',
    fetchImpl: flaky,
    sleep,
  });
  assert.deepEqual([ok.ok, ok.text, calls], [true, '{"ok":1}', 2]);
  assert.deepEqual(waits, [600]);
  assert.equal(ledger.snapshot().totals.dispatched, 2);

  calls = 0;
  const missing = await fetchBounded({
    ledger: looseLedger(time.now),
    url: 'https://example.test/b',
    agent: 't',
    fetchImpl: async () => {
      calls += 1;
      return respond('no', 404);
    },
    sleep,
  });
  assert.deepEqual([missing.kind, missing.status, calls], ['http', 404, 1]);

  const large = await fetchBounded({
    ledger: looseLedger(time.now),
    url: 'https://example.test/c',
    agent: 't',
    maxBytes: 4,
    fetchImpl: async () => respond('0123456789'),
    sleep,
  });
  assert.equal(large.kind, 'too-large');

  const down = await fetchBounded({
    ledger: looseLedger(time.now),
    url: 'https://example.test/d',
    agent: 't',
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    sleep,
  });
  assert.equal(down.kind, 'network');
});

test('a denied reservation never reaches fetch', async () => {
  const time = clock();
  const ledger = createRequestLedger({
    sourceId: 'geofon',
    budget: { minIntervalMs: 1, perMinute: 1, perDay: 1 },
    now: time.now,
  });
  ledger.reserve();
  time.advance(10);
  const result = await fetchBounded({
    ledger,
    url: 'https://example.test',
    agent: 't',
    fetchImpl: () => assert.fail('must not dispatch'),
  });
  assert.equal(result.kind, 'denied');
  assert.equal(result.reason, 'minute-limit');
});

test('quake queries are bounded in space, time and rows', async () => {
  assert.equal(validQuakeQuery({ lat: 95, lon: 0, timeMs: NOW }), null);
  assert.equal(validQuakeQuery({ lat: 0, lon: 0, timeMs: 'x' }), null);
  const urls = [];
  const adapter = createEmscAdapter({
    ledger: looseLedger(() => NOW),
    now: () => NOW,
    fetchImpl: async (url) => {
      urls.push(url);
      return respond(fixture('emsc-uttarkashi-2026-10-10.json'));
    },
  });
  const answer = await adapter.get(UTTARKASHI);
  const params = new URL(urls[0]).searchParams;
  assert.equal(params.get('starttime'), '2026-10-10T14:34:30');
  assert.equal(params.get('endtime'), '2026-10-10T14:40:30');
  assert.equal(params.get('maxradius'), '2');
  assert.equal(params.get('limit'), '20');
  assert.equal(params.get('lat'), '30.81');
  assert.equal(answer.state, 'ok');
  assert.deepEqual(
    [answer.records[0].author, answer.records[0].mag, answer.records[0].lat],
    ['NDI', 4.2, 30.744],
  );
});

test('EMSC parser keeps valid rows and counts malformed ones', () => {
  const payload = JSON.parse(fixture('emsc-honshu-2026-11-06.json'));
  const broken = {
    ...payload,
    features: [
      ...payload.features,
      { properties: { time: 'not a time', lat: 1, lon: 1 } },
    ],
  };
  const parsed = parseEmscEvents(JSON.stringify(broken));
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.dropped, 1);
  assert.equal(parsed.records[0].author, 'EMSC');
  assert.equal(parseEmscEvents('{"nope":1}'), null);
});

test('GEOFON text parser reads UTC times and empty answers', () => {
  const parsed = parseGeofonEvents(fixture('geofon-honshu-2026-11-06.txt'));
  assert.equal(parsed.records.length, 1);
  assert.equal(
    new Date(parsed.records[0].timeMs).toISOString(),
    '2026-11-06T10:39:28.290Z',
  );
  assert.deepEqual(
    [
      parsed.records[0].author,
      parsed.records[0].magType,
      parsed.records[0].mag,
    ],
    ['GFZ', 'Mw', 6.01],
  );
  assert.deepEqual(parseGeofonEvents(''), { records: [], dropped: 0 });
  assert.equal(parseGeofonEvents('<html>error</html>'), null);
});

test('adapter states: ok, empty, partial, stale, unavailable and denied', async () => {
  const time = clock();
  let reply = () => respond(fixture('geofon-honshu-2026-11-06.txt'));
  const adapter = createGeofonAdapter({
    ledger: looseLedger(time.now),
    now: time.now,
    sleep: async (ms) => time.advance(ms),
    fetchImpl: async () => reply(),
  });
  assert.equal((await adapter.get(HONSHU)).state, 'ok');
  assert.equal((await adapter.get(HONSHU)).cache, 'hit');

  time.advance(6 * 60_000);
  reply = () => respond('', 500);
  const stale = await adapter.get(HONSHU);
  assert.deepEqual(
    [stale.state, stale.reason, stale.records.length],
    ['stale', 'http:500', 1],
  );

  const cooling = await adapter.get(UTTARKASHI);
  assert.deepEqual(
    [cooling.state, cooling.reason],
    ['denied', 'budget:cooldown'],
    'a failed upstream is not asked again during its cooldown',
  );
  time.advance(20_000);
  const unavailable = await adapter.get(UTTARKASHI);
  assert.equal(unavailable.state, 'unavailable', 'no cache for this box');
  time.advance(20_000);
  reply = () => respond(null, 204);
  assert.equal(
    (await adapter.get({ ...UTTARKASHI, lat: 30.9 })).state,
    'empty',
  );

  reply = () =>
    respond(`${fixture('geofon-honshu-2026-11-06.txt').trim()}\nbad|row|x|y\n`);
  assert.equal(
    (await adapter.get({ ...UTTARKASHI, lat: 31.5 })).state,
    'partial',
  );

  reply = () => respond('<html>maintenance</html>');
  const malformed = await adapter.get({ ...UTTARKASHI, lat: 32 });
  assert.deepEqual(
    [malformed.state, malformed.reason],
    ['unavailable', 'malformed'],
  );

  time.advance(2 * 3_600_000);
  reply = () => respond('', 503);
  assert.equal(
    (await adapter.get(HONSHU)).state,
    'unavailable',
    'stale answers expire',
  );

  const strict = createRequestLedger({
    sourceId: 'geofon',
    budget: { minIntervalMs: 1, perMinute: 1, perDay: 1 },
    now: time.now,
  });
  strict.reserve();
  time.advance(10);
  const denied = await createGeofonAdapter({
    ledger: strict,
    now: time.now,
    fetchImpl: () => assert.fail('must not dispatch'),
  }).get(HONSHU);
  assert.deepEqual(
    [denied.state, denied.reason],
    ['denied', 'budget:minute-limit'],
  );
});

test('row limit marks the answer partial (truncated)', async () => {
  const payload = JSON.parse(fixture('emsc-honshu-2026-11-06.json'));
  const feature = payload.features[0];
  const many = {
    ...payload,
    features: Array.from({ length: 20 }, (_, index) => ({
      ...feature,
      properties: { ...feature.properties, unid: `row-${index}` },
    })),
  };
  const answer = await createEmscAdapter({
    ledger: looseLedger(() => NOW),
    now: () => NOW,
    fetchImpl: async () => respond(JSON.stringify(many)),
  }).get(UTTARKASHI);
  assert.deepEqual([answer.state, answer.truncated], ['partial', true]);
});

test('aircraft v2 parser aligns position time and accepts second or ms clocks', () => {
  const fi = parseAircraftV2(fixture('adsbfi-hex-8014f9.json'), {
    hex: '8014f9',
  });
  const raw = JSON.parse(fixture('adsbfi-hex-8014f9.json'));
  assert.equal(fi.records.length, 1);
  assert.equal(
    fi.records[0].positionTimeMs,
    Math.round(raw.now - raw.ac[0].seen_pos * 1000),
  );
  assert.equal(fi.records[0].positionType, 'adsb');
  const seconds = parseAircraftV2(
    JSON.stringify({
      now: 1794024780.5,
      aircraft: [{ ...raw.ac[0], seen_pos: 0.5 }],
    }),
  );
  assert.equal(seconds.records[0].positionTimeMs, 1794024780000);
  assert.deepEqual(parseAircraftV2(fixture('adsbfi-hex-empty.json')), {
    records: [],
    dropped: 0,
  });
  const other = parseAircraftV2(fixture('adsbfi-hex-8014f9.json'), {
    hex: '800c0c',
  });
  assert.equal(other.dropped, 1, 'a row for another address is never used');
  assert.equal(validHex('8014F9'), '8014f9');
  assert.equal(validHex('8014f9; rm'), null);
});

test('adsb.fi spacing waits briefly instead of failing a second selection', async () => {
  const time = clock();
  const ledger = createRequestLedger({
    sourceId: 'adsb-fi',
    budget: { minIntervalMs: 1100, perMinute: 20, perDay: 100 },
    now: time.now,
  });
  const adapter = createAdsbFiAdapter({
    ledger,
    now: time.now,
    sleep: async (ms) => time.advance(ms),
    fetchImpl: async () => respond(fixture('adsbfi-hex-empty.json')),
  });
  assert.equal((await adapter.get({ hex: '8014f9' })).state, 'empty');
  assert.equal((await adapter.get({ hex: '800c0c' })).state, 'empty');
  assert.equal(ledger.snapshot().totals.dispatched, 2);
});

test('service validates selections and reports per-source ledgers', async () => {
  const service = createSecondSourceService({
    now: () => NOW,
    sleep: noSleep,
    fetchImpl: async (url) =>
      String(url).includes('seismicportal')
        ? respond(fixture('emsc-uttarkashi-2026-10-10.json'))
        : String(url).includes('geofon')
          ? respond(null, 204)
          : respond(fixture('adsbfi-hex-empty.json')),
  });
  assert.equal(await service.quake({ lat: 'x', lon: 1, timeMs: NOW }), null);
  assert.equal(await service.aircraft({ hex: 'zzzzzz' }), null);
  const quake = await service.quake(UTTARKASHI);
  assert.deepEqual(
    [quake.sources.emsc.state, quake.sources.geofon.state],
    ['ok', 'empty'],
  );
  const status = service.status();
  assert.deepEqual(Object.keys(status).sort(), [
    'adsb-fi',
    'adsb-lol',
    'emsc',
    'geofon',
  ]);
  assert.equal(status.emsc.lastDay, 1);
  assert.equal(status['adsb-fi'].lastDay, 0);
});

test('route validates method and query, and never dispatches for bad input', async () => {
  let handler;
  secondSourceProxy({
    fetchImpl: () => assert.fail('must not dispatch'),
  }).configureServer({
    middlewares: {
      use(_path, fn) {
        handler = fn;
      },
    },
  });
  const call = (url, method = 'GET') =>
    new Promise((resolve) => {
      const res = {
        headers: {},
        statusCode: 200,
        headersSent: false,
        setHeader(name, value) {
          this.headers[name] = value;
        },
        end(body) {
          resolve({ status: this.statusCode, body: JSON.parse(body) });
        },
      };
      handler(
        { url, method, headers: { host: 'localhost:4173' }, socket: {} },
        res,
      );
    });
  assert.equal((await call('/quake?lat=1', 'POST')).status, 405);
  assert.equal((await call('/quake?lat=x&lon=1&time=1')).status, 400);
  assert.equal((await call('/aircraft?hex=nothex')).status, 400);
  assert.equal((await call('/elsewhere')).status, 404);
  const status = await call('/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.emsc.totals.dispatched, 0);
});
