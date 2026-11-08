/**
 * Wait, briefly, for the start-up view's surface tiles.
 *
 * The start-up share restore lands the camera at once under the loading
 * cover (src/sharelink.js). Lifting the cover the same instant would show the
 * destination still streaming in, which the old 3 s flight used to hide. This
 * waits until the visible surface reports its tiles loaded, or a short cap,
 * whichever comes first, so the reveal looks as it did, only sooner.
 */

/** Frames rendered at the new view before its tile flag is trusted. */
const SETTLE_FRAMES = 2;

/** Never hold the cover longer than this for tiles. */
export const VIEW_TILES_CAP_MS = 2000;

/** Whether every shown surface (globe or 3D tileset) has its tiles. */
export function surfaceTilesLoaded(scene) {
  if (scene?.globe?.show) return scene.globe.tilesLoaded !== false;
  let found = false;
  for (let index = 0; index < (scene?.primitives?.length || 0); index += 1) {
    const primitive = scene.primitives.get(index);
    if (!primitive?.show || typeof primitive.tilesLoaded !== 'boolean')
      continue;
    found = true;
    if (!primitive.tilesLoaded) return false;
  }
  return found;
}

/**
 * Resolve when the surface has loaded, the cap passes or `signal` aborts.
 * Resolves to 'loaded', 'cap' or 'aborted'; it never rejects.
 * @param {{scene: object, signal?: AbortSignal, capMs?: number}} options
 * @returns {Promise<'loaded'|'cap'|'aborted'>}
 */
export function waitForViewTiles({ scene, signal, capMs = VIEW_TILES_CAP_MS }) {
  return new Promise((resolve) => {
    let settled = false;
    let removeListener = () => {};
    let timer;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeListener();
      signal?.removeEventListener('abort', onAbort);
      // Visible to the start-up probe; costs nothing otherwise.
      globalThis.performance?.mark?.(`startup-view-${outcome}`);
      resolve(outcome);
    };
    const onAbort = () => finish('aborted');
    // The flag still describes the old view until frames at the new one have
    // issued its tile requests, so only frames after landing count.
    let frames = 0;
    const check = () => {
      frames += 1;
      if (frames >= SETTLE_FRAMES && surfaceTilesLoaded(scene))
        finish('loaded');
    };
    if (signal?.aborted) return finish('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish('cap'), capMs);
    // Each completed frame may have finished the last tile.
    removeListener = scene?.postRender?.addEventListener?.(check) || (() => {});
    scene?.requestRender?.();
  });
}
