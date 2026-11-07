/** Fieldbook snapshot of one horizon result: rounded, bounded, self-describing. */
import { HORIZON_LABEL } from './constants.js';
import {
  roundAngle,
  roundAzimuth,
  roundKm,
  roundMetres,
  roundTime,
  wholeDegrees,
} from './envelope.js';

/** Class, unit and source of each saved group; fixed so a reader never guesses. */
export const HORIZON_SNAPSHOT_CLASSES = Object.freeze({
  'observer.groundM': 'observed · m · copernicus-glo30',
  'horizon.elevationDeg': 'derived · deg · copernicus-glo30',
  'horizon.distanceKm': 'derived · km · copernicus-glo30',
  'sun.astronomical*': 'modelled · time · local-ephemeris',
  'sun.terrain*': 'derived · time · copernicus-glo30+local-ephemeris',
  'sun.directSunMinutes': 'derived · min · copernicus-glo30+local-ephemeris',
  'moon.astronomicalRise': 'modelled · time · local-ephemeris',
  'moon.terrainRise': 'derived · time · copernicus-glo30+local-ephemeris',
  'shadow.sun*': 'modelled · deg · local-ephemeris',
  'shadow.shadow*': 'derived · m, deg · local-ephemeris',
  'peaks.demM': 'observed · m · copernicus-glo30',
  'peaks.osmEleM': 'note · m · osm-peaks',
  'peaks.azimuthDeg,distanceKm,apparentElevationDeg':
    'derived · deg, km · osm-peaks+copernicus-glo30',
});
export const HORIZON_SNAPSHOT_METHOD =
  'Kshitij DEM ray-march, refraction k = 0.13; NOAA solar and Almanac lunar ephemeris';

export function toHorizonSnapshot(
  result,
  { capturedAt = new Date().toISOString() } = {},
) {
  const shadow = result.shadow;
  return {
    version: 1,
    capturedAt,
    localDate: result.query.localDate,
    timeZone: result.query.timeZone,
    label: HORIZON_LABEL,
    method: HORIZON_SNAPSHOT_METHOD,
    refractionK: result.refractionK,
    observer: {
      lat: result.observer.lat,
      lon: result.observer.lon,
      groundM: roundMetres(result.observer.groundM),
      observerHeightM: result.query.observerHeightM,
    },
    horizon: {
      elevationDeg: wholeDegrees(result.horizon.elevationDeg, roundAngle),
      distanceKm: wholeDegrees(result.horizon.distanceM, roundKm),
    },
    sun: {
      astronomicalRise: roundTime(result.sun.astronomicalRise),
      astronomicalSet: roundTime(result.sun.astronomicalSet),
      terrainRise: roundTime(result.sun.terrainRise),
      terrainSet: roundTime(result.sun.terrainSet),
      directSunMinutes: result.sun.directSunMinutes,
    },
    moon: {
      astronomicalRise: roundTime(result.moon.astronomicalRise),
      terrainRise: roundTime(result.moon.terrainRise),
    },
    shadow: shadow
      ? {
          at: roundTime(shadow.at),
          sunAltitudeDeg: roundAngle(shadow.sunAltitudeDeg),
          sunAzimuthDeg: roundAzimuth(shadow.sunAzimuthDeg),
          sunlit: shadow.sunlit,
          gnomonM: shadow.gnomonM,
          shadowLengthM:
            shadow.shadowLengthM === null
              ? null
              : Math.round(shadow.shadowLengthM * 100) / 100,
          shadowAzimuthDeg: roundAzimuth(shadow.shadowAzimuthDeg),
        }
      : null,
    peaks: result.peaks.listed.map((row) => ({
      id: row.id,
      name: row.name,
      nameHi: row.nameHi,
      state: row.state,
      azimuthDeg: roundAzimuth(row.azimuthDeg),
      distanceKm: roundKm(row.distanceM),
      apparentElevationDeg: roundAngle(row.apparentElevationDeg),
      demM: roundMetres(row.demM),
      osmEleM: roundMetres(row.osmEleM),
    })),
    dem: {
      sourceId: result.dem.id,
      label: result.dem.label,
      attribution: result.dem.attribution,
      license: result.dem.license,
      link: result.dem.link,
      applicableTime: result.dem.applicableTime,
      retrievedAt: result.dem.retrievedAt,
      voidSamples: result.dem.voidSamples,
      absentTiles: result.dem.absentTiles.length,
      radiusKm: result.dem.radiusM / 1000,
    },
    peakSource: result.peaks.source
      ? {
          label: result.peaks.source.label,
          license: result.peaks.source.license,
          attribution: result.peaks.source.attribution,
          extractAt: result.peaks.source.extractAt,
        }
      : null,
    classes: { ...HORIZON_SNAPSHOT_CLASSES },
  };
}
