import * as Cesium from 'cesium';
import { clampLabel, createCableOverlayEntry } from './overlay.js';
import {
  CABLE_PICK_PREFIX,
  CABLE_REFERENCE_STYLE,
  CABLE_TIP_OUTLINE_ALPHA,
} from './policy.js';
import {
  cableLineStyle,
  createLinePrimitive,
  createPolygonPrimitive,
  defaultCablePinImage,
  defaultCableStemMaterial,
  lineInstance,
  pinStyle,
  polygonColor,
  polygonInstance,
  releaseCreationGeometry,
  removeAndDestroy,
  walkCableParts,
  writeInstanceShow,
} from './primitives.js';

const INITIAL_TIP_HEIGHT_M = 2500;

/**
 * Build the renderer for one enable cycle. Nothing is in the scene until
 * `attach()`; `destroy()` removes and frees every primitive.
 * @param {object} options
 * @param {Cesium.Scene} options.scene Scene that owns the collections.
 * @param {{cables:object[], landings:object[]}} options.model Parsed source.
 * @param {{cableColor:Cesium.Color, landingColor:Cesium.Color}} options.colors
 * @param {Cesium.ClassificationType} options.classificationType Cable lines.
 * @param {function(Cesium.Color, number):(HTMLCanvasElement|string)} [options.pinImage]
 * @param {function(Cesium.Color):Cesium.Material} [options.stemMaterial]
 */
