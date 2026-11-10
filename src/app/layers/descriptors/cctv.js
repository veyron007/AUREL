import { t } from '../../../i18n/index.js';

// CCTV's descriptor and facade: what the shell reads from it while it is off
// (src/app/deferredLayer.js). The CCTV panel subscribes at start-up and draws
// its toggles from the UI state, which follows the parameters restored from a
// share link or storage. Camera commands answer as an empty catalog does; the
// panel enables the layer before it sends one. Checked against the real
// layer by src/app/layers/deferredDescriptors.test.mjs.

// Mirrors MIN_AUTO_HOP_SEC / MAX_AUTO_HOP_SEC (src/layers/cctv/policy.js) and
// CCTV_AMBIENT_CARD_MAX (src/data/cctvLod.js); the descriptor test compares.
export const CCTV_IDLE_LIMITS = Object.freeze({
  minAutoHopSec: 8,
  maxAutoHopSec: 90,
  ambientCardMax: 40,
});

const COVERAGE_MODES = Object.freeze(['off', 'on', 'viewshed']);

function coverageMode(value, current) {
  if (value === true) return 'on';
  if (value === false) return 'off';
  return COVERAGE_MODES.includes(value) ? value : current;
}

/** The toggles the real setParams() would hold after `pending`. */
function idleToggles(pending) {
  let mode = 'on';
  if (typeof pending.showCoverage === 'boolean')
    mode = coverageMode(pending.showCoverage, mode);
  if (typeof pending.coverageMode === 'string')
    mode = coverageMode(pending.coverageMode, mode);
  const { minAutoHopSec, maxAutoHopSec } = CCTV_IDLE_LIMITS;
  const hop = Number.isFinite(pending.autoHopSec)
    ? Math.min(
        maxAutoHopSec,
        Math.max(minAutoHopSec, Math.round(pending.autoHopSec)),
      )
    : 18;
  const flag = (value, fallback) =>
    typeof value === 'boolean' ? value : fallback;
  return {
    showCoverage: mode !== 'off',
    coverageMode: mode,
    showProjection: flag(pending.showProjection, true),
    calibrationMode: flag(pending.calibrationMode, false),
    autoHop: flag(pending.autoHop, false),
    autoHopSec: hop,
  };
}

function idleParams(pending) {
  const { autoHopSec, ...toggles } = idleToggles(pending);
  return { ...toggles, autoHopSec, selectedCameraId: null, calibration: null };
}

function idleUiState(pending) {
  const { autoHopSec, ...toggles } = idleToggles(pending);
  return {
    enabled: false,
    ...toggles,
    autoHopSuspended: false,
    autoHopSec,
    count: 0,
    lastUpdate: null,
    error: null,
    loading: { active: false, loaded: 0, total: 0 },
    ambientCards: {
      count: 0,
      limit: CCTV_IDLE_LIMITS.ambientCardMax,
      frameFetches: 0,
      minFrameFetchSpacingMs: null,
      fetchMode: 'steady',
      fetchesInFlight: 0,
      hoverId: null,
    },
    activeCameraId: null,
    activeCamera: null,
    cameraIndex: [],
    summary: t('No cameras available in catalog.'),
    cameras: [],
  };
}

/** @type {import('../../deferredLayer.js').LayerDescriptor} */
export const CCTV_DESCRIPTOR = Object.freeze({
  id: 'cctv',
  values: Object.freeze({
    name: 'CCTV',
    icon: '📹',
    source: 'CCTV + Street View fallback',
    updateInterval: 10000,
  }),
  methods: Object.freeze([
    'activationProbeClampRange',
    'applyCctvFocusDeemphasis',
    'bindCctvWorldClickGesture',
    'calibrationPatchMovesAnchor',
    'cctvCycleIndex',
    'cctvEmptyClickDeselects',
    'cctvGeometryDrainPacing',
    'cctvRecordNeedsActivation',
    'clearProbeClampOnDeactivation',
    'computeFrustumGeometry',
    'createCctvProjectionOverlayEntry',
    'createGeometryProgressNotifier',
    'cycleCamera',
    'deactivateActiveCamera',
    'deriveCalBadge',
    'destroy',
    'disable',
    'enable',
    'focusCamera',
    'focusCctvRecord',
    'focusNearest',
    'frameSignatureFromPixels',
    'getActiveVideoElement',
    'getDetectableObjects',
    'getParams',
    'getStats',
    'getUIState',
    'hideCctvRecordVisuals',
    'init',
    'materializeCctvActiveCoverageEntities',
    'materializeCctvCoverageEntities',
    'materializeCctvVisibleCoverageEntities',
    'maybeAutoHop',
    'migrateRangeScaleForFloor',
    'normalizeCoverageMode',
    'prioritizeActiveCctvGeometryRecord',
    'processCctvGeometryDrainBatch',
    'processCctvGeometryQueueBatch',
    'processGeometryBatch',
    'readCalibrationStoreV2',
    'refreshCoverageStyles',
    'refreshHorizonCulling',
    'selectCamera',
    'setActiveCamera',
    'setCardPresentationOptions',
    'setCctvCardPresentationOptions',
    'setParams',
    'subscribe',
    'surfaceRegimeKey',
    'update',
    'writeCalibrationStoreV2',
  ]),
  params: Object.freeze(idleParams({})),
  stats: Object.freeze({
    count: 0,
    lastUpdate: null,
    error: null,
    loading: false,
    loadingLoaded: 0,
    loadingTotal: 0,
  }),
  answers: Object.freeze({
    getParams: idleParams,
    getUIState: idleUiState,
    getDetectableObjects: Object.freeze([]),
    getActiveVideoElement: null,
    // An empty catalog: nothing to select, cycle to or fly to.
    focusNearest: null,
    cycleCamera: null,
    selectCamera: false,
    focusCamera: 'no-active-camera',
  }),
  emits: Object.freeze({ subscribe: 'getUIState' }),
});
