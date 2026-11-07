import * as Cesium from 'cesium';
import { watch } from 'vue';
import { prefersReducedMotion } from '../cameraVerbs.js';
import { normalizeLensSelection } from '../ui/lensPresentation.js';
import { RegionsController } from '../ui/regionsController.js';
import { useRegionsStore } from '../ui/stores/regions.js';
import { useDisplayStore } from '../ui/stores/display.js';

/** Existing importer and navigation owners receive explicit verified region intent. */
export function createRegionBindings({
  pinia,
  geoFileImport,
  viewer,
  styleManager,
  onSelectPlace,
}) {
  const display = useDisplayStore(pinia),
    disposers = new Set();
  let destroyed = false;
  return {
    importFiles: geoFileImport?.importFiles
      ? (files) =>
          destroyed
            ? Promise.resolve([])
            : geoFileImport.importFiles(files, {
                autoFly: false,
                presentation: 'local-region',
              })
      : undefined,
    readImports: () => geoFileImport?.list?.() || [],
    // A nonabortable import can settle after teardown; its controller still owns cleanup.
    removeImport: (id) => geoFileImport?.remove?.(id) ?? false,
    subscribeImports(listener) {
      if (destroyed) return () => {};
      const stop = watch(() => display.geoImport, listener, { flush: 'sync' });
      disposers.add(stop);
      return () => {
        stop();
        disposers.delete(stop);
      };
    },
    focusPlace(place) {
      if (destroyed) return false;
      const selection = normalizeLensSelection(place);
      if (!selection || !viewer?.camera?.flyTo) return false;
      const [lon, lat] = selection.geometry.coordinates;
      return (
        styleManager?._runExplicitNavigation?.('local region place', () => {
          if (destroyed) return false;
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1500),
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
            duration: prefersReducedMotion() ? 0 : 1.2,
          });
          onSelectPlace?.(selection);
          return true;
        }) ?? false
      );
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      disposers.forEach((stop) => stop());
      disposers.clear();
    },
  };
}

export function createRegionTools(options) {
  const bindings = createRegionBindings(options);
  const controller = new RegionsController({
    ...bindings,
    store: useRegionsStore(options.pinia),
  });
  controller.init();
  return {
    controller,
    destroy() {
      controller.destroy();
      bindings.destroy();
    },
  };
}
