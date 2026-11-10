import { t } from '../i18n/index.js';

/**
 * The Scene Director, loaded on first use (PERFORMANCE-PLAN.md WP2.3).
 *
 * The application hands this stand-in to everything that holds the Director
 * (Bhote Koshi's scene controls, Orbit Witness, voice, the agent desk, the
 * globe recovery). It loads the real Director when the Authoring panel opens,
 * when anything calls a method that needs it, or once start-up has settled,
 * and from then on forwards every property. Before that:
 *
 * - `running` is false: nothing can play without the Director;
 * - `subscribe` keeps the listener and attaches it once loaded;
 * - `stopScene` stops nothing; `listScenes`, `findSceneByQuery`,
 *   `getPlaybackStatus` and `getProjectSnapshot` start the load and answer
 *   as an empty project does (callers that need the real answer await
 *   `ready()` first);
 * - every other method loads the Director and forwards the call, resolving
 *   with its result.
 *
 * An import failure rejects with a translated message; the next call retries.
 */

const IDLE_ANSWERS = Object.freeze({
  stopScene: () => undefined,
  listScenes: () => [],
  findSceneByQuery: () => null,
  getPlaybackStatus: () => null,
  getProjectSnapshot: () => null,
});

/**
 * @param {() => Promise<object>} load Imports and constructs the Director.
 * @returns {object} The stand-in; `ready()` resolves with the real Director.
 */
export function createLazyDirector(load) {
  if (typeof load !== 'function')
    throw new TypeError('The lazy Director needs a loader');
  const listeners = new Map();
  let real = null;
  let loading = null;
  let destroyed = false;

  const adopt = (director) => {
    if (destroyed) {
      void director.destroy?.();
      throw new Error('The Scene Director was destroyed');
    }
    real = director;
    for (const [entry, args] of listeners)
      entry.release = director.subscribe(...args);
    listeners.clear();
    return director;
  };
  const ready = () => {
    if (real) return Promise.resolve(real);
    if (destroyed)
      return Promise.reject(new Error('The Scene Director was destroyed'));
    loading ??= Promise.resolve()
      .then(load)
      .then(adopt, (error) => {
        loading = null;
        throw new Error(
          t('{name} could not be loaded. Check the connection and try again.', {
            name: t('Scenes'),
          }),
          { cause: error },
        );
      });
    return loading;
  };
  const subscribe = (...args) => {
    if (real) return real.subscribe(...args);
    const entry = { release: null };
    listeners.set(entry, args);
    return () => {
      listeners.delete(entry);
      if (typeof entry.release === 'function') entry.release();
      entry.release = null;
    };
  };
  const destroy = () => {
    if (real) return real.destroy();
    destroyed = true;
    listeners.clear();
    return Promise.resolve();
  };
  const own = { ready, subscribe, destroy };
  const idleCall = (name) => {
    if (Object.hasOwn(IDLE_ANSWERS, name))
      return (...args) => {
        void ready().catch(() => {});
        return IDLE_ANSWERS[name](...args);
      };
    return (...args) => ready().then((director) => director[name](...args));
  };

  return new Proxy(own, {
    get(target, property) {
      if (property === 'loaded') return Boolean(real);
      if (property === 'running') return Boolean(real?.running);
      if (real && property !== 'ready') {
        const value = real[property];
        return typeof value === 'function' ? value.bind(real) : value;
      }
      if (Object.hasOwn(target, property)) return target[property];
      if (typeof property !== 'string' || property === 'then') return undefined;
      return idleCall(property);
    },
  });
}
