/**
 * Parse a bundled `.geojsonl` dataset in a one-shot module Worker, falling back
 * to the same parser on the calling thread where Worker is unavailable
 * (node:test) or the worker cannot start. A dataset error found by the worker
 * keeps its name, so a corrupt line still reports as malformed.
 */
import { parseLocalGeojsonDataset } from './localGeojsonParse.js';

function defaultWorkerFactory() {
  if (typeof Worker !== 'function') return null;
  return new Worker(new URL('./localGeojsonParse.worker.js', import.meta.url), {
    type: 'module',
  });
}

function startWorker(workerFactory) {
  try {
    return workerFactory() || null;
  } catch {
    return null;
  }
}

function abortError() {
  return new DOMException('The dataset parse was aborted.', 'AbortError');
}

function workerFailure({ name, message }) {
  const ErrorType = name === 'SyntaxError' ? SyntaxError : Error;
  return new ErrorType(message || 'dataset parse failed');
}

function parseOnThisThread(text) {
  return Promise.resolve().then(() => parseLocalGeojsonDataset(text));
}

/**
 * @param {string} text Dataset text.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] Aborts the parse and stops the worker.
 * @param {function():(Worker|null)} [options.workerFactory] Test seam.
 * @returns {Promise<import('./localGeojsonParse.js').LocalGeojsonRecord[]>}
 */
export function parseLocalGeojsonOffThread(
  text,
  { signal, workerFactory = defaultWorkerFactory } = {},
) {
  if (signal?.aborted) return Promise.reject(abortError());
  const worker = startWorker(workerFactory);
  if (!worker) return parseOnThisThread(text);
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      settle(value);
    };
    const onAbort = () => finish(reject, abortError());
    worker.onmessage = (event) => {
      const reply = event.data || {};
      if (reply.ok) finish(resolve, reply.records);
      else finish(reject, workerFailure(reply));
    };
    // The worker script itself failed (blocked, missing chunk): parse here.
    worker.onerror = (event) => {
      event?.preventDefault?.();
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      parseOnThisThread(text).then(resolve, reject);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ text });
  });
}
