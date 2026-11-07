/**
 * The polar DEM grid exchanged between the sampler (server) and the
 * ray-march (browser worker or Node). Heights are Int16 metres, little
 * endian, base64; -32768 marks a void.
 */
import {
  AZIMUTH_COUNT,
  AZIMUTH_STEP_DEG,
  DEM_SOURCE_ID,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
} from './constants.js';
import { radialDistances } from './geodesy.js';

export const GRID_VERSION = 1;
const CHUNK = 0x8000;

export function int16ToBase64(values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  let text = '';
  for (let i = 0; i < bytes.length; i += CHUNK)
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(text);
}

export function base64ToInt16(text, expectedLength) {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024)
    throw new Error('Invalid horizon grid.');
  const binary = atob(text);
  if (binary.length !== expectedLength * 2)
    throw new Error('Invalid horizon grid.');
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++)
    view.setUint8(i, binary.charCodeAt(i));
  const values = new Int16Array(expectedLength);
  for (let i = 0; i < expectedLength; i++)
    values[i] = view.getInt16(i * 2, true);
  return values;
}

const finite = (value, min, max) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const shortText = (value, max = 600) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/**
 * Validate a sampler payload and return `{ grid, meta }`. Distances must be
 * exactly the shared radial schedule for the stated radius, so a payload
 * cannot smuggle in its own geometry.
 */
export function decodeGridPayload(payload) {
  const fail = () => {
    throw new Error('Invalid horizon terrain response.');
  };
  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.version !== GRID_VERSION
  )
    fail();
  const { observer, radiusM, source } = payload;
  if (
    !observer ||
    !finite(observer.lat, -85, 85) ||
    !finite(observer.lon, -180, 180) ||
    !(observer.groundM === null || finite(observer.groundM, -500, 9000)) ||
    !finite(radiusM, MIN_RADIUS_KM * 1000, MAX_RADIUS_KM * 1000) ||
    payload.azimuthStepDeg !== AZIMUTH_STEP_DEG ||
    payload.azimuthCount !== AZIMUTH_COUNT ||
    !Number.isSafeInteger(payload.voidSamples) ||
    payload.voidSamples < 0 ||
    !Array.isArray(payload.absentTiles) ||
    payload.absentTiles.length > 64 ||
    !payload.absentTiles.every((name) => shortText(name, 80)) ||
    !Array.isArray(payload.levels) ||
    payload.levels.length > 8 ||
    !shortText(payload.sampling) ||
    !source ||
    source.id !== DEM_SOURCE_ID ||
    !shortText(source.label) ||
    !shortText(source.attribution) ||
    !shortText(source.license) ||
    !shortText(source.link) ||
    !shortText(source.applicableTime, 120) ||
    !(
      source.retrievedAt === null ||
      Number.isFinite(Date.parse(source.retrievedAt))
    ) ||
    !Array.isArray(source.tiles) ||
    source.tiles.length > 64
  )
    fail();
  const distances = radialDistances(radiusM);
  if (
    !Array.isArray(payload.distancesM) ||
    payload.distancesM.length !== distances.length ||
    payload.distancesM.some((value, index) => value !== distances[index])
  )
    fail();
  const heights = base64ToInt16(
    payload.heights,
    AZIMUTH_COUNT * distances.length,
  );
  return {
    grid: { heights, distances },
    meta: {
      observer: { ...observer },
      radiusM,
      voidSamples: payload.voidSamples,
      absentTiles: [...payload.absentTiles],
      levels: payload.levels.map((level) => ({ ...level })),
      sampling: payload.sampling,
      source: {
        id: source.id,
        label: source.label,
        attribution: source.attribution,
        license: source.license,
        link: source.link,
        applicableTime: source.applicableTime,
        retrievedAt: source.retrievedAt,
        tiles: source.tiles.map((tile) => ({ ...tile })),
      },
    },
  };
}
