import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freeOnlyPlugin,
  freeOnlyCapability,
  freeOnlyBrowserKeys,
} from './free-only.js';

for (const route of [
  '/api/google/nearby-places',
  '/api/google/text-search',
  '/api/google/geocode',
  '/api/realtime/token',
  '/api/realtime/oauth-login',
  '/api/openai/chat',
  '/api/gemini/chat',
  '/api/tomtom/flow',
  '/api/flights/track',
  '/API/GOOGLE/x',
  '/api/google.extra',
  '/api/x/../google/x',
]) {
  test(`denies ${route}`, () => assert.ok(freeOnlyCapability(route)));
}
for (const route of [
  '/api/flights?lat=30&lon=78',
  '/api/military',
  '/api/launches',
  '/api/setup/status',
  '/api/setup/keys',
  '/api/firms',
  '/api/route',
]) {
  test(`retains ${route}`, () => assert.equal(freeOnlyCapability(route), null));
}
test('browser key projection never exposes saved paid/unverified keys or mutates env', () => {
  const env = Object.freeze({
    GOOGLE_MAPS_API_KEY: 'saved',
    CESIUM_ION_TOKEN: 'saved',
    MAPILLARY_CLIENT_TOKEN: 'free',
  });
  assert.deepEqual(freeOnlyBrowserKeys(env), {
    googleApiKey: undefined,
    cesiumToken: undefined,
    mapillaryToken: 'free',
  });
  assert.equal(env.GOOGLE_MAPS_API_KEY, 'saved');
});
for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook} blocks before downstream and reports policy`, () => {
    let middleware;
    freeOnlyPlugin()[hook]({
      middlewares: {
        use(fn) {
          middleware = fn;
        },
      },
    });
    let next = 0,
      body;
    const res = {
      setHeader() {},
      end(value) {
        body = JSON.parse(value);
      },
    };
    middleware({ url: '/api/openai/chat' }, res, () => next++);
    assert.equal(next, 0);
    assert.equal(res.statusCode, 403);
    assert.equal(body.code, 'FREE_ONLY_BLOCKED');
    middleware({ url: '/api/firms' }, res, () => next++);
    assert.equal(next, 1);
    middleware({ url: '/api/openai/hud-summary/status' }, res, () => next++);
    assert.equal(body.configured, false);
  });
}

test('free-only flight adapter never attempts OpenSky OAuth or state requests', async (t) => {
  const { openSkyProxy } = await import('../providers/aircraft/opensky.js');
  let handler;
  openSkyProxy({ allowOpenSky: false }).configureServer({
    middlewares: {
      use(path, fn) {
        handler = fn;
      },
    },
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    assert.equal(new URL(url).hostname, 'api.adsb.lol');
    return new Response(JSON.stringify({ ac: [], now: Date.now() }));
  });
  const res = {
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
    },
    end(value) {
      this.body = JSON.parse(value);
    },
  };
  await handler({ url: '/?lat=30.3258&lon=78.0438' }, res, () =>
    assert.fail('unexpected next'),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
});

test('public launch adapter omits saved token through explicit resolver', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rocketLaunchesProxy } =
    await import('../providers/space/launch-library.js');
  const oldCwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), 'aurel-free-'));
  let plugin;
  try {
    process.chdir(dir);
    plugin = rocketLaunchesProxy({ resolveToken: () => '' });
  } finally {
    process.chdir(oldCwd);
  }
  let handler,
    calls = 0;
  plugin.configureServer({
    middlewares: {
      use(path, fn) {
        handler = fn;
      },
    },
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify({ results: [] }));
  });
  const res = {
    writeHead(status) {
      this.statusCode = status;
    },
    end() {},
  };
  await handler({ method: 'GET', url: '/' }, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  // The adapter's nonblocking disk write settles before temp cleanup.
  await new Promise((resolve) => setTimeout(resolve, 30));
  await rm(dir, { recursive: true, force: true });
});

test('Google token probe is a silent unavailable result, never an upstream request', () => {
  for (const method of ['GET', 'HEAD']) {
    let handler;
    freeOnlyPlugin().configureServer({
      middlewares: {
        use(fn) {
          handler = fn;
        },
      },
    });
    const res = {
      setHeader() {},
      end(value) {
        assert.equal(value, undefined);
      },
    };
    handler({ url: '/api/google/tiles-token', method }, res, () =>
      assert.fail('must not delegate'),
    );
    assert.equal(res.statusCode, 204);
  }
});

test('standalone free-only composition does not construct paid assistant or traffic middleware', async () => {
  const { localProviderPlugins } = await import('../providers/local.js');
  const names = localProviderPlugins({ freeOnly: true, gemini: {} }).map(
    (plugin) => plugin.name,
  );
  assert.ok(!names.includes('openai-realtime-proxy'));
  assert.ok(!names.includes('gemini-live-proxy'));
  assert.ok(!names.includes('tomtom-proxy'));
  assert.ok(
    names.includes('google-places-context-proxy'),
    'keyless routing stays mounted',
  );
});

test('Vite hooks never return the Connect app as a post-install hook', () => {
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    const connect = () => assert.fail('Connect must not run as a post hook');
    assert.equal(
      freeOnlyPlugin()[hook]({
        middlewares: {
          use() {
            return connect;
          },
        },
      }),
      undefined,
    );
  }
});

test('saved Google credentials cannot be spent by standalone Places or CCTV fallback in dev or preview', async (t) => {
  const { localProviderPlugins } = await import('../providers/local.js');
  const fakeEnvironment = {
    GOOGLE_MAPS_API_KEY: 'fixture-browser-saved',
    GOOGLE_MAPS_SERVER_API_KEY: 'fixture-server-saved',
    CCTV_SOURCES_JSON: '[]',
    CCTV_SOURCES_FILE: '/aurel-fixture-missing-camera-catalog.json',
    CCTV_FORCE_AUSTIN: '0',
  };
  const previous = Object.fromEntries(
    Object.keys(fakeEnvironment).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, fakeEnvironment);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    throw new Error('No upstream request expected for this fixture');
  });
  const response = () => ({
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = String(body ?? '');
    },
  });
  const request = (url) => ({
    method: 'GET',
    url,
    headers: {
      host: 'localhost:4173',
      origin: 'http://localhost:4173',
      'sec-fetch-site': 'same-origin',
    },
    socket: { remoteAddress: '127.0.0.1' },
  });
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    const plugins = localProviderPlugins({ freeOnly: true });
    const routes = new Map();
    const server = {
      middlewares: {
        use(path, handler) {
          routes.set(path, handler);
        },
      },
    };
    plugins
      .find((plugin) => plugin.name === 'google-places-context-proxy')
      [hook](server);
    assert.equal(routes.size, 4);
    // Exercise the underlying handlers without the outer deny middleware: their
    // injected key resolver must independently prevent Google requests.
    for (const handler of routes.values()) {
      const res = response();
      await handler(
        request('/?lat=30.3258&lon=78.0438&q=park&address=Dehradun'),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(res.body).configured, false);
      assert.ok(!res.body.includes('fixture-browser-saved'));
      assert.ok(!res.body.includes('fixture-server-saved'));
    }
    plugins.find((plugin) => plugin.name === 'cctv-proxy')[hook](server);
    const res = response();
    await routes.get('/api/cctv')(
      request('/frame/aurel-unregistered-fixture?lat=30.3258&lon=78.0438'),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['X-CCTV-Source'], 'synthetic');
    assert.match(res.body, /NO UPSTREAM CONFIGURED/);
    assert.deepEqual(
      requests.filter((url) =>
        new URL(url).hostname.endsWith('googleapis.com'),
      ),
      [],
      'neither direct Places nor internal Street View fallback may fetch Google',
    );
    assert.equal(
      process.env.GOOGLE_MAPS_API_KEY,
      fakeEnvironment.GOOGLE_MAPS_API_KEY,
    );
    assert.equal(
      process.env.GOOGLE_MAPS_SERVER_API_KEY,
      fakeEnvironment.GOOGLE_MAPS_SERVER_API_KEY,
    );
  }
});