export function createCableRenderer({
  scene,
  model,
  colors,
  classificationType,
  pinImage = defaultCablePinImage,
  stemMaterial = defaultCableStemMaterial,
}) {
  const root = new Cesium.PrimitiveCollection();
  const ground = new Cesium.PrimitiveCollection();
  const pins = root.add(
    new Cesium.BillboardCollection({
      scene,
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    }),
  );
  const stems = root.add(new Cesium.PolylineCollection());
  const tips = root.add(
    new Cesium.PointPrimitiveCollection({
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    }),
  );
  const picks = new Map();
  const surfaces = [];
  const surfaceByKey = new Map();
  const references = [];
  const pendingShows = new Set();
  const unreleased = new Set();
  const pinImages = new Map();
  const stemMaterials = new Map();
  const lineInstances = { cable: [], landing: [] };
  const polygonInstances = [];
  const primitives = { cableLines: null, landingLines: null, polygons: null };
  let attached = false;
  let destroyed = false;

  function pinFor(feature) {
    const { color, size } = pinStyle(feature, colors);
    const id = `cable-pin:${color.toCssHexString()}:${size}`;
    if (!pinImages.has(id)) pinImages.set(id, pinImage(color, size));
    return { id, image: pinImages.get(id) };
  }

  function addSurface({ key, feature, part }) {
    const info = Object.freeze({
      kind: feature.kind,
      reference: feature.reference,
      label: feature.label,
    });
    picks.set(key, info);
    const surface = {
      key,
      type: part.type,
      owner: feature.kind,
      base: Cesium.Cartesian3.fromDegrees(
        feature.reference.lon,
        feature.reference.lat,
        0,
      ),
      visible: true,
      pin: null,
    };
    if (part.type === 'point') addPin(surface, feature, part);
    else if (part.type === 'line') addLine(surface, feature, part);
    else
      polygonInstances.push(
        polygonInstance(key, part.rings, polygonColor(feature, colors), true),
      );
    surfaces.push(surface);
    surfaceByKey.set(key, surface);
  }

  function addPin(surface, feature, part) {
    const { id, image } = pinFor(feature);
    surface.pin = pins.add({
      position: Cesium.Cartesian3.fromDegrees(
        Number(part.coordinates[0]),
        Number(part.coordinates[1]),
        Number(part.coordinates[2]) || 0,
      ),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference:
        part.coordinates.length === 2
          ? Cesium.HeightReference.CLAMP_TO_GROUND
          : Cesium.HeightReference.NONE,
      id: surface.key,
    });
    surface.pin.setImage(id, image);
  }

  function addLine(surface, feature, part) {
    if (!Array.isArray(part.coordinates) || part.coordinates.length < 2) return;
    const { color, width } = cableLineStyle(feature, colors);
    const bucket = feature.kind === 'cable' ? 'cable' : 'landing';
    lineInstances[bucket].push({
      key: surface.key,
      coordinates: part.coordinates,
      color,
      width,
    });
  }

  function materialFor(color) {
    const id = color.toCssHexString();
    if (!stemMaterials.has(id)) stemMaterials.set(id, stemMaterial(color));
    return stemMaterials.get(id);
  }

  function addReference(feature) {
    const style = CABLE_REFERENCE_STYLE[feature.kind];
    const baseColor =
      feature.kind === 'cable' ? colors.cableColor : colors.landingColor;
    const { lon, lat } = feature.reference;
    const base = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const tip = Cesium.Cartesian3.fromDegrees(lon, lat, INITIAL_TIP_HEIGHT_M);
    const key = `${CABLE_PICK_PREFIX}ref:${references.length}`;
    const info = Object.freeze({
      kind: feature.kind,
      reference: feature.reference,
      label: feature.label,
      featureId: feature.featureId || null,
    });
    picks.set(key, info);
    const stemPositionBuffers = [
      [base, tip],
      [base, tip],
    ];
    const record = {
      id: `${feature.kind}-reference-${references.length}-${info.featureId || 'feature'}`,
      key,
      info,
      stem: stems.add({
        positions: stemPositionBuffers[0],
        width: style.stemWidthPx,
        material: materialFor(baseColor.withAlpha(style.stemAlpha)),
        id: key,
      }),
      point: tips.add({
        position: tip,
        pixelSize: style.tipPixelSize,
        color: baseColor.withAlpha(style.tipAlpha),
        outlineColor: Cesium.Color.BLACK.withAlpha(CABLE_TIP_OUTLINE_ALPHA),
        outlineWidth: 1,
        disableDepthTestDistance: 0,
        id: key,
      }),
      base,
      tip,
      nextTip: Cesium.Cartesian3.clone(tip),
      stemPositionBuffers,
      stemPositionBufferIndex: 0,
      reference: feature.reference,
      kind: feature.kind,
      label: clampLabel(feature.label),
      visible: false,
      distanceM: Infinity,
      entry: null,
    };
    record.entry = createCableOverlayEntry(record);
    references.push(record);
  }

  function buildLines(bucket, type) {
    const instances = lineInstances[bucket].map((line) =>
      lineInstance(
        line.key,
        line.coordinates,
        line.width,
        line.color,
        surfaceByKey.get(line.key)?.visible !== false,
      ),
    );
    const primitive = createLinePrimitive(instances, type);
    if (primitive) {
      ground.add(primitive);
      unreleased.add(primitive);
    }
    return primitive;
  }

  function buildModel() {
    const referenced = new Set();
    walkCableParts(model, (visit) => {
      addSurface(visit);
      if (referenced.has(visit.feature)) return;
      referenced.add(visit.feature);
      addReference(visit.feature);
    });
    primitives.cableLines = buildLines('cable', classificationType);
    primitives.landingLines = buildLines(
      'landing',
      Cesium.ClassificationType.BOTH,
    );
    primitives.polygons = createPolygonPrimitive(polygonInstances.splice(0));
    if (primitives.polygons) {
      ground.add(primitives.polygons);
      unreleased.add(primitives.polygons);
    }
  }

  function primitiveFor(surface) {
    if (surface.type === 'polygon') return primitives.polygons;
    return surface.owner === 'cable'
      ? primitives.cableLines
      : primitives.landingLines;
  }

  buildModel();

  return {
    picks,
    surfaces,
    references,

    /** Put every collection in the scene. */
    attach() {
      if (attached || destroyed) return;
      attached = true;
      scene.primitives.add(root);
      scene.groundPrimitives.add(ground);
    },

    /** Layer-level visibility (enabled state). */
    setShown(shown) {
      root.show = shown;
      ground.show = shown;
    },

    /** Show or hide one reference stem and its tip. */
    setReferenceVisible(record, visible) {
      record.stem.show = visible;
      record.point.show = visible;
    },

    /** Show or hide one drawn cable or landing part. */
    setSurfaceVisible(surface, visible) {
      surface.visible = visible;
      if (surface.pin) {
        surface.pin.show = visible;
        return;
      }
      if (writeInstanceShow(primitiveFor(surface), surface.key, visible))
        pendingShows.delete(surface);
      else pendingShows.add(surface);
    },

    /** Re-classify the cable ground lines: one primitive rebuild. */
    reclassify(type) {
      if (destroyed) return;
      const previous = primitives.cableLines;
      unreleased.delete(previous);
      removeAndDestroy(ground, previous);
      primitives.cableLines = buildLines('cable', type);
      for (const surface of surfaces)
        if (surface.owner === 'cable' && surface.type === 'line')
          pendingShows.delete(surface);
    },

    /**
     * Apply show changes queued while a ground primitive was building and
     * release the creation geometry of ground primitives that became ready.
     * @returns {number} Work still waiting on a primitive (0: nothing left).
     */
    maintain() {
      for (const surface of pendingShows) {
        if (
          writeInstanceShow(primitiveFor(surface), surface.key, surface.visible)
        )
          pendingShows.delete(surface);
      }
      for (const primitive of unreleased) {
        if (primitive.isDestroyed?.() || releaseCreationGeometry(primitive))
          unreleased.delete(primitive);
      }
      return pendingShows.size + unreleased.size;
    },

    /** Work still waiting on a ground primitive to become ready. */
    get pending() {
      return pendingShows.size + unreleased.size;
    },

    /** The ground primitive drawing the cable lines (null when none). */
    get cableLinePrimitive() {
      return primitives.cableLines;
    },

    /** Remove every collection from the scene and free its GPU resources. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pendingShows.clear();
      unreleased.clear();
      picks.clear();
      try {
        removeAndDestroy(attached ? scene.primitives : null, root);
      } finally {
        removeAndDestroy(attached ? scene.groundPrimitives : null, ground);
      }
    },
  };
}
