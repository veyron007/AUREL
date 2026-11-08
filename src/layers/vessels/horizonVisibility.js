import * as Cesium from 'cesium';
import {
  buildHorizonCells,
  classifyHorizonCells,
  HORIZON_HIDDEN,
  HORIZON_TEST,
} from './horizonCells.js';

const ELLIPSOID = Cesium.Ellipsoid.WGS84;

/**
 * Per-cell horizon visibility for the vessel records (horizonCells.js).
 *
 * `prepare` rebuilds the cell index only when the record list or a vessel's
 * horizon point changed; `classify` runs once per visibility pass; `isVisible`
 * answers per record from the cell verdict, falling back to the occluder's
 * own test for records in a cell the horizon crosses. The pass allocates
 * nothing: verdicts live in a reused byte array and the camera in scratch.
 */
export function createHorizonVisibility() {
  let index = null;
  let builtFor = null;
  let builtVersion = -1;
  let verdicts = new Uint8Array(0);
  let classified = false;
  const cameraScaled = new Cesium.Cartesian3();
  const pointScaled = new Cesium.Cartesian3();

  /** Scaled-space horizon points for the records, exactly as Cesium scales. */
  function scaledPoints(records, getVisual) {
    const scaled = new Float64Array(records.length * 3);
    for (let i = 0; i < records.length; i++) {
      const point = getVisual(records[i]).surfacePosition;
      if (!point) continue;
      ELLIPSOID.transformPositionToScaledSpace(point, pointScaled);
      scaled[i * 3] = pointScaled.x;
      scaled[i * 3 + 1] = pointScaled.y;
      scaled[i * 3 + 2] = pointScaled.z;
    }
    return scaled;
  }

  return {
    /**
     * @param {ReadonlyArray<{lat: number, lon: number}>} records
     * @param {(record: object) => {surfacePosition?: Cesium.Cartesian3}} getVisual
     * @param {number} version Bumped whenever any horizon point is rewritten.
     */
    prepare(records, getVisual, version) {
      if (records === builtFor && version === builtVersion) return;
      index = buildHorizonCells({
        count: records.length,
        scaled: scaledPoints(records, getVisual),
        readLatLon: (i, out) => {
          out.lat = records[i].lat;
          out.lon = records[i].lon;
        },
        hasPoint: (i) => Boolean(getVisual(records[i]).surfacePosition),
      });
      if (verdicts.length < records.length)
        verdicts = new Uint8Array(records.length);
      builtFor = records;
      builtVersion = version;
    },

    /**
     * Classify every cell for this camera; without a camera every record
     * reads visible, as the per-vessel test did without an occluder.
     * @param {?Cesium.Cartesian3} cameraPositionWC
     */
    classify(cameraPositionWC) {
      classified = Boolean(cameraPositionWC && index);
      if (!classified) return null;
      ELLIPSOID.transformPositionToScaledSpace(cameraPositionWC, cameraScaled);
      return classifyHorizonCells(
        index,
        cameraScaled.x,
        cameraScaled.y,
        cameraScaled.z,
        verdicts,
      );
    },

    /**
     * Whether record `i` of the prepared list is in front of the horizon.
     * @param {number} i
     * @param {?Cesium.Cartesian3} surfacePosition
     * @param {?Cesium.EllipsoidalOccluder} occluder
     */
    isVisible(i, surfacePosition, occluder) {
      if (!classified || !surfacePosition || !occluder) return true;
      const verdict = verdicts[i];
      if (verdict === HORIZON_TEST)
        return occluder.isPointVisible(surfacePosition);
      return verdict !== HORIZON_HIDDEN;
    },
  };
}
