/**
 * Mission facts for Orbit Witness. Every number cites its publisher. Swath
 * and altitude are nominal design values, not per-pass measurements.
 */
const ESA_S2_MISSION = 'https://sentiwiki.copernicus.eu/web/s2-mission';
const USGS_LANDSAT_8 = 'https://www.usgs.gov/landsat-missions/landsat-8';
const USGS_LANDSAT_9 = 'https://www.usgs.gov/landsat-missions/landsat-9';
const NASA_ISS = 'https://www.nasa.gov/international-space-station/';

const sentinel2 = (id, label, norad, extra = {}) =>
  Object.freeze({
    id,
    label,
    norad,
    family: 'sentinel-2',
    imaging: true,
    swathKm: 290,
    altitudeKm: 786,
    stacPlatform: id,
    planSatellite: label.replace('Sentinel-', 'S'),
    hlsProduct: 'S30',
    factSource: Object.freeze({
      // i18n-ignore: source credit, a proper name
      label: 'ESA SentiWiki, Sentinel-2 mission',
      url: ESA_S2_MISSION,
    }),
    ...extra,
  });

const landsat = (id, label, norad, url) =>
  Object.freeze({
    id,
    label,
    norad,
    family: 'landsat',
    imaging: true,
    swathKm: 185,
    altitudeKm: 705,
    stacPlatform: id,
    planSatellite: null,
    hlsProduct: 'L30',
    // i18n-ignore: source credit, a proper name
    factSource: Object.freeze({ label: `USGS, ${label} mission`, url }),
  });

/** The six spacecraft Orbit Witness predicts. The ISS carries no open imaging product here. */
export const ORBIT_WITNESS_MISSIONS = Object.freeze([
  // ESA runs Sentinel-2A in a temporary extension campaign, announced to the end of 2026.
  sentinel2('sentinel-2a', 'Sentinel-2A', 40697, { campaign: 'extension' }),
  sentinel2('sentinel-2b', 'Sentinel-2B', 42063),
  sentinel2('sentinel-2c', 'Sentinel-2C', 60989),
  landsat('landsat-8', 'Landsat 8', 39084, USGS_LANDSAT_8),
  landsat('landsat-9', 'Landsat 9', 49260, USGS_LANDSAT_9),
  Object.freeze({
    id: 'iss',
    // i18n-ignore: spacecraft name
    label: 'ISS',
    norad: 25544,
    family: 'iss',
    imaging: false,
    swathKm: null,
    altitudeKm: null,
    stacPlatform: null,
    planSatellite: null,
    hlsProduct: null,
    // i18n-ignore: source credit, a proper name
    factSource: Object.freeze({ label: 'NASA, ISS', url: NASA_ISS }),
  }),
]);

export function missionById(id) {
  return ORBIT_WITNESS_MISSIONS.find((mission) => mission.id === id) || null;
}

export function missionByNorad(norad) {
  return (
    ORBIT_WITNESS_MISSIONS.find((mission) => mission.norad === norad) || null
  );
}

/** Map a STAC platform string ("sentinel-2b", "landsat-9") to a mission. */
export function missionByPlatform(platform) {
  const value = typeof platform === 'string' ? platform.toLowerCase() : '';
  return (
    ORBIT_WITNESS_MISSIONS.find((mission) => mission.stacPlatform === value) ||
    null
  );
}
