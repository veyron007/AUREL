import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirmsAreaService, firmsAreaProxy } from './firms-area.js';
const NOW = Date.parse('2026-11-07T12:00:00Z');
const bounds = { west: 77.9, south: 30.1, east: 78.2, north: 30.5 };
const header =
  'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp';
const csv = (...rows) => new Response([header, ...rows].join('\n'));
const row = (lat = 30.3, lon = 78, time = '1100') =>
  `${lat},${lon},2026-11-07,${time},N20,VIIRS,n,4.2`;

test('missing keys explain setup and never dispatch', async () => {
  const service = createFirmsAreaService({
    resolveKey: () => '',
    now: () => NOW,
    fetchImpl: () => {
      throw Error('unexpected');
    },
  });
  const value = await service.get(bounds);
  assert.equal(value.status, 'needs-key');
  assert.equal(value.fetchedAt, null);
  assert.match(value.limitations[0], /FIRMS_MAP_KEY/);
});
test('bounded area, trailing acquisition UTC, filtering before cap and shared cache', async () => {
  const urls = [];
  const service = createFirmsAreaService({
    resolveKey: () => 'secret-value',
    now: () => NOW,
    fetchImpl: async (url) => {
      urls.push(url);
      return csv(
        row(5, 5),
        ...Array.from({ length: 130 }, (_, i) =>
          row(30.3, 78, String(1000 + (i % 50))),
        ),
        row(30.3, 78, '1300'),
      );
    },
  });
  const [a, b] = await Promise.all([service.get(bounds), service.get(bounds)]);
  assert.equal(urls.length, 4);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'ok');
  assert.equal(a.matchedCount, 520);
  assert.equal(a.count, 500);
  assert.equal(a.truncated, true);
  assert.ok(
    a.observations.every(
      (x) => x.lat === 30.3 && x.acquiredAt.endsWith('Z') && x.frpMw === 4.2,
    ),
  );
  assert.ok(
    urls.every(
      (url) =>
        url.endsWith('/77.9,30.1,78.2,30.5/2') && !url.includes('/world/'),
    ),
  );
  assert.ok(!JSON.stringify(a).includes('secret-value'));
  await service.get(bounds);
  assert.equal(urls.length, 4);
});
test('partial success differs from successful empty observations', async () => {
  let n = 0;
  const service = createFirmsAreaService({
    resolveKey: () => 'fixture',
    now: () => NOW,
    fetchImpl: async () =>
      ++n === 1 ? new Response('denied', { status: 403 }) : csv(),
  });
  const value = await service.get(bounds);
  assert.equal(value.status, 'partial');
  assert.equal(value.sources[0].status, 'unavailable');
  assert.equal(value.count, 0);
  assert.match(value.limitations.join(' '), /not establish/);
});
test('all failures back off; stale cache preserves retrieval time but re-filters acquisition', async () => {
  let now = NOW,
    calls = 0,
    fail = false;
  const service = createFirmsAreaService({
    resolveKey: () => 'fixture',
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return fail
        ? new Response('', { status: 429, headers: { 'retry-after': '600' } })
        : csv(row());
    },
  });
  const fresh = await service.get(bounds);
  now += 31 * 60000;
  fail = true;
  const stale = await service.get(bounds);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.fetchedAt, fresh.fetchedAt);
  assert.equal(stale.sources[0].status, 'rate-limited');
  await service.get(bounds);
  assert.equal(calls, 5);
  now += 25 * 3600000;
  const expired = await service.get(bounds);
  assert.equal(expired.observations.length, 0);
  assert.equal(expired.matchedCount, 0);
});
test('invalid bounds and unknown query options cannot become arbitrary upstream URLs', async () => {
  const service = createFirmsAreaService({
    resolveKey: () => 'fixture',
    now: () => NOW,
  });
  await assert.rejects(() => service.get({ ...bounds, east: 99 }), /bounds/);
  let handler;
  firmsAreaProxy({ resolveKey: () => '' }).configureServer({
    middlewares: {
      use(route, h) {
        assert.equal(route, '/api/firms/area');
        handler = h;
      },
    },
  });
  const request = async (url, method = 'GET') => {
    let status, body;
    await handler(
      { url, method },
      {
        setHeader() {},
        writeHead(s) {
          status = s;
        },
        end(s) {
          body = JSON.parse(s);
        },
      },
    );
    return { status, body };
  };
  assert.equal(
    (await request('/?west=77&south=30&east=78&north=31&url=https://evil'))
      .status,
    400,
  );
  assert.equal(
    (await request('/?west=77&west=78&south=30&east=78&north=31')).status,
    400,
  );
  assert.equal((await request('/', 'POST')).status, 405);
  assert.equal(
    (await request('/?west=77&south=30&east=78&north=31')).body.status,
    'needs-key',
  );
});

test('invalid CSV and oversized streams are failed sources; hung transports meet deadlines', async () => {
  const responses = [
    () => new Response('Invalid MAP_KEY'),
    () =>
      new Response('csv', {
        headers: { 'content-length': String(3 * 1024 * 1024) },
      }),
    () => new Promise(() => {}),
  ];
  for (const fetchImpl of responses) {
    const service = createFirmsAreaService({
      resolveKey: () => 'fixture',
      now: () => NOW,
      fetchImpl,
      timeoutMs: 3,
    });
    const value = await service.get(bounds);
    assert.equal(value.status, 'unavailable');
    assert.ok(
      value.sources.every((x) =>
        ['invalid-response', 'timeout'].includes(x.status),
      ),
    );
  }
});
test('coordinate scrubbing is rate limited, cache is bounded, changed key never reuses credential state', async () => {
  let now = NOW,
    key = 'one',
    calls = 0;
  const service = createFirmsAreaService({
    resolveKey: () => key,
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return csv();
    },
  });
  await service.get(bounds);
  assert.equal(
    (await service.get({ ...bounds, west: 77.8 })).status,
    'unavailable',
  );
  assert.equal(calls, 4);
  for (let i = 0; i < 9; i++) {
    now += 16000;
    await service.get({ ...bounds, west: 77.7 + i / 100 });
  }
  now += 16000;
  await service.get(bounds);
  assert.equal(calls, 44);
  key = 'two';
  now += 16000;
  await service.get(bounds);
  assert.equal(calls, 48);
});

