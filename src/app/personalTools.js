import * as Cesium from 'cesium';
import { t } from '../i18n/index.js';
import { prefersReducedMotion } from '../cameraVerbs.js';
import { createPersonalWorkspace } from '../ui/personalWorkspace.js';
import { normalizeLensSelection } from '../ui/lensPresentation.js';
import { getSelectedEntityContext } from '../data/contextStore.js';
import { isPickedWorldPosition } from '../data/scenePick.js';
import {
  captureRoute,
  captureManualDrawings,
  restoreManualDrawings,
  captureScene,
  captureAttachment,
} from '../fieldbook/capture.js';
import { createFieldbook, validateFieldbook } from '../fieldbook/document.js';
import { validateRouteSnapshot } from '../layers/directions/snapshot.js';

function selectionRecord(record) {
  if (!record) return null;
  let position = null;
  if (isPickedWorldPosition(record.position)) {
    const point = Cesium.Cartographic.fromCartesian(record.position);
    if (point)
      position = {
        lat: Cesium.Math.toDegrees(point.latitude),
        lon: Cesium.Math.toDegrees(point.longitude),
      };
  }
  return normalizeLensSelection({
    id: record.id,
    name: record.name || record.label || record.properties?.name,
    lat: record.lat ?? record.latitude ?? position?.lat,
    lon: record.lon ?? record.longitude ?? position?.lon,
    geometry: record.geometry,
    extent: record.extent || record.bbox,
    sourceId: record.sourceId || record.layerId,
    sourceLabel: record.sourceLabel || record.source,
  });
}

