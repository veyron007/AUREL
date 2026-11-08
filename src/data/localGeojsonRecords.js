import * as Cesium from 'cesium';
import {
  createLocalInfrastructureOverlayEntry,
  featureLabelFromProperties,
  labelPriorityFromProperties,
} from './localGeojsonOverlay.js';

/** Height of a stem tip before the first camera-sized walk. */
export const LOCAL_INITIAL_TIP_HEIGHT_M = 2000;

/** lon/lat pairs (degrees) to ellipsoid-surface Cartesians, as GeoJsonDataSource did. */
export function ringPositions(flat) {
  const positions = new Array(flat.length / 2);
  for (let i = 0; i < positions.length; i++)
    positions[i] = Cesium.Cartesian3.fromDegrees(flat[i * 2], flat[i * 2 + 1]);
  return positions;
}

/**
 * The anchor the Entity path used: a Point's position, or the bounding-sphere
 * centre of a polygon's outer ring at height 0. Lines and empty records have
 * none.
 * @param {import('./localGeojsonParse.js').LocalGeojsonRecord} parsed
 * @returns {{position: Cesium.Cartesian3, rings: Cesium.Cartesian3[][]|null}|null}
 */
export function localRecordAnchor(parsed) {
  if (parsed.kind === 'point') {
    const [lon, lat] = parsed.point;
    return { position: Cesium.Cartesian3.fromDegrees(lon, lat), rings: null };
  }
  if (parsed.kind !== 'polygon') return null;
  const rings = parsed.rings.map(ringPositions);
  return {
    position: Cesium.BoundingSphere.fromPoints(rings[0]).center,
    rings,
  };
}

function contextMetadata(layer, recordId, properties, carto) {
  return {
    id: `${layer.id}:${recordId}`,
    layerId: layer.id,
    layerName: layer.name,
    source: layer.source,
    dataSource: layer.handle,
    label: featureLabelFromProperties(properties, layer.id),
    properties,
    latitude: Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6)),
    longitude: Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6)),
  };
}

function overlayEntry(layer, recordId, tip, properties, priority) {
  if (!layer.labels) return null;
  return createLocalInfrastructureOverlayEntry({
    id: recordId,
    layerId: layer.id,
    position: tip,
    properties,
    priority,
    accent: layer.color,
  });
}

function stemRecord(layer, parsed, anchor, services) {
  const carto = Cesium.Cartographic.fromCartesian(anchor.position);
  const base = Cesium.Cartesian3.fromRadians(
    carto.longitude,
    carto.latitude,
    0,
  );
  const tip = Cesium.Cartesian3.fromRadians(
    carto.longitude,
    carto.latitude,
    LOCAL_INITIAL_TIP_HEIGHT_M,
  );
  // The pick and context carrier: mutable by design, because context
  // consumers read `show` and `__localBaseCartesian` live.
  const carrier = {
    id: parsed.id,
    show: true,
    __localLayerId: layer.id,
    __localBaseCarto: carto,
    __localBaseCartesian: base,
  };
  const properties = parsed.properties;
  services.registerEntityContext(
    carrier,
    contextMetadata(layer, parsed.id, properties, carto),
  );
  const priority = labelPriorityFromProperties(properties, layer.id);
  const visual = services.renderer.addRecord({
    carrier,
    base,
    tip,
    rings: anchor.rings,
    isPoint: parsed.kind === 'point',
  });
  return {
    id: parsed.id,
    carrier,
    visual,
    properties,
    carto,
    base,
    tip,
    nextTip: Cesium.Cartesian3.clone(tip),
    groundHeight: 0,
    groundSampled: false,
    lastGroundSampleMs: 0,
    // Drawn state of the visuals, which start hidden (localGeojsonPrimitives.js).
    visible: false,
    priority,
    entry: overlayEntry(layer, parsed.id, tip, properties, priority),
  };
}

function lineCarrier(layer, parsed, renderer) {
  const positions = ringPositions(parsed.line);
  const carrier = { id: parsed.id, show: true, __localLayerId: layer.id };
  renderer.addLine(carrier, positions);
  return { carrier, flyTarget: positions[0] };
}

/**
 * Turn parsed records into stem records, register their context records and
 * hand every visual to the renderer.
 * @param {object} layer {id, name, source, color, labels, handle}
 * @param {import('./localGeojsonParse.js').LocalGeojsonRecord[]} parsedRecords
 * @param {{renderer: object, registerEntityContext: Function}} services
 * @returns {{stemRecords: object[], byCarrier: Map<object, object>}}
 */
export function buildLocalStemRecords(layer, parsedRecords, services) {
  const stemRecords = [];
  const byCarrier = new Map();
  for (const parsed of parsedRecords) {
    if (parsed.kind === 'line') {
      const line = lineCarrier(layer, parsed, services.renderer);
      byCarrier.set(line.carrier, line);
      continue;
    }
    const anchor = localRecordAnchor(parsed);
    if (!anchor) continue;
    const record = stemRecord(layer, parsed, anchor, services);
    stemRecords.push(record);
    byCarrier.set(record.carrier, record);
  }
  return { stemRecords, byCarrier };
}
