/**
 * Parse a bundled `.geojsonl` dataset into compact drawable records, off the
 * Entity path. Pure and Cesium-free so it runs in a module Worker and in Node.
 *
 * Record identity follows Cesium's GeoJsonDataSource (createObject), which the
 * layers used before: each Point, polygon of a MultiPolygon and line of a
 * MultiLineString becomes one record; a feature id that is already taken gets
 * `_2`, `_3`, ... appended; a missing id or a non-Feature gets a random id; a
 * null geometry still takes an id but draws nothing; a polygon without an outer
 * ring is skipped without taking an id. Coordinates keep longitude and latitude
 * only, because every record is clamped to the ground (the bundled datasets
 * carry no heights).
 */
import { parseGeojsonLines } from '../sources/infrastructureData.js';

/** @typedef {'point'|'polygon'|'line'|'empty'} LocalRecordKind */

/**
 * @typedef {object} LocalGeojsonRecord
 * @property {string} id Unique record id within the dataset.
 * @property {LocalRecordKind} kind What the record draws.
 * @property {object} properties The feature properties ({} when absent).
 * @property {Float64Array} [point] [lon, lat] in degrees (kind 'point').
 * @property {Float64Array[]} [rings] Outer ring then holes, flat lon/lat pairs (kind 'polygon').
 * @property {Float64Array} [line] Flat lon/lat pairs (kind 'line').
 */

/** Flatten [[lon, lat, ...], ...] into a lon/lat Float64Array. */
function flatLonLat(positions) {
  const flat = new Float64Array(positions.length * 2);
  for (let i = 0; i < positions.length; i++) {
    flat[i * 2] = Number(positions[i][0]);
    flat[i * 2 + 1] = Number(positions[i][1]);
  }
  return flat;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Math.random()}`;
}

/** Cesium createObject's id rule, against the ids taken so far. */
function claimId(feature, takenIds) {
  const id = feature?.id;
  if (id === undefined || id === null || feature.type !== 'Feature') {
    const generated = randomId();
    takenIds.add(generated);
    return generated;
  }
  let finalId = String(id);
  for (let i = 2; takenIds.has(finalId); i++) finalId = `${id}_${i}`;
  takenIds.add(finalId);
  return finalId;
}

function propertiesOf(feature) {
  const properties = feature?.properties;
  return properties && typeof properties === 'object' ? properties : {};
}

function pointRecord(context, coordinates) {
  return {
    id: claimId(context.feature, context.takenIds),
    kind: 'point',
    properties: context.properties,
    point: flatLonLat([coordinates]),
  };
}

function polygonRecord(context, rings) {
  if (!rings?.length || !rings[0]?.length) return null;
  return {
    id: claimId(context.feature, context.takenIds),
    kind: 'polygon',
    properties: context.properties,
    rings: rings.map(flatLonLat),
  };
}

function lineRecord(context, coordinates) {
  return {
    id: claimId(context.feature, context.takenIds),
    kind: 'line',
    properties: context.properties,
    line: flatLonLat(coordinates),
  };
}

const GEOMETRY_HANDLERS = Object.freeze({
  Point: (context, geometry) => [pointRecord(context, geometry.coordinates)],
  MultiPoint: (context, geometry) =>
    geometry.coordinates.map((point) => pointRecord(context, point)),
  LineString: (context, geometry) => [
    lineRecord(context, geometry.coordinates),
  ],
  MultiLineString: (context, geometry) =>
    geometry.coordinates.map((line) => lineRecord(context, line)),
  Polygon: (context, geometry) => [
    polygonRecord(context, geometry.coordinates),
  ],
  MultiPolygon: (context, geometry) =>
    geometry.coordinates.map((rings) => polygonRecord(context, rings)),
  GeometryCollection: (context, geometry) =>
    geometry.geometries.flatMap((part) => geometryRecords(context, part)),
});

function geometryRecords(context, geometry) {
  const handler = GEOMETRY_HANDLERS[geometry.type];
  if (!handler) throw new Error(`Unknown geometry type: ${geometry.type}`);
  return handler(context, geometry).filter(Boolean);
}

function featureRecords(feature, takenIds) {
  const context = { feature, takenIds, properties: propertiesOf(feature) };
  if (feature?.geometry === null) {
    return [
      {
        id: claimId(feature, takenIds),
        kind: 'empty',
        properties: context.properties,
      },
    ];
  }
  if (!feature?.geometry) throw new Error('feature.geometry is required.');
  return geometryRecords(context, feature.geometry);
}

/**
 * Turn parsed GeoJSON features into drawable records, in dataset order.
 * @param {object[]} features GeoJSON Feature objects.
 * @returns {LocalGeojsonRecord[]}
 */
export function localGeojsonRecordsFromFeatures(features) {
  const takenIds = new Set();
  return features.flatMap((feature) => featureRecords(feature, takenIds));
}

/**
 * Parse `.geojsonl` text into drawable records.
 * @param {string} text One GeoJSON Feature per non-empty line.
 * @returns {LocalGeojsonRecord[]}
 * @throws {SyntaxError} When a line is not JSON.
 */
export function parseLocalGeojsonDataset(text) {
  return localGeojsonRecordsFromFeatures(parseGeojsonLines(text));
}

/** Transferable buffers inside parsed records, for a zero-copy postMessage. */
export function localGeojsonTransferables(records) {
  const buffers = [];
  for (const record of records) {
    if (record.point) buffers.push(record.point.buffer);
    if (record.line) buffers.push(record.line.buffer);
    if (record.rings)
      for (const ring of record.rings) buffers.push(ring.buffer);
  }
  return buffers;
}
