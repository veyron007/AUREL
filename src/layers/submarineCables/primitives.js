import * as Cesium from 'cesium';
import {
  CABLE_LINE_ALPHA,
  CABLE_LINE_WIDTH_PX,
  CABLE_PIN_SIZE_PX,
  CABLE_PICK_PREFIX,
  LANDING_LINE_ALPHA,
  LANDING_LINE_WIDTH_PX,
  CABLE_POLYGON_ALPHA,
  LANDING_POLYGON_ALPHA,
} from './policy.js';

/**
 * Cesium primitives for one enable cycle of the cable layer. Replaces the
 * three GeoJsonDataSources and their ~6,500 entities with:
 *  - one GroundPolylinePrimitive for every cable segment (per-instance
 *    colour and show, the same RHUMB/9,999 m geometry the entity path built),
 *  - one ground-clamped BillboardCollection for landing pins (the GeoJSON
 *    default PinBuilder marker, 6 px),
 *  - one PolylineCollection for the reference stems and one
 *    PointPrimitiveCollection for their tips, so a stem re-size rewrites one
 *    line instead of rebuilding a batched entity primitive.
 * Every pickable object carries a string key; `picks` maps it to the record.
 * Only the rare non-default geometries (landing lines, polygons) get their
 * own ground primitives.
 */

const PIN_SIZES = Object.freeze({ small: 24, medium: 48, large: 64 });
const RHUMB_GRANULARITY_M = 9999;
let sharedPinBuilder = null;

/** PinBuilder draws on a canvas; created on first use, never at import. */
export function defaultCablePinImage(color, size) {
  sharedPinBuilder ??= new Cesium.PinBuilder();
  return sharedPinBuilder.fromColor(color, size);
}

/**
 * A shared Color material for one stem colour. PolylineCollection destroys
 * the material of each removed polyline, so the shared one ignores destroy:
 * a Color material owns no GPU objects.
 * @param {Cesium.Color} color
 * @returns {Cesium.Material}
 */
export function defaultCableStemMaterial(color) {
  const material = Cesium.Material.fromType(Cesium.Material.ColorType, {
    color,
  });
  material.destroy = () => undefined;
  return material;
}

/** GeoJSON's default CRS: degrees, height 0 when absent. */
function toCartesian(coordinates) {
  return Cesium.Cartesian3.fromDegrees(
    Number(coordinates[0]),
    Number(coordinates[1]),
    Number.isFinite(Number(coordinates[2])) ? Number(coordinates[2]) : 0,
  );
}

function lineInstance(key, coordinates, width, color, visible) {
  return new Cesium.GeometryInstance({
    id: key,
    geometry: new Cesium.GroundPolylineGeometry({
      positions: coordinates.map(toCartesian),
      width,
      arcType: Cesium.ArcType.RHUMB,
      granularity: RHUMB_GRANULARITY_M,
    }),
    attributes: {
      color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
      show: new Cesium.ShowGeometryInstanceAttribute(visible),
      // The entity path always sent this (default, never-culling) attribute.
      // It changes the shadow-volume shader variant, and without it the
      // lines rasterize about one pixel thinner — keep it for identical look.
      distanceDisplayCondition:
        Cesium.DistanceDisplayConditionGeometryInstanceAttribute.fromDistanceDisplayCondition(
          new Cesium.DistanceDisplayCondition(),
        ),
    },
  });
}

function polygonInstance(key, rings, color, visible) {
  const [outer = [], ...holes] = rings || [];
  return new Cesium.GeometryInstance({
    id: key,
    geometry: new Cesium.PolygonGeometry({
      polygonHierarchy: new Cesium.PolygonHierarchy(
        outer.map(toCartesian),
        holes.map((hole) => new Cesium.PolygonHierarchy(hole.map(toCartesian))),
      ),
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      arcType: Cesium.ArcType.RHUMB,
    }),
    attributes: {
      color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
      show: new Cesium.ShowGeometryInstanceAttribute(visible),
    },
  });
}

