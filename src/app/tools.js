import { installCameraMotionFlag } from '../ui/cameraMotionFlag.js';
import { installQualityGovernor } from './qualityGovernor.js';
import { useQualityStore } from '../ui/stores/quality.js';
import { captureInFlight } from '../voice/cesiumFrameCapture.js';
import { createSessionControls } from './sessionControls.js';
import { createLocalCommandTools } from './localCommandTools.js';
import { createPaletteTools } from './paletteTools.js';
import { useLocationStore } from '../ui/stores/location.js';
import { createApplicationDirector } from './sceneDirectorTools.js';
import { createPersonalTools } from './personalTools.js';
import { createPlannerTools } from './plannerTools.js';
import { createHorizonTools } from './horizonTools.js';
import { createChronicleTools } from './chronicleTools.js';
import { createResearchTools } from './researchTools.js';
import { createWatchlistTools } from './watchlistTools.js';
import { createAgentDeskTools } from './agentDeskTools.js';
import { createBreathTools } from './breathTools.js';
import {
  createOrbitWitnessTools,
  createSceneWatchlistSource,
  createChronicleSceneOpener,
} from './orbitWitnessTools.js';
import { createRegionTools } from './regionTools.js';
import { createRaindropTools } from './raindropTools.js';
import { useWorkspaceStore } from '../ui/stores/workspace.js';
import { initAnnotations } from '../annotations/index.js';
import { initDrawTool } from '../annotations/drawTool.js';
import { initGeoFileImport } from '../ui/geoFileImport.js';
import { useDisplayStore } from '../ui/stores/display.js';
import { applicationPinia } from '../ui/vueRuntime.js';
import { initImageryBoxTool } from '../ui/imageryBoxTool.js';
import { createRecentImageryPanel } from '../ui/recentImagery.js';
import {
  initGevVoiceCommands,
  preloadVoiceSessions,
} from '../voice/gevRealtime.js';
import { whenStartupSettled } from '../ui/rail/deferredBody.js';
import { installViews, isEmbeddedInline } from './embed.js';
import {
  installScopeMask,
  destroyScopeMask,
  isScopeMaskEnabled,
} from '../scopeMask.js';
import { KEYHOLE_OUTER_RADIUS } from '../celestialRing.js';
import { installGlobeInViewRecovery } from './viewer.js';
import { installLayerReleaseTrim } from '../sceneCommandRelease.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import { waitForViewTiles } from './startupView.js';

