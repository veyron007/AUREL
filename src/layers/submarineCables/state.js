import * as Cesium from 'cesium';
import {
  createCableReferenceSweepGate,
  createCableOverlayPublisher,
} from './overlay.js';
import { BASE_CABLE_COLOR, BASE_LANDING_COLOR } from './policy.js';

export function createState({ sweepClock, overlayHost }) {
  const state = {};

  state._viewer = null;

  state._enabled = false;

  state._loading = false;

  state._loaded = false;

  state._count = 0;

  state._error = null;

  state._lastUpdate = null;

  state._loadingLabel = '';

  state._abort = null;

  /** Monotonic load-ownership token; every load() start claims a new one. */

  state._loadGeneration = 0;

  /**
   * The primitives of the current enable cycle (renderer.js), or null. A
   * disable destroys them; enable rebuilds from the cached model.
   */

  state._render = null;

  /**
   * The one parsed copy of the source (model.js), kept across
   * disable/enable so a re-enable rebuilds without a fetch or re-parse. The
   * raw JSON is not retained.
   */

  state._model = null;

  state._clickHandler = null;

  state._preRenderRemover = null;

  state._moveEndRemover = null;

  state._mapStackListener = null;

  /** Active ground-line classification; refined from live scene state at init. */

  state._classificationType = Cesium.ClassificationType.BOTH;

  state._referenceLabelCount = 0;

  state._referenceSweepGate = createCableReferenceSweepGate({
    now: sweepClock,
  });

  state._overlayPublisher = createCableOverlayPublisher({ host: overlayHost });

  /** Reused winner→entry scratch so a 2 Hz sweep allocates no arrays. */

  state._publishScratch = [];

  /**
   * Last published cohort signature (ids + quantized priorities). A parked
   * camera reproduces the same winners every sweep; skipping the identical
   * republish keeps the host from requesting a render per publish, so the
   * layer stays render-governor idle exactly like its native predecessor.
   * Tip positions need no republish either: the host reprojects the same
   * mutable Cartesians on every painted frame.
   */

  state._lastPublishedIds = [];

  state._lastPublishedPriorities = [];

  state._lastPublishedCount = -1;

  state.cableColor = Cesium.Color.fromCssColorString(BASE_CABLE_COLOR);

  state.landingColor = Cesium.Color.fromCssColorString(BASE_LANDING_COLOR);
  return state;
}
