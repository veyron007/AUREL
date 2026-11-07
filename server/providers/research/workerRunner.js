import { Worker } from 'node:worker_threads';
/** Decode in a disposable worker so abort/timeout also stops synchronous TIFF decompression. */
export function runSentinelJob(
  item,
  input,
  { signal, timeoutMs = 45000, WorkerImpl = Worker } = {},
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new WorkerImpl(
      new URL('./sentinel.worker.mjs', import.meta.url),
      {
        workerData: { item, input },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
      },
    );
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate().catch(() => {});
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || new Error('cancelled'));
    const timer = setTimeout(
      () => finish(new Error('analysis-timeout')),
      Math.min(45000, timeoutMs),
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message) =>
      message?.ok
        ? finish(null, message.value)
        : finish(
            Object.assign(new Error(message?.reason || 'decode-failed'), {
              retryMs: message?.retryMs,
            }),
          ),
    );
    worker.once('error', () => finish(new Error('decode-failed')));
    worker.once('exit', () => finish(new Error('decode-failed')));
    if (signal?.aborted) abort();
  });
}
