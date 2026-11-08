import {
  cableClassificationTypeForScene,
  cableClassificationTypeForStack,
} from './surface.js';

export function createLifecycle({ state, parts, source, mapStackEventTarget }) {
  return {
    id: 'telegeography-submarine-cables',
    name: 'Submarine Cables',
    icon: '≋',
    source: source.label,
    updateInterval: 0,
    statsRefreshInterval: 500,

    init(viewer) {
      state._viewer = viewer;
      state._classificationType = cableClassificationTypeForScene(
        viewer?.scene,
      );
      if (!state._mapStackListener && mapStackEventTarget?.addEventListener) {
        state._mapStackListener = (event) => {
          parts.rendering.applyCableClassification(
            event?.detail?.activeId
              ? cableClassificationTypeForStack(event.detail.activeId)
              : cableClassificationTypeForScene(state._viewer?.scene),
          );
        };
        mapStackEventTarget.addEventListener(
          'gev:map-stack-changed',
          state._mapStackListener,
        );
      }
      parts.interaction.beginInteraction(viewer);
      if (!state._preRenderRemover) {
        state._preRenderRemover = viewer.scene.preRender.addEventListener(
          () => {
            // The camera is handed to the gate so tracked/orbit cameras — which
            // never emit moveEnd — reach the motion fallback. No render is
            // requested for a fallback sweep: it only fires while the camera is
            // already moving, so frames are flowing by construction.
            if (
              !state._enabled ||
              !state._loaded ||
              !state._referenceSweepGate.shouldRun(viewer.camera)
            )
              return;
            parts.rendering.updateReferenceVisibility();
          },
        );
      }
      if (!state._postRenderRemover && viewer.scene.postRender) {
        state._postRenderRemover = viewer.scene.postRender.addEventListener(
          () => parts.rendering.maintainPrimitives(),
        );
      }
      if (!state._moveEndRemover) {
        state._moveEndRemover = viewer.camera.moveEnd.addEventListener(() => {
          if (!state._enabled) return;
          state._referenceSweepGate.markDirty();
          viewer.scene.requestRender?.();
        });
      }
    },

    enable(viewer) {
      state._enabled = true;
      parts.rendering.updateVisibility();
      state._overlayPublisher.show();
      // A hide() cleared the host source, so an identical cohort must still
      // republish on the next sweep.
      parts.rendering.resetPublishSignature();
      state._referenceSweepGate.markDirty();
      // The gate is dirty-only; ask for the frame its sweep needs in case the
      // camera is parked and nothing else is rendering.
      (viewer || state._viewer)?.scene?.requestRender?.();
      void parts.ingestion.load(viewer || state._viewer);
    },

    disable() {
      state._enabled = false;
      state._overlayPublisher.hide();
      parts.rendering.resetPublishSignature();
      if (state._loading && state._abort) {
        state._abort.abort();
        state._loading = false;
        state._loadingLabel = '';
      }
      // Free the primitives rather than hide them; enable() rebuilds from the
      // cached model. An in-flight load's own post-await ownership check
      // keeps a stale generation from building anything later.
      parts.rendering.releasePrimitives();
    },

    update(viewer) {
      return parts.ingestion.load(viewer || state._viewer);
    },

    destroy(viewer) {
      if (state._abort) state._abort.abort();
      parts.rendering.releasePrimitives();
      state._model = null;
      // hide() clears every published host entry and goes invisible while
      // keeping the publisher reusable — the legacy layer supported re-init
      // after destroy, and hidden publishers already drop late publishes.
      // Pinned by the direct-destroy host test: removing this line leaves a
      // visible overlay source with orphan labels.
      state._overlayPublisher.hide();
      if (state._clickHandler) {
        state._clickHandler.destroy();
        state._clickHandler = null;
      }
      if (state._preRenderRemover) {
        state._preRenderRemover();
        state._preRenderRemover = null;
      }
      if (state._moveEndRemover) {
        state._moveEndRemover();
        state._moveEndRemover = null;
      }
      if (state._postRenderRemover) {
        state._postRenderRemover();
        state._postRenderRemover = null;
      }
      if (state._mapStackListener && mapStackEventTarget?.removeEventListener) {
        mapStackEventTarget.removeEventListener(
          'gev:map-stack-changed',
          state._mapStackListener,
        );
        state._mapStackListener = null;
      }
      state._viewer = null;
      state._enabled = false;
      state._loading = false;
      state._loaded = false;
      state._count = 0;
      state._error = null;
      state._lastUpdate = null;
      state._loadingLabel = '';
      state._referenceLabelCount = 0;
      state._publishScratch.length = 0;
      parts.rendering.resetPublishSignature();
      state._referenceSweepGate.reset();
    },

    /**
     * The record behind a `scene.pick()` result, or null when the pick is
     * not one of this layer's primitives (or the layer is off).
     * @param {object|null} picked
     * @returns {{kind:string, reference:{lon:number, lat:number}, label:string, featureId?:string|null}|null}
     */
    resolvePick(picked) {
      return parts.interaction.resolvePickRecord(picked);
    },

    getStats() {
      return {
        count: state._count,
        lastUpdate: state._lastUpdate,
        loading: state._loading,
        loadingLabel: state._loadingLabel,
        error: state._error,
        referenceLabelCount: state._referenceLabelCount,
      };
    },
  };
}
