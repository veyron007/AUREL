import * as Cesium from 'cesium';
import { mapAnalystRecord } from '../sources/infrastructureData.js';
import { isPointerFree } from './inputOwnership.js';
import { createRecordTracker } from './localGeojsonTracking.js';
import {
  selectInfraLod,
  applyInfraEvictionGrace,
  shouldRecomputeInfraLod,
} from './localGeojsonLod.js';
import {
  LOCAL_OVERLAY_COHORT_LIMIT,
  createLocalInfrastructureOverlayPublisher,
  selectLocalInfrastructureOverlayCohort,
} from './localGeojsonOverlay.js';
import {
  GROUND_SAMPLE_MAX_ARMED_RETRIES,
  GROUND_SAMPLE_MAX_DISTANCE_M,
  GROUND_SAMPLE_RETRY_MS,
  groundSampleInView,
  refreshLocalTerrainFloor,
  sampleLocalGroundHeight,
  updateLocalStemGeometry,
} from './localGeojsonGround.js';
import { parseLocalGeojsonOffThread } from './localGeojsonParseClient.js';
import {
  createLocalGeojsonPrimitives,
  defaultLocalPinImage,
  defaultLocalStemMaterial,
} from './localGeojsonPrimitives.js';
import { buildLocalStemRecords } from './localGeojsonRecords.js';

export {
  LOCAL_OVERLAY_COHORT_LIMIT,
  createLocalInfrastructureOverlayEntry,
  createLocalInfrastructureOverlayPublisher,
  localInfrastructureOverlayCopy,
  selectLocalInfrastructureOverlayCohort,
} from './localGeojsonOverlay.js';
export {
  GROUND_SAMPLE_MAX_ARMED_RETRIES,
  LOCAL_STEM_TIP_EPSILON_M,
} from './localGeojsonGround.js';

const DEFAULT_LABEL_MAX = 900;
const DEFAULT_LABEL_GRID_PX = 132;
const VISIBILITY_UPDATE_MS = 450;
const FLY_TO_HEIGHT_M = 5000;
const FLY_TO_DURATION_S = 1.5;

/**
 * Reduce a bundled-dataset load failure to one short, honest stats string.
 *
 * These layers ship their data with the build, so a failure means the asset
 * is missing (404 / bad path) or corrupt — never "the network is slow". Both
 * must reach the user's chip; the raw parser message is console-only because
 * a truncated JSON blob is not a status line.
 *
 * @param {Error|{name?:string, message?:string}|null|undefined} error - The thrown load failure.
 * @returns {string} Short reason for getStats().error.
 */
export function localDatasetError(error) {
  if (error?.name === 'SyntaxError') return 'dataset is malformed';
  const message = String(error?.message || '').trim();
  return message ? `dataset unavailable (${message})` : 'dataset unavailable';
}

/** Fetch and parse a bundled dataset (parse runs in a worker when possible). */
async function fetchLocalDataset(url, signal, workerFactory) {
  const response = await fetch(url, { signal });
  // A 404 returns an HTML body that would otherwise die in JSON.parse
  // one line later, reported as a parse error for a missing file.
  if (!response.ok) throw new Error(`HTTP ${response.status ?? '?'}`);
  const text = await response.text();
  signal.throwIfAborted();
  return parseLocalGeojsonOffThread(text, { signal, workerFactory });
}

/** Fly to the surface below a picked record, keeping input off mid-flight. */
function flyToSurface(viewer, position) {
  const carto = Cesium.Cartographic.fromCartesian(position);
  if (!carto) return;
  const controller = viewer.scene.screenSpaceCameraController;
  // Disable interactions so Cesium doesn't cancel the flight.
  controller.enableInputs = false;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(
      carto.longitude,
      carto.latitude,
      FLY_TO_HEIGHT_M,
    ),
    duration: FLY_TO_DURATION_S,
    complete: () => {
      controller.enableInputs = true;
    },
    cancel: () => {
      controller.enableInputs = true;
    },
  });
}

