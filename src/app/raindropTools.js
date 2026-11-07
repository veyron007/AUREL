import * as Cesium from 'cesium';
import { watch } from 'vue';
import { prefersReducedMotion } from '../cameraVerbs.js';
import { claimPointer, releasePointer } from '../data/inputOwnership.js';
import { ensureGeoidReady, geoidHeight } from '../data/geoid.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
} from '../renderGovernor.js';
import { readResponseJsonCapped } from '../sources/httpBody.js';
import { RaindropController } from '../ui/raindropController.js';
import { useRaindropStore } from '../ui/stores/raindrop.js';
import { useLensStore } from '../ui/stores/lens.js';
import { createRaindropAnalysis } from '../hydro/analysis.js';
import { createHydroClient } from '../hydro/workerClient.js';
import { meshTileUrl } from '../hydro/demSampler.js';
import { validateRiverSubset } from '../hydro/farField.js';
import { buildDropClip } from '../hydro/dropClip.js';

export const RAINDROP_POINTER_OWNER = 'raindrop-pick';
const RENDER_HOLD = 'raindrop-drop';
const HYDRO_ROOT = '/hydro/';
const JSON_LIMIT = 2 * 1024 * 1024;

/** Lamplight tokens for globe colours; the theme owns the values. */
function token(name, fallback) {
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return Cesium.Color.fromCssColorString(value || fallback);
  } catch {
    return Cesium.Color.fromCssColorString(fallback);
  }
}