/** Attach scene tools, rendering listeners and the application debug handle. */
export function createApplicationTools({
  scene,
  controls,
  data,
  loadingScreen,
  placeSearch,
  voice = {},
  startChrome,
  onSceneDirector,
  sceneDataPacks,
  signal,
  defer,
}) {
  const { viewer, tileset, mapStackController, operations } = scene;
  const { styleManager, weatherEffects, cockpitCloudEffects } = controls;
  const { dataManager } = data;
  // Built on first use: the Authoring panel, a scene command, or once
  // start-up settles (src/scenes/lazyDirector.js).
  const directorOwner = createApplicationDirector({
    viewer,
    styleManager,
    dataManager,
    dataPacks: sceneDataPacks,
    mapStackController,
    pinia: applicationPinia(),
  });
  const sceneDirector = directorOwner.director;
  defer(() => directorOwner.stop());
  dataManager.layers
    .get('bhote-koshi-2026')
    ?.module.attachSceneController(sceneDirector);
  defer(() => sceneDirector.destroy());
  defer(
    installGlobeInViewRecovery(viewer, {
      // The scope mask hides everything outside its keyhole.
      keyholeRadius: () => (isScopeMaskEnabled() ? KEYHOLE_OUTER_RADIUS : 0),
      // An authored scene frames its own shots, holds included.
      paused: () => sceneDirector.running,
    }),
  );
  onSceneDirector?.(sceneDirector);
  const annotations = initAnnotations({
    viewer,
    tileset,
    placeSearch,
    resolver: operations.annotationResolver,
  });
  defer(() => {
    if (window.__gevAnnotations === annotations) delete window.__gevAnnotations;
    annotations.destroy();
  });
  const displayStore = useDisplayStore(applicationPinia());
  // The Display panel's controls answer through the store; returns the
  // disconnect.
  const connectDisplay = (actions) => {
    const token = displayStore.connect(actions);
    return () => displayStore.detach(token);
  };
  // UTILITIES ▸ Draw: the same whiteboard, drawn by hand. It claims the pointer
  // while a session is open, so its teardown belongs to the application
  // lifetime rather than to whoever last pressed the button. A row's fly-to
  // goes through the shell's navigation policy, as Import's does.
  const drawTool = initDrawTool({
    viewer,
    annotations,
    navigation: styleManager,
    publish: (view) => displayStore.publishDraw(view),
    connect: connectDisplay,
  });
  defer(() => drawTool?.destroy());
  // UTILITIES ▸ Import: the person's own GeoJSON/KML/KMZ/GPX files, each its
  // own data source. They live for the page session, so the application
  // lifetime removes them and the drop listeners on the viewer container.
  const geoFileImport = initGeoFileImport({
    viewer,
    navigation: styleManager,
    ground: operations.surface?.groundFloor,
    subscribeMapSource: (listener) => mapStackController?.subscribe?.(listener),
    publish: (view) => displayStore.publishGeoImport(view),
    connect: connectDisplay,
  });
  defer(() => geoFileImport?.destroy());
  let planner, chronicle;
  const personalWorkspace = createPersonalTools({
    viewer,
    styleManager,
    dataManager,
    mapStackController,
    operations,
    annotations,
    sceneDirector,
    pinia: applicationPinia(),
    onPlanPlace: () => planner?.controller.setScope('place'),
    onOpenComparison: (saved) => {
      personalWorkspace.lens.select(saved.subject, {
        reveal: false,
        origin: 'fieldbook',
      });
      chronicle?.controller.reopen(saved);
      useWorkspaceStore(applicationPinia()).chooseDestination('compare');
    },
  });
  defer(() => personalWorkspace.destroy());
  planner = createPlannerTools({
    pinia: applicationPinia(),
    viewer,
    dataManager,
    operations,
    fieldbook: personalWorkspace.fieldbook,
  });
  defer(() => planner.destroy());
  const horizon = createHorizonTools({
    pinia: applicationPinia(),
    viewer,
    fieldbook: personalWorkspace.fieldbook,
  });
  defer(() => horizon.destroy());
  const raindrop = createRaindropTools({
    pinia: applicationPinia(),
    viewer,
    styleManager,
  });
  defer(() => raindrop.destroy());
  // DATA ▸ Recent Imagery: the box tool claims the pointer like Draw and the
  // panel lives on the right rail, so both belong to the application
  // lifetime. The tileset lets the layer drape while the globe is hidden.
  const recentImagery = dataManager.layers.get('recent-imagery')?.module;
  if (recentImagery) {
    recentImagery.attachTileset(tileset);
    const imageryBoxTool = initImageryBoxTool({
      viewer,
      onBox: (box) => recentImagery.setBox(box),
      onCancel: (reason, message, box) => {
        if (message) recentImagery.reportBoxRefusal(message, box);
      },
      onActive: (active) => recentImagery.setToolActive(active),
      // The tool takes Escape in a capture listener, so the panel's order
      // (clear a preview before cancelling the tool) is applied here.
      onEscape: () => recentImagery.clearPreview(),
    });
    // The readout mounts in its rail body through the layer panel, like the
    // weather readout.
    data.presentation.attachRecentImagery((container) =>
      createRecentImageryPanel({
        container,
        viewer,
        layer: recentImagery,
        tool: imageryBoxTool,
      }),
    );
    // The live gate's handle (scripts/qa-recent-imagery.mjs).
    const recentImageryHandle = { layer: recentImagery, tool: imageryBoxTool };
    window.__gevRecentImagery = recentImageryHandle;
    defer(() => {
      if (window.__gevRecentImagery === recentImageryHandle)
        delete window.__gevRecentImagery;
      data.presentation.attachRecentImagery(null);
      imageryBoxTool?.destroy();
    });
  }
  chronicle = createChronicleTools({
    pinia: applicationPinia(),
    dataManager,
    fieldbook: personalWorkspace.fieldbook,
  });
  defer(() => chronicle.destroy());
  const research = createResearchTools({ pinia: applicationPinia() });
  defer(() => research.destroy());
  const watchlists = createWatchlistTools({
    pinia: applicationPinia(),
    sceneSource: createSceneWatchlistSource(),
    onOpenScene: createChronicleSceneOpener({
      lens: personalWorkspace.lens,
      chronicle: chronicle.controller,
      workspace: useWorkspaceStore(applicationPinia()),
    }),
  });
  defer(() => watchlists.destroy());
  // Field Kit: answers a local MCP server's requests; writes need the owner's
  // per-session "Allow agent writes" toggle (src/fieldkit).
  const agentDesk = createAgentDeskTools({
    pinia: applicationPinia(),
    viewer,
    dataManager,
    fieldbook: personalWorkspace.fieldbook,
    watchlists: watchlists.controller,
  });
  if (agentDesk) defer(() => agentDesk.destroy());
  const breath = createBreathTools({
    pinia: applicationPinia(),
    watchlists: watchlists.controller,
  });
  defer(() => breath.destroy());
  const orbitWitness = createOrbitWitnessTools({
    pinia: applicationPinia(),
    viewer,
    sceneDirector,
    watchlists: watchlists.controller,
  });
  defer(() => orbitWitness.destroy());
  const regions = createRegionTools({
    pinia: applicationPinia(),
    geoFileImport,
    viewer,
    styleManager,
    onSelectPlace: (selection) =>
      personalWorkspace.lens.select(selection, {
        reveal: false,
        origin: 'local-region',
      }),
  });
  defer(() => regions.destroy());
  const sessionControls = createSessionControls({
    dataManager,
    watchlists: watchlists.controller,
    cancelWork: [
      () => planner.controller.cancel(),
      () => horizon.controller.cancel(),
      () => chronicle.controller.cancel(),
      () => research.controller.cancel(),
      () => raindrop.controller.pause(),
    ],
  });
  const workspaceStore = useWorkspaceStore(applicationPinia());
  const sessionToken = workspaceStore.connect({
    pauseFeeds: () => sessionControls.pauseLiveData(),
  });
  defer(() => workspaceStore.detach(sessionToken));
  if (startChrome)
    defer(
      startChrome({
        loadingScreen,
        styleManager,
        dataManager,
        signal,
        // The start-up view lands under the cover; let its tiles arrive.
        waitForView: () => waitForViewTiles({ scene: viewer.scene, signal }),
      }),
    );
  // Idle render governor: flips the scene into requestRenderMode whenever
  // nothing animates per frame. Installed AFTER every module above has had
  // its chance to register pre-install holds. (perf wave 2)
  installRenderGovernor(viewer);
  // Spatial glass turns solid while the camera moves (spatial-budget.css).
  defer(
    installCameraMotionFlag({
      camera: viewer.camera,
      root: document.documentElement,
    }),
  );
  defer(installAdaptiveQuality(viewer));
  // Cesium keeps a turned-off layer's draw commands (and so all its entities)
  // alive in reused per-pass arrays; trim them after each disable.
  defer(
    installLayerReleaseTrim({
      scene: viewer.scene,
      dataManager,
      requestRender: governorRequestRender,
    }),
  );

  // Install the explicit scope mask used by the DISPLAY controls.
  installScopeMask(viewer);
  defer(() => destroyScopeMask());

  // The follow camera recomputes the tracked target's dead-reckon position
  // every frame — tracking anything is a per-frame animation. (perf wave 2)
  const removeTrackingListener = viewer.trackedEntityChanged.addEventListener(
    () => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    },
  );

  // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
  // stop the default render loop outright — a hidden canvas repaints for
  // nobody, and browser rAF throttling still lets throttled frames burn
  // GPU. Holder/data state is untouched, so return is seamless: restore
  // the loop, refresh the one DOM surface we gated, render a frame.
  const syncVisibilitySuspension = () => {
    // A panel's host may report it hidden while it is on screen; the panel
    // keeps drawing itself (see keepPanelRendering in embed.js).
    const hidden = document.hidden && !isEmbeddedInline();
    viewer.useDefaultRenderLoop = !hidden;
    cockpitCloudEffects?.setSuspended?.(hidden);
    if (!hidden) {
      data.presentation.flushVisible();
      governorRequestRender('visibility-restore');
    }
  };
  document.addEventListener('visibilitychange', syncVisibilitySuspension);
  defer(() =>
    document.removeEventListener('visibilitychange', syncVisibilitySuspension),
  );
  defer(() => {
    removeTrackingListener();
    releaseContinuousRender('tracked-entity');
  });
  // Apply the CURRENT state too — bootstrap can complete while the tab is
  // already hidden, and waiting for the next transition would leave the
  // loop burning behind a hidden tab. (perf wave 2 fix)
  syncVisibilitySuspension();

  window.__godsEyeView = {
    viewer,
    styleManager,
    tileset,
    dataManager,
    sceneDirector,
    mapStackController,
    annotations,
    weatherEffects,
    cockpitCloudEffects,
    getRenderGovernorDiagnostics,
    surfaceServices: operations.surface,
    requestRender: governorRequestRender,
  };
  const debug = window.__godsEyeView;
  defer(() => {
    if (window.__godsEyeView === debug) delete window.__godsEyeView;
  });
  const voiceCommands = initGevVoiceCommands({
    ...voice,
    floorServices: operations.surface.groundFloor,
    annotationResolver: operations.annotationResolver,
    searchNavigation: operations.searchAndFlyTo,
    signal,
    placeSearch,
    viewer,
    styleManager,
    dataManager,
    sceneDirector,
    annotations,
  });
  defer(() => {
    voiceCommands.stop({ removeUi: true });
    if (window.__gevVoiceCommands === voiceCommands)
      delete window.__gevVoiceCommands;
  });
  debug.voiceCommands = voiceCommands;
  // The provider's session code loads on the first mic or chat use, or here
  // once start-up has settled, so push-to-talk is ready soon after.
  void whenStartupSettled().then(() => {
    if (signal?.aborted) return;
    preloadVoiceSessions(voiceCommands.provider).catch((error) =>
      console.warn('[Voice] Session code could not be preloaded:', error),
    );
  });
  const localCommands = createLocalCommandTools({
    pinia: applicationPinia(),
    personalWorkspace,
    chronicle,
    dataManager,
    runCoordinate: async (args, { signal: commandSignal }) => {
      const result = await voiceCommands.runner('fly_to_location', args, {
        signal: commandSignal,
      });
      return result?.ok === true;
    },
    stageSearch: async (query, { signal: commandSignal }) => {
      commandSignal.throwIfAborted();
      await useWorkspaceStore(applicationPinia()).act(
        'openPanel',
        'location-bar',
      );
      commandSignal.throwIfAborted();
      return (
        useLocationStore(applicationPinia()).controls?.stageSearch(query) ===
        true
      );
    },
  });
  defer(() => localCommands.destroy());
  const paletteTools = createPaletteTools({
    pinia: applicationPinia(),
    dataManager,
  });
  defer(() => paletteTools.destroy());
  defer(
    installViews({
      shell: styleManager,
      viewer,
      dataManager,
      run: (name, args) => voiceCommands.runner(name, args, { signal }),
      signal,
    }),
  );
  return { sceneDirector, annotations, voiceCommands };
}

/** Adaptive display quality (Settings → Display quality), until teardown. */
function installAdaptiveQuality(viewer) {
  const quality = useQualityStore(applicationPinia());
  quality.restoreMode();
  const governor = installQualityGovernor({
    viewer,
    root: document.documentElement,
    readMode: () => quality.mode,
    publishLevel: (level) => quality.publishLevel(level),
    isRecording: () => document.body.classList.contains('recording-mode'),
    isCapturing: captureInFlight,
  });
  const stop = quality.$subscribe(() => governor.sync());
  return () => {
    stop();
    governor.destroy();
  };
}
