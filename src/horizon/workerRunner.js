/**
 * Runs `computeHorizon` in a dedicated Web Worker; one job at a time, a new
 * worker per job so cancellation also stops the computation. Without
 * `Worker` (Node, tests) it computes inline.
 */
import { computeHorizon } from './compute.js';

export function createHorizonWorkerRunner({
  WorkerImpl = globalThis.Worker,
  createWorker = () =>
    new WorkerImpl(new URL('./horizon.worker.js', import.meta.url), {
      type: 'module',
    }),
  timeoutMs = 30000,
} = {}) {
  let sequence = 0;
  return function runHorizon(input, { signal } = {}) {
    signal?.throwIfAborted();
    if (typeof WorkerImpl !== 'function')
      return Promise.resolve().then(() => computeHorizon(input));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const worker = createWorker();
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () =>
        finish(signal.reason ?? new Error('Horizon cancelled.'));
      const timer = setTimeout(
        () => finish(new Error('The horizon computation timed out.')),
        timeoutMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event) => {
        if (event.data?.id !== id) return;
        if (event.data.ok) finish(null, event.data.result);
        else finish(new Error(event.data.message));
      };
      worker.onerror = () =>
        finish(new Error('The horizon worker failed to start.'));
      worker.postMessage({ id, input });
    });
  };
}
