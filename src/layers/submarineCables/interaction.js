import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';

export function createInteraction({ state, screenSpaceEventHandlerFactory }) {
  function beginInteraction(viewer) {
    if (state._clickHandler) return;
    state._clickHandler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
    state._clickHandler.setInputAction((click) => {
      // A tool owns the pointer (src/data/inputOwnership.js): yield the click.
      if (!isPointerFree()) return;
      if (!state._enabled) return;
      const picked = viewer.scene.pick(click.position);
      const record = resolvePickRecord(picked);
      if (!record?.reference) return;
      flyToReference(viewer, record.reference);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  /**
   * Every cable, landing and reference primitive carries a string pick key
   * (the instance id of a ground segment, the id of a pin, stem or tip); the
   * current enable cycle's renderer maps it to the record.
   * @param {object|null} picked Result of `scene.pick()`.
   * @returns {{kind:string, reference:{lon:number, lat:number}, label:string}|null}
   */
  function resolvePickRecord(picked) {
    const picks = state._render?.picks;
    if (!picked || !picks) return null;
    if (typeof picked.id === 'string') return picks.get(picked.id) || null;
    const primitiveId = picked.primitive?.id;
    if (typeof primitiveId === 'string') return picks.get(primitiveId) || null;
    return null;
  }

  function flyToReference(viewer, reference) {
    if (!viewer || !reference) return;
    const destination = Cesium.Cartesian3.fromDegrees(
      reference.lon,
      reference.lat,
      6500,
    );
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({
      destination,
      orientation: {
        heading: viewer.camera.heading || 0,
        pitch: Cesium.Math.toRadians(-52),
        roll: 0,
      },
      duration: 1.35,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }
  return {
    beginInteraction,
    resolvePickRecord,
    flyToReference,
  };
}
