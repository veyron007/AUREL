import { distanceKm, finite, roundTo } from './geo.js';
import { assembleCard, quantity } from './verdict.js';

/**
 * "Two sensors": a VIIRS detection and a MODIS detection of the same place
 * within the window. VIIRS (375 m) resolves smaller fires than MODIS (1 km),
 * and the two families overpass at different times, so a one-sensor fire is
 * common and is not a contradiction.
 */
export const FIRE_TOLERANCES = Object.freeze({
  windowMin: 60,
  // MODIS pixels grow towards the swath edge; 2 km keeps one pixel's reach.
  distanceKm: 2,
});

/** FIRMS satellite field to a dependency-graph node, or null. */
export function fireNode(sensor, satellite) {
  const family = String(sensor || '').toUpperCase();
  const sat = String(satellite || '')
    .trim()
    .toUpperCase();
  if (family === 'VIIRS') {
    if (sat === 'N20' || sat === 'NOAA-20' || sat === '1')
      return 'firms-viirs-noaa20';
    if (sat === 'N21' || sat === 'NOAA-21') return 'firms-viirs-noaa21';
    if (sat === 'N' || sat === 'NPP' || sat === 'SUOMI NPP')
      return 'firms-viirs-snpp';
    return 'firms-viirs-noaa20';
  }
  if (family === 'MODIS') {
    if (sat === 'T' || sat === 'TERRA') return 'firms-modis-terra';
    if (sat === 'A' || sat === 'AQUA') return 'firms-modis-aqua';
    return 'firms-modis-aqua';
  }
  return null;
}

const LABELS = {
  'firms-viirs-noaa20': 'VIIRS NOAA-20',
  'firms-viirs-noaa21': 'VIIRS NOAA-21',
  'firms-viirs-snpp': 'VIIRS Suomi NPP',
  'firms-modis-terra': 'MODIS Terra',
  'firms-modis-aqua': 'MODIS Aqua',
};

/** Nearest detection from the other instrument family inside the window. */
export function matchOtherSensor(
  selected,
  detections,
  tolerances = FIRE_TOLERANCES,
) {
  const family = String(selected?.sensor || '').toUpperCase();
  if (!['VIIRS', 'MODIS'].includes(family) || !finite(selected?.acqMs))
    return null;
  let best = null;
  for (const fire of Array.isArray(detections) ? detections : []) {
    if (String(fire?.sensor || '').toUpperCase() === family) continue;
    if (!['VIIRS', 'MODIS'].includes(String(fire?.sensor || '').toUpperCase()))
      continue;
    if (!finite(fire.acqMs)) continue;
    const dtMin = (fire.acqMs - selected.acqMs) / 60_000;
    const km = distanceKm(selected, fire);
    if (km === null || Math.abs(dtMin) > tolerances.windowMin) continue;
    if (km > tolerances.distanceKm) continue;
    const score =
      km / tolerances.distanceKm + Math.abs(dtMin) / tolerances.windowMin;
    if (!best || score < best.score) best = { fire, dtMin, km, score };
  }
  return best;
}

/**
 * Corroboration card for a selected FIRMS detection.
 * @param {object} input From the FIRMS layer: the selected detection, nearby
 *   detections (both families, unfiltered by the display intensity filter)
 *   and how many detections of each family the loaded payload holds.
 */
export function corroborateFire(
  {
    selected,
    nearby = [],
    loadedBySensor = {},
    fetchedAt = null,
    stale = false,
  } = {},
  { checkedAt = null } = {},
) {
  const ownNode = fireNode(selected?.sensor, selected?.satellite);
  if (!ownNode) return null;
  const otherFamily =
    String(selected.sensor).toUpperCase() === 'VIIRS' ? 'MODIS' : 'VIIRS';
  const loaded = Number(loadedBySensor?.[otherFamily]) || 0;
  const match = loaded ? matchOtherSensor(selected, nearby) : null;
  const otherNode = match
    ? fireNode(match.fire.sensor, match.fire.satellite)
    : otherFamily === 'MODIS'
      ? 'firms-modis-aqua'
      : 'firms-viirs-noaa20';
  const label = match ? LABELS[otherNode] : otherFamily;
  const pair = `${label} − ${LABELS[ownNode]}`;
  const comparisons = [
    {
      nodeId: otherNode,
      label,
      state: loaded ? (stale ? 'stale' : 'loaded') : 'unavailable',
      reason: loaded ? null : 'family-not-loaded',
      notes: stale ? [{ code: 'served-stale' }] : [],
      match: match
        ? {
            agree: true,
            notes: [],
            quantities: [
              quantity({
                id: 'position-residual',
                value: roundTo(match.km * 1000, -1),
                unit: 'm',
                cls: 'derived',
                source: pair,
                at: selected.acqMs,
              }),
              quantity({
                id: 'time-offset',
                value: roundTo(match.dtMin, 0),
                unit: 'min',
                cls: 'derived',
                source: pair,
                at: selected.acqMs,
              }),
              quantity({
                id: 'frp',
                value: match.fire.frp,
                unit: 'MW',
                cls: 'observed',
                source: label,
                at: match.fire.acqMs,
              }),
            ],
          }
        : null,
    },
  ];
  return assembleCard({
    kind: 'fire',
    primary: {
      nodeId: ownNode,
      label: LABELS[ownNode],
      quantities: [
        quantity({
          id: 'frp',
          value: selected.frp,
          unit: 'MW',
          cls: 'observed',
          source: LABELS[ownNode],
          at: selected.acqMs,
        }),
      ],
    },
    comparisons,
    notes: [
      { code: 'fire-window', ...FIRE_TOLERANCES },
      ...(match ? [] : [{ code: 'one-sensor-common' }]),
      { code: 'same-distributor' },
    ],
    checkedAt: checkedAt ?? (finite(fetchedAt) ? fetchedAt : null),
  });
}
