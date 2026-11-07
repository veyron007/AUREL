import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFirmsArea } from '../sources/firmsArea.js';
import { WatchlistController } from './watchlistController.js';
import {
  createWatchDefinition,
  emptyWatchRuntime,
} from '../watchlists/model.js';
const origin = Date.parse('2026-11-07T12:00:00Z'),
  place = {
    id: 'p',
    name: 'Dehradun',
    geometry: { type: 'Point', coordinates: [78.03, 30.3] },
    extent: [78, 30.2, 78.1, 30.4],
  };
const copy = (x) => structuredClone(x),
  settle = () => new Promise((r) => setTimeout(r, 0));
function fixture({ source } = {}) {
  let clock = origin,
    visible = true,
    visibilityChanged,
    calls = 0;
  const pending = new Map();
  let sequence = 0;
  const definition = createWatchDefinition({ place }, { id: 'w', now: clock }),
    records = new Map([
      ['w', { definition, runtime: emptyWatchRuntime(), lease: null }],
    ]);
  const repo = {
    list: async () => ({
      watches: [...records.values()].map(copy),
      corrupt: [],
    }),
    get: async (id) => copy(records.get(id)),
    save: async (d) => {
      const r = {
        definition: { ...d, revision: 1 },
        runtime: emptyWatchRuntime(),
        lease: null,
      };
      records.set(d.id, r);
      return copy(r);
    },
    claim: async (id, ownerId, at) => {
      const r = records.get(id);
      if (r.lease && r.lease.ownerId !== ownerId && r.lease.until > at)
        throw Object.assign(Error(), { code: 'OTHER_TAB' });
      r.lease = { ownerId, token: String(++sequence), until: at + 90000 };
      return copy(r);
    },
    renew: async (id, owner, token, at) => {
      const r = records.get(id);
      if (r.lease?.token !== token) throw Error();
      r.lease.until = at + 90000;
      return copy(r);
    },
    commit: async (id, owner, token, runtime) => {
      const r = records.get(id);
      if (r.lease?.token !== token) throw Error();
      r.runtime = copy(runtime);
      return copy(r);
    },
    release: async (id, owner, token) => {
      const r = records.get(id);
      if (r.lease?.token === token) r.lease = null;
      return copy(r);
    },
    remove: async (id) => records.delete(id),
    clearNotifications: async (id) => {
      records.get(id).runtime.notifications = [];
      return copy(records.get(id));
    },
    close() {},
  };
  const controller = new WatchlistController({
    repository: repo,
    readSavedPlaces: () => [place],
    now: () => clock,
    visibility: () => visible,
    subscribeVisibility: (fn) => {
      visibilityChanged = fn;
      return () => {};
    },
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++sequence;
        pending.set(id, { fn, at: clock + ms });
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    source: {
      check: async (bounds, options) => {
        calls++;
        return source
          ? source(bounds, options)
          : {
              context: {
                status: 'ok',
                source: 'NASA FIRMS',
                fetchedAt: clock,
                window: {
                  start: new Date(clock - 86400000).toISOString(),
                  end: new Date(clock).toISOString(),
                },
                bounds,
                sources: [{ id: 'VIIRS_NOAA20_NRT', status: 'ok', count: 0 }],
                matchedCount: 0,
                count: 0,
                truncated: false,
                observations: [],
                limitations: [],
              },
              retryAt: null,
            };
      },
    },
  });
  return {
    controller,
    repo,
    records,
    pending,
    calls: () => calls,
    async visible(value) {
      visible = value;
      visibilityChanged();
      await settle();
    },
    async advance(ms) {
      clock += ms;
      const due = [...pending].filter(([, v]) => v.at <= clock);
      for (const [id, job] of due) {
        pending.delete(id);
        job.fn();
      }
      await settle();
    },
  };
}
test('init only loads definitions; explicit start baselines then stop clears all timers and lease', async () => {
  const f = fixture();
  await f.controller.init();
  assert.equal(f.calls(), 0);
  assert.equal(f.pending.size, 0);
  await f.controller.start('w');
  await settle();
  assert.equal(f.calls(), 1);
  assert.equal(f.controller.view.watches[0].baselinePending, false);
  assert.equal(f.records.get('w').runtime.notifications.length, 0);
  await f.controller.stop('w');
  assert.equal(f.pending.size, 0);
  assert.equal(f.records.get('w').lease, null);
  await f.advance(3600000);
  assert.equal(f.calls(), 1);
  await f.controller.destroy();
});
test('hidden pages pause without fetch and visible resume respects minimum interval', async () => {
  const f = fixture();
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  await f.visible(false);
  assert.equal(f.pending.size, 0);
  assert.equal(f.controller.view.watches[0].state, 'paused-hidden');
  await f.visible(true);
  assert.equal(f.calls(), 1);
  assert.equal(f.controller.view.watches[0].state, 'paused-cooldown');
  await f.controller.destroy();
});
test('stop aborts an outstanding source and late settlement cannot publish', async () => {
  let finish, signal;
  const f = fixture({
    source: (bounds, options) => {
      signal = options.signal;
      return new Promise((r) => {
        finish = r;
      });
    },
  });
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  await f.controller.stop('w');
  assert.equal(signal.aborted, true);
  finish({ context: { status: 'unavailable' } });
  await settle();
  assert.equal(f.records.get('w').runtime.lastSuccessAt, null);
  assert.equal(f.pending.size, 0);
  await f.controller.destroy();
});
test('foreign active leases block local acquisition', async () => {
  const f = fixture();
  await f.controller.init();
  f.records.get('w').lease = {
    ownerId: 'another-tab',
    token: 'other',
    until: origin + 90000,
  };
  await f.controller.start('w');
  assert.equal(f.calls(), 0);
  assert.equal(f.controller.view.watches[0].state, 'other-tab');
  await f.controller.destroy();
  assert.equal(f.records.get('w').lease.ownerId, 'another-tab');
});

