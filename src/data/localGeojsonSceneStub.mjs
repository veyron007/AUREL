/**
 * Test support for the local GeoJSON layers: the parts of a Cesium Scene the
 * primitive renderer touches (src/data/localGeojsonPrimitives.js), without
 * WebGL. Collections destroy what they remove, like scene.primitives.
 */
import * as Cesium from 'cesium';

/** A scene.primitives-like collection that records what it holds. */
export function primitiveCollectionStub({ rejectAdd = false } = {}) {
  const items = [];
  return {
    items,
    add(primitive) {
      if (rejectAdd) throw new Error('scene rejected the primitives');
      items.push(primitive);
      return primitive;
    },
    remove(primitive) {
      const index = items.indexOf(primitive);
      if (index < 0) return false;
      items.splice(index, 1);
      if (!primitive.isDestroyed?.()) primitive.destroy?.();
      return true;
    },
    contains: (primitive) => items.includes(primitive),
  };
}

/**
 * Scene members the renderer needs: primitive collections plus the clamping
 * hooks a BillboardCollection with a scene calls for ground-clamped pins.
 */
export function localSceneStub({ rejectAdd = false } = {}) {
  return {
    primitives: primitiveCollectionStub({ rejectAdd }),
    groundPrimitives: primitiveCollectionStub(),
    frameState: { mode: Cesium.SceneMode.SCENE3D },
    updateHeight: () => () => {},
    getHeight: () => undefined,
  };
}

/** A pin image a Node test can hand to the renderer (no canvas). */
export const stubPinImage = () => 'data:image/png;base64,';

/** A stem material stand-in: Cesium materials need DOM classes Node lacks. */
export const stubStemMaterial = () => ({ type: 'Color', destroy() {} });

/** Layer options that keep the renderer off the DOM in Node tests. */
export const NODE_RENDER_OPTIONS = Object.freeze({
  pinImage: stubPinImage,
  stemMaterial: stubStemMaterial,
});

/**
 * The layer's drawn records, from the collections it added to the scene.
 * @returns {{carrier: object, stem: Cesium.Polyline, point: Cesium.PointPrimitive}[]}
 */
export function renderedRecords(scene) {
  const root = scene.primitives.items[0];
  if (!root) return [];
  const stems = root.get(0);
  const tips = root.get(2);
  return Array.from({ length: tips.length }, (_, i) => ({
    carrier: tips.get(i).id,
    stem: stems.get(i),
    point: tips.get(i),
  }));
}

/** Whether no primitive of the layer is left in either scene collection. */
export function sceneIsEmpty(scene) {
  return (
    scene.primitives.items.length === 0 &&
    scene.groundPrimitives.items.length === 0
  );
}
