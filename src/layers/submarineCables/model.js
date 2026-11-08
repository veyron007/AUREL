import { featureLabel, featureReference } from './geometry.js';

/**
 * One parsed copy of a cable source: compact feature records whose drawable
 * parts follow the order in which Cesium's GeoJsonDataSource expanded them
 * into entities (one per LineString, Point and Polygon member), so every
 * segment keeps its own feature's styling, pick record and horizon culling.
 * Pure data: no Cesium types, so the model is cached across disable/enable
 * and tested without a scene.
 */

/**
 * @typedef {{type:'line', coordinates:number[][]}
 *   | {type:'point', coordinates:number[]}
 *   | {type:'polygon', rings:number[][][]}} CablePart
 * @typedef {object} CableFeatureRecord
 * @property {'cable'|'landing-point'} kind
 * @property {string} featureId Normalized feature id (source id or `${kind}-${index}`).
 * @property {string} label Display label.
 * @property {{lon:number, lat:number}|null} reference Stem anchor.
 * @property {string|null} color Feature colour (cables), CSS.
 * @property {boolean} isTbd Landing point still to be decided.
 * @property {object} style GeoJSON simplestyle overrides (stroke, marker).
 * @property {CablePart[]} parts Drawable members in entity order.
 */

const SIMPLESTYLE_KEYS = Object.freeze([
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'marker-color',
  'marker-size',
]);

/**
 * Build the compact model for one kind of feature collection.
 * @param {{features?: object[]}} json GeoJSON FeatureCollection.
 * @param {'cable'|'landing'} sourceKind Collection role.
 * @returns {CableFeatureRecord[]}
 */
export function buildCableFeatureRecords(json, sourceKind) {
  const features = Array.isArray(json?.features) ? json.features : [];
  const kind = sourceKind === 'cable' ? 'cable' : 'landing-point';
  return features.map((feature, index) =>
    featureRecord(feature, index, sourceKind, kind),
  );
}

function featureRecord(feature, index, sourceKind, kind) {
  const properties = feature?.properties || {};
  const id = properties.id || feature?.id || `${sourceKind}-${index}`;
  const normalized = { ...feature, id: String(id) };
  return Object.freeze({
    kind,
    featureId: String(id),
    label: featureLabel(normalized),
    reference: featureReference(normalized),
    color: properties.color ? String(properties.color) : null,
    isTbd: Boolean(properties.is_tbd),
    style: simplestyle(properties),
    parts: Object.freeze(geometryParts(feature?.geometry)),
  });
}

function simplestyle(properties) {
  const style = {};
  for (const key of SIMPLESTYLE_KEYS) {
    if (properties[key] !== undefined && properties[key] !== null)
      style[key] = properties[key];
  }
  return Object.freeze(style);
}

/**
 * Expand a geometry exactly like GeoJsonDataSource's handlers: multi-part
 * and collection members become separate parts, in source order.
 * @param {object|null|undefined} geometry
 * @returns {CablePart[]}
 */
export function geometryParts(geometry) {
  if (!geometry || typeof geometry !== 'object') return [];
  const coordinates = geometry.coordinates;
  switch (geometry.type) {
    case 'Point':
      return [{ type: 'point', coordinates }];
    case 'MultiPoint':
      return listOf(coordinates).map((point) => ({
        type: 'point',
        coordinates: point,
      }));
    case 'LineString':
      return [{ type: 'line', coordinates }];
    case 'MultiLineString':
      return listOf(coordinates).map((line) => ({
        type: 'line',
        coordinates: line,
      }));
    case 'Polygon':
      return [{ type: 'polygon', rings: coordinates }];
    case 'MultiPolygon':
      return listOf(coordinates).map((rings) => ({ type: 'polygon', rings }));
    case 'GeometryCollection':
      return listOf(geometry.geometries).flatMap(geometryParts);
    default:
      throw new TypeError(`Unknown geometry type: ${geometry.type}`);
  }
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * The cached, parsed source: both collections plus the source's feature
 * count. The raw JSON is not retained.
 * @param {{cables:object, landingPoints:object}} payload Source fetch result.
 * @returns {{cables:CableFeatureRecord[], landings:CableFeatureRecord[], count:number}}
 */
export function buildCableModel({ cables, landingPoints }) {
  if (
    !Array.isArray(cables?.features) ||
    !Array.isArray(landingPoints?.features)
  ) {
    throw new TypeError(
      'A cable source must return cables and landingPoints GeoJSON collections',
    );
  }
  const cableRecords = buildCableFeatureRecords(cables, 'cable');
  const landingRecords = buildCableFeatureRecords(landingPoints, 'landing');
  return Object.freeze({
    cables: Object.freeze(cableRecords),
    landings: Object.freeze(landingRecords),
    count: cableRecords.length + landingRecords.length,
  });
}
