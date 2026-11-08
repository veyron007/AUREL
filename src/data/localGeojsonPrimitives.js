import * as Cesium from 'cesium';

/**
 * Draw a local GeoJSON layer with batched primitives instead of Entities.
 *
 * Every visual mirrors what GeoJsonDataSource plus the layer's stem setup drew:
 *  - stems: one PolylineCollection, width 3.5, the base colour (was a
 *    PolylineGraphics per entity);
 *  - tips: one PointPrimitiveCollection, 10 px, black 2 px outline, never
 *    depth-tested (was a PointGraphics per entity);
 *  - Point-feature pins: one BillboardCollection bound to the scene, an 8 px
 *    PinBuilder pin in the base colour, bottom origin, clamped to ground;
 *  - polygon footprints: GroundPrimitives with per-instance colour (alpha 0.3)
 *    and show, PolygonGeometry with RHUMB arcs, batched like Cesium's
 *    StaticGroundGeometryColorBatch (an instance joins the first batch whose
 *    rectangles it does not overlap, so overlapping footprints still blend);
 *    outlines are unsupported on clamped polygons, so none are drawn;
 *  - LineString parts: one GroundPolylinePrimitive, width 2, stroke colour.
 * Each pick object (instance id / primitive id) is the record's carrier.
 * Every visual starts hidden; the layer's first visibility walk (the first
 * preRender after enable, before anything is drawn) shows the records the
 * globe LOD admits. Starting hidden means per-instance attribute accessors,
 * which Cesium caches per instance for good, exist only for footprints that
 * were ever shown, not for the thousands the LOD keeps hidden. GroundPrimitive
 * per-instance attributes exist only once the primitive is ready, so show
 * changes made before that are applied by `maintain()`.
 */

export const LOCAL_STEM_WIDTH_PX = 3.5;
export const LOCAL_TIP_PIXEL_SIZE = 10;
export const LOCAL_TIP_OUTLINE_WIDTH_PX = 2;
export const LOCAL_PIN_SIZE_PX = 8;
export const LOCAL_FOOTPRINT_ALPHA = 0.3;
export const LOCAL_LINE_WIDTH_PX = 2;

let sharedPinBuilder = null;

/**
 * One Color material shared by every stem. Polyline#_destroy destroys its
 * material, so each stem would destroy the shared one again (a DeveloperError
 * after the first). A Color material owns no textures or GPU objects, so its
 * destroy is made a no-op for this shared instance.
 * @param {Cesium.Color} color
 * @returns {Cesium.Material}
 */
export function defaultLocalStemMaterial(color) {
  const material = Cesium.Material.fromType(Cesium.Material.ColorType, {
    color,
  });
  material.destroy = () => undefined;
  return material;
}

/** PinBuilder draws on a canvas; created on first use, never at import. */
export function defaultLocalPinImage(color, size) {
  sharedPinBuilder ??= new Cesium.PinBuilder();
  return sharedPinBuilder.fromColor(color, size);
}

function polygonHierarchy(rings) {
  const [outer, ...holes] = rings;
  return new Cesium.PolygonHierarchy(
    outer,
    holes.map((hole) => new Cesium.PolygonHierarchy(hole)),
  );
}

function footprintInstance(carrier, rings, fillAttribute) {
  return new Cesium.GeometryInstance({
    id: carrier,
    geometry: new Cesium.PolygonGeometry({
      polygonHierarchy: polygonHierarchy(rings),
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      arcType: Cesium.ArcType.RHUMB,
    }),
    attributes: {
      show: new Cesium.ShowGeometryInstanceAttribute(false),
      color: fillAttribute,
    },
  });
}

/** Cesium's StaticGroundGeometryColorBatch placement: first non-overlapping batch. */
function batchFootprints(footprints) {
  const batches = [];
  for (const footprint of footprints) {
    const rectangle = footprint.instance.geometry.rectangle;
    let batch = batches.find((item) => !item.checker.collides(rectangle));
    if (!batch) {
      batch = { checker: new Cesium.RectangleCollisionChecker(), items: [] };
      batches.push(batch);
    }
    batch.checker.insert(String(batch.items.length), rectangle);
    batch.items.push(footprint);
  }
  return batches;
}

