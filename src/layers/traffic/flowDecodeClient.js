import { decodeFlowTile } from './flowDecode.js';

/**
 * Decode TomTom flow tiles in one module Worker per traffic source, so a
 * dense tile's protobuf decode never blocks a frame. Where Worker is missing
 * (node:test) or the worker cannot start or dies, tiles decode on the calling
 * thread with the same function, so results never differ — only where they
 * are computed. Bytes are copied to the worker, not transferred: the caller
 * still reads the buffer's size after the decode.
 * @module layers/traffic/flowDecodeClient
 */

function defaultWorkerFactory() {
  if (typeof Worker !== 'function') return null;
  return new Worker(new URL('./flowDecode.worker.js', import.meta.url), {
    type: 'module',
  });
}

function decodeHere(bytes, z, x, y) {
  return Promise.resolve().then(() =>
    decodeFlowTile(bytes, z, x, y, { strict: true }),
  );
}

/**
 * @param {object} [options]
 * @param {function():(Worker|null)} [options.workerFactory] Test seam.
 * @returns {{decode: function(Uint8Array|ArrayBuffer, number, number, number): Promise<object[]>, close: function(): void}}
 */
export function createFlowDecodeClient({
  workerFactory = defaultWorkerFactory,
} = {}) {
  let worker = null;
  let broken = false;
  let nextId = 1;
  const requests = new Map();

  function fallBack(reason) {
    broken = true;
    const pending = [...requests.values()];
    requests.clear();
    worker?.terminate();
    worker = null;
    console.warn('[traffic] flow decode worker unavailable:', reason);
    for (const request of pending)
      decodeHere(...request.args).then(request.resolve, request.reject);
  }

  function onMessage(event) {
    const reply = event.data || {};
    const request = requests.get(reply.id);
    if (!request) return;
    requests.delete(reply.id);
    if (reply.ok) request.resolve(reply.segments);
    else request.reject(new Error(reply.message));
  }

  function ensureWorker() {
    if (worker || broken) return worker;
    try {
      worker = workerFactory() || null;
    } catch (error) {
      worker = null;
      broken = true;
      console.warn('[traffic] flow decode worker failed to start:', error);
      return null;
    }
    if (!worker) {
      broken = true;
      return null;
    }
    worker.onmessage = onMessage;
    worker.onerror = (event) => {
      event?.preventDefault?.();
      fallBack(event?.message || 'worker error');
    };
    return worker;
  }

  return {
    decode(bytes, z, x, y) {
      const active = ensureWorker();
      if (!active) return decodeHere(bytes, z, x, y);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        requests.set(id, { resolve, reject, args: [bytes, z, x, y] });
        active.postMessage({ id, bytes, z, x, y });
      });
    },
    /** Stop the worker; pending tiles finish on this thread. */
    close() {
      const pending = [...requests.values()];
      requests.clear();
      worker?.terminate();
      worker = null;
      broken = false;
      for (const request of pending)
        decodeHere(...request.args).then(request.resolve, request.reject);
    },
  };
}
