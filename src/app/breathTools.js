import { watch } from 'vue';
import { BreathController } from '../ui/breathController.js';
import { useBreathStore } from '../ui/stores/breath.js';
import { useLensStore } from '../ui/stores/lens.js';
import { createFieldContextSource } from '../sources/fieldContext.js';
import { createAirQualityStationsSource } from '../sources/airQualityStations.js';

/**
 * Compose the Lens Breath card from the Lens selection, the same-site station
 * route and the existing field-context (CAMS) route. Construction makes no
 * request; the card asks only when the person chooses "Check air here".
 */
export function createBreathTools({
  pinia,
  watchlists,
  stations = createAirQualityStationsSource(),
  fieldContext = createFieldContextSource(),
} = {}) {
  const lens = useLensStore(pinia);
  const controller = new BreathController({
    stations,
    fieldContext,
    store: useBreathStore(pinia),
    readSelection: () => lens.view?.selection ?? null,
    subscribeSelection: (listener) =>
      watch(() => lens.view?.selection, listener, { flush: 'sync' }),
    createStationWatch: (options) =>
      watchlists?.createStationWatch(options) ?? Promise.resolve(false),
  });
  controller.init();
  return { controller, destroy: () => controller.destroy() };
}
