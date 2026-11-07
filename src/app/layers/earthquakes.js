import * as Cesium from 'cesium';
import { createEarthquakesLayer } from '../../layers/earthquakes/index.js';
import { createEarthquakeSelection } from '../../layers/earthquakes/selection.js';
import * as context from '../../data/contextStore.js';
import * as picking from '../../data/pickRegistry.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { overlayHost } from './overlayHost.js';
/** Wire earthquake observations to the application overlay host and selection. */
export function createApplicationEarthquakes(options) {
  return createEarthquakesLayer({
    overlayHost,
    selection: createEarthquakeSelection({
      context,
      picking,
      isPointerFree,
      screenSpaceEventHandlerFactory: (viewer) =>
        new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
    }),
    ...options,
  });
}
