import * as Cesium from 'cesium';
import {
  updateCableReferenceStem,
  selectCableReferenceLabelWinners,
  cableReferencePriority,
} from './overlay.js';
import { createCableRenderer } from './renderer.js';

export function createRendering({ state, renderOptions = {} }) {
  function resetPublishSignature() {
    state._lastPublishedIds.length = 0;
    state._lastPublishedPriorities.length = 0;
    state._lastPublishedCount = -1;
  }

  /**
   * Build this enable cycle's primitives from the parsed model and put them
   * in the scene. A failure leaves nothing behind in the scene.
   * @param {Cesium.Viewer} viewer
   * @param {object} model Parsed source (model.js).
   */
  function buildPrimitives(viewer, model) {
    releasePrimitives();
    const render = createCableRenderer({
      scene: viewer.scene,
      model,
      colors: {
        cableColor: state.cableColor,
        landingColor: state.landingColor,
      },
      classificationType: state._classificationType,
      ...renderOptions,
    });
    try {
      render.attach();
    } catch (error) {
      render.destroy();
      throw error;
    }
    state._render = render;
  }

  /**
   * Remove every primitive from the scene and free its GPU resources.
   * Hiding is not enough: hidden collections still hold their buffers and
   * the ~6,500 records behind them. The parsed model stays cached, so the
   * next enable rebuilds without a network round trip or a re-parse.
   */
  function releasePrimitives() {
    const render = state._render;
    state._render = null;
    state._referenceLabelCount = 0;
    state._publishScratch.length = 0;
    state._loaded = false;
    state._referenceSweepGate.reset();
    render?.destroy();
  }

  function updateVisibility() {
    state._render?.setShown(state._enabled);
  }

  /**
   * Re-classify every cable ground line for the active surface. One ground
   * primitive rebuild per stack switch — never per frame.
   * @param {Cesium.ClassificationType} next
   */
  function applyCableClassification(next) {
    if (next === undefined || next === state._classificationType) return;
    state._classificationType = next;
    if (!state._render) return;
    state._render.reclassify(next);
    state._viewer?.scene?.requestRender?.();
  }

  /**
   * Finish work that waits on Cesium's asynchronous ground primitives:
   * queued per-segment show changes and creation-geometry release. Cesium
   * marks a primitive ready only after the frame that built it, so this runs
   * after each frame and asks for one more whenever it changed something —
   * a parked camera under the idle governor still gets the settled frame.
   */
  function maintainPrimitives() {
    const render = state._render;
    if (!state._enabled || !render) return;
    const before = render.pending;
    if (before === 0) return;
    if (render.maintain() < before) state._viewer?.scene?.requestRender?.();
  }

  function sweepReferences(occluder, cameraPos, canvasHeight, fov) {
    const render = state._render;
    for (const record of render.references) {
      const visible = occluder.isPointVisible(record.base);
      record.visible = visible;
      record.distanceM = Cesium.Cartesian3.distance(cameraPos, record.base);
      if (record.point.show !== visible)
        render.setReferenceVisible(record, visible);
      // Hidden stems keep their last geometry; this same sweep refreshes them
      // in the pass where they turn visible again.
      if (visible)
        updateCableReferenceStem(record, cameraPos, canvasHeight, fov);
    }
    for (const surface of render.surfaces) {
      const visible = occluder.isPointVisible(surface.base);
      if (surface.visible !== visible)
        render.setSurfaceVisible(surface, visible);
    }
  }

  function publishWinners() {
    const winners = selectCableReferenceLabelWinners(state._render.references);
    let changed = winners.length !== state._lastPublishedCount;
    for (let i = 0; i < winners.length; i++) {
      const record = winners[i];
      const priority = cableReferencePriority(record.distanceM);
      record.entry.priority = priority;
      state._publishScratch[i] = record.entry;
      if (
        !changed &&
        (state._lastPublishedIds[i] !== record.entry.id ||
          state._lastPublishedPriorities[i] !== priority)
      ) {
        changed = true;
      }
    }
    state._publishScratch.length = winners.length;
    state._referenceLabelCount = winners.length;
    if (!changed) return;
    state._overlayPublisher.publish(state._publishScratch);
    state._lastPublishedCount = winners.length;
    for (let i = 0; i < winners.length; i++) {
      state._lastPublishedIds[i] = state._publishScratch[i].id;
      state._lastPublishedPriorities[i] = state._publishScratch[i].priority;
    }
    state._lastPublishedIds.length = winners.length;
    state._lastPublishedPriorities.length = winners.length;
  }

  function updateReferenceVisibility() {
    if (!state._enabled || !state._render || !state._viewer?.camera) return;
    const cameraPos = state._viewer.camera.positionWC;
    if (!cameraPos) return;
    const canvasHeight = state._viewer.scene?.canvas?.clientHeight || 1080;
    const fov = state._viewer.camera.frustum?.fov || Math.PI / 3;
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      cameraPos,
    );
    sweepReferences(occluder, cameraPos, canvasHeight, fov);
    publishWinners();
  }
  return {
    resetPublishSignature,
    buildPrimitives,
    releasePrimitives,
    updateVisibility,
    applyCableClassification,
    maintainPrimitives,
    updateReferenceVisibility,
  };
}