function createGroundPrimitive(batch) {
  return new Cesium.GroundPrimitive({
    asynchronous: true,
    geometryInstances: batch.items.map((item) => item.instance),
    classificationType: Cesium.ClassificationType.BOTH,
  });
}

function createLinePrimitive(lines, strokeColor) {
  const color = Cesium.ColorGeometryInstanceAttribute.fromColor(strokeColor);
  return new Cesium.GroundPolylinePrimitive({
    asynchronous: true,
    appearance: new Cesium.PolylineColorAppearance(),
    classificationType: Cesium.ClassificationType.BOTH,
    geometryInstances: lines.map(
      ({ carrier, positions }) =>
        new Cesium.GeometryInstance({
          id: carrier,
          geometry: new Cesium.GroundPolylineGeometry({
            positions,
            width: LOCAL_LINE_WIDTH_PX,
            arcType: Cesium.ArcType.RHUMB,
          }),
          attributes: { color },
        }),
    ),
  });
}

/**
 * Drop the creation-time geometry a ready GroundPrimitive still references.
 * GroundPrimitive and its ClassificationPrimitive keep the shadow-volume
 * instances (PolygonGeometry, hierarchy positions, ellipsoid clones) in their
 * private creation options after the GPU buffers exist, and only read them
 * while creating the inner primitive, which happens once. Clearing them frees
 * roughly ten megabytes for the bundled datacenters. Guarded: a Cesium that
 * renames these fields keeps working, it just keeps the memory.
 * @returns {boolean} Whether the primitive was ready (and is now released).
 */
function releaseCreationGeometry(primitive) {
  if (!primitive.ready) return false;
  const options = primitive._classificationPrimitiveOptions;
  if (options) options.geometryInstances = undefined;
  const inner = primitive._primitive?._primitiveOptions;
  if (inner) inner.geometryInstances = undefined;
  return true;
}

/** Remove a primitive from a scene collection and free it exactly once. */
function releasePrimitive(collection, primitive) {
  try {
    collection?.remove?.(primitive);
  } finally {
    if (!primitive.isDestroyed()) primitive.destroy();
  }
}

/**
 * Apply a visibility to one footprint, now if its primitive is ready.
 * @returns {boolean} Whether the value reached the GPU attribute.
 */
function writeFootprintShow(footprint, visible) {
  const primitive = footprint.batchPrimitive;
  if (!primitive?.ready) return false;
  const attributes = primitive.getGeometryInstanceAttributes(footprint.carrier);
  if (!attributes) return false;
  attributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(
    visible,
    attributes.show,
  );
  return true;
}

/**
 * Build the renderer for one enable cycle. Nothing is in the scene until
 * `attach()`; `destroy()` removes and frees every primitive.
 * @param {object} options
 * @param {Cesium.Scene} options.scene Scene that owns the collections.
 * @param {Cesium.Color} options.color Base colour.
 * @param {function(Cesium.Color, number):(HTMLCanvasElement|string)} [options.pinImage]
 *   Pin image factory (test seam; Node has no canvas).
 * @param {string} [options.pinImageId] Atlas key shared by every pin.
 * @param {function(Cesium.Color):Cesium.Material} [options.stemMaterial]
 *   Shared stem material factory (test seam; Cesium materials need a DOM).
 */
