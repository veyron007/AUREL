import * as Cesium from 'cesium';
import { FIRMS_OVERLAY_SOURCE_ID } from '../../data/firmsLabels.js';
import { horizonOccluder } from '../../data/iconOrientation.js';
import {
  LOD_LEVELS,
  CONTEXT_TOP_N,
  HANDOFF_FADE,
  HEAT_RASTER,
  HEAT_REBUILD_MS,
} from './policy.js';
import { createHeatImagery } from './heatImagery.js';
import { createHeatRasterClient } from './heatRasterClient.js';
import { buildFireGridIndex, queryFireGridIndex } from './markerIndex.js';

/** The markers drawn under the far bands' heatmap for the hand-off fade. */
const HANDOFF_MARKER_LOD = LOD_LEVELS.find((lod) => lod.mode === 'detections');

/** Fade steps: a moving camera rewrites marker colors at most this often. */
const FADE_STEPS = 32;

export function createRendering({
  layerState,
  services,
  components,
  config,
  feed,
}) {
  const { warmFireAnchorFloors } = services.anchors;
  const { registerSpriteCollection, restoreSpriteOrder } = services.sprites;
  const { overlayHost } = config;

  /**
   * Rebuild the render for the current LOD band and viewport. Skips work
   * when neither the (hysteresis-damped) LOD band nor the padded view
   * rectangle changed meaningfully.
   * @param {boolean} force - Rebuild even if LOD/view appear unchanged.
   * @returns {boolean} True when a rebuild actually ran. Callers use this to
   *   avoid a second horizon walk in the same tick: a rebuild already culls
   *   its freshly-added sprites, an early-out does not.
   */

  function renderCurrentLod(force = false) {
    if (
      !layerState._dataSource ||
      !layerState._fires.length ||
      !layerState._viewer
    ) {
      // A filter that leaves nothing shown must not leave the old heat behind.
      if (!layerState._fires.length) layerState._heatImagery?.setShow(false);
      return false;
    }
    const lodIndex = components.viewport.selectLodIndex(
      components.viewport.cameraHeight(),
    );
    const lod = LOD_LEVELS[lodIndex];
    const viewRect = components.viewport.computeViewRect();
    if (
      !force &&
      lodIndex === layerState._currentLodIndex &&
      !components.viewport.viewChangedEnough(viewRect)
    )
      return false;
    layerState._currentLodIndex = lodIndex;
    layerState._currentLodId = lod.id;
    layerState._lastViewRect = viewRect
      ? Cesium.Rectangle.clone(viewRect)
      : null;
    const bounds = viewRect
      ? components.model.paddedDegreeBounds(viewRect)
      : null;

    renderBand(lod, bounds);
    return true;
  }

  /**
   * Draw one band. Markers and heatmap stay built in every band; the
   * hand-off only fades between them.
   * @param {Object} lod - Band descriptor.
   * @param {?Object} bounds - Padded view bounds in degrees, or null.
   */

  function renderBand(lod, bounds) {
    prepareHeat(lod.mode === 'heat');
    if (lod.mode === 'detections') renderDetections(lod, bounds);
    else renderHeat(lod, bounds);
    applyHandoffFade(true);
  }

  const fadeColor = new Cesium.Color();

  /**
   * Cross-fade between markers and heatmap by camera height (HANDOFF_FADE),
   * on every rendered frame, so a fast zoom never outruns the throttled band
   * check. Cheap when nothing changed: one height read and a compare.
   * @param {boolean} [force] Reapply, e.g. to freshly added markers.
   */

  function applyHandoffFade(force = false) {
    const height = components.viewport.cameraHeight();
    const t = Math.min(
      1,
      Math.max(
        0,
        (height - HANDOFF_FADE.from) / (HANDOFF_FADE.to - HANDOFF_FADE.from),
      ),
    );
    const heat = Math.round(t * t * (3 - 2 * t) * FADE_STEPS) / FADE_STEPS;
    if (!force && heat === layerState._handoffHeat) return;
    layerState._handoffHeat = heat;
    layerState._heatImagery?.setOpacity(heat);
    const billboards = layerState._billboards;
    if (!billboards) return;
    billboards.show = layerState._enabled && heat < 1;
    Cesium.Color.WHITE.withAlpha(1 - heat, fadeColor);
    // Only sprites on the near side are drawn; a far-side sprite takes the
    // fade when the horizon cull shows it again (refreshHorizonCulling).
    // Every write dirties the sprite's vertices, so equal colours are skipped.
    const markers = layerState._markerBillboards;
    for (let i = 0; i < markers.length; i += 1) {
      const billboard = markers[i];
      if (billboard.show && !Cesium.Color.equals(billboard.color, fadeColor))
        billboard.color = fadeColor;
    }
  }

  /**
   * Bin all detections into grid cells, then viewport-clip BEFORE the
   * top-N cap so fires in view never lose their slot to higher-scoring
   * cells on other continents. `bounds === null` (sky/horizon or
   * near-global view) falls back to the global top-N behavior.
   * @param {Object} lod - Active LOD descriptor.
   * @param {?Object} bounds - Padded view bounds in degrees, or null.
   * @returns {Array<Object>} Cells sorted by heat score, capped.
   */

  function aggregateFires(lod, bounds) {
    const gridDegrees = lod.gridDegrees;

    let sorted = layerState._cellCacheByGrid.get(gridDegrees);
    if (!sorted) {
      const cells = new Map();
      for (const fire of layerState._fires) {
        const latCell = Math.floor(fire.lat / gridDegrees) * gridDegrees;
        const lonCell = Math.floor(fire.lon / gridDegrees) * gridDegrees;
        const key = `${latCell.toFixed(3)}:${lonCell.toFixed(3)}`;
        // confidence is normalized 0..1 — weight ×4 preserves the old 0..100×0.04 scale.
        const intensity = Math.max(
          1,
          fire.frp * 0.18 + fire.confidence * 4 + fire.brightness * 0.01,
        );
        const existing = cells.get(key) || {
          latCell,
          lonCell,
          count: 0,
          intensity: 0,
          maxFrp: 0,
          night: 0,
          newestAcqMs: 0,
        };
        existing.count += 1;
        existing.intensity += intensity;
        existing.maxFrp = Math.max(existing.maxFrp, fire.frp);
        existing.newestAcqMs = Math.max(existing.newestAcqMs, fire.acqMs);
        if (fire.night) existing.night += 1;
        cells.set(key, existing);
      }
      // Heat-sorted once; per-render clipping below preserves the order.
      sorted = [...cells.values()].sort(
        (a, b) => components.model.heatScore(b) - components.model.heatScore(a),
      );
      layerState._cellCacheByGrid.set(gridDegrees, sorted);
    }

    if (!bounds) return sorted.slice(0, lod.maxCells);
    const clipped = [];
    for (const cell of sorted) {
      if (!components.model.cellIntersectsBounds(cell, gridDegrees, bounds))
        continue;
      clipped.push(cell);
      if (clipped.length >= lod.maxCells) break;
    }
    return clipped;
  }

  /** The heat imagery adapter, created on first use. */

  function heatImagery() {
    if (!layerState._heatImagery) {
      layerState._heatImagery = createHeatImagery({
        cesium: Cesium,
        getHost: () =>
          layerState._imageryHost?.() ?? {
            collection: layerState._viewer?.imageryLayers ?? null,
            kind: 'globe',
          },
      });
    }
    return layerState._heatImagery;
  }

  /** The worker-backed raster builder, created on first use. */

  function heatRasterClient() {
    if (!layerState._heatRasterClient) {
      layerState._heatRasterClient = createHeatRasterClient({
        onFallback: (error) =>
          console.warn(
            '[FIRMS] Heat raster worker unavailable; building on the main thread.',
            error,
          ),
      });
    }
    return layerState._heatRasterClient;
  }

  /**
   * Build the heat raster from the shown set off the main thread and drape
   * it when it lands. A result for a set that is no longer shown (a filter
   * change or refresh meanwhile) is dropped; the newer set builds its own.
   */

  function rebuildHeatRaster() {
    clearTimeout(layerState._heatRebuildTimer);
    layerState._heatRebuildTimer = null;
    if (layerState._destroyed) return;
    const fires = layerState._fires;
    layerState._heatBuildFires = fires;
    heatRasterClient()
      .build(fires, HEAT_RASTER)
      .then((raster) => {
        if (!raster) return;
        if (layerState._heatBuildFires === fires)
          layerState._heatBuildFires = null;
        if (layerState._destroyed || layerState._fires !== fires) {
          raster.image?.close?.();
          return;
        }
        layerState._heatRaster = raster;
        heatImagery().setRaster(raster);
        services.render?.governorRequestRender?.('firms-heat-raster');
      })
      .catch((error) => {
        if (layerState._heatBuildFires === fires)
          layerState._heatBuildFires = null;
        console.error('[FIRMS] Heat raster build failed.', error);
      });
  }

  /**
   * Make sure the draped heatmap matches the shown set. The first build in a
   * far band starts at once; other builds (filter drags, refreshes, the
   * preload under the markers) trail by HEAT_REBUILD_MS and keep the
   * previous heatmap on screen meanwhile. A build already running for the
   * shown set is not started again.
   * @param {boolean} now Build at once when nothing is draped yet.
   */

  function ensureHeatRaster(now) {
    if (layerState._heatRaster) return;
    if (layerState._heatBuildFires === layerState._fires) return;
    if (now && !heatImagery().hasRaster()) {
      rebuildHeatRaster();
      return;
    }
    clearTimeout(layerState._heatRebuildTimer);
    layerState._heatRebuildTimer = setTimeout(
      rebuildHeatRaster,
      HEAT_REBUILD_MS,
    );
  }

  /**
   * Keep the heatmap draped on the current map stack and current with the
   * shown set in every band; the hand-off fade decides how much of it shows.
   * @param {boolean} now The camera is in a far band.
   */

  function prepareHeat(now) {
    const imagery = heatImagery();
    // The map stack may have changed since the last render.
    imagery.rehome();
    ensureHeatRaster(now);
    imagery.setShow(layerState._enabled);
  }

  /**
   * Far bands (global/regional): a Snap Map–style heatmap draped over the
   * globe, transparent where nothing burns, plus the decluttered "N FIRES"
   * cards from the coarse aggregation. The nearest band's markers are kept
   * built underneath for the hand-off fade and hidden once it completes;
   * cards go through the same screen-space label pipeline as detections
   * (see {@link rebuildAmbientLabels}).
   * @param {Object} lod - Active LOD descriptor.
   * @param {?Object} bounds - Padded view bounds in degrees, or null.
   */

  function renderHeat(lod, bounds) {
    paintMarkers(HANDOFF_MARKER_LOD, bounds);

    const cells = aggregateFires(lod, bounds);
    layerState._cellCount = cells.length;
    layerState._labelCandidates = [];
    layerState._labelLodDistance = lod.labelDistance;

    // Cells arrive heat-sorted, so candidate order doubles as label priority.
    for (const cell of cells) {
      const centerLon = cell.lonCell + lod.gridDegrees / 2;
      const centerLat = cell.latCell + lod.gridDegrees / 2;
      layerState._labelCandidates.push({
        position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0),
        cullPosition: components.model.cellCullPosition(centerLon, centerLat),
        fire: null,
        cell,
        accent: components.model.cellCardAccent(cell),
      });
    }

    components.cards.rebuildAmbientLabels();
    components.selection.refreshContextRegistrations(
      components.selection.topFiresWithinBounds(bounds),
    );
  }

  /**
   * Render individual detections (local/close bands) as pre-baked
   * radial-glow sprite billboards sized by FRP, capped per viewport by
   * highest FRP, depth test disabled. The 3D Tiles mesh is never sampled
   * per point; instead, the CLOSE band (where terrain parallax is actually
   * visible) batch-warms the shared cached DEM floor for its rendered
   * subset and re-renders once floors land, so anchors sit on the terrain
   * (firePosition). The local band keeps cold anchors at height 0 — at
   * ≥750 km camera height the divergence is invisible and warming a
   * continent-wide viewport would waste the DEM proxy.
   * Labels are not built here; candidates feed {@link rebuildAmbientLabels}.
   * @param {Object} lod - Active LOD descriptor.
   * @param {?Object} bounds - Padded view bounds in degrees, or null.
   */

  function renderDetections(lod, bounds) {
    const markers = paintMarkers(lod, bounds);
    if (!markers) return;
    const candidates = markers.map((marker) => marker.fire);

    layerState._cellCount = candidates.length;
    // FRP-sorted walk: marker order doubles as label priority.
    layerState._labelCandidates = markers;
    layerState._labelLodDistance = lod.labelDistance;

    components.cards.rebuildAmbientLabels();
    components.selection.refreshContextRegistrations(
      candidates.slice(0, CONTEXT_TOP_N),
    );

    if (lod.id === 'close') {
      // Batched (chunked ≤200, sequential, session-cached) DEM warm for the
      // rendered subset; fires are static so each coarse cell resolves once
      // ever. Re-render ONLY when a floor actually landed — a failed resolve
      // reports false, so this chain terminates instead of looping against a
      // down proxy (the next camera-driven rebuild retries).
      warmFireAnchorFloors(candidates).then((warmed) => {
        if (!warmed || !layerState._enabled || !layerState._viewer) return;
        const currentLod = LOD_LEVELS[layerState._currentLodIndex];
        if (!currentLod || currentLod.mode !== 'detections') return;
        renderCurrentLod(true);
      });
    }
  }

  /**
   * The glow-sprite markers for a detections band: the strongest fires in
   * view, capped at the band's maxDetections, horizon-culled.
   * @param {Object} lod - Detections band descriptor.
   * @param {?Object} bounds - Padded view bounds in degrees, or null.
   * @returns {?Array<Object>} Label candidates for the fires drawn,
   *   strongest first; null before the sprite collection exists.
   */

  function paintMarkers(lod, bounds) {
    ensureDetectionCollections();
    layerState._dataSource.entities.removeAll();
    if (!layerState._billboards) return null;
    const candidates = markerCandidates(lod, bounds);
    // Only the close band warms terrain floors (renderDetections).
    const anchor =
      lod.id === 'close'
        ? components.model.firePosition
        : components.model.fireBuiltPosition;
    const markers = [];
    const next = new Map();
    const billboards = [];
    layerState._cullPositions.length = 0;
    for (const fire of candidates) {
      const position = anchor(fire);
      const cullPosition = components.model.fireCullPosition(fire, position);
      const billboard = keepOrAddMarker(fire, position);
      next.set(fire, billboard);
      billboards.push(billboard);
      layerState._cullPositions.push(cullPosition);
      markers.push({ position, cullPosition, fire, cell: null });
    }
    for (const [fire, billboard] of layerState._markerByFire) {
      if (next.has(fire)) continue;
      layerState._pickIndexById.delete(billboard.id);
      layerState._billboards.remove(billboard);
    }
    layerState._markerByFire = next;
    layerState._markerBillboards = billboards;

    // Freshly-added sprites default to show=true; cull the far side now so a
    // rebuild never flashes through-the-planet detections while the camera
    // sits still (the moveEnd/preRender hooks only fire on camera motion).
    refreshHorizonCulling();
    return markers;
  }

  /**
   * The strongest detections in view for a marker band, strongest first:
   * the grid index walks only the cells the padded view touches and returns
   * what a scan of the FRP-sorted set would (markerIndex.js).
   * @param {Object} lod - Detections band descriptor.
   * @param {?Object} bounds - Padded view bounds in degrees, or null.
   * @returns {Array<Object>}
   */

  function markerCandidates(lod, bounds) {
    const firesByFrp = layerState._firesByFrp;
    // Sky/horizon view: fall back to the globally strongest detections.
    if (!bounds) return firesByFrp.slice(0, lod.maxDetections);
    if (layerState._markerIndexSource !== firesByFrp) {
      layerState._markerIndex = buildFireGridIndex(firesByFrp);
      layerState._markerIndexSource = firesByFrp;
    }
    return queryFireGridIndex(
      layerState._markerIndex,
      firesByFrp,
      bounds,
      lod.maxDetections,
      components.model.boundsContainPoint,
    );
  }

  /**
   * The sprite for one detection: the one already drawn when it stays in
   * the set (its image depends only on the detection; its anchor moves only
   * when a terrain floor lands), else a new one carrying the current
   * hand-off fade. Diffing replaces the old clear-and-refill of up to 40,000
   * sprites on every rebuild.
   */

  function keepOrAddMarker(fire, position) {
    const kept = layerState._markerByFire.get(fire);
    if (kept) {
      if (kept.position !== position) kept.position = position;
      return kept;
    }
    const pickId = `firms-${fire.index}`;
    layerState._pickIndexById.set(pickId, fire);
    const coreSize = components.model.frpPixelSize(fire.frp);
    return layerState._billboards.add({
      id: pickId,
      position,
      color: currentFadeColor(),
      image: components.model.glowSprite(
        components.model.detectionColorStop(fire),
        components.model.sizeBucket(coreSize),
      ),
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }

  /** The marker colour for the last applied hand-off fade. */

  function currentFadeColor() {
    const heat = Math.max(0, layerState._handoffHeat);
    return Cesium.Color.WHITE.withAlpha(1 - heat, fadeColor);
  }

  function ensureDetectionCollections() {
    if (!layerState._viewer || layerState._billboards) return;
    layerState._billboards = new Cesium.BillboardCollection({
      scene: layerState._viewer.scene,
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    });
    layerState._billboards.show = layerState._enabled;
    layerState._viewer.scene.primitives.add(layerState._billboards);
    registerSpriteCollection('firms', layerState._billboards);
    restoreSpriteOrder(layerState._viewer);
    overlayHost.setVisible(FIRMS_OVERLAY_SOURCE_ID, layerState._enabled);
  }

  function removeDetectionCollections(viewer) {
    const scene = viewer?.scene || layerState._viewer?.scene;
    if (scene && !scene.isDestroyed?.()) {
      try {
        if (layerState._billboards)
          scene.primitives.remove(layerState._billboards);
      } catch {
        /* already torn down */
      }
    }
    layerState._billboards = null;
    layerState._markerByFire = new Map();
    layerState._markerBillboards = [];
    layerState._pickIndexById.clear();
    overlayHost.clearSource(FIRMS_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(FIRMS_OVERLAY_SOURCE_ID, false);
  }

  /**
   * Shared horizon occluder positioned at the current camera, or null when
   * there is no usable camera yet (init order / headless stubs).
   * `viewer.camera` and `viewer.scene.camera` are the SAME object in Cesium;
   * both are probed so a partial stub (either shape) still gets a real
   * occluder rather than silently degrading to "nothing is ever occluded".
   * @returns {?Cesium.EllipsoidalOccluder}
   */

  function fireHorizonOccluder() {
    const camera = layerState._viewer?.camera?.positionWC
      ? layerState._viewer.camera
      : layerState._viewer?.scene?.camera;
    if (!camera?.positionWC) return null;
    return horizonOccluder(camera);
  }

  /**
   * Hide detection sprites that sit beyond the ellipsoid horizon (see
   * {@link applyHorizonCull}). Runs on the cadences that already exist in this
   * layer — the throttled LOD preRender watcher (camera-moved only), camera
   * moveEnd, and each detection rebuild — never as a new per-frame pass.
   * No-ops in the `cells` bands, where the collection is empty.
   */

  function refreshHorizonCulling() {
    const markers = layerState._markerBillboards;
    if (!layerState._billboards || !markers.length) return;
    components.model.applyHorizonCull(
      markerView,
      fireHorizonOccluder(),
      layerState._cullPositions,
      currentFadeColor(),
    );
  }

  /** The drawn markers in candidate order, index-aligned with _cullPositions. */
  const markerView = {
    get length() {
      return layerState._markerBillboards.length;
    },
    get(i) {
      return layerState._markerBillboards[i];
    },
  };
  return {
    renderCurrentLod,
    renderBand,
    aggregateFires,
    renderHeat,
    renderDetections,
    applyHandoffFade,
    ensureDetectionCollections,
    removeDetectionCollections,
    fireHorizonOccluder,
    refreshHorizonCulling,
  };
}
