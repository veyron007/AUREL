import { watch } from 'vue';
import { createLazyDirector } from '../scenes/lazyDirector.js';
import { usePanelChromeStore } from '../ui/stores/panelChrome.js';
import { whenStartupSettled } from '../ui/rail/deferredBody.js';

/** The Authoring panel, whose first open loads the Director. */
const AUTHORING_PANEL_ID = 'scene-panel';

/**
 * The application's Scene Director, built on first use (src/scenes/lazyDirector.js):
 * when the Authoring panel opens, when a caller needs it, or once start-up
 * has settled. Returns the stand-in and a function that stops the triggers.
 * @param {{viewer: object, styleManager: object, dataManager: object,
 *   dataPacks?: object, mapStackController?: object, pinia: object}} input
 */
export function createApplicationDirector({
  viewer,
  styleManager,
  dataManager,
  dataPacks,
  mapStackController,
  pinia,
}) {
  const director = createLazyDirector(() =>
    import('../scenes/director.js').then(
      ({ SceneDirector }) =>
        new SceneDirector(viewer, styleManager, dataManager, {
          dataPacks,
          isMapStackAvailable: (id) =>
            mapStackController?.isStackAvailable(id) === true,
        }),
    ),
  );
  const load = () =>
    director.ready().catch((error) => {
      console.warn('[Scenes] The Director could not be loaded:', error);
    });
  const chrome = usePanelChromeStore(pinia);
  const stopWatching = watch(
    () => chrome.panels[AUTHORING_PANEL_ID]?.collapsed === false,
    (open) => open && load(),
    { immediate: true },
  );
  let stopped = false;
  whenStartupSettled().then(() => !stopped && load());
  return {
    director,
    stop() {
      stopped = true;
      stopWatching();
    },
  };
}