/**
 * A local GeoJSON layer drawn with batched primitives: stems, tips, pins and
 * ground footprints (src/data/localGeojsonPrimitives.js). Each pick object is
 * a plain carrier registered as the record's context entity.
 * @param {object} options Dataset URL, identity, appearance and optional Cesium adapters.
 * @param {object} services Caller-owned operations; see docs/INFRASTRUCTURE-LAYERS.md.
 * @returns {object} A fresh layer implementing init/enable/disable/update/destroy/getStats/getAnalystRecords.
 * One live instance per layer id is allowed in a given viewer/context/overlay host.
 * Destroy the previous instance before replacing it. Importing creates no layers.
 */
export function createLocalGeoJsonLayer(
  {
    id,
    url,
    name,
    color,
    icon = '📍',
    source = 'Local JSONL',
    osmDerived = false,
    labels = true,
    labelMax = DEFAULT_LABEL_MAX,
    labelGridPx = DEFAULT_LABEL_GRID_PX,
    screenSpaceEventHandlerFactory = (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
    projectToWindow = (scene, position) =>
      Cesium.SceneTransforms.worldToWindowCoordinates(scene, position),
    pinImage = defaultLocalPinImage,
    stemMaterial = defaultLocalStemMaterial,
    parseWorkerFactory,
  },
  {
    overlayHost,
    registerEntityContext,
    selectEntityContext,
    clearSelectedEntityContextForLayer,
    removeEntityContextsForLayer,
    governorRequestRender,
    showOsmCredit,
    hideOsmCredit,
  },
) {
  /** Primitives of the current enable cycle; null while disabled. */
  let _renderer = null;
  /** The context records' `dataSource`: shown only while the build is live. */
  let _handle = null;
  let _enabled = false;
  let _clickHandler = null;
  /** Double-click camera lock (Entities got it from Cesium's Viewer). */
  let _tracker = null;
  let _count = 0;
  /** @type {number|null} Timestamp of the last successful dataset load. */
  let _lastUpdate = null;
  /** @type {string|null} Short reason the bundled dataset failed to load. */
  let _error = null;
  let _preRenderRemover = null;
  let _cameraMoveEndRemover = null;
  let _stemRecords = [];
  /** Pick carrier -> stem record or line {carrier, flyTarget}. */
  let _byCarrier = new Map();
  let _stemGeometryDirty = true;
  let _lastVisibilityUpdate = 0;
  let _postRenderRemover = null;
  let _destroyed = false;
  let _loadPromise = null;
  let _loadController = null;
  /**
   * The parsed bundled dataset, kept across disable/enable so a re-enable
   * rebuilds the primitives without refetching. The primitives themselves are
   * NOT kept: disable frees every GPU resource.
   * @type {Array<object>|null}
   */
  let _cachedRecords = null;
  /**
   * Globe-LOD active set: the record ids allowed to carry a live stem right
   * now. This bounds geometry refreshes and ground-sample work to the
   * camera-height budget in localGeojsonLod.js. Recomputed only when the
   * camera moves (`_stemGeometryDirty`, raised by moveEnd and by the motion
   * fallback below).
   * @type {Set<string>}
   */
  let _activeLodIds = new Set();
  /** Eviction-grace bookkeeping for `_activeLodIds` (id -> {misses, since}). */
  let _lodGraceState = new Map();
  /** Budget cap the most recent camera-height band produced (0 until computed). */
  let _lastLodBudgetLimit = 0;
  /**
   * False until the first post-enable walk has run the LOD selection. While
   * false the walk treats every record as active; once true, an EMPTY
   * `_activeLodIds` legitimately means "nothing should carry a stem now".
   */
  let _lodComputed = false;
  /** Camera position of the last LOD selection (motion-fallback reference). */
  const _lastLodCameraPos = new Cesium.Cartesian3();
  /** Last time the motion-fallback probe window opened (or a selection ran). */
  let _lastLodProbeMs = Number.NEGATIVE_INFINITY;
  let _groundRetryTimer = null;
  /** Consecutive self-armed retries since the last grounding/camera motion. */
  let _groundRetryArms = 0;
  /** Last observed scene.sampleHeightSupported; null until the first walk. */
  let _lastGroundSampleCapability = null;

  const layerIdentity = {
    id,
    name,
    source,
    color,
    labels,
  };
  const _overlayPublisher = createLocalInfrastructureOverlayPublisher({
    sourceId: id,
    host: overlayHost,
  });

  /**
   * Coalesced one-shot: ask the governor for a frame once the retry window
   * has elapsed, so the preRender ground-sample retry runs while the camera
   * is parked. Gated on capability (a scene that cannot sample never arms)
   * and on a bounded budget (GROUND_SAMPLE_MAX_ARMED_RETRIES consecutive
   * arms); free camera-motion frames still retry.
   * @param {Cesium.Viewer} viewer
   */
  function scheduleGroundRetryRender(viewer) {
    if (_groundRetryTimer || !_enabled) return;
    if (!viewer?.scene?.sampleHeightSupported) return;
    if (_groundRetryArms >= GROUND_SAMPLE_MAX_ARMED_RETRIES) return;
    _groundRetryArms += 1;
    _groundRetryTimer = setTimeout(() => {
      _groundRetryTimer = null;
      if (!_enabled || _destroyed) return;
      governorRequestRender(`local-ground-retry:${id}`);
    }, GROUND_SAMPLE_RETRY_MS);
  }

  function clearGroundRetryRender() {
    _groundRetryArms = 0;
    _lastGroundSampleCapability = null;
    if (!_groundRetryTimer) return;
    clearTimeout(_groundRetryTimer);
    _groundRetryTimer = null;
  }

  function resetLodState() {
    _activeLodIds = new Set();
    _lodGraceState = new Map();
    _lastLodBudgetLimit = 0;
    _lodComputed = false;
    _lastLodProbeMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * Take the built primitives out of the scene and free them. The parsed
   * records stay cached, so the next enable() rebuilds without a fetch.
   */
  function releaseRenderer() {
    const renderer = _renderer;
    _renderer = null;
    if (_handle) _handle.show = false;
    _handle = null;
    _stemRecords = [];
    _byCarrier = new Map();
    _stemGeometryDirty = true;
    _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;
    if (!renderer) return;
    removeEntityContextsForLayer(id);
    renderer.destroy();
  }

  function disableLayer(viewer) {
    hideOsmCredit?.(viewer, id);
    _enabled = false;
    _tracker?.release();
    clearGroundRetryRender();
    resetLodState();
    releaseRenderer();
    _overlayPublisher.hide();
    clearSelectedEntityContextForLayer(id);
    if (viewer?.selectedEntity?.__localLayerId === id) {
      viewer.selectedEntity = undefined;
    }
    _preRenderRemover?.();
    _preRenderRemover = null;
    _cameraMoveEndRemover?.();
    _cameraMoveEndRemover = null;
    _postRenderRemover?.();
    _postRenderRemover = null;
  }

  /** Build this cycle's primitives and records from the parsed dataset. */
  function buildScene(viewer, parsedRecords) {
    const handle = { show: false };
    const renderer = createLocalGeojsonPrimitives({
      scene: viewer.scene,
      color: Cesium.Color.fromCssColorString(color),
      pinImage,
      stemMaterial,
    });
    try {
      const built = buildLocalStemRecords(
        { ...layerIdentity, handle },
        parsedRecords,
        { renderer, registerEntityContext },
      );
      renderer.attach();
      return { renderer, handle, ...built };
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  async function loadAndBuild(viewer) {
    _loadController = new AbortController();
    const signal = _loadController.signal;
    _error = null;
    try {
      const parsed =
        _cachedRecords ??
        (await fetchLocalDataset(url, signal, parseWorkerFactory));
      if (_destroyed) return;
      _cachedRecords = parsed;
      // A disable() that landed during the fetch/parse: build nothing; the
      // next enable() builds from the cached records.
      if (_enabled) {
        const built = buildScene(viewer, parsed);
        _renderer = built.renderer;
        _handle = built.handle;
        _stemRecords = built.stemRecords;
        _byCarrier = built.byCarrier;
        _stemGeometryDirty = true;
      }
      _count = parsed.length;
      _lastUpdate = Date.now();
    } catch (e) {
      // The dataset ships with the build, so this is a broken install,
      // not a blip — it has to reach the chip, not just the console.
      if (_destroyed) return;
      _error = localDatasetError(e);
      removeEntityContextsForLayer(id);
      _count = 0;
      _stemRecords = [];
      _byCarrier = new Map();
      console.error(`Failed to load ${id}:`, e);
    }
    if (_destroyed) return;
    installClickHandler(viewer);
  }

  function onClick(viewer, click) {
    // A tool owns the pointer (src/data/inputOwnership.js).
    if (!isPointerFree()) return;
    if (!_enabled) return;
    const carrier = viewer.scene.pick(click.position)?.id;
    if (!carrier || carrier.__localLayerId !== id) return;
    const target = _byCarrier.get(carrier);
    if (!target) return;
    viewer.selectedEntity = carrier;
    selectEntityContext(carrier);
    // A stem's surface base (polygon or point), or a line's first vertex.
    const targetPos = target.base ?? target.flyTarget;
    if (targetPos) flyToSurface(viewer, targetPos);
  }

  /** Lock the camera onto a double-clicked record, as Entities were. */
  function onDoubleClick(viewer, click) {
    if (!isPointerFree() || !_enabled) return;
    const carrier = viewer.scene.pick(click.position)?.id;
    if (!carrier || carrier.__localLayerId !== id) return;
    const target = _byCarrier.get(carrier);
    const position = target?.base ?? target?.flyTarget;
    if (!position) return;
    viewer.camera.cancelFlight?.();
    viewer.selectedEntity = carrier;
    selectEntityContext(carrier);
    _tracker ??= createRecordTracker(viewer);
    _tracker.track(position, String(carrier.id));
  }

  function installClickHandler(viewer) {
    if (_clickHandler) return;
    _clickHandler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
    _clickHandler.setInputAction(
      (click) => onClick(viewer, click),
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
    _clickHandler.setInputAction(
      (click) => onDoubleClick(viewer, click),
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );
  }

  /**
   * Globe-LOD motion fallback: moveEnd never fires during a tracked follow,
   * Cockpit, route flight or continuous orbit, so a rate-limited probe
   * re-selects once the camera has travelled since the last selection.
   */
  function probeLodMotion(viewer, now, cameraPos) {
    if (_stemGeometryDirty || !_lodComputed || _stemRecords.length === 0)
      return;
    const probe = shouldRecomputeInfraLod({
      nowMs: now,
      lastProbeMs: _lastLodProbeMs,
      movedSqM: Cesium.Cartesian3.distanceSquared(cameraPos, _lastLodCameraPos),
      cameraHeightM: viewer.camera.positionCartographic?.height,
    });
    _lastLodProbeMs = probe.lastProbeMs;
    // Re-selecting demands fresh stem geometry: a record admitted
    // mid-motion has never had its tip sized for this camera.
    if (probe.recompute) _stemGeometryDirty = true;
  }

  /** Recompute the active-stem set for the camera-height budget. */
  function recomputeLod(viewer, now, cameraPos, occluder) {
    const candidates = new Array(_stemRecords.length);
    for (let i = 0; i < _stemRecords.length; i++) {
      const record = _stemRecords[i];
      candidates[i] = {
        id: record.id,
        priority: record.priority,
        distanceM: Cesium.Cartesian3.distance(cameraPos, record.base),
        inView: occluder.isPointVisible(record.base),
      };
    }
    const selection = selectInfraLod(candidates, {
      cameraHeightM: viewer.camera.positionCartographic?.height,
      incumbentIds: _activeLodIds,
    });
    const grace = applyInfraEvictionGrace({
      selectedIds: selection.activeIds,
      builtIds: [..._activeLodIds],
      graceState: _lodGraceState,
      nowMs: now,
      activeLimit: selection.budget.activeLimit,
    });
    _activeLodIds = new Set(grace.keepIds);
    _lodGraceState = grace.graceState;
    _lastLodBudgetLimit = selection.budget.activeLimit;
    _lodComputed = true;
    // Travel is measured from the last SELECTION, never the previous walk,
    // so jitter around a parked camera never accumulates into a recompute.
    Cesium.Cartesian3.clone(cameraPos, _lastLodCameraPos);
    _lastLodProbeMs = now;
  }

  function setRecordVisible(record, visible) {
    // The carrier is what context consumers read; it starts true, like the
    // Entity it replaces, while the visuals start hidden until this walk.
    record.carrier.show = visible;
    if (record.visible === visible) return;
    record.visible = visible;
    _renderer.setVisible(record.visual, record.carrier, visible);
  }

  /**
   * Ground-sample one active record and size its stem. Accumulates into
   * `walk.progress` (a record newly grounded) and `walk.retryPending`.
   */
  function walkActiveRecord(viewer, record, walk) {
    const wasGroundSampled = record.groundSampled;
    const terrainFloorChanged = refreshLocalTerrainFloor(viewer, record);
    if (walk.refreshStemGeometry || terrainFloorChanged) {
      updateLocalStemGeometry(viewer, record, walk.now, null, walk.writeStem);
    } else if (
      walk.canSampleGround &&
      !record.groundSampled &&
      walk.now - record.lastGroundSampleMs >= GROUND_SAMPLE_RETRY_MS
    ) {
      // Capability first: without it the distance is pure waste.
      const distance = Cesium.Cartesian3.distance(
        viewer.camera.positionWC,
        record.base,
      );
      if (
        distance < GROUND_SAMPLE_MAX_DISTANCE_M &&
        sampleLocalGroundHeight(viewer, record, walk.now)
      ) {
        updateLocalStemGeometry(
          viewer,
          record,
          walk.now,
          distance,
          walk.writeStem,
        );
      }
    }
    if (!wasGroundSampled && record.groundSampled) walk.progress = true;
    // Still unsampled AND close enough for a retry to succeed: under the
    // idle governor the retry's preRender never arrives on a parked camera,
    // so schedule the frame it needs (in-range, in-view records only).
    if (
      walk.canSampleGround &&
      !record.groundSampled &&
      !walk.retryPending &&
      Cesium.Cartesian3.distance(viewer.camera.positionWC, record.base) <
        GROUND_SAMPLE_MAX_DISTANCE_M &&
      groundSampleInView(viewer, record)
    ) {
      walk.retryPending = true;
    }
  }

  function publishCohort(viewer, visibleOverlayRecords) {
    const canvas = viewer.scene.canvas;
    const cohort = selectLocalInfrastructureOverlayCohort(
      visibleOverlayRecords,
      {
        maxEntries: labelMax,
        gridPx: labelGridPx,
        width: canvas.clientWidth || canvas.width || 0,
        height: canvas.clientHeight || canvas.height || 0,
        cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
        project: (record) => projectToWindow(viewer.scene, record.tip),
      },
    );
    _overlayPublisher.publish(cohort);
  }

  /** Read sampling capability once per walk; a late false->true re-opens the budget. */
  function groundCapability(viewer) {
    const canSampleGround = viewer.scene.sampleHeightSupported === true;
    if (canSampleGround && _lastGroundSampleCapability === false)
      _groundRetryArms = 0;
    _lastGroundSampleCapability = canSampleGround;
    return canSampleGround;
  }

  /** The 450 ms horizon/LOD/stem/label walk. */
  function visibilityWalk(viewer) {
    const now = performance.now();
    if (now - _lastVisibilityUpdate < VISIBILITY_UPDATE_MS) return;
    _lastVisibilityUpdate = now;
    const cameraPos = viewer.camera.positionWC;
    if (!cameraPos) return;
    probeLodMotion(viewer, now, cameraPos);
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      cameraPos,
    );
    const renderer = _renderer;
    const walk = {
      now,
      refreshStemGeometry: _stemGeometryDirty,
      canSampleGround: groundCapability(viewer),
      writeStem: (record) =>
        renderer.setStem(record.visual, record.base, record.tip),
      progress: false,
      retryPending: false,
    };
    if (walk.refreshStemGeometry && _stemRecords.length > 0)
      recomputeLod(viewer, now, cameraPos, occluder);

    const visibleOverlayRecords = [];
    for (let i = 0; i < _stemRecords.length; i++) {
      const record = _stemRecords[i];
      const isActive = !_lodComputed || _activeLodIds.has(record.id);
      const isVisible = isActive && occluder.isPointVisible(record.base);
      setRecordVisible(record, isVisible);
      // Records outside the active set carry no visible stem, so skip every
      // per-frame cost for them — geometry, ground samples, label candidacy.
      if (!isActive) continue;
      walkActiveRecord(viewer, record, walk);
      if (isVisible && record.entry) visibleOverlayRecords.push(record);
    }
    _renderer.maintain();
    _stemGeometryDirty = false;
    // Tiles ARE streaming in: real progress re-opens the give-up budget.
    if (walk.progress) _groundRetryArms = 0;
    if (walk.retryPending) scheduleGroundRetryRender(viewer);
    publishCohort(viewer, visibleOverlayRecords);
  }

  /**
   * Ground primitives finish building asynchronously, and Cesium marks them
   * ready only after the frame that built them. Settle their queued footprint
   * shows (and release their creation geometry) after each frame, and ask for
   * one more frame whenever that changed something, so a parked camera under
   * the idle governor still draws the result. One request per change, so this
   * cannot loop; nothing runs once no ground work is pending.
   */
  function settleGroundWork() {
    if (!_enabled || !_renderer) return;
    const before = _renderer.pending;
    if (before === 0) return;
    if (_renderer.maintain() < before)
      governorRequestRender(`local-ground-ready:${id}`);
  }

  function installListeners(viewer) {
    if (!_postRenderRemover && viewer.scene.postRender) {
      _postRenderRemover =
        viewer.scene.postRender.addEventListener(settleGroundWork);
    }
    if (!_preRenderRemover) {
      _preRenderRemover = viewer.scene.preRender.addEventListener(() => {
        if (_enabled && _renderer) visibilityWalk(viewer);
      });
    }
    if (!_cameraMoveEndRemover) {
      _cameraMoveEndRemover = viewer.camera.moveEnd.addEventListener(() => {
        if (!_enabled) return;
        _stemGeometryDirty = true;
        _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;
        // Real camera motion re-opens the retry budget a parked camera spent.
        _groundRetryArms = 0;
        viewer.scene.requestRender?.();
      });
    }
  }

  return {
    id,
    name,
    icon,
    source,
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init: async () => {
      // DataLayerManager calls this once
    },

    update: async () => {
      // DataLayerManager calls this when enabled
    },

    /**
     * @returns {{count:number, lastUpdate:number|null, error:string|null}}
     *   A dead layer must be distinguishable from an empty one: a failed load
     *   surfaces `error` (manager chip → UNAVAILABLE) instead of reporting a
     *   silent zero count as nominal.
     */
    getStats: () => {
      return { count: _count, lastUpdate: _lastUpdate, error: _error };
    },

    /**
     * Globe-LOD state for QA harnesses (scripts/qa-infra-lod.mjs) and tests.
     * @returns {{total:number, active:number, budgetLimit:number, computed:boolean}}
     */
    getLodDiagnostics: () => ({
      total: _stemRecords.length,
      active: _activeLodIds.size,
      budgetLimit: _lastLodBudgetLimit,
      computed: _lodComputed,
    }),

    /**
     * Snapshot in-memory infrastructure features as plain JSON-safe objects
     * for the analyst query engine. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] Maximum records to return (truncation).
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_stemRecords.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _stemRecords.slice(0, limit).map((record) =>
        mapAnalystRecord(
          {
            id: record.id,
            lat: Cesium.Math.toDegrees(record.carto.latitude),
            lon: Cesium.Math.toDegrees(record.carto.longitude),
            properties: record.properties,
          },
          id,
        ),
      );
    },

    enable: async (viewer) => {
      if (_destroyed) return;
      _enabled = true;
      _stemGeometryDirty = true;
      _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;
      _groundRetryArms = 0; // fresh give-up budget per enable-cycle
      _lastGroundSampleCapability = null;
      resetLodState(); // fresh globe-LOD selection per enable-cycle
      _overlayPublisher.show();

      if (!_renderer) {
        _loadPromise ??= loadAndBuild(viewer);
        try {
          await _loadPromise;
        } finally {
          _loadPromise = null;
          _loadController = null;
        }
      }

      if (_destroyed) return;
      if (_enabled && _count > 0 && osmDerived) showOsmCredit?.(viewer, id);
      if (_enabled) installListeners(viewer);
      // Honor a disable() that landed while the shared load was settling.
      if (!_enabled) {
        releaseRenderer();
        return;
      }
      if (_handle) _handle.show = true;
      viewer.scene.requestRender?.();
    },

    disable: disableLayer,

    destroy: (viewer) => {
      if (_destroyed) return;
      _destroyed = true;
      _loadController?.abort();
      // Defensively disable first so listeners and selection state are
      // torn down even if destroy is called while the layer is enabled.
      disableLayer(viewer);
      removeEntityContextsForLayer(id);
      _clickHandler?.destroy();
      _clickHandler = null;
      _tracker?.release();
      _tracker = null;
      _overlayPublisher.destroy();
      _cachedRecords = null;
      _stemRecords = [];
      _count = 0;
      _lastUpdate = null;
      _error = null;
    },
  };
}

export { mapAnalystRecord };
