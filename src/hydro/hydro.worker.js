/**
 * Raindrop routing worker. Holds routed grids by key so repeated drops on the
 * same window reuse one fill. Messages:
 *   {id, type:'load', key, spec, heights}  -> {id, ok, disclosure}
 *   {id, type:'query', key, point}         -> {id, ok, result}
 *   {id, type:'drop', key}                 -> {id, ok}
 */
import { createHydroRouter } from './router.js';

const router = createHydroRouter();

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    self.postMessage({ id: message.id, ok: true, ...router.handle(message) });
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: String(error?.message || error),
    });
  }
};
