/**
 * Presentation of a horizon result: rounded to 1° and to the minute, and
 * every number tagged with unit, class, source and applicable time.
 */
import { AZIMUTH_STEP_DEG, HORIZON_LABEL } from './constants.js';

export const ENVELOPE_KIND = 'aurel.horizon';
export const SOURCE_IDS = Object.freeze({
  dem: 'copernicus-glo30',
  peaks: 'osm-peaks',
  ephemeris: 'local-ephemeris',
});
const DERIVED_SOURCE = `${SOURCE_IDS.dem}+${SOURCE_IDS.ephemeris}`;

/** Azimuth to a whole degree in [0, 360). */
export const roundAzimuth = (value) =>
  value === null || value === undefined ? null : Math.round(value) % 360;
export const roundAngle = (value) =>
  value === null || value === undefined ? null : Math.round(value * 10) / 10;
export const roundKm = (metres) =>
  metres === null || metres === undefined ? null : Math.round(metres / 100) / 10;
export const roundMetres = (value) =>
  value === null || value === undefined ? null : Math.round(value);
/** ISO instant to the nearest minute. */
export function roundTime(value) {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.round(ms / 60000) * 60000).toISOString();
}

/** One number with its unit, class, source and applicable time. */
export function quantity(value, unit, kind, source, applicableTime) {
  return { value, unit, class: kind, source, applicableTime };
}

/** Horizon at each whole degree (the ray exactly on that degree). */
export function wholeDegrees(values, map = (value) => value) {
  const step = Math.round(1 / AZIMUTH_STEP_DEG);
  return Array.from({ length: 360 }, (_, degree) => map(values[degree * step]));
}

function sources(result) {
  const list = [
    {
      id: SOURCE_IDS.dem,
      label: result.dem.label,
      license: result.dem.license,
      attribution: result.dem.attribution,
      link: result.dem.link,
      retrievedAt: result.dem.retrievedAt,
      applicableTime: result.dem.applicableTime,
    },
    {
      id: SOURCE_IDS.ephemeris,
      label: 'Local ephemeris',
      license: 'Computed on this device',
      attribution: null,
      link: null,
      retrievedAt: null,
      applicableTime: result.query.localDate,
      method: `${result.ephemeris.sun}; ${result.ephemeris.moon}`,
    },
  ];
  if (result.peaks.source)
    list.push({
      id: SOURCE_IDS.peaks,
      label: result.peaks.source.label,
      license: result.peaks.source.license,
      attribution: result.peaks.source.attribution,
      link: result.peaks.source.link,
      retrievedAt: result.peaks.source.retrievedAt,
      applicableTime: result.peaks.source.extractAt,
    });
  return list;
}

function peakRow(row, demTime, peakTime) {
  return {
    id: row.id,
    name: row.name,
    nameHi: row.nameHi,
    state: row.state,
    azimuthDeg: quantity(roundAzimuth(row.azimuthDeg), 'deg', 'derived', SOURCE_IDS.peaks, peakTime),
    distanceKm: quantity(roundKm(row.distanceM), 'km', 'derived', SOURCE_IDS.peaks, peakTime),
    apparentElevationDeg: quantity(
      roundAngle(row.apparentElevationDeg),
      'deg',
      'derived',
      SOURCE_IDS.dem,
      demTime,
    ),
    clearanceDeg: quantity(roundAngle(row.clearanceDeg), 'deg', 'derived', SOURCE_IDS.dem, demTime),
    demHeightM: quantity(roundMetres(row.demM), 'm', 'observed', SOURCE_IDS.dem, demTime),
    osmEleM: quantity(roundMetres(row.osmEleM), 'm', 'note', SOURCE_IDS.peaks, peakTime),
  };
}

