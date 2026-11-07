import { distanceKm, finite, roundTo } from './geo.js';
import { assembleCard, quantity } from './verdict.js';

/**
 * Matching tolerances. A candidate is any catalogue row inside the search
 * window; it AGREES only inside the tighter agreement bounds. A candidate
 * outside agreement is a disagreement, which is normal between agencies.
 */
export const QUAKE_TOLERANCES = Object.freeze({
  windowS: 180,
  candidateKm: 150,
  candidateMag: 1.5,
  agreeS: 15,
  agreeKm: 30,
  agreeMag: 0.4,
});

const QUAKE_SOURCES = Object.freeze([
  // i18n-ignore: agency names, not UI copy
  { nodeId: 'emsc', label: 'EMSC' },
  // i18n-ignore: agency names, not UI copy
  { nodeId: 'geofon', label: 'GFZ GEOFON' },
]);

const USGS_AUTHORS = new Set(['NEIC', 'US', 'USGS', 'NEIC-USGS']);

/** The contributing network behind a USGS event id ("us7000…" is NEIC). */
export function usgsNetwork(usgsId) {
  const match = /^([a-z]{2})[0-9a-z]/i.exec(String(usgsId || ''));
  return match ? match[1].toUpperCase() : null;
}

/** Whether a catalogue row is the USGS solution relayed under another name. */
export function isUsgsAuthored(author, usgsId) {
  const name = String(author || '')
    .trim()
    .toUpperCase();
  if (!name) return false;
  const network = usgsNetwork(usgsId);
  if (network === 'US') return USGS_AUTHORS.has(name);
  return USGS_AUTHORS.has(name) || (network !== null && name === network);
}

/**
 * Best candidate for one primary event, with residuals and agreement.
 * @returns {?{row: object, dtS: number, distanceKm: number,
 *   dMag: ?number, dDepthKm: ?number, agree: boolean, exceeded: string[]}}
 */
export function matchQuake(primary, rows, tolerances = QUAKE_TOLERANCES) {
  if (![primary?.lat, primary?.lon, primary?.timeMs].every(finite)) return null;
  let best = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const dtS = (row.timeMs - primary.timeMs) / 1000;
    const km = distanceKm(primary, row);
    const dMag =
      finite(row.mag) && finite(primary.mag) ? row.mag - primary.mag : null;
    if (
      !finite(dtS) ||
      km === null ||
      Math.abs(dtS) > tolerances.windowS ||
      km > tolerances.candidateKm ||
      (dMag !== null && Math.abs(dMag) > tolerances.candidateMag)
    )
      continue;
    const score =
      Math.abs(dtS) / tolerances.windowS +
      km / tolerances.candidateKm +
      (dMag === null ? 0.5 : Math.abs(dMag) / tolerances.candidateMag);
    if (!best || score < best.score) {
      best = { row, dtS, distanceKm: km, dMag, score };
    }
  }
  if (!best) return null;
  const exceeded = [
    Math.abs(best.dtS) > tolerances.agreeS ? 'time' : null,
    best.distanceKm > tolerances.agreeKm ? 'position' : null,
    best.dMag !== null && Math.abs(best.dMag) > tolerances.agreeMag
      ? 'magnitude'
      : null,
  ].filter(Boolean);
  const { row, dtS, distanceKm: km, dMag } = best;
  return {
    row,
    dtS,
    distanceKm: km,
    dMag,
    dDepthKm:
      finite(row.depthKm) && finite(primary.depthKm)
        ? row.depthKm - primary.depthKm
        : null,
    agree: exceeded.length === 0,
    exceeded,
  };
}

