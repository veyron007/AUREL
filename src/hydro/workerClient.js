/**
 * Promise client for the routing worker. Falls back to an in-thread router
 * where Worker is unavailable (node:test, very old browsers); the fallback is
 * reported so the method card can say where the work ran.
 */
import { createHydroRouter } from './router.js';

export function createHydroClient({ createWorker } = {}) {
  let worker = null,
    nextId = 1,
    fallback = null;
  const pending = new Map();
  const make =
    createWorker ||
    (typeof Worker === 'function'
      ? () =>
          new Worker(new URL('./hydro.worker.js', import.meta.url), {
            type: 'module',
          })
      : null);
  function ensure() {
    if (worker || fallback) return;
    try {
      worker = make?.() || null;
    } catch {
      worker = null;
    }
    if (!worker) {
      fallback = createHydroRouter();
      return;
    }
    worker.onmessage = (event) => {
      const { id, ok, error, ...rest } = event.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(rest);
      else entry.reject(new Error(error || 'Hydro worker failed'));
    };
    worker.onerror = (event) => {
      const error = new Error(event?.message || 'Hydro worker failed');
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    };
  }
  function send(message, transfer = []) {
    ensure();
    if (fallback) {
      try {
        return Promise.resolve(fallback.handle(message));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }
  const loaded = new Set();
  return {
    get mode() {
      ensure();
      return fallback ? 'main-thread' : 'worker';
    },
    isLoaded: (key) => loaded.has(key),
    async load(key, spec, heights) {
      const copy = Float32Array.from(heights);
      const reply = await send({ type: 'load', key, spec, heights: copy }, [
        copy.buffer,
      ]);
      loaded.add(key);
      return reply.disclosure;
    },
    async query(key, point) {
      return (await send({ type: 'query', key, point })).result;
    },
    destroy() {
      worker?.terminate?.();
      worker = null;
      for (const entry of pending.values())
        entry.reject(new Error('Hydro worker stopped'));
      pending.clear();
      loaded.clear();
    },
  };
}