/** Translate existing application owners into the personal workspace's small API. */
export function createPersonalToolBindings({
  viewer,
  styleManager,
  dataManager,
  mapStackController,
  operations,
  annotations,
  sceneDirector,
}) {
  let destroyed = false;
  const lifetime = new AbortController();
  const cleanups = new Set();
  const assertLive = () => {
    if (destroyed) throw new Error('Personal workspace is closed.');
  };
  const own = (cleanup) => {
    if (typeof cleanup !== 'function') return () => {};
    if (destroyed) {
      cleanup();
      return () => {};
    }
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      cleanups.delete(release);
      cleanup();
    };
    cleanups.add(release);
    return release;
  };
  const readSelection = () =>
    typeof window === 'undefined'
      ? null
      : selectionRecord(getSelectedEntityContext({ dataManager }));
  const directions = () => dataManager?.layers?.get('directions')?.module;
  const subscribe = (owner, method, listener) =>
    own(
      owner?.[method]?.((...args) => {
        if (!destroyed) listener(...args);
      }),
    );
  function subscribeSelection(listener) {
    if (destroyed || typeof window === 'undefined') return () => {};
    const selected = (event) => {
      if (destroyed) return;
      // Tracking publishes its event just before updating the shared slot. Its
      // event position is already authoritative; do not read yesterday's slot.
      const record = selectionRecord(event.detail) || readSelection();
      if (record) listener(record);
    };
    const cleared = () => {
      if (!destroyed) listener(null);
    };
    const events = [
      ['gev:entity-selected', selected],
      ['gev:awareness-subject-selected', selected],
      ['gev:entity-selection-cleared', cleared],
      ['gev:awareness-subject-cleared', cleared],
    ];
    events.forEach(([name, handler]) => window.addEventListener(name, handler));
    // Only new user selections reveal Lens; mounting must not steal focus.
    return own(() =>
      events.forEach(([name, handler]) =>
        window.removeEventListener(name, handler),
      ),
    );
  }
  function readCurrentPlace() {
    if (destroyed) return null;
    const point = operations?.annotationResolver?.pickWorldFromScreen?.(
      viewer,
      0.5,
      0.5,
    );
    return point
      ? selectionRecord({ ...point, name: t('Current map view') })
      : null;
  }
  function focusPlace(place) {
    if (destroyed) return false;
    const point = selectionRecord(place);
    if (!point) return false;
    const [lon, lat] = point.geometry.coordinates;
    return (
      styleManager?._runExplicitNavigation?.('saved place', () => {
        if (destroyed) return false;
        // A bounded overview above the highest terrain, without a new elevation
        // request. The user can zoom into the saved point through normal controls.
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 12000),
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          duration: prefersReducedMotion() ? 0 : 1.2,
        });
        return true;
      }) ?? false
    );
  }
  async function captureCurrent(kind, file) {
    assertLive();
    let result;
    if (kind === 'route') result = captureRoute(directions());
    else if (kind === 'drawing') result = captureManualDrawings(annotations);
    else if (kind === 'scene') result = captureScene(sceneDirector);
    else if (kind === 'attachment') result = await captureAttachment(file);
    else throw new Error('Unsupported personal capture.');
    assertLive();
    return result;
  }
  async function restoreCapture(kind, entry) {
    assertLive();
    if (kind === 'route') {
      const snapshot = validateRouteSnapshot(entry?.snapshot);
      if (!snapshot)
        throw new Error(
          'This route has no supported saved directions snapshot.',
        );
      const module = directions();
      if (!module?.restoreSavedRoute)
        throw new Error('Directions are unavailable.');
      const enabled = await dataManager.setEnabled('directions', true, {
        origin: 'tool',
        signal: lifetime.signal,
      });
      assertLive();
      if (
        enabled === false ||
        !dataManager.isEnabled('directions') ||
        directions() !== module ||
        !module.restoreSavedRoute(snapshot)
      )
        throw new Error('The saved route could not be restored.');
      return true;
    }
    if (kind === 'drawing') {
      const result = await restoreManualDrawings(annotations, [entry], {
        signal: lifetime.signal,
      });
      assertLive();
      if (!result?.ok || result.failed)
        throw new Error('The saved drawing could not be restored.');
      return true;
    }
    if (kind === 'scene') {
      const result = await sceneDirector?.restoreProjectSnapshot?.(
        entry?.document,
        { signal: lifetime.signal },
      );
      assertLive();
      if (!result) throw new Error('The saved scenes could not be restored.');
      return true;
    }
    if (kind === 'attachment') {
      // Local download only. Never mount arbitrary attachment bytes in the DOM
      // or hand them to a network-capable map loader automatically.
      validateFieldbook({ ...createFieldbook(), attachments: [entry] });
      const bytes =
        entry.encoding === 'utf8'
          ? new TextEncoder().encode(entry.data)
          : Uint8Array.from(atob(entry.data), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: 'application/octet-stream' }),
      );
      const revoke = own(() => URL.revokeObjectURL(url));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = entry.name.replace(/[\\/]/g, '_');
        anchor.click();
      } finally {
        setTimeout(revoke, 0);
      }
      return true;
    }
    throw new Error('Unsupported saved content.');
  }
  return {
    subscribeLocationSearch: (listener) =>
      subscribe(styleManager, 'subscribeLocationSearch', listener),
    subscribeSelection,
    subscribeEvidence(listener) {
      const unsubscribers = [
        subscribe(dataManager, 'subscribe', listener),
        subscribe(dataManager, 'subscribeActivity', listener),
        subscribe(mapStackController, 'subscribe', listener),
      ];
      return own(() => unsubscribers.forEach((unsubscribe) => unsubscribe()));
    },
    readLayers: () => (destroyed ? [] : dataManager?.getAll?.() || []),
    readMapSource: () => {
      const stack = destroyed ? null : mapStackController?.getActiveStack?.();
      return stack ? { id: stack.id, label: stack.label } : null;
    },
    readCurrentPlace,
    focusPlace,
    captureCurrent,
    restoreCapture,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      lifetime.abort();
      for (const cleanup of [...cleanups]) cleanup();
    },
  };
}

export function createPersonalTools(options) {
  const bindings = createPersonalToolBindings(options);
  let workspace;
  try {
    workspace = createPersonalWorkspace({
      ...bindings,
      pinia: options.pinia,
      onPlanPlace: options.onPlanPlace,
      onOpenComparison: options.onOpenComparison,
      ...(options.repository ? { repository: options.repository } : {}),
    });
  } catch (error) {
    bindings.destroy();
    throw error;
  }
  return {
    ...workspace,
    destroy() {
      bindings.destroy();
      workspace.destroy();
    },
  };
}
