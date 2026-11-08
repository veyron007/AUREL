/**
 * Camera motion flag: `data-camera-moving` on <html> while the camera is in a
 * transient move (a drag, a wheel zoom, a flight), so the Spatial theme can
 * swap its blurred glass for the solid pane while the globe redraws every
 * frame (src/ui/styles/spatial-budget.css fades it back on settle).
 *
 * Cesium raises `moveStart` on the first changed frame and `moveEnd` once the
 * camera has held still for `scene.cameraEventWaitTime`. Sustained camera
 * modes registered with the render governor (following a tracked entity, the
 * orbit verb, Cockpit) are a steady state rather than a move, so they keep
 * the resting look; so does an active recording, which must film the look the
 * person sees at rest.
 */
import { getRenderGovernorDiagnostics } from '../renderGovernor.js';

export const CAMERA_MOVING_ATTRIBUTE = 'data-camera-moving';

/** Governor holds whose camera motion is a steady state, not a move. */
export const SUSTAINED_CAMERA_HOLDS = Object.freeze([
  'tracked-entity',
  'camera-orbit',
  'cockpit',
]);

function sustainedHoldActive(readHolds) {
  const holds = readHolds();
  return SUSTAINED_CAMERA_HOLDS.some((id) => holds.includes(id));
}

/**
 * @param {object} options
 * @param {{moveStart: {addEventListener: Function}, moveEnd: {addEventListener: Function}}} options.camera
 * @param {{setAttribute: Function, removeAttribute: Function}} options.root Usually document.documentElement.
 * @param {() => string[]} [options.readHolds] Current governor hold owners.
 * @param {() => boolean} [options.isRecording] Whether a recording is running.
 * @returns {() => void} Disposer; removes the listeners and the attribute.
 */
export function installCameraMotionFlag({
  camera,
  root,
  readHolds = () => getRenderGovernorDiagnostics().holds,
  isRecording = () =>
    Boolean(globalThis.document?.body?.classList.contains('recording-mode')),
}) {
  if (!camera?.moveStart || !camera?.moveEnd || !root)
    throw new TypeError('installCameraMotionFlag needs a camera and a root');
  let moving = false;
  const set = (next) => {
    if (next === moving) return;
    moving = next;
    if (next) root.setAttribute(CAMERA_MOVING_ATTRIBUTE, '');
    else root.removeAttribute(CAMERA_MOVING_ATTRIBUTE);
  };
  const onStart = () => {
    try {
      set(!sustainedHoldActive(readHolds) && !isRecording());
    } catch (error) {
      // A failed read keeps the resting look rather than guessing.
      console.warn('[camera-motion] could not read the move state', error);
      set(false);
    }
  };
  const onEnd = () => set(false);
  const removeStart = camera.moveStart.addEventListener(onStart);
  const removeEnd = camera.moveEnd.addEventListener(onEnd);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    removeStart?.();
    removeEnd?.();
    set(false);
  };
}
