/** Kshitij horizon engine: fixed method constants, stated on every result. */

/** Terrestrial refraction coefficient used for the effective Earth radius. */
export const HORIZON_REFRACTION_K = 0.13;
/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6371008.8;
/** One ray every half degree: 720 rays around the observer. */
export const AZIMUTH_STEP_DEG = 0.5;
export const AZIMUTH_COUNT = 360 / AZIMUTH_STEP_DEG;
export const MIN_RADIUS_KM = 10;
export const MAX_RADIUS_KM = 200;
export const DEFAULT_RADIUS_KM = 200;
/** First sample distance and near-field spacing, metres. */
export const NEAR_STEP_M = 30;
export const FIRST_SAMPLE_M = 60;
/** Beyond the near field each step grows by this fraction of its distance. */
export const RADIAL_GROWTH = 0.01;
export const MAX_OBSERVER_HEIGHT_M = 500;
export const DEFAULT_OBSERVER_HEIGHT_M = 1.7;
/** Int16 sentinel for a sample with no DEM value. */
export const VOID_HEIGHT = -32768;
/** Every result carries this label; nothing here models trees, buildings or haze. */
export const HORIZON_LABEL = 'geometric visibility, terrain-only';
export const HORIZON_METHOD = `DEM ray-march, ${360 / AZIMUTH_STEP_DEG} rays at ${AZIMUTH_STEP_DEG}°, refraction k = ${HORIZON_REFRACTION_K}, Earth radius ${EARTH_RADIUS_M} m`;
/** Peaks within this elevation angle of the nearer terrain are "marginal". */
export const MARGINAL_DEG = 0.1;
export const MAX_LISTED_PEAKS = 20;
export const DEM_SOURCE_ID = 'copernicus-glo30';