test('hiding during an outstanding check cannot rearm timers after late settlement', async () => {
  let finish;
  const f = fixture({
    source: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  await f.visible(false);
  finish({ context: { status: 'unavailable' } });
  await settle();
  assert.equal(f.pending.size, 0);
  assert.equal(f.controller.view.watches[0].state, 'paused-hidden');
  await f.controller.destroy();
});
test('three failed checks pause and an explicit restart cannot bypass cooldown', async () => {
  const f = fixture({
    source: async () => {
      throw Error('offline');
    },
  });
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  assert.equal(f.controller.view.watches[0].errorCount, 1);
  await f.advance(1800000);
  await f.advance(1800000);
  assert.equal(f.calls(), 3);
  assert.equal(f.controller.view.watches[0].state, 'paused-errors');
  assert.equal(f.pending.size, 0);
  await f.controller.start('w');
  assert.equal(f.calls(), 3);
  assert.equal(f.controller.view.watches[0].state, 'paused-cooldown');
  await f.controller.destroy();
});
test('create and remove definitions never acquire; clear notifications persists', async () => {
  const f = fixture();
  await f.controller.init();
  assert.equal(await f.controller.create({ placeId: 'missing' }), false);
  assert.equal(
    await f.controller.create({
      placeId: 'p',
      title: 'Neighborhood',
      intervalMinutes: 60,
    }),
    true,
  );
  assert.equal(f.calls(), 0);
  const created = f.controller.view.watches.find(
    (w) => w.title === 'Neighborhood',
  );
  assert.equal(created.intervalMinutes, 60);
  assert.equal(await f.controller.clearNotifications(created.id), true);
  assert.equal(await f.controller.remove(created.id), true);
  assert.equal(f.controller.view.watches.length, 1);
  await f.controller.destroy();
});
test('missing saved key stops immediately and a provider retry deadline is persisted', async () => {
  const f = fixture({
    source: async (bounds) => ({
      context: emptyFirmsArea(bounds, origin, 'needs-key'),
      retryAt: origin + 7200000,
    }),
  });
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  assert.equal(f.controller.view.watches[0].state, 'needs-key');
  assert.equal(f.pending.size, 0);
  assert.equal(f.records.get('w').runtime.nextAllowedAt, origin + 7200000);
  await f.controller.destroy();
});
test('hidden explicit start stays armed without claiming or fetching', async () => {
  const f = fixture();
  await f.controller.init();
  await f.visible(false);
  await f.controller.start('w');
  assert.equal(f.calls(), 0);
  assert.equal(f.pending.size, 0);
  assert.equal(f.records.get('w').lease, null);
  await f.visible(true);
  await settle();
  assert.equal(f.calls(), 1);
  await f.controller.destroy();
});
test('lost lease during heartbeat clears timers and requires explicit restart', async () => {
  const f = fixture();
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  f.repo.renew = async () => {
    throw Error('expired');
  };
  await f.advance(30000);
  assert.equal(f.controller.view.watches[0].state, 'paused-errors');
  assert.equal(f.pending.size, 0);
  assert.equal(f.calls(), 1);
  await f.controller.destroy();
});
test('storage failures are visible and never silently start monitoring', async () => {
  const f = fixture();
  f.repo.list = async () => {
    throw Error();
  };
  assert.equal(await f.controller.init(), false);
  assert.ok(f.controller.view.error);
  f.repo.list = async () => ({
    watches: [...f.records.values()],
    corrupt: [{}],
  });
  assert.equal(await f.controller.refresh(), true);
  assert.match(f.controller.view.error, /recovery/);
  f.repo.claim = async () => {
    throw Error();
  };
  assert.equal(await f.controller.start('w'), false);
  assert.equal(f.controller.view.watches[0].state, 'paused-errors');
  assert.equal(f.calls(), 0);
  f.repo.remove = async () => {
    throw Error();
  };
  assert.equal(await f.controller.remove('w'), false);
  f.repo.clearNotifications = async () => {
    throw Error();
  };
  assert.equal(await f.controller.clearNotifications('w'), false);
  await f.controller.destroy();
  assert.equal(await f.controller.start('w'), false);
});
test('only four watches may be armed and duplicate starts do not acquire twice', async () => {
  const f = fixture();
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  assert.equal(await f.controller.start('w'), false);
  assert.equal(await f.controller.start('missing'), false);
  for (let i = 0; i < 4; i++)
    await f.controller.create({ placeId: 'p', title: `Watch ${i}` });
  await f.visible(false);
  const rows = f.controller.view.watches.filter((r) => r.id !== 'w');
  for (const row of rows.slice(0, 3))
    assert.equal(await f.controller.start(row.id), true);
  assert.equal(await f.controller.start(rows[3].id), false);
  assert.equal(f.calls(), 1);
  assert.match(f.controller.view.error, /four/);
  await f.controller.destroy();
});
test('a failed lease release still aborts local timers and reports its bounded expiry', async () => {
  const f = fixture();
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  f.repo.release = async () => {
    throw Error('storage offline');
  };
  await f.controller.stop('w');
  assert.equal(f.pending.size, 0);
  assert.equal(f.controller.view.watches[0].state, 'stopped');
  assert.match(f.controller.view.error, /expire automatically/);
  await f.advance(3600000);
  assert.equal(f.calls(), 1);
  await f.controller.destroy();
});
for (const ending of ['stop', 'hide', 'destroy']) {
  test(`a pending renewal rejection cannot replace deliberate ${ending} state`, async () => {
    const f = fixture();
    await f.controller.init();
    await f.controller.start('w');
    await settle();
    let rejectRenew;
    f.repo.renew = () =>
      new Promise((resolve, reject) => {
        rejectRenew = reject;
      });
    await f.advance(30000);
    assert.equal(typeof rejectRenew, 'function');
    if (ending === 'hide') await f.visible(false);
    else if (ending === 'destroy') await f.controller.destroy();
    else await f.controller.stop('w');
    const expected = ending === 'hide' ? 'paused-hidden' : 'stopped';
    assert.equal(f.controller.sessions.get('w').state, expected);
    rejectRenew(Error('expired'));
    await settle();
    assert.equal(f.controller.sessions.get('w').state, expected);
    assert.equal(f.pending.size, 0);
    assert.equal(f.calls(), 1);
    assert.equal(f.controller.sessions.get('w').request, null);
    await f.controller.destroy();
  });
}
test('a pending successful renewal cannot rearm heartbeat after hidden pause', async () => {
  const f = fixture();
  await f.controller.init();
  await f.controller.start('w');
  await settle();
  let resolveRenew;
  f.repo.renew = () =>
    new Promise((resolve) => {
      resolveRenew = resolve;
    });
  await f.advance(30000);
  await f.visible(false);
  resolveRenew();
  await settle();
  assert.equal(f.controller.sessions.get('w').state, 'paused-hidden');
  assert.equal(f.pending.size, 0);
  assert.equal(f.calls(), 1);
  await f.controller.destroy();
});
test('default browser timers retain the global receiver and injected timers remain unchanged', () => {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  const calls = [];
  try {
    globalThis.setTimeout = function (callback, delay) {
      assert.equal(
        this,
        globalThis,
        'browser setTimeout requires its Window receiver',
      );
      calls.push(delay);
      return 42;
    };
    globalThis.clearTimeout = function (id) {
      assert.equal(
        this,
        globalThis,
        'browser clearTimeout requires its Window receiver',
      );
      calls.push(id);
    };
    const controller = new WatchlistController();
    assert.equal(
      controller.timers.setTimeout(() => {}, 30000),
      42,
    );
    controller.timers.clearTimeout(42);
    assert.deepEqual(calls, [30000, 42]);
    const injected = { setTimeout: () => 7, clearTimeout: () => {} };
    const second = new WatchlistController({ timers: injected });
    assert.equal(second.timers.setTimeout, injected.setTimeout);
    assert.equal(second.timers.clearTimeout, injected.clearTimeout);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});
