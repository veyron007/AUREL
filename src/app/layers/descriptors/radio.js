import { normalizeRadioFilter } from '../../../data/layerState.js';

// Radio's descriptor and facade: what the shell and voice read from it while
// it is off (src/app/deferredLayer.js). The radio panel subscribes at
// start-up; every station, tuning and volume command refuses while the layer
// is off, as the real layer does. Voice ducking and voice playback load the
// layer and forward, in order. Checked against the real layer by
// src/app/layers/deferredDescriptors.test.mjs.

const DEFAULT_VOLUME = 0.8;

const clampVolume = (value) => Math.min(1, Math.max(0, Number(value) || 0));

/** The parameters the real setParams() would hold after `pending`. */
function idleParams(pending) {
  return {
    filter: Object.hasOwn(pending, 'filter')
      ? normalizeRadioFilter(pending.filter)
      : 'all',
    volume: Object.hasOwn(pending, 'volume')
      ? clampVolume(pending.volume)
      : DEFAULT_VOLUME,
  };
}

/** Whether the real setParams() accepts `params` (it refuses, not clamps). */
function acceptParams(params) {
  if (Object.hasOwn(params, 'filter') && !normalizeRadioFilter(params.filter))
    return false;
  return !(
    Object.hasOwn(params, 'volume') && !Number.isFinite(Number(params.volume))
  );
}

function idleUiState(pending) {
  const { filter, volume } = idleParams(pending);
  return Object.freeze({
    enabled: false,
    loading: false,
    stale: false,
    degraded: false,
    rejectedStationCount: 0,
    error: null,
    updatedAt: null,
    filter,
    categories: [],
    acceptedCatalogGeneration: null,
    presentationActive: false,
    stationCount: 0,
    filteredCount: 0,
    selected: null,
    selectedIndex: -1,
    audioState: 'stopped',
    audioError: null,
    playingStationId: null,
    volume,
    effectiveVolume: volume,
    voiceDucked: false,
    voiceRestoring: false,
    tuningActive: false,
    tuningStatic: false,
    tuningAwaitingStationId: null,
    tuningPreviewStationId: null,
    tuningRestoredStationId: null,
    tuningCatalogGeneration: null,
    tuningUnavailableStationId: null,
  });
}

const refused = false;
const refusedLater = () => Promise.resolve(false);
const notTuning = (pending, [stationId] = []) => ({
  ok: false,
  reason: 'not-tuning',
  stationId,
  generation: null,
});
// Stopping nothing succeeds, unless it names an attempt that is not playing.
const stopNothing = (pending, [options] = []) => !options?.attemptId;
const emptyCatalog = Object.freeze({
  instance: null,
  generation: null,
  updatedAt: null,
  stations: Object.freeze([]),
  stationIds: Object.freeze([]),
});