/** Line colour/width for a part, after GeoJSON simplestyle and layer styling. */
export function cableLineStyle(feature, colors) {
  if (feature.kind === 'cable') {
    const base = feature.color
      ? Cesium.Color.fromCssColorString(feature.color)
      : colors.cableColor;
    return {
      color: base.withAlpha(CABLE_LINE_ALPHA),
      width: CABLE_LINE_WIDTH_PX,
    };
  }
  // Landing lines keep the GeoJSON defaults: the layer never restyled them.
  const style = feature.style;
  let color = style.stroke
    ? Cesium.Color.fromCssColorString(String(style.stroke))
    : colors.landingColor.withAlpha(LANDING_LINE_ALPHA);
  const opacity = Number(style['stroke-opacity']);
  if (style['stroke-opacity'] !== undefined && opacity !== 1)
    color = color.withAlpha(opacity);
  const width = Number(style['stroke-width']);
  return {
    color,
    width: Number.isFinite(width) ? width : LANDING_LINE_WIDTH_PX,
  };
}

function pinStyle(feature, colors) {
  const style = feature.style;
  const color = style['marker-color']
    ? Cesium.Color.fromCssColorString(String(style['marker-color']))
    : feature.kind === 'cable'
      ? colors.cableColor
      : colors.landingColor;
  const size = PIN_SIZES[style['marker-size']] ?? CABLE_PIN_SIZE_PX;
  return { color, size };
}

function polygonColor(feature, colors) {
  return feature.kind === 'cable'
    ? colors.cableColor.withAlpha(CABLE_POLYGON_ALPHA)
    : colors.landingColor.withAlpha(LANDING_POLYGON_ALPHA);
}

/**
 * Walk every drawable part with a stable key, in entity order. The same walk
 * rebuilds the cable line primitive on a classification change, so keys are
 * identical across rebuilds.
 * @param {{cables:object[], landings:object[]}} model
 * @param {function(object):void} visit
 */
export function walkCableParts(model, visit) {
  let serial = 0;
  for (const features of [model.cables, model.landings]) {
    for (const feature of features) {
      for (const part of feature.parts) {
        const key = `${CABLE_PICK_PREFIX}${serial++}`;
        if (feature.reference) visit({ key, feature, part });
      }
    }
  }
}

function createLinePrimitive(instances, classificationType) {
  if (!instances.length) return null;
  return new Cesium.GroundPolylinePrimitive({
    asynchronous: true,
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance(),
    classificationType,
  });
}

function createPolygonPrimitive(instances) {
  if (!instances.length) return null;
  return new Cesium.GroundPrimitive({
    asynchronous: true,
    geometryInstances: instances,
    classificationType: Cesium.ClassificationType.BOTH,
  });
}

/**
 * Drop the creation geometry a ready ground primitive still references in
 * its private creation options (only read while the inner primitive is
 * created, once). Guarded: a renamed field just keeps the memory.
 * @returns {boolean} Whether the primitive is ready (and now released).
 */
function releaseCreationGeometry(primitive) {
  if (!primitive?.ready) return false;
  if (primitive._primitiveOptions)
    primitive._primitiveOptions.geometryInstances = undefined;
  if (primitive._classificationPrimitiveOptions)
    primitive._classificationPrimitiveOptions.geometryInstances = undefined;
  return true;
}

function writeInstanceShow(primitive, key, visible) {
  if (!primitive?.ready) return false;
  const attributes = primitive.getGeometryInstanceAttributes(key);
  if (!attributes) return true; // no such instance: nothing to apply
  attributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(
    visible,
    attributes.show,
  );
  return true;
}

function removeAndDestroy(collection, primitive) {
  if (!primitive || primitive.isDestroyed?.()) return;
  try {
    collection?.remove?.(primitive);
  } finally {
    if (!primitive.isDestroyed()) primitive.destroy();
  }
}

export { createLinePrimitive, createPolygonPrimitive, lineInstance };
export {
  polygonInstance,
  pinStyle,
  polygonColor,
  releaseCreationGeometry,
  writeInstanceShow,
  removeAndDestroy,
};