test('browser cross-site and per-client/global bursts are refused before key resolution', async () => {
  let handler,
    reads = 0;
  firmsAreaProxy({
    resolveKey: () => {
      reads++;
      return '';
    },
  }).configurePreviewServer({
    middlewares: {
      use(_route, h) {
        handler = h;
      },
    },
  });
  const request = async (headers = {}, ip = '127.0.0.1') => {
    let payload;
    const res = {
      statusCode: 200,
      setHeader() {},
      writeHead(s) {
        this.statusCode = s;
      },
      end(s) {
        payload = JSON.parse(s);
      },
    };
    await handler(
      {
        method: 'GET',
        url: '/?west=77&south=30&east=78&north=31',
        headers: { host: 'localhost:4173', ...headers },
        socket: { remoteAddress: ip },
      },
      res,
    );
    return { status: res.statusCode, payload };
  };
  assert.equal(
    (
      await request({
        origin: 'https://foreign.test',
        'sec-fetch-site': 'cross-site',
      })
    ).status,
    403,
  );
  assert.equal(reads, 0);
  for (let i = 0; i < 12; i++) assert.equal((await request()).status, 503);
  assert.equal((await request()).status, 429);
  assert.equal(reads, 12);
  for (let i = 0; i < 36; i++) await request({}, `192.0.2.${i}`);
  assert.equal((await request({}, '192.0.2.99')).status, 429);
  assert.equal(reads, 48);
});
test('unexpected service failures return generic upstream errors, not input errors or secrets', async () => {
  let handler;
  firmsAreaProxy({
    resolveKey: () => {
      throw Error('secret-marker');
    },
  }).configureServer({
    middlewares: {
      use(_route, h) {
        handler = h;
      },
    },
  });
  let status, text;
  await handler(
    { method: 'GET', url: '/?west=77&south=30&east=78&north=31' },
    {
      setHeader() {},
      writeHead(s) {
        status = s;
      },
      end(s) {
        text = s;
      },
    },
  );
  assert.equal(status, 502);
  assert.ok(!text.includes('secret-marker'));
});

test('failure cooldown retains source diagnostics and respects upstream Retry-After', async () => {
  let now = NOW,
    calls = 0;
  const service = createFirmsAreaService({
    resolveKey: () => 'fixture',
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return new Response('', {
        status: 429,
        headers: { 'retry-after': '600' },
      });
    },
  });
  const first = await service.get(bounds);
  now += 6 * 60000;
  const cooling = await service.get(bounds);
  assert.equal(calls, 1);
  assert.deepEqual(cooling.sources, first.sources);
  assert.equal(cooling.status, 'unavailable');
  now += 5 * 60000;
  await service.get(bounds);
  assert.equal(calls, 2);
});

test('a 429 after partial success stops remaining sources and pauses every area for the key', async () => {
  let now = NOW,
    calls = 0;
  const service = createFirmsAreaService({
    resolveKey: () => 'fixture',
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? csv(row())
        : new Response('', { status: 429, headers: { 'retry-after': '600' } });
    },
  });
  const first = await service.get(bounds);
  assert.equal(first.status, 'partial');
  assert.equal(calls, 2);
  assert.equal(first.sources.length, 4);
  now += 16000;
  const other = await service.get({ ...bounds, west: 77.8 });
  assert.equal(other.status, 'unavailable');
  assert.equal(calls, 2);
  now += 9 * 60000;
  await service.get({ ...bounds, west: 77.7 });
  assert.equal(calls, 2);
  now += 60000;
  await service.get({ ...bounds, west: 77.6 });
  assert.equal(calls, 3);
});
test('missing blank nonnumeric and negative FRP rows are rejected, never invented as zero', async () => {
  const bad = ['', '-1', 'NaN', 'n/a', 'Infinity', '0x10'];
  const service = createFirmsAreaService({
    resolveKey: () => 'fixture',
    now: () => NOW,
    fetchImpl: async () =>
      csv(
        row().replace('4.2', '0'),
        row(),
        ...bad.map((value) => row().replace('4.2', value)),
      ),
  });
  const result = await service.get(bounds);
  assert.equal(result.status, 'partial');
  assert.ok(
    result.sources.every(
      (source) => source.status === 'partial' && source.count === 2,
    ),
  );
  assert.equal(result.count, 8);
  assert.equal(result.matchedCount, 8);
  assert.deepEqual(
    [...new Set(result.observations.map((x) => x.frpMw))].sort(),
    [0, 4.2],
  );
});

test('Vite setup hooks do not return Connect as an unintended post-install hook', () => {
  const plugin = firmsAreaProxy({ resolveKey: () => '' });
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    const installed = [];
    const connect = () => {
      throw new Error('Connect must not become a Vite post hook');
    };
    const result = plugin[hook]({
      middlewares: {
        use(...args) {
          installed.push(args);
          return connect;
        },
      },
    });
    assert.equal(installed.length, 1);
    assert.equal(installed[0][0], '/api/firms/area');
    assert.equal(result, undefined);
  }
});
