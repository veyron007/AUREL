/**
 * Globe drawing for Orbit Witness: the predicted swath (modelled, dashed
 * brass outline) and, when a catalogued scene exists, its footprint
 * (observed, solid). Owns one data source; nothing else is touched.
 */
import * as Cesium from 'cesium';
import {
  registerDynamicCredit,
  ORBIT_WITNESS_CREDIT,
} from '../data/dataCredits.js';
import { governorRequestRender } from '../renderGovernor.js';

const BRASS = '#d6ab55';
const PETROL = '#7fc3c4';

function ringPositions(ring) {
  return Cesium.Cartesian3.fromDegreesArray(
    ring.flatMap(([lon, lat]) => [lon, lat]),
  );
}

export function createOrbitWitnessOverlay(viewer) {
  let source = null;
  let destroyed = false;
  async function ensure() {
    if (destroyed || !viewer?.dataSources) return null;
    if (!source) {
      source = new Cesium.CustomDataSource('orbit-witness');
      await viewer.dataSources.add(source);
    }
    return source;
  }
  return {
    /**
     * The panel names each shape's class; no Cesium label is drawn (world text
     * belongs to the world-overlay host).
     * @param {{ predicted?: Array<[number, number]>|null, observed?: Array<[number, number]>|null }} shapes
     */
    async show({ predicted = null, observed = null } = {}) {
      const target = await ensure();
      if (!target) return false;
      target.entities.removeAll();
      if (predicted?.length >= 4)
        target.entities.add({
          id: 'orbit-witness-predicted-swath',
          polyline: {
            positions: ringPositions(predicted),
            width: 2,
            clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString(BRASS),
              dashLength: 18,
            }),
          },
          polygon: {
            hierarchy: ringPositions(predicted),
            material: Cesium.Color.fromCssColorString(BRASS).withAlpha(0.08),
          },
        });
      if (observed?.length >= 4)
        target.entities.add({
          id: 'orbit-witness-observed-footprint',
          polyline: {
            positions: ringPositions(observed),
            width: 2,
            clampToGround: true,
            material: Cesium.Color.fromCssColorString(PETROL),
          },
        });
      registerDynamicCredit(viewer, ORBIT_WITNESS_CREDIT);
      governorRequestRender('orbit-witness');
      return true;
    },
    clear() {
      source?.entities.removeAll();
      governorRequestRender('orbit-witness');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (source && viewer?.dataSources && !viewer.isDestroyed?.())
        viewer.dataSources.remove(source, true);
      source = null;
    },
  };
}
