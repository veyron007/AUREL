// i18n-ignore-file: synthetic DEM fixtures
import { AZIMUTH_COUNT, AZIMUTH_STEP_DEG, DEM_SOURCE_ID } from './constants.js';
import { radialDistances } from './geodesy.js';
import { GRID_VERSION, int16ToBase64 } from './grid.js';

/** A sampler payload whose heights come from `height(azimuthDeg, distanceM)`. */
export function syntheticPayload({
  lat = 30.4597,
  lon = 78.1058,
  groundM = 0,
  radiusKm = 20,
  height = () => 0,
} = {}) {
  const distances = radialDistances(radiusKm * 1000);
  const n = distances.length;
  const heights = new Int16Array(AZIMUTH_COUNT * n);
  let voidSamples = 0;
  for (let ray = 0; ray < AZIMUTH_COUNT; ray++)
    for (let j = 0; j < n; j++) {
      const value = height(ray * AZIMUTH_STEP_DEG, distances[j]);
      heights[ray * n + j] = value;
      if (value === -32768) voidSamples++;
    }
  return {
    version: GRID_VERSION,
    observer: { lat, lon, groundM },
    radiusM: radiusKm * 1000,
    azimuthStepDeg: AZIMUTH_STEP_DEG,
    azimuthCount: AZIMUTH_COUNT,
    distancesM: distances,
    heights: int16ToBase64(heights),
    voidSamples,
    absentTiles: [],
    levels: [{ level: 0, fromM: 0, toM: radiusKm * 1000, resolutionArcSec: 1 }],
    sampling: 'synthetic test grid',
    source: {
      id: DEM_SOURCE_ID,
      // i18n-ignore: test fixture data
      label: 'Synthetic DEM',
      attribution: 'test fixture',
      license: 'test fixture',
      link: 'https://example.test/dem',
      applicableTime: 'fixture',
      retrievedAt: '2026-11-07T00:00:00.000Z',
      tiles: [],
    },
  };
}
