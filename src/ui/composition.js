/** Compose UI controls with the application's existing engines and layer instances. */
import { StyleManager as ApplicationShell } from './applicationShell.js';
import { LocationSearch } from './location.js';
import { CITY_POIS } from '../cityPois.js';
import { createSuggestionEngine } from '../search/suggest.js';
import { listPresetPlaces } from '../search/presetGeocoder.js';
import { createRecentPlaces } from '../search/recentPlaces.js';
import { viewportBias } from '../annotations/annotationResolver.js';
import {
  GLOBE_VIEW,
  flyToGlobeView,
  flyToPresetLocation,
  flyToPOI,
  searchAndFlyTo,
} from '../locations.js';
import {
  interruptCameraMotion,
  interruptGlobeRotation,
} from '../cameraVerbs.js';
import { IntelHUD } from '../hud.js';
import { ShareLinkManager } from '../sharelink.js';
import { OrbitController } from '../orbit.js';
import {
  CelestialRing,
  getKeyholeFadeTuning,
  isCelestialRingStyleSupported,
  setKeyholeFadeTuning,
} from '../celestialRing.js';
import {
  destroyTrackedReadout,
  initTrackedReadout,
} from '../data/trackedReadout.js';
import {
  activateWorldOverlayAction,
  destroyWorldOverlay,
  initWorldOverlay,
  subscribeWorldOverlayActions,
} from '../overlays/worldOverlay.js';
import {
  destroyDetection,
  initDetection,
  cycleMode as cycleDetectionMode,
  getDetectionDiagnostics as readDetectionDiagnostics,
  getDetectionTuning,
  getMode as getDetectionMode,
  setMode as setDetectionModeByLabel,
  suspendDetection,
  resumeDetection,
  setDetectionStyle,
  setDetectionTuning,
} from '../data/detection.js';
import { isTr3b, toggleTr3b } from '../data/tr3bRegistry.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
} from '../renderGovernor.js';
import {
  setScopeMaskEnabled,
  isScopeMaskEnabled,
  setScopeMaskFeather,
  getScopeMaskFeather,
  setScopeTerminusOverride,
  getScopeTerminusOverride,
  clampScopeTerminusPct,
} from '../scopeMask.js';
import {
  fetchRegionalBrief,
  regionalDistanceM,
  weatherCodeLabel,
} from '../data/regionalBrief.js';

export class StyleManager extends ApplicationShell {
  constructor(viewer, options = {}) {
    super(viewer, {
      ...options,
      services: {
        CITY_POIS,
        GLOBE_VIEW,
        flyToGlobeView,
        flyToPresetLocation,
        flyToPOI,
        searchAndFlyTo,
        locationSuggestions,
        interruptCameraMotion,
        interruptGlobeRotation,
        IntelHUD,
        ShareLinkManager,
        OrbitController,
        CelestialRing,
        getKeyholeFadeTuning,
        isCelestialRingStyleSupported,
        setKeyholeFadeTuning,
        destroyTrackedReadout,
        initTrackedReadout,
        destroyWorldOverlay,
        initWorldOverlay,
        subscribeWorldOverlayActions,
        activateWorldOverlayAction,
        destroyDetection,
        initDetection,
        cycleDetectionMode,
        readDetectionDiagnostics,
        getDetectionTuning,
        getDetectionMode,
        setDetectionModeByLabel,
        suspendDetection,
        resumeDetection,
        setDetectionStyle,
        setDetectionTuning,
        isTr3b,
        toggleTr3b,
        holdContinuousRender,
        releaseContinuousRender,
        governorRequestRender,
        setScopeMaskEnabled,
        isScopeMaskEnabled,
        setScopeMaskFeather,
        getScopeMaskFeather,
        setScopeTerminusOverride,
        getScopeTerminusOverride,
        clampScopeTerminusPct,
        fetchRegionalBrief,
        regionalDistanceM,
        weatherCodeLabel,
        LocationSearch,
        ...options.services,
      },
    });
  }
}

const recentPlaces = createRecentPlaces();

/**
 * Location type-ahead for the shell: the suggestion engine over the bundled
 * places, this browser's recent choices and the place search's keyless
 * suggester, plus the current view bias. Kept here so the shell itself does
 * not import search modules.
 */
const locationSuggestions = Object.freeze({
  createEngine({ placeSearch, onUpdate }) {
    return createSuggestionEngine({
      remote: placeSearch?.suggest ?? null,
      places: listPresetPlaces(CITY_POIS),
      readRecent: () => recentPlaces.read(),
      onUpdate,
    });
  },
  remember: (place) => recentPlaces.remember(place),
  bias(viewer) {
    try {
      return viewportBias(viewer);
    } catch {
      return null;
    }
  },
});
