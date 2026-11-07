import { watch } from 'vue';
import { WatchlistController } from '../ui/watchlistController.js';
import { useWatchlistsStore } from '../ui/stores/watchlists.js';
import { useFieldbookStore } from '../ui/stores/fieldbook.js';
import { createStationWatchSource } from '../airQuality/watch.js';
import { createAirQualityStationsSource } from '../sources/airQualityStations.js';

/** A clean draft is saved only when the repository list acknowledges its exact revision. */
function savedPlaces(view) {
  const draft = view?.draft;
  if (
    !draft ||
    view.dirty !== false ||
    view.busy ||
    view.loading ||
    view.conflict ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 0 ||
    !view.projects?.some(
      (project) =>
        project.id === draft.id && project.revision === draft.revision,
    )
  )
    return [];
  return draft.places || [];
}

/** Current saved places seed independent local watch definitions; monitoring is always explicit. */
export function createWatchlistTools({
  pinia,
  repository,
  source,
  stationSource = createStationWatchSource({
    stations: createAirQualityStationsSource(),
  }),
  sceneSource,
  onOpenScene,
} = {}) {
  const library = useFieldbookStore(pinia);
  const controller = new WatchlistController({
    store: useWatchlistsStore(pinia),
    ...(repository ? { repository } : {}),
    ...(source ? { source } : {}),
    stationSource,
    ...(sceneSource ? { sceneSource } : {}),
    ...(onOpenScene ? { onOpenScene } : {}),
    readSavedPlaces: () => savedPlaces(library.view),
    subscribeSavedPlaces: (listener) =>
      watch(() => library.view, listener, { flush: 'sync' }),
  });
  const ready = controller.init();
  return { controller, ready, destroy: () => controller.destroy() };
}
