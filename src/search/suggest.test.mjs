import test from 'node:test';
import assert from 'node:assert/strict';
import {
  biasCell,
  createSuggestionEngine,
  foldName,
  localSuggestions,
  matchRank,
} from './suggest.js';
import { listPresetPlaces } from './presetGeocoder.js';
import { CITY_POIS } from '../cityPois.js';

const DEHRADUN = {
  lat: 30.3165,
  lng: 78.0322,
  name: 'Dehradun',
  label: 'Dehradun',
};
const places = listPresetPlaces(CITY_POIS);

/** A manual clock and timer queue so debounce is tested without waiting. */
function clock() {
  let time = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(fn, ms) {
      timers.set(++id, { fn, at: time + ms });
      return id;
    },
    clearTimer(handle) {
      timers.delete(handle);
    },
    async advance(ms) {
      time += ms;
      for (const [handle, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(handle);
          // Fire without awaiting: a request may be held open by the test.
          void timer.fn();
        }
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      await new Promise((resolve) => setImmediate(resolve));
    },
    get pending() {
      return timers.size;
    },
  };
}

function remoteSpy(answer = () => [DEHRADUN]) {
  const calls = [];
  const remote = async (text, { bias, signal }) => {
    calls.push({ text, bias, signal });
    return answer(text, signal);
  };
  return { remote, calls };
}

function engine(overrides = {}) {
  const c = clock();
  const updates = [];
  const spy = overrides.spy ?? remoteSpy();
  const instance = createSuggestionEngine({
    remote: spy.remote,
    places,
    onUpdate: (state) => updates.push(state),
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    ...overrides.engine,
  });
  return { instance, c, updates, spy, last: () => updates.at(-1) };
}

test('folding ignores case, accents and punctuation', () => {
  assert.equal(foldName('  São-Paulo!  '), 'sao paulo');
  assert.equal(matchRank('Dehradun', 'dehradun'), 0);
  assert.equal(matchRank('Dehradun', 'dehr'), 1);
  assert.equal(matchRank('Clock Tower (Ghanta Ghar)', 'gha'), 2);
  assert.equal(matchRank('Dehradun', 'zz'), null);
});

test('bias cells are 1° wide so nearby views share cached answers', () => {
  assert.equal(biasCell('30.1,77.9|30.5,78.2'), '30,78');
  assert.equal(biasCell(null), 'world');
});

test('bundled cities and landmarks answer locally, best match first', () => {
  const rows = localSuggestions('dehr', { places });
  assert.equal(rows[0].place.name, 'Dehradun');
  assert.equal(rows[0].source, 'preset');
  const landmarks = localSuggestions('clock tower', { places });
  assert.ok(landmarks.some((row) => /Clock Tower/.test(row.place.name)));
});

test('typed coordinates become one exact suggestion and skip the network', async () => {
  const { instance, c, last, spy } = engine();
  instance.update('30.3165, 78.0322');
  assert.equal(last().items.length, 1);
  assert.equal(last().items[0].source, 'coordinate');
  assert.equal(last().remote, 'skipped');
  await c.advance(1000);
  assert.equal(spy.calls.length, 0);
});

test('short queries stay local; the network waits for three characters', async () => {
  const { instance, c, spy, last } = engine();
  instance.update('de');
  assert.equal(last().remote, 'skipped');
  await c.advance(1000);
  assert.equal(spy.calls.length, 0);
});

test('typing is debounced into one request for the settled text', async () => {
  const { instance, c, spy, last } = engine();
  for (const text of ['deh', 'dehr', 'dehra', 'dehrad']) {
    instance.update(text, { bias: '30.1,77.9|30.5,78.2' });
    await c.advance(100);
  }
  assert.equal(spy.calls.length, 0, 'nothing sent while typing');
  assert.equal(last().loading, true);
  await c.advance(250);
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].text, 'dehrad');
  assert.equal(last().loading, false);
  assert.equal(last().remote, 'done');
});

test('remote rows merge after local ones without duplicates', async () => {
  const spy = remoteSpy(() => [
    DEHRADUN,
    {
      lat: 30.33,
      lng: 78.06,
      name: 'Dehradun Cantonment',
      label: 'Dehradun Cantonment',
    },
  ]);
  const { instance, c, last } = engine({ spy });
  instance.update('dehradun');
  await c.advance(300);
  const names = last().items.map((row) => row.place.name);
  assert.equal(names.filter((name) => name === 'Dehradun').length, 1);
  assert.ok(names.includes('Dehradun Cantonment'));
  assert.equal(last().items[0].source, 'preset');
});

