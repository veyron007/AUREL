/**
 * Startup performance marks read by scripts/perf-probe.mjs.
 *
 * Each mark is recorded once per page load with `performance.mark`, so it costs
 * one timestamp in production and nothing is sent anywhere. The probe reads the
 * first entry of each name and reports the gaps between them in this order:
 *
 * - cesium-ready: the entry module started; Cesium.js and the module graph ran.
 * - viewer-created: the Cesium viewer exists.
 * - first-tile: the globe finished loading its first set of tiles.
 * - bootstrap-done: application start resolved.
 * - splash-hidden: the loading screen was told to hide.
 */
export const STARTUP_MARKS = Object.freeze({
  cesiumReady: 'cesium-ready',
  viewerCreated: 'viewer-created',
  firstTile: 'first-tile',
  bootstrapDone: 'bootstrap-done',
  splashHidden: 'splash-hidden',
});

/** Mark names in the order the probe reports gaps between them. */
export const STARTUP_MARK_ORDER = Object.freeze(Object.values(STARTUP_MARKS));

/** Record a startup mark the first time it is reached in this page. */
export function markStartup(name, timing = globalThis.performance) {
  if (typeof timing?.mark !== 'function') return false;
  if (timing.getEntriesByName?.(name, 'mark')?.length) return false;
  timing.mark(name);
  return true;
}

/**
 * Mark `first-tile` when the globe's tile queue first drains with every tile
 * loaded. Returns a function that stops listening early.
 */
export function markWhenGlobeTilesLoad(globe, timing = globalThis.performance) {
  const event = globe?.tileLoadProgressEvent;
  if (typeof event?.addEventListener !== 'function') return () => {};
  const remove = event.addEventListener((pending) => {
    if (pending !== 0 || !globe.tilesLoaded) return;
    markStartup(STARTUP_MARKS.firstTile, timing);
    remove();
  });
  return remove;
}
