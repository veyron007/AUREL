import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runSentinelJob } from './workerRunner.js';
function fakeWorker() {
  let instance;
  class Fake extends EventEmitter {
    constructor(url, options) {
      super();
      this.options = options;
      this.stopped = 0;
      instance = this;
    }
    async terminate() {
      this.stopped++;
    }
  }
  return {
    Fake,
    get instance() {
      return instance;
    },
  };
}
test('worker success terminates worker and applies memory limits', async () => {
  const f = fakeWorker();
  const promise = runSentinelJob({}, {}, { WorkerImpl: f.Fake });
  f.instance.emit('message', { ok: true, value: { status: 'available' } });
  assert.equal((await promise).status, 'available');
  assert.equal(f.instance.stopped, 1);
  assert.equal(f.instance.options.resourceLimits.maxOldGenerationSizeMb, 128);
});
test('abort, timeout and decoding errors terminate workers without publishing late results', async () => {
  for (const reason of ['abort', 'timeout', 'error', 'exit', 'message']) {
    const f = fakeWorker(),
      controller = new AbortController();
    const promise = runSentinelJob(
      {},
      {},
      {
        WorkerImpl: f.Fake,
        signal: controller.signal,
        timeoutMs: reason === 'timeout' ? 1 : 1000,
      },
    );
    if (reason === 'abort') controller.abort(new Error('cancelled'));
    else if (reason === 'error') f.instance.emit('error', new Error('private'));
    else if (reason === 'exit') f.instance.emit('exit', 1);
    else if (reason === 'message')
      f.instance.emit('message', { ok: false, reason: 'decode-failed' });
    await assert.rejects(promise);
    assert.equal(f.instance.stopped, 1);
    f.instance.emit('message', { ok: true, value: {} });
    assert.equal(f.instance.stopped, 1);
  }
});