/** @type {import('../../deferredLayer.js').LayerDescriptor} */
export const RADIO_DESCRIPTOR = Object.freeze({
  id: 'radio',
  values: Object.freeze({
    name: 'Radio',
    icon: '◉',
    source: 'Radio Browser',
    updateInterval: 2700000,
  }),
  methods: Object.freeze([
    'beginRadioTuning',
    'beginTuning',
    'buildRadioCategories',
    'buildRadioTunerBand',
    'cancelRadioTuning',
    'cancelTuning',
    'commitRadioTuningStation',
    'commitTuningStation',
    'confirmRadioPlayback',
    'createRadioClusterOverlayEntry',
    'createRadioSelectedOverlayEntry',
    'createRadioSingletonOverlayEntry',
    'cycleRadioStation',
    'cycleStation',
    'destroy',
    'disable',
    'enable',
    'endRadioTuning',
    'endTuning',
    'filterRadioStations',
    'getAcceptedCatalogSnapshot',
    'getOverlayDiagnostics',
    'getParams',
    'getRadioAcceptedCatalogSnapshot',
    'getRadioParams',
    'getRadioTunerStations',
    'getRadioUIState',
    'getStats',
    'getTunerStations',
    'getUIState',
    'init',
    'isEnglishRadioStation',
    'normalizeRadioTag',
    'pause',
    'pauseRadioPlayback',
    'play',
    'playForVoice',
    'playPreparedRadioForVoice',
    'playSelectedRadio',
    'previewRadioTuningStation',
    'previewTuningStation',
    'radioCameraNavigationAllowed',
    'radioCameraPositionChanged',
    'radioCategoryColor',
    'radioClusterBadgeText',
    'radioClusterCategoryId',
    'radioGlobeLabel',
    'radioGlobeNeedsRecentering',
    'radioGlobeRecenterHeight',
    'radioRequestIsCurrent',
    'radioSelectionBracketSvg',
    'radioSingletonLabelLimit',
    'radioStationCameraPlan',
    'radioStationCategoryId',
    'radioStationIdFromPick',
    'radioStationResolutionMatches',
    'radioTuningStaticShouldPlay',
    'radioViewIsGlobal',
    'rankRadioStationsForRequest',
    'rankRadioStationsForViewport',
    'reconcileRadioClusterCandidates',
    'retainRadioClusterIdentitiesForStations',
    'selectRadioClusterCandidates',
    'selectRadioSingletonCandidates',
    'selectRadioStation',
    'selectRequestedRadioStation',
    'selectRequestedStation',
    'selectStation',
    'setFilter',
    'setLifecyclePresentation',
    'setParams',
    'setRadioFilter',
    'setRadioParams',
    'setRadioTuningStatic',
    'setRadioVoiceDucking',
    'setRadioVolume',
    'setTuningStatic',
    'setVoiceDucked',
    'setVolume',
    'stationMatchesRadioCategory',
    'stopPlayback',
    'stopRadioPlayback',
    'subscribe',
    'subscribePlaybackControls',
    'subscribeToRadio',
    'subscribeToRadioPlaybackControls',
    'togglePlayback',
    'toggleRadioPlayback',
    'update',
  ]),
  params: Object.freeze(idleParams({})),
  stats: Object.freeze({
    count: 0,
    filtered: 0,
    selected: null,
    playing: null,
    stale: false,
    degraded: false,
    loading: false,
    error: null,
    lastUpdate: null,
    horizonScans: 0,
    overlayEntries: 0,
  }),
  acceptParams,
  answers: Object.freeze({
    getParams: idleParams,
    getRadioParams: idleParams,
    getUIState: idleUiState,
    getRadioUIState: idleUiState,
    getAcceptedCatalogSnapshot: emptyCatalog,
    getRadioAcceptedCatalogSnapshot: emptyCatalog,
    getTunerStations: Object.freeze([]),
    getRadioTunerStations: Object.freeze([]),
    beginTuning: refused,
    beginRadioTuning: refused,
    cancelTuning: refused,
    cancelRadioTuning: refused,
    previewTuningStation: refused,
    previewRadioTuningStation: refused,
    commitTuningStation: notTuning,
    commitRadioTuningStation: notTuning,
    cycleStation: refused,
    cycleRadioStation: refused,
    selectStation: refused,
    selectRadioStation: refused,
    selectRequestedStation: null,
    selectRequestedRadioStation: null,
    setFilter: refused,
    setRadioFilter: refused,
    setVolume: refused,
    setRadioVolume: refused,
    pause: refused,
    pauseRadioPlayback: refused,
    play: refusedLater,
    playSelectedRadio: refusedLater,
    togglePlayback: refusedLater,
    toggleRadioPlayback: refusedLater,
    stopPlayback: stopNothing,
    stopRadioPlayback: stopNothing,
  }),
  emits: Object.freeze({
    subscribe: 'getUIState',
    subscribeToRadio: 'getUIState',
  }),
  remember: Object.freeze(['setLifecyclePresentation']),
  commands: Object.freeze([
    'setVoiceDucked',
    'setRadioVoiceDucking',
    'playForVoice',
    'playPreparedRadioForVoice',
  ]),
  // Lifting a duck that never happened changes nothing: no need to load.
  skipWhenIdle: Object.freeze({
    setVoiceDucked: ([ducked] = []) => !ducked,
    setRadioVoiceDucking: ([ducked] = []) => !ducked,
  }),
});
