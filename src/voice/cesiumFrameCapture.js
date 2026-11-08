/**
 * Read the Cesium canvas while its drawing buffer still holds the frame.
 *
 * The viewer runs without `preserveDrawingBuffer` (WP4.8): after the browser
 * composites a frame, the WebGL drawing buffer may be cleared, so a read in a
 * later task can return a blank image. A read inside `scene.postRender` runs
 * in the same task as the render, before compositing, and sees the frame.
 */

/** Longest wait for a requested frame before the capture gives up. */
export const FRESH_FRAME_TIMEOUT_MS = 400;

let capturesInFlight = 0;

/** Whether a capture is waiting to read the canvas (adaptive quality holds). */
export function captureInFlight() {
  return capturesInFlight > 0;
}

const isDocumentHidden = () =>
  typeof document !== 'undefined' && document.hidden === true;

/**
 * Request one frame and run `read(canvas)` inside its postRender.
 * @returns {Promise<{fresh: boolean, value: any}>} fresh is false while the
 *   document is hidden, on timeout, or when a read throws.
 */
function readNextFrame(scene, read, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let removeListener = () => {};
    const finish = (fresh, value = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeListener();
      resolve({ fresh, value });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    removeListener = scene.postRender.addEventListener(() => {
      // A tab switch during the wait invalidates freshness.
      if (isDocumentHidden()) return finish(false);
      try {
        finish(true, read(scene.canvas));
      } catch (error) {
        console.warn('[GEV Capture] Reading the Cesium frame failed', error);
        finish(false);
      }
    });
    try {
      scene.requestRender?.();
    } catch (error) {
      console.warn('[GEV Capture] Requesting a Cesium frame failed', error);
      finish(false);
    }
  });
}

/**
 * Render a fresh frame and read the scene canvas synchronously inside its
 * postRender, while the drawing buffer is valid.
 *
 * @param {object} viewer Cesium viewer.
 * @param {(canvas: HTMLCanvasElement) => any} read Synchronous reader, e.g. a
 *   drawImage of the canvas into a 2D canvas. Its result is resolved.
 * @param {{attempts?: number, timeoutMs?: number}} [options] attempts > 1
 *   retries only when no frame arrived in time (never when hidden).
 * @returns {Promise<any|null>} The read result, or null when hidden, timed
 *   out, or the read failed; a stale frame is never passed off as current.
 */
export async function captureCesiumFrame(
  viewer,
  read,
  { attempts = 1, timeoutMs = FRESH_FRAME_TIMEOUT_MS } = {},
) {
  const scene = viewer?.scene;
  if (!scene?.postRender || typeof read !== 'function') return null;
  capturesInFlight++;
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      // While hidden the render loop is suspended: don't restart it for an
      // optional screenshot.
      if (isDocumentHidden()) return null;
      const { fresh, value } = await readNextFrame(scene, read, timeoutMs);
      if (fresh) return value ?? null;
    }
    return null;
  } finally {
    capturesInFlight--;
  }
}
