import { msg, t } from '../../i18n/index.js';
import { buildCableModel } from './model.js';

export function createIngestion({ state, parts, source }) {
  async function fetchModel(signal) {
    if (state._model) return state._model;
    const payload = await source.fetch(signal);
    signal.throwIfAborted();
    return buildCableModel(payload ?? {});
  }

  async function load(viewer) {
    if (state._loading || state._loaded) return;

    state._loading = true;
    state._error = null;
    state._loadingLabel = t('loading...');
    // Ownership token (the militaryAwareness activationId pattern): a
    // disable/abort followed by a fresh enable starts a NEWER load while this
    // one is still settling. The stale load must bail after every await and
    // must never touch shared lifecycle state or the viewer it no longer
    // owns.
    const generation = ++state._loadGeneration;
    const abort = new AbortController();
    state._abort = abort;
    const owns = () =>
      generation === state._loadGeneration && !abort.signal.aborted;

    try {
      const model = await fetchModel(abort.signal);
      if (!owns()) return;
      state._model = model;
      // Await-free from here: the primitives are built and handed to the
      // scene synchronously, so no disable/destroy can interleave, and the
      // GPU geometry is built asynchronously by Cesium's own workers.
      parts.rendering.buildPrimitives(viewer, model);
      state._count = model.count;
      state._loaded = true;
      state._lastUpdate = Date.now();
      state._loadingLabel = '';
      parts.rendering.updateVisibility();
      state._referenceSweepGate.markDirty();
      viewer.scene.requestRender?.();
    } catch (error) {
      // A stale or aborted load reports nothing: its failure belongs to a
      // lifecycle the user already left.
      if (owns() && error?.name !== 'AbortError') {
        parts.rendering.releasePrimitives();
        state._error = error?.message || msg('TeleGeography load failed');
        console.warn(
          '[Data:telegeography-submarine-cables]',
          state._error,
          error,
        );
      }
    } finally {
      // Only the OWNING load may clear the shared lifecycle. A stale load
      // clearing `_loading`/`_abort` would hand a later enable/update a
      // duplicate load while the real one is still in flight.
      if (generation === state._loadGeneration) {
        state._loading = false;
        if (state._abort === abort) state._abort = null;
      }
    }
  }
  return { load };
}
