// Explicitly reviewed feed owners only. Unknown/new IDs fail closed: never
// disable user-authored routes, imported files, drawings or image comparisons.
const LIVE_FEEDS = new Set([
  'flights',
  'military',
  'local-adsb',
  'ais-live-vessels',
  'satellites',
  'earthquakes',
  'air-quality',
  'local-firms',
  'traffic',
  'cctv',
  'radio',
  'transit',
  'bikeshare',
  'rocket-launches',
  'military-awareness',
  'wind',
  'weather-lightning',
  'weather-cyclones',
  'weather-radar',
  'weather-satellite',
  'fire-perimeters',
  'gnss-integrity',
  'drone-airspace',
  'wildlife-sightings',
  's2-ghostmaps',
]);
async function pauseKnownFeeds(manager) {
  if (!manager?.getEnabledLayerIds || !manager?.setEnabled)
    throw Error('Layer owner unavailable');
  const targetIds = [...manager.getEnabledLayerIds()]
    .filter((id) => LIVE_FEEDS.has(id))
    .reverse();
  // Queue every OFF intent synchronously; the manager cancels in-flight enables
  // and retains authority for any later explicit user intent. No retry loop.
  const attempts = targetIds.map((id) => {
    try {
      return Promise.resolve(
        manager.setEnabled(id, false, { origin: 'session-pause' }),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  });
  const outcomes = await Promise.allSettled(attempts);
  const current = manager.getEnabledLayerIds();
  const notClearedIds = targetIds.filter(
    (id, index) =>
      outcomes[index].status !== 'fulfilled' ||
      outcomes[index].value !== true ||
      current.has(id),
  );
  return {
    targetIds,
    clearedIds: targetIds.filter((id) => !notClearedIds.includes(id)),
    notClearedIds,
  };
}
/** Explicit session pause. Map tiles and third-party browser tabs are outside this scope. */
export function createSessionControls({
  dataManager,
  watchlists,
  cancelWork = [],
} = {}) {
  let pending = null;
  return {
    get busy() {
      return pending !== null;
    },
    pauseLiveData() {
      if (pending) return pending;
      const watchIds = (watchlists?.view?.watches || [])
        .filter((row) => row.state !== 'other-tab')
        .map((row) => row.id);
      const tasks = [
        {
          kind: 'layers',
          run: () => pauseKnownFeeds(dataManager),
        },
        ...watchIds.map((id) => ({
          kind: 'watch',
          id,
          run: () => watchlists.stop(id),
        })),
        ...cancelWork.map((run, index) => ({
          kind: 'work',
          id: String(index),
          run,
        })),
      ];
      const work = tasks.map((task) => {
        try {
          return Promise.resolve(task.run());
        } catch (error) {
          return Promise.reject(error);
        }
      });
      pending = Promise.allSettled(work)
        .then((results) => {
          const failures = [],
            stoppedWatchIds = [];
          let layerResult = null;
          results.forEach((result, index) => {
            const task = tasks[index];
            if (result.status === 'rejected') {
              failures.push({ kind: task.kind, id: task.id || null });
              return;
            }
            if (task.kind === 'layers') {
              layerResult = result.value;
              if (
                !layerResult ||
                !Array.isArray(layerResult.notClearedIds) ||
                layerResult.notClearedIds.length
              )
                failures.push({ kind: 'layers', id: null });
            } else if (task.kind === 'watch') stoppedWatchIds.push(task.id);
          });
          return {
            ok: failures.length === 0,
            layerResult,
            stoppedWatchIds,
            failures,
          };
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
