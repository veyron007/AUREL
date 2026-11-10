// The lazy Director answers like an idle Director, loads once on first real
// use, hands earlier subscribers to the real one, and retries a failed load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyDirector } from './lazyDirector.js';

function fakeDirector(log) {
  const listeners = new Set();
  return {
    running: false,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (value) => listeners.forEach((listener) => listener(value)),
    listScenes: () => [{ id: 'a', title: 'A' }],
    getProjectSnapshot: () => ({ version: 6, scenes: [] }),
    startScene: (id) => {
      log.push(['start', id]);
      return Promise.resolve({ started: true });
    },
    destroy: () => {
      log.push(['destroy']);
      return Promise.resolve();
    },
  };
}

function lazy({ fail = 0 } = {}) {
  const log = [];
  let imports = 0;
  const director = createLazyDirector(async () => {
    imports += 1;
    if (imports <= fail) throw new Error('chunk missing');
    return fakeDirector(log);
  });
  return { director, log, imports: () => imports };
}

test('before loading, it answers as an idle, empty Director', async () => {
  const { director, imports } = lazy();
  assert.equal(director.running, false);
  assert.equal(director.loaded, false);
  assert.equal(director.stopScene(), undefined);
  assert.equal(imports(), 0, 'stopping nothing loads nothing');
  assert.deepEqual(director.listScenes(), []);
  assert.equal(director.getPlaybackStatus(), null);
  assert.equal(director.then, undefined, 'not a thenable');
  await director.ready();
  assert.equal(imports(), 1, 'a query starts the load');
  assert.deepEqual(director.listScenes(), [{ id: 'a', title: 'A' }]);
});

test('commands load once and forward; subscribers reach the real Director', async () => {
  const { director, log, imports } = lazy();
  const seen = [];
  director.subscribe((value) => seen.push(value));
  const dropped = director.subscribe(() => seen.push('dropped'));
  dropped();
  const [first, second] = await Promise.all([
    director.startScene('a'),
    director.startScene('b'),
  ]);
  assert.deepEqual([first, second], [{ started: true }, { started: true }]);
  assert.equal(imports(), 1);
  assert.deepEqual(log, [
    ['start', 'a'],
    ['start', 'b'],
  ]);
  (await director.ready()).emit('changed');
  assert.deepEqual(seen, ['changed']);
  assert.equal(director.loaded, true);
});

test('a failed load is a translated error, and the next use retries', async () => {
  const { director, imports } = lazy({ fail: 1 });
  await assert.rejects(director.ready(), (error) => {
    assert.match(error.message, /could not be loaded/);
    assert.match(error.cause.message, /chunk missing/);
    return true;
  });
  await director.ready();
  assert.equal(imports(), 2);
});

test('destroyed before loading, it never constructs', async () => {
  const { director, imports } = lazy();
  await director.destroy();
  await assert.rejects(director.ready(), /destroyed/);
  assert.equal(imports(), 0);
});