/** The MCP and agent-facing provenance envelope. */
export function toProvenanceEnvelope(result) {
  const demTime = result.dem.applicableTime,
    day = result.query.localDate,
    peakTime = result.peaks.source?.extractAt ?? null;
  const time = (value, kind, source) =>
    quantity(roundTime(value), 'time', kind, source, day);
  const shadow = result.shadow;
  const shadowTime = shadow?.at ?? null;
  return {
    kind: ENVELOPE_KIND,
    version: 1,
    label: HORIZON_LABEL,
    method: result.method,
    refractionK: result.refractionK,
    computedAt: result.computedAt,
    query: { ...result.query, shadowAt: roundTime(result.query.shadowAt) },
    sources: sources(result),
    observer: {
      lat: result.observer.lat,
      lon: result.observer.lon,
      groundM: quantity(roundMetres(result.observer.groundM), 'm', 'observed', SOURCE_IDS.dem, demTime),
      eyeM: quantity(roundMetres(result.observer.eyeM), 'm', 'derived', SOURCE_IDS.dem, demTime),
    },
    horizon: {
      azimuthStepDeg: 1,
      elevationDeg: quantity(
        wholeDegrees(result.horizon.elevationDeg, roundAngle),
        'deg',
        'derived',
        SOURCE_IDS.dem,
        demTime,
      ),
      distanceKm: quantity(
        wholeDegrees(result.horizon.distanceM, roundKm),
        'km',
        'derived',
        SOURCE_IDS.dem,
        demTime,
      ),
    },
    sun: {
      astronomicalRise: time(result.sun.astronomicalRise, 'modelled', SOURCE_IDS.ephemeris),
      astronomicalSet: time(result.sun.astronomicalSet, 'modelled', SOURCE_IDS.ephemeris),
      terrainRise: time(result.sun.terrainRise, 'derived', DERIVED_SOURCE),
      terrainSet: time(result.sun.terrainSet, 'derived', DERIVED_SOURCE),
      directSunMinutes: quantity(result.sun.directSunMinutes, 'min', 'derived', DERIVED_SOURCE, day),
    },
    moon: {
      astronomicalRise: time(result.moon.astronomicalRise, 'modelled', SOURCE_IDS.ephemeris),
      astronomicalSet: time(result.moon.astronomicalSet, 'modelled', SOURCE_IDS.ephemeris),
      terrainRise: time(result.moon.terrainRise, 'derived', DERIVED_SOURCE),
      terrainSet: time(result.moon.terrainSet, 'derived', DERIVED_SOURCE),
    },
    shadow: shadow
      ? {
          at: roundTime(shadow.at),
          timeSource: 'entered on this device',
          sunAltitudeDeg: quantity(roundAngle(shadow.sunAltitudeDeg), 'deg', 'modelled', SOURCE_IDS.ephemeris, shadowTime),
          sunAzimuthDeg: quantity(roundAzimuth(shadow.sunAzimuthDeg), 'deg', 'modelled', SOURCE_IDS.ephemeris, shadowTime),
          terrainHorizonDeg: quantity(roundAngle(shadow.terrainHorizonDeg), 'deg', 'derived', SOURCE_IDS.dem, demTime),
          sunlit: shadow.sunlit,
          gnomonM: quantity(shadow.gnomonM, 'm', 'note', 'user', shadowTime),
          shadowLengthM: quantity(
            shadow.shadowLengthM === null ? null : Math.round(shadow.shadowLengthM * 100) / 100,
            'm',
            'derived',
            DERIVED_SOURCE,
            shadowTime,
          ),
          shadowAzimuthDeg: quantity(roundAzimuth(shadow.shadowAzimuthDeg), 'deg', 'derived', SOURCE_IDS.ephemeris, shadowTime),
        }
      : null,
    peaks: {
      counts: { ...result.peaks.counts },
      considered: result.peaks.considered,
      listed: result.peaks.listed.map((row) => peakRow(row, demTime, peakTime)),
    },
    dem: {
      voidSamples: quantity(result.dem.voidSamples, 'samples', 'observed', SOURCE_IDS.dem, demTime),
      absentTiles: [...result.dem.absentTiles],
      levels: result.dem.levels.map((level) => ({ ...level })),
      sampling: result.dem.sampling,
      radiusKm: result.dem.radiusM / 1000,
    },
    limits: [...result.limits],
  };
}