test('answers are cached by query and viewport cell', async () => {
  const { instance, c, spy, last } = engine();
  instance.update('rajpur', { bias: '30.1,77.9|30.5,78.2' });
  await c.advance(400);
  instance.update('rajpu', { bias: '30.1,77.9|30.5,78.2' });
  await c.advance(400);
  instance.update('rajpur', { bias: '30.2,77.8|30.4,78.1' });
  assert.equal(last().remote, 'cached');
  assert.equal(last().loading, false);
  await c.advance(1000);
  assert.equal(spy.calls.length, 2, 'rajpur once, rajpu once, then cache');
});

test('cached answers expire', async () => {
  const { instance, c, spy } = engine({
    engine: { options: { cacheTtlMs: 1000 } },
  });
  instance.update('rajpur');
  await c.advance(300);
  await c.advance(2000);
  instance.update('rajpur');
  await c.advance(400);
  assert.equal(spy.calls.length, 2);
});

test('the cache is bounded', async () => {
  const { instance, c } = engine({
    engine: { options: { cacheSize: 3, minIntervalMs: 0 } },
  });
  for (const text of ['aaa', 'bbb', 'ccc', 'ddd', 'eee']) {
    instance.update(text);
    await c.advance(300);
  }
  assert.equal(instance.cacheSize, 3);
});

test('a newer keystroke aborts the request in flight and drops its answer', async () => {
  let release;
  const spy = remoteSpy(
    (text, signal) =>
      new Promise((resolve, reject) => {
        release = () => resolve([{ ...DEHRADUN, name: text, label: text }]);
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  );
  const { instance, c, last } = engine({ spy });
  instance.update('mus');
  await c.advance(300);
  assert.equal(spy.calls.length, 1);
  const first = spy.calls[0].signal;
  instance.update('muss');
  assert.equal(first.aborted, true);
  release();
  await c.advance(0);
  assert.equal(last().query, 'muss');
});

test('requests are spaced by the minimum interval', async () => {
  const { instance, c, spy } = engine({
    engine: { options: { debounceMs: 10, minIntervalMs: 500 } },
  });
  instance.update('abc');
  await c.advance(20);
  instance.update('abcd');
  await c.advance(20);
  assert.equal(spy.calls.length, 1, 'second request waits for the interval');
  await c.advance(500);
  assert.equal(spy.calls.length, 2);
});

test('a failing suggester leaves local rows and says it is unavailable', async () => {
  const spy = remoteSpy(() => {
    throw new Error('offline');
  });
  const { instance, c, last } = engine({ spy });
  instance.update('dehradun');
  await c.advance(300);
  assert.equal(last().remote, 'unavailable');
  assert.equal(last().items[0].place.name, 'Dehradun');
});

test('failures are not cached', async () => {
  let fail = true;
  const spy = remoteSpy(() => {
    if (fail) throw new Error('offline');
    return [DEHRADUN];
  });
  const { instance, c } = engine({ spy });
  instance.update('dehradun');
  await c.advance(400);
  fail = false;
  instance.update('dehradun');
  await c.advance(400);
  assert.equal(spy.calls.length, 2);
});

test('an empty field offers recent places; recents also lead matches', () => {
  const recent = [
    {
      ...DEHRADUN,
      name: 'Lal Tibba',
      label: 'Lal Tibba, Mussoorie',
      lat: 30.4597,
      lng: 78.1058,
    },
  ];
  const { instance, last } = engine({ engine: { readRecent: () => recent } });
  instance.update('');
  assert.equal(last().items[0].source, 'recent');
  instance.update('lal');
  assert.equal(last().items[0].place.name, 'Lal Tibba');
});

test('a throwing recent store is ignored', () => {
  const { instance, last } = engine({
    engine: {
      readRecent: () => {
        throw new Error('blocked');
      },
    },
  });
  instance.update('');
  assert.deepEqual(last().items, []);
});

test('cancel stops pending work and destroy stops updates', async () => {
  const { instance, c, spy, updates } = engine();
  instance.update('dehradun');
  instance.cancel();
  await c.advance(1000);
  assert.equal(spy.calls.length, 0);
  instance.destroy();
  const count = updates.length;
  instance.update('mumbai');
  assert.equal(updates.length, count);
});

test('without a remote suggester the engine is local-only', async () => {
  const { instance, c, last } = engine({ engine: { remote: null } });
  instance.update('dehradun');
  await c.advance(1000);
  assert.equal(last().remote, 'idle');
  assert.equal(last().items[0].place.name, 'Dehradun');
});