export function createLocalGeojsonPrimitives({
  scene,
  color,
  pinImage = defaultLocalPinImage,
  pinImageId = `local-geojson-pin:${color.toCssHexString()}`,
  stemMaterial: createStemMaterial = defaultLocalStemMaterial,
}) {
  const root = new Cesium.PrimitiveCollection();
  const ground = new Cesium.PrimitiveCollection();
  const stems = root.add(new Cesium.PolylineCollection());
  const pins = root.add(new Cesium.BillboardCollection({ scene }));
  const tips = root.add(new Cesium.PointPrimitiveCollection());
  const stemMaterial = createStemMaterial(color);
  const fillAttribute = Cesium.ColorGeometryInstanceAttribute.fromColor(
    color.withAlpha(LOCAL_FOOTPRINT_ALPHA),
  );
  const footprints = [];
  const footprintByCarrier = new Map();
  const lines = [];
  const pendingShows = new Set();
  /** Ground primitives whose creation geometry is not released yet. */
  const unreleased = new Set();
  let pinCanvas = null;
  let attached = false;
  let destroyed = false;

  function addStemVisual({ carrier, base, tip }) {
    const stem = stems.add({
      positions: [Cesium.Cartesian3.clone(base), Cesium.Cartesian3.clone(tip)],
      width: LOCAL_STEM_WIDTH_PX,
      material: stemMaterial,
      id: carrier,
      show: false,
    });
    const point = tips.add({
      position: tip,
      pixelSize: LOCAL_TIP_PIXEL_SIZE,
      color,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: LOCAL_TIP_OUTLINE_WIDTH_PX,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      id: carrier,
      show: false,
    });
    return { stem, point, pin: null };
  }

  function addPin(carrier, position) {
    pinCanvas ??= pinImage(color, LOCAL_PIN_SIZE_PX);
    const pin = pins.add({
      position,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      id: carrier,
      show: false,
    });
    pin.setImage(pinImageId, pinCanvas);
    return pin;
  }

  function addFootprint(carrier, rings) {
    const footprint = {
      carrier,
      instance: footprintInstance(carrier, rings, fillAttribute),
      batchPrimitive: null,
    };
    footprints.push(footprint);
    footprintByCarrier.set(carrier, footprint);
  }

  function buildGroundPrimitives() {
    for (const batch of batchFootprints(footprints)) {
      const primitive = ground.add(createGroundPrimitive(batch));
      unreleased.add(primitive);
      for (const item of batch.items) {
        item.batchPrimitive = primitive;
        item.instance = null; // the primitive owns (and releases) the geometry
      }
    }
    if (lines.length) ground.add(createLinePrimitive(lines, color));
  }

  return {
    /**
     * Add a record's stem, tip, and its pin (Point) or footprint (polygon).
     * @param {object} record {carrier, base, tip, rings?, isPoint}
     * @returns {{stem: Cesium.Polyline, point: Cesium.PointPrimitive, pin: Cesium.Billboard|null}}
     */
    addRecord(record) {
      const visual = addStemVisual(record);
      if (record.isPoint) visual.pin = addPin(record.carrier, record.base);
      if (record.rings) addFootprint(record.carrier, record.rings);
      return visual;
    },

    /** Add a clamped ground line (LineString part) with a pickable carrier. */
    addLine(carrier, positions) {
      lines.push({ carrier, positions });
    },

    /** Batch the footprints and put every collection in the scene. */
    attach() {
      if (attached || destroyed) return;
      buildGroundPrimitives();
      // Marked first: if the second add throws, destroy() still removes
      // whatever the scene already accepted.
      attached = true;
      scene.primitives.add(root);
      scene.groundPrimitives.add(ground);
    },

    /** Move a record's stem and tip; the polyline gets fresh endpoints. */
    setStem(visual, base, tip) {
      visual.stem.positions = [
        Cesium.Cartesian3.clone(base),
        Cesium.Cartesian3.clone(tip),
      ];
      visual.point.position = tip;
    },

    /** Show or hide every visual of one record. */
    setVisible(visual, carrier, visible) {
      visual.stem.show = visible;
      visual.point.show = visible;
      if (visual.pin) visual.pin.show = visible;
      const footprint = footprintByCarrier.get(carrier);
      if (!footprint) return;
      if (writeFootprintShow(footprint, visible)) pendingShows.delete(carrier);
      else pendingShows.add(carrier);
    },

    /**
     * Apply footprint show changes queued while their primitive was building,
     * and release creation geometry of primitives that became ready.
     * @returns {number} Work still waiting on a primitive (0: nothing left).
     */
    maintain() {
      for (const carrier of pendingShows) {
        if (writeFootprintShow(footprintByCarrier.get(carrier), carrier.show))
          pendingShows.delete(carrier);
      }
      for (const primitive of unreleased) {
        if (releaseCreationGeometry(primitive)) unreleased.delete(primitive);
      }
      return pendingShows.size + unreleased.size;
    },

    /** Work still waiting on a ground primitive to become ready. */
    get pending() {
      return pendingShows.size + unreleased.size;
    },

    /** Remove every collection from the scene and free its GPU resources. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pendingShows.clear();
      unreleased.clear();
      footprintByCarrier.clear();
      footprints.length = 0;
      lines.length = 0;
      try {
        releasePrimitive(attached ? scene.primitives : null, root);
      } finally {
        releasePrimitive(attached ? scene.groundPrimitives : null, ground);
      }
    },
  };
}
