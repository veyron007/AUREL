// A lazy voice session renders its controls from known capabilities, builds
// the real adapter on first start (or preload), applies the bindings it was
// asked for, forwards everything after, and retries a failed import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazySession } from './lazySession.js';

function provider({ fail = 0 } = {}) {
  const log = [];
  let imports = 0;
  const factory = createLazySession({
    capabilities: { costControls: true, pushToTalk: true },
    load: async () => {
      imports += 1;
      if (imports <= fail) throw new Error('chunk missing');
      return (options) => {
        log.push(['create', options.name]);
        return {
          controller: { status: 'idle', announce: () => 'announced' },
          start: (settings) => log.push(['start', settings]),
          stop: () => log.push(['stop']),
          getStartOptions: () => ({ pushToTalk: true }),
          sendText: (text) => `sent:${text}`,
          sendMapEvent: (event) => log.push(['map', event.type]),
          ignoreButtonClick: () => true,
          bindControls: () => log.push(['bind']),
        };
      };
    },
  });
  return { factory, log, imports: () => imports };
}

test('before the first use nothing loads and the idle answers hold', () => {
  const { factory, imports } = provider();
  const adapter = factory({ name: 'a' });
  assert.deepEqual(adapter.capabilities, {
    costControls: true,
    pushToTalk: true,
  });
  adapter.bindControls();
  assert.equal(adapter.stop(), undefined);
  assert.equal(adapter.sendMapEvent({ type: 'outline' }), undefined);
  assert.deepEqual(adapter.getStartOptions(), { pushToTalk: false });
  assert.equal(adapter.ignoreButtonClick(), false);
  adapter.controller.session = 'attached';
  assert.equal(adapter.controller.session, 'attached');
  assert.equal(adapter.controller.status, undefined);
  assert.equal(imports(), 0);
});

test('the first start builds the real adapter once, then binds and forwards', async () => {
  const { factory, log, imports } = provider();
  const adapter = factory({ name: 'a' });
  adapter.bindControls();
  await Promise.all([
    adapter.start({ pushToTalk: false }),
    adapter.sendText('hi'),
  ]);
  assert.equal(imports(), 1);
  assert.deepEqual(log.slice(0, 3), [
    ['create', 'a'],
    ['bind'],
    ['start', { pushToTalk: false }],
  ]);
  assert.equal(
    adapter.sendText('again'),
    'sent:again',
    'synchronous once built',
  );
  assert.deepEqual(adapter.getStartOptions(), { pushToTalk: true });
  assert.equal(adapter.controller.announce(), 'announced');
  adapter.sendMapEvent({ type: 'outline' });
  assert.deepEqual(log.at(-1), ['map', 'outline']);
});

test('preloading builds every live adapter; ended ones are skipped', async () => {
  const { factory, log } = provider();
  const ended = new AbortController();
  factory({ name: 'ended', signal: ended.signal });
  ended.abort();
  const adapter = factory({ name: 'live' });
  await factory.preload();
  assert.deepEqual(log, [['create', 'live']]);
  assert.equal(adapter.ignoreButtonClick(), true);
});

test('a failed import is a translated error, and the next start retries', async () => {
  const { factory, imports } = provider({ fail: 1 });
  const adapter = factory({ name: 'a' });
  await assert.rejects(adapter.start({}), (error) => {
    assert.match(error.message, /could not be loaded/);
    assert.match(error.cause.message, /chunk missing/);
    return true;
  });
  await adapter.start({});
  assert.equal(imports(), 2);
});