function comparison(primary, source, envelope) {
  const state = envelope?.state ?? 'unavailable';
  const base = {
    nodeId: source.nodeId,
    label: source.label,
    state,
    reason: envelope?.reason ?? null,
    retrievedAt: envelope?.retrievedAt ?? null,
    notes: state === 'stale' ? [{ code: 'served-stale' }] : [],
  };
  const match = ['ok', 'partial', 'stale'].includes(state)
    ? matchQuake(primary, envelope.records)
    : null;
  if (!match) return { ...base, match: null };
  const pair = `${source.label} − USGS`;
  const notes = [
    ...(match.exceeded.length
      ? [{ code: 'outside-agreement', quantities: match.exceeded }]
      : []),
    ...(match.row.author
      ? [{ code: 'catalogue-author', author: match.row.author }]
      : []),
    ...(match.row.magType &&
    primary.magType &&
    match.row.magType.toLowerCase() !== primary.magType.toLowerCase()
      ? [
          {
            code: 'magnitude-types-differ',
            primary: primary.magType,
            other: match.row.magType,
          },
        ]
      : []),
  ];
  return {
    ...base,
    eventId: match.row.id,
    author: match.row.author,
    match: {
      agree: match.agree,
      notes,
      quantities: [
        quantity({
          id: 'magnitude',
          value: match.row.mag,
          unit: match.row.magType || 'M',
          cls: 'observed',
          source: source.label,
          at: match.row.timeMs,
        }),
        quantity({
          id: 'magnitude-difference',
          value: roundTo(match.dMag, 2),
          unit: 'magnitude units',
          cls: 'derived',
          source: pair,
          at: primary.timeMs,
        }),
        quantity({
          id: 'time-offset',
          value: roundTo(match.dtS, 1),
          unit: 's',
          cls: 'derived',
          source: pair,
          at: primary.timeMs,
        }),
        quantity({
          id: 'position-residual',
          value: roundTo(match.distanceKm, 1),
          unit: 'km',
          cls: 'derived',
          source: pair,
          at: primary.timeMs,
        }),
        quantity({
          id: 'depth-difference',
          value: roundTo(match.dDepthKm, 1),
          unit: 'km',
          cls: 'derived',
          source: pair,
          at: primary.timeMs,
        }),
      ],
    },
  };
}

/**
 * Corroboration card for a selected USGS event.
 * @param {{usgsId: string, lat: number, lon: number, timeMs: number,
 *   mag: ?number, depthKm: ?number, magType?: string}} primary
 * @param {?{sources: Record<string, object>}} answer `/api/second-source/quake` body.
 */
export function corroborateQuake(primary, answer, { checkedAt = null } = {}) {
  const comparisons = QUAKE_SOURCES.map((source) =>
    comparison(primary, source, answer?.sources?.[source.nodeId]),
  );
  const extraEdges = [];
  const emsc = comparisons.find((row) => row.nodeId === 'emsc');
  const geofon = comparisons.find((row) => row.nodeId === 'geofon');
  if (emsc?.match && isUsgsAuthored(emsc.author, primary.usgsId)) {
    extraEdges.push({
      from: 'emsc',
      to: 'usgs',
      relation: 'relays',
      certainty: 'known',
    });
  }
  if (
    emsc?.match &&
    geofon?.match &&
    /^(GFZ|GEOFON)$/i.test(String(emsc.author || ''))
  ) {
    extraEdges.push({
      from: 'emsc',
      to: 'geofon',
      relation: 'relays',
      certainty: 'known',
    });
  }
  return assembleCard({
    kind: 'quake',
    primary: {
      nodeId: 'usgs',
      // i18n-ignore: agency name, not UI copy
      label: 'USGS',
      quantities: [
        quantity({
          id: 'magnitude',
          value: primary.mag,
          unit: primary.magType || 'M',
          cls: 'observed',
          source: 'USGS',
          at: primary.timeMs,
        }),
        quantity({
          id: 'depth',
          value: primary.depthKm,
          unit: 'km',
          cls: 'observed',
          source: 'USGS',
          at: primary.timeMs,
        }),
      ],
    },
    comparisons,
    extraEdges,
    notes: [{ code: 'quake-window', ...QUAKE_TOLERANCES }],
    checkedAt,
  });
}
