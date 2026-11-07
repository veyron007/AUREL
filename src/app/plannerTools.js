import { watch } from 'vue';
import { Cartesian3, Color } from 'cesium';
import { calculateProfile } from '../planner/profile.js';
import { PlannerController } from '../ui/plannerController.js';
import { usePlannerStore } from '../ui/stores/planner.js';
import { useLensStore } from '../ui/stores/lens.js';
import { createFieldContextSource } from '../sources/fieldContext.js';
import { fetchFirmsAreaSource } from '../sources/firmsArea.js';

/** Explicit analysis adapters. Construction never starts a provider request. */
export function createPlannerBindings({
  pinia,
  viewer,
  dataManager,
  operations,
  fieldbook,
  contextSource = createFieldContextSource(),
  fireSource = fetchFirmsAreaSource,
}) {
  const lens = useLensStore(pinia);
  const lifetime = new AbortController();
  const disposers = new Set();
  const heights = new Map();
  const pointKey = (point) => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
  let marker = null;
  const activeSignal = (signal) => {
    const combined = AbortSignal.any([lifetime.signal, signal].filter(Boolean));
    combined.throwIfAborted();
    return combined;
  };
  const removeMarker = () => {
    if (marker) viewer?.entities?.remove(marker);
    marker = null;
  };
  return {
    readSelection: () =>
      lifetime.signal.aborted ? null : lens.view?.selection || null,
    readRoute: () =>
      lifetime.signal.aborted
        ? null
        : dataManager?.layers?.get('directions')?.module.getRouteSnapshot?.() ||
          null,
    subscribeChanges(listener) {
      if (lifetime.signal.aborted) return () => {};
      const changed = () => {
        removeMarker();
        if (!lifetime.signal.aborted) listener();
      };
      const stopSelection = watch(() => lens.view?.selection, changed, {
        flush: 'sync',
      });
      const stopRoute = dataManager?.layers
        ?.get('directions')
        ?.module.subscribeRoute?.(changed);
      let active = true;
      const dispose = () => {
        if (!active) return;
        active = false;
        stopSelection();
        stopRoute?.();
        disposers.delete(dispose);
      };
      disposers.add(dispose);
      return dispose;
    },
    async getTerrain(points, { signal } = {}) {
      const active = activeSignal(signal);
      if (
        typeof operations?.requests?.terrain?.getProfileHeights !== 'function'
      )
        throw new Error('Terrain profile source is unavailable.');
      points.forEach((point) => heights.delete(pointKey(point)));
      removeMarker();
      const results = await operations.requests.terrain.getProfileHeights(
        points,
        { signal: active },
      );
      active.throwIfAborted();
      const accepted = calculateProfile(
        { samples: points, sampleSpacingM: null },
        { results },
      ).samples;
      (results || []).forEach((row, index) => {
        if (
          points[index] &&
          Number.isFinite(accepted[index]?.elevationM) &&
          Number.isFinite(row?.ellipsoid) &&
          Number.isFinite(row?.lat) &&
          Number.isFinite(row?.lon) &&
          pointKey(row) === pointKey(points[index]) &&
          row?.provenance?.tileset === 'mapterhorn-egm08'
        ) {
          heights.set(pointKey(points[index]), row.ellipsoid);
          while (heights.size > 128)
            heights.delete(heights.keys().next().value);
        }
      });
      return { results };
    },
    async getContext(point, { signal } = {}) {
      const active = activeSignal(signal);
      const result = await contextSource.getContext(point, { signal: active });
      active.throwIfAborted();
      return result;
    },
    async getFireContext({ bounds }, { signal } = {}) {
      const active = activeSignal(signal);
      const result = await fireSource({ bounds, signal: active });
      active.throwIfAborted();
      return result;
    },
    async saveSnapshot(subject, snapshot) {
      activeSignal();
      return fieldbook.saveAnalysis(subject, snapshot);
    },
    focusSample(point) {
      if (
        lifetime.signal.aborted ||
        !point ||
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lon) ||
        !Number.isFinite(point.elevationM)
      )
        return;
      const height = heights.get(pointKey(point));
      removeMarker();
      if (!Number.isFinite(height) || !viewer?.entities) return;
      marker = viewer.entities.add({
        position: Cartesian3.fromDegrees(point.lon, point.lat, height + 2),
        point: {
          pixelSize: 12,
          color: Color.fromCssColorString('#e1c187'),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      viewer.scene?.requestRender?.();
    },
    destroy() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      for (const dispose of [...disposers]) dispose();
      removeMarker();
      heights.clear();
    },
  };
}

export function createPlannerTools(options) {
  const bindings = createPlannerBindings(options);
  const controller = new PlannerController({
    ...bindings,
    store: usePlannerStore(options.pinia),
  });
  controller.init();
  return {
    controller,
    destroy() {
      bindings.destroy();
      controller.destroy();
    },
  };
}
