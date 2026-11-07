import { watch } from 'vue';
import { t } from '../i18n/index.js';
import { OrbitWitnessController } from '../ui/orbitWitnessController.js';
import { useOrbitWitnessStore } from '../ui/stores/orbitWitness.js';
import { useLensStore } from '../ui/stores/lens.js';
import { createOrbitElementSource } from '../orbitWitness/tle.js';
import {
  createSceneCatalogueSource,
  createCloudForecastSource,
} from '../orbitWitness/sources.js';
import { createSceneWatchSource } from '../orbitWitness/sceneWatch.js';
import { createOrbitWitnessOverlay } from '../orbitWitness/overlay.js';
import { withRideScene } from '../orbitWitness/ride.js';

const DAY_MS = 86400000;
/** Chronicle's window is at most 31 UTC days; the previous scene is found inside it. */
const CHRONICLE_LOOKBACK_DAYS = 30;

/** HLS product Chronicle can display for a catalogued scene, or null. */
export function chronicleProductFor(observation) {
  if (['S30', 'L30'].includes(observation?.productId))
    return observation.productId;
  const platform = String(observation?.platform || '');
  if (platform.startsWith('sentinel-2')) return 'S30';
  if (platform.startsWith('landsat')) return 'L30';
  return null;
}

/**
 * Open a fired scene in Chronicle beside the previous scene of the same
 * product: select the watch's place, search the 31-day window ending on
 * the scene's day, choose the previous and the new day, compare.
 */
export function createChronicleSceneOpener({ lens, chronicle, workspace }) {
  return async function openScene({ place, observation }) {
    const product = chronicleProductFor(observation);
    const day = String(observation?.acquiredAt || '').slice(0, 10);
    if (!product || !/^\d{4}-\d{2}-\d{2}$/.test(day))
      return {
        ok: false,
        message: t('Chronicle cannot display this scene type.'),
      };
    lens?.select(
      {
        id: place.id,
        name: place.name,
        geometry: { type: 'Point', coordinates: place.coordinates },
      },
      { reveal: false, origin: 'watchlist' },
    );
    workspace?.chooseDestination('compare');
    const startDate = new Date(
      Date.parse(`${day}T00:00:00Z`) - CHRONICLE_LOOKBACK_DAYS * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    if (!(await chronicle.search({ startDate, endDate: day })))
      return {
        ok: false,
        message: t('Chronicle could not search dated imagery for this place.'),
      };
    const rows = chronicle.candidates.filter((row) =>
      row.id.startsWith(`${product}:`),
    );
    const after = rows.find((row) => row.requestedDate === day);
    if (!after)
      return {
        ok: false,
        message: t(
          'HLS {product} for {day} is not in NASA CMR yet. HLS usually follows the source scene by days; try again later.',
          { product, day },
        ),
      };
    const before = rows
      .filter((row) => row.requestedDate < day)
      .sort((a, b) => b.requestedDate.localeCompare(a.requestedDate))[0];
    if (!before)
      return {
        ok: false,
        message: t(
          'No earlier {product} scene was found in the 31 days before {day}.',
          { product, day },
        ),
      };
    const ok =
      (await chronicle.choose({ slot: 'a', id: before.id })) &&
      (await chronicle.choose({ slot: 'b', id: after.id })) &&
      (await chronicle.compare());
    return ok
      ? { ok: true }
      : {
          ok: false,
          message: t(
            'Chronicle found both dates but could not verify their pixels for this place.',
          ),
        };
  };
}

/** Scene watch source for the Watchlist (second watch type). */
export function createSceneWatchlistSource() {
  return createSceneWatchSource({ catalogue: createSceneCatalogueSource() });
}

function downloadText(fileName, text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The Scene Director seen through the only operations a ride needs. */
export function createRideDirector(sceneDirector) {
  if (!sceneDirector) return null;
  return {
    subscribe: (listener) => sceneDirector.subscribe(listener),
    get running() {
      return Boolean(sceneDirector.running);
    },
    async ride(scene) {
      const snapshot = sceneDirector.getProjectSnapshot();
      if (!snapshot || sceneDirector.running) return false;
      const restored = await sceneDirector.restoreProjectSnapshot(
        withRideScene(snapshot, scene),
      );
      if (!restored) return false;
      // Preview runs in recording mode; the promise settles when the run ends.
      const run = sceneDirector.startScene(scene.id);
      const early = await Promise.race([
        run,
        new Promise((resolve) => setTimeout(() => resolve(null), 250)),
      ]);
      return early?.started !== false;
    },
    stop: () => sceneDirector.stopScene(),
  };
}

export function createOrbitWitnessTools({
  pinia,
  viewer,
  sceneDirector,
  watchlists,
}) {
  const lens = useLensStore(pinia);
  const disposers = new Set();
  const controller = new OrbitWitnessController({
    store: useOrbitWitnessStore(pinia),
    readSelection: () => lens.view?.selection || null,
    subscribeSelection(listener) {
      const stop = watch(() => lens.view?.selection, listener, {
        flush: 'sync',
      });
      disposers.add(stop);
      return () => {
        stop();
        disposers.delete(stop);
      };
    },
    elements: createOrbitElementSource(),
    catalogue: createSceneCatalogueSource(),
    cloud: createCloudForecastSource(),
    overlay: viewer ? createOrbitWitnessOverlay(viewer) : null,
    director: createRideDirector(sceneDirector),
    createWatch: watchlists
      ? (selection) =>
          watchlists.create({
            kind: 'scene',
            place: selection,
            title: t('New scenes over {place}', { place: selection.name }),
          })
      : null,
    download: downloadText,
  });
  controller.init();
  return {
    controller,
    destroy() {
      controller.destroy();
      [...disposers].forEach((stop) => stop());
      disposers.clear();
    },
  };
}
