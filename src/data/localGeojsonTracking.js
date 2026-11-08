import * as Cesium from 'cesium';

/**
 * Double-click camera lock for primitive-backed local GeoJSON records.
 *
 * When these layers were Entities, Cesium's Viewer tracked a double-clicked
 * feature by itself (pickAndTrackObject). Primitives are not Entities, so the
 * layer tracks through a helper Entity at the record's surface base. The
 * helper carries a transparent point so its bounding sphere is ready at once,
 * and it is removed as soon as the viewer tracks anything else.
 */

const HELPER_POINT = Object.freeze({
  pixelSize: 1,
  color: Cesium.Color.TRANSPARENT,
});

/**
 * @param {Cesium.Viewer} viewer
 * @returns {{track: (position: Cesium.Cartesian3, name?: string) => void, release: () => void, readonly helper: ?Cesium.Entity}}
 */
export function createRecordTracker(viewer) {
  let helper = null;
  let removeListener = null;

  function release() {
    removeListener?.();
    removeListener = null;
    if (!helper) return;
    const current = helper;
    helper = null;
    if (viewer.trackedEntity === current) viewer.trackedEntity = undefined;
    if (!viewer.isDestroyed?.()) viewer.entities.remove(current);
  }

  function track(position, name) {
    if (!position) return;
    release();
    helper = viewer.entities.add({
      name,
      position,
      point: HELPER_POINT,
    });
    viewer.trackedEntity = helper;
    const owned = helper;
    removeListener =
      viewer.trackedEntityChanged?.addEventListener((entity) => {
        if (entity !== owned) release();
      }) ?? null;
  }

  return {
    track,
    release,
    get helper() {
      return helper;
    },
  };
}
