import * as Cesium from 'cesium';

export const EARTHQUAKE_ENTITY_PREFIX = 'earthquake:';
const LAYER_ID = 'earthquakes';

/**
 * Click selection for earthquake discs through the shared context store, so
 * Lens and the Second Source card can inspect one event. Services are
 * injected by the application binding; without them the layer still renders.
 *
 * @param {object} options
 * @param {{registerEntityContext: Function, selectEntityContext: Function,
 *   clearSelectedEntityContextForLayer: Function,
 *   removeEntityContextsForLayer: Function}} options.context
 * @param {{resolvePickId: Function, isOwnedByOtherLayer: Function,
 *   registerPickOwner: Function, unregisterPickOwner: Function}} options.picking
 * @param {() => boolean} [options.isPointerFree]
 * @param {(viewer: object) => object} options.screenSpaceEventHandlerFactory
 */
export function createEarthquakeSelection({
  context,
  picking,
  isPointerFree = () => true,
  screenSpaceEventHandlerFactory,
}) {
  let handler = null;
  let viewer = null;
  let registeredIds = new Set();

  /**
   * The shared context store lives on `window`; without it (tests, workers)
   * selection is unavailable and the layer still renders.
   */
  const safely = (operation) => {
    try {
      return operation();
    } catch {
      return null;
    }
  };

  const owns = (id) =>
    typeof id === 'string' && id.startsWith(EARTHQUAKE_ENTITY_PREFIX);

  function install(nextViewer) {
    // Headless hosts (tests) have no canvas: rendering continues unselectable.
    if (handler || !nextViewer?.scene?.canvas) return;
    handler = safely(() => screenSpaceEventHandlerFactory(nextViewer));
    if (!handler) return;
    viewer = nextViewer;
    picking.registerPickOwner?.(LAYER_ID, owns);
    handler.setInputAction((click) => {
      if (!isPointerFree()) return;
      const picked = viewer?.scene?.pick(click.position);
      const pickedId = picked ? picking.resolvePickId(picked) : null;
      if (owns(pickedId) && registeredIds.has(pickedId)) {
        safely(() => context.selectEntityContext(picked.id));
        return;
      }
      if (pickedId && picking.isOwnedByOtherLayer(LAYER_ID, pickedId)) return;
      safely(() => context.clearSelectedEntityContextForLayer(LAYER_ID));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function uninstall() {
    handler?.destroy();
    handler = null;
    picking.unregisterPickOwner?.(LAYER_ID);
    viewer = null;
  }

  /**
   * Register the current events; drops records that left the feed.
   * @param {Array<{entity: object, row: object}>} entries
   * @param {object} dataSource The layer's data source (visibility gate).
   */
  function register(entries, dataSource) {
    const next = new Set();
    for (const { entity, row } of entries) {
      const id = `${EARTHQUAKE_ENTITY_PREFIX}${row.stableId}`;
      const magnitude = Number.isFinite(row.mag) ? row.mag.toFixed(1) : '?';
      const registered = safely(() =>
        context.registerEntityContext(entity, {
          id,
          layerId: LAYER_ID,
          layerName: 'Earthquakes (24h)',
          source: 'USGS',
          sourceId: LAYER_ID,
          sourceLabel: 'USGS',
          dataSource,
          // i18n-ignore: English entity label; the voice card translates it (shownEntityLabel)
          label: row.place ? `M${magnitude} · ${row.place}` : `M${magnitude}`,
          latitude: row.lat,
          longitude: row.lon,
          properties: {
            usgsId: row.usgsId,
            mag: row.mag,
            timeMs: row.time,
            depthKm: row.depthKm,
            place: row.place,
          },
        }),
      );
      if (registered) next.add(id);
    }
    registeredIds = next;
    safely(() =>
      context.removeEntityContextsForLayer(LAYER_ID, { retainIds: next }),
    );
  }

  function clear() {
    registeredIds = new Set();
    safely(() => context.removeEntityContextsForLayer(LAYER_ID));
  }

  return { install, uninstall, register, clear };
}
