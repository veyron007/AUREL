/** Web Worker: the horizon ray-march and its Sun, Moon, shadow and peak passes. */
import { computeHorizon } from './compute.js';

self.onmessage = (event) => {
  const { id, input } = event.data || {};
  try {
    self.postMessage({ id, ok: true, result: computeHorizon(input) });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message:
        error instanceof Error ? error.message : 'Horizon computation failed.',
    });
  }
};