async function hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Same-origin bundled files, verified against their manifest before use. */
export function createBundledHydroLoaders(fetchImpl = (...a) => fetch(...a)) {
  const json = async (name) => {
    const response = await fetchImpl(HYDRO_ROOT + name, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return readResponseJsonCapped(response, JSON_LIMIT);
  };
  return {
    async loadBundled() {
      const manifest = await json('doon/manifest.json');
      if (!manifest?.asset?.path) return null;
      const response = await fetchImpl(
        HYDRO_ROOT + 'doon/' + manifest.asset.path,
      );
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      if (
        buffer.byteLength !== manifest.asset.byteLength ||
        (await hex(buffer)) !== manifest.asset.sha256
      )
        throw new Error('Bundled DEM failed its integrity check');
      return { manifest, codes: new Uint16Array(buffer) };
    },
    async loadRivers() {
      const value = await json('rivers.json');
      return value ? validateRiverSubset(value) : null;
    },
    loadBasins: () => json('basins-doon.json'),
  };
}

async function fetchMeshTile(tile, signal) {
  const response = await fetch(meshTileUrl(tile), {
    signal,
    headers: {
      Accept: 'application/vnd.quantized-mesh,application/octet-stream;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Globe adapters for Raindrop: one-shot pick, trace, catchment and the drop clip. */
export function createRaindropBindings({ pinia, viewer, styleManager }) {
  const lens = useLensStore(pinia);
  const entities = [];
  let clipFrame = null,
    pickCleanup = null,
    lastResult = null,
    destroyed = false;

  const add = (entity) => {
    const added = viewer?.entities?.add(entity);
    if (added) entities.push(added);
    return added;
  };
  function stopClip() {
    if (clipFrame !== null) cancelAnimationFrame(clipFrame);
    clipFrame = null;
    releaseContinuousRender(RENDER_HOLD);
  }
  function clear() {
    stopClip();
    for (const entity of entities.splice(0)) viewer?.entities?.remove(entity);
    governorRequestRender('raindrop-clear');
  }
  function playClip(result) {
    stopClip();
    const clip = buildDropClip(
      result.drop.path,
      result.farField?.status === 'ok' ? result.farField.path : null,
    );
    let started = null;
    let position = Cesium.Cartesian3.fromDegrees(...result.drop.path[0]);
    add({
      id: 'raindrop-drop-head',
      position: new Cesium.CallbackProperty(() => position, false),
      point: {
        pixelSize: 11,
        color: token('--state-info', '#7fc4d8'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    if (prefersReducedMotion()) {
      position = Cesium.Cartesian3.fromDegrees(
        ...clip.positionAt(clip.duration),
      );
      governorRequestRender('raindrop-static');
      return;
    }
    holdContinuousRender(RENDER_HOLD);
    const frame = (time) => {
      if (destroyed) return;
      started ??= time;
      const seconds = (time - started) / 1000;
      position = Cesium.Cartesian3.fromDegrees(...clip.positionAt(seconds));
      if (seconds < clip.duration) clipFrame = requestAnimationFrame(frame);
      else stopClip();
    };
    clipFrame = requestAnimationFrame(frame);
  }
  function show(result) {
    if (destroyed || !viewer?.entities) return;
    clear();
    lastResult = result;
    const water = token('--state-info', '#7fc4d8');
    const brass = token('--accent', '#d6ab55');
    const ring = result.drop.catchment.outline.ring;
    if (ring.length > 3) {
      const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
      add({
        id: 'raindrop-catchment-fill',
        polygon: {
          hierarchy: positions,
          material: brass.withAlpha(0.14),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      });
      add({
        id: 'raindrop-catchment-outline',
        polyline: {
          positions,
          width: 2.5,
          material: brass,
          clampToGround: true,
        },
      });
    }
    add({
      id: 'raindrop-trace',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(result.drop.path.flat()),
        width: 3.5,
        material: water,
        clampToGround: true,
      },
    });
    if (result.farField?.status === 'ok')
      add({
        id: 'raindrop-far-field',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(
            result.farField.path.flat(),
          ),
          width: 2.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: water.withAlpha(0.85),
            dashLength: 14,
          }),
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
    focus(result);
    playClip(result);
  }
  function focus(result) {
    const points = [...result.drop.path, ...result.drop.catchment.outline.ring];
    const lons = points.map((p) => p[0]),
      lats = points.map((p) => p[1]);
    const pad = 0.02;
    const destination = Cesium.Rectangle.fromDegrees(
      Math.min(...lons) - pad,
      Math.min(...lats) - pad,
      Math.max(...lons) + pad,
      Math.max(...lats) + pad,
    );
    const fly = () =>
      viewer.camera.flyTo({
        destination,
        duration: prefersReducedMotion() ? 0 : 1.4,
      });
    if (styleManager?._runExplicitNavigation)
      styleManager._runExplicitNavigation('route', () => {
        if (!destroyed) fly();
        return true;
      });
    else fly();
  }
  function pickPoint(signal) {
    pickCleanup?.();
    return new Promise((resolve) => {
      const lease = claimPointer(RAINDROP_POINTER_OWNER);
      if (!lease) return resolve(null);
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      const finish = (value) => {
        handler.destroy();
        releasePointer(lease);
        document.removeEventListener('keydown', onKey, true);
        document.body.classList.remove('gev-raindrop-pick');
        signal?.removeEventListener('abort', onAbort);
        pickCleanup = null;
        resolve(value);
      };
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(null);
      };
      const onAbort = () => finish(null);
      handler.setInputAction(({ position }) => {
        const ray = viewer.camera.getPickRay(position);
        const cartesian =
          (ray && viewer.scene.globe.pick(ray, viewer.scene)) ||
          viewer.camera.pickEllipsoid(position);
        if (!cartesian) return;
        const c = Cesium.Cartographic.fromCartesian(cartesian);
        finish({
          lon: Cesium.Math.toDegrees(c.longitude),
          lat: Cesium.Math.toDegrees(c.latitude),
        });
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      document.addEventListener('keydown', onKey, true);
      document.body.classList.add('gev-raindrop-pick');
      signal?.addEventListener('abort', onAbort, { once: true });
      pickCleanup = () => finish(null);
    });
  }
  return {
    pickPoint,
    readSelection() {
      const selection = lens.view?.selection;
      const [lon, lat] = selection?.geometry?.coordinates || [];
      return Number.isFinite(lon) && Number.isFinite(lat)
        ? { lon, lat, name: selection.name || null }
        : null;
    },
    subscribeSelection: (listener) =>
      watch(() => lens.view?.selection, listener, { flush: 'post' }),
    render: { show, clear, replay: () => lastResult && playClip(lastResult) },
    destroy() {
      if (destroyed) return;
      pickCleanup?.();
      clear();
      destroyed = true;
    },
  };
}

async function fetchJson(path, { signal } = {}) {
  const response = await fetch(path, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    return {
      state: 'unavailable',
      reason: response.status === 429 ? 'rate-limited' : 'upstream-unavailable',
    };
  return readResponseJsonCapped(response, 1024 * 1024, signal);
}

export function createRaindropTools({ pinia, viewer, styleManager }) {
  const bindings = createRaindropBindings({ pinia, viewer, styleManager });
  const client = createHydroClient();
  const loaders = createBundledHydroLoaders();
  const analysis = createRaindropAnalysis({
    client,
    ...loaders,
    fetchTile: fetchMeshTile,
    geoid: async () => {
      await ensureGeoidReady();
      return geoidHeight;
    },
  });
  const controller = new RaindropController({
    store: useRaindropStore(pinia),
    analysis,
    render: bindings.render,
    pickPoint: bindings.pickPoint,
    readSelection: bindings.readSelection,
    fetchJson,
  });
  controller.init();
  const stopSelection = bindings.subscribeSelection(() => controller.present());
  // The QA script and local commands drive drops by coordinate.
  const handle = {
    traceAt: (lon, lat) => controller.traceAt(lon, lat),
    checkWatches: () => controller.checkWatches(),
  };
  window.__aurelRaindrop = handle;
  return {
    controller,
    destroy() {
      if (window.__aurelRaindrop === handle) delete window.__aurelRaindrop;
      stopSelection();
      controller.destroy();
      bindings.destroy();
      client.destroy();
    },
  };
}
