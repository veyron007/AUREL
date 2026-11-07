import { parentPort, workerData } from 'node:worker_threads';
import { decodeSentinelRoi } from './decode.js';
try {
  parentPort.postMessage({
    ok: true,
    value: await decodeSentinelRoi(workerData.item, workerData.input),
  });
} catch (error) {
  const allowed = [
    'scene-does-not-cover-roi',
    'unsupported-tiff-grid',
    'range-budget-exceeded',
    'invalid-range-response',
    'rate-limited',
  ];
  parentPort.postMessage({
    ok: false,
    reason: allowed.includes(error.message) ? error.message : 'decode-failed',
    retryMs: Number.isFinite(error.retryMs) ? error.retryMs : null,
  });
}
