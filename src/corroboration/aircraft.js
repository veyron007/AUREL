import { distanceKm, finite, propagate, roundTo } from './geo.js';
import { assembleCard, quantity } from './verdict.js';

/**
 * Two reports of one ICAO address agree when, after moving the other report
 * along its own track to the reference position time, the residual is small.
 */
export const AIRCRAFT_TOLERANCES = Object.freeze({
  maxOffsetS: 60,
  agreeKm: 1,
  agreeAltFt: 500,
});

/**
 * Compare one report against the reference report of the same aircraft.
 * @returns {?{agree: boolean, dtS: number, residualKm: number,
 *   rawKm: number, dAltFt: ?number, propagated: boolean, exceeded: string[]}}
 */
export function compareAircraft(
  reference,
  other,
  tolerances = AIRCRAFT_TOLERANCES,
) {
  if (
    ![reference?.lat, reference?.lon, reference?.positionTimeMs].every(
      finite,
    ) ||
    ![other?.lat, other?.lon, other?.positionTimeMs].every(finite)
  )
    return null;
  const dtS = (other.positionTimeMs - reference.positionTimeMs) / 1000;
  const rawKm = distanceKm(reference, other);
  // Move the other report back to the reference instant along its own track.
  const moved = propagate(other, other.groundSpeedKt, other.trackDeg, -dtS);
  const residualKm = moved ? distanceKm(reference, moved) : rawKm;
  const dAltFt =
    finite(other.altBaroFt) && finite(reference.altBaroFt)
      ? other.altBaroFt - reference.altBaroFt
      : null;
  const exceeded = [
    Math.abs(dtS) > tolerances.maxOffsetS ? 'time' : null,
    residualKm > tolerances.agreeKm ? 'position' : null,
    dAltFt !== null && Math.abs(dAltFt) > tolerances.agreeAltFt
      ? 'altitude'
      : null,
  ].filter(Boolean);
  return {
    agree: exceeded.length === 0,
    dtS,
    residualKm,
    rawKm,
    dAltFt,
    propagated: Boolean(moved),
    exceeded,
  };
}

function row(nodeId, label, envelopeState, record, reference, refLabel) {
  const notes = [
    ...(envelopeState === 'stale' ? [{ code: 'served-stale' }] : []),
    ...(record && record.positionType && record.positionType !== 'adsb'
      ? [{ code: 'position-type', type: record.positionType }]
      : []),
  ];
  const compared =
    record && reference ? compareAircraft(reference, record) : null;
  const pair = `${label} − ${refLabel}`;
  return {
    nodeId,
    label,
    state: envelopeState,
    notes,
    match: compared
      ? {
          agree: compared.agree,
          notes: [
            ...(compared.exceeded.length
              ? [{ code: 'outside-agreement', quantities: compared.exceeded }]
              : []),
            ...(compared.propagated
              ? [{ code: 'propagated-to-reference' }]
              : []),
          ],
          quantities: [
            quantity({
              id: 'time-offset',
              value: roundTo(compared.dtS, 1),
              unit: 's',
              cls: 'derived',
              source: pair,
              at: reference.positionTimeMs,
            }),
            quantity({
              id: 'position-residual',
              value: roundTo(compared.residualKm * 1000, -1),
              unit: 'm',
              cls: 'derived',
              source: pair,
              at: reference.positionTimeMs,
            }),
            quantity({
              id: 'altitude-difference',
              value: compared.dAltFt,
              unit: 'ft',
              cls: 'derived',
              source: pair,
              at: reference.positionTimeMs,
            }),
          ],
        }
      : null,
  };
}

const envState = (envelope) => envelope?.state ?? 'unavailable';
const firstRecord = (envelope) =>
  ['ok', 'partial', 'stale'].includes(envState(envelope))
    ? (envelope.records?.[0] ?? null)
    : null;

/**
 * Corroboration card for a selected aircraft.
 *
 * Reference: the adsb.lol report fetched at the same moment as adsb.fi, or,
 * when adsb.lol is unavailable, the report the map layer already holds.
 * The local receiver joins when it hears the same address.
 *
 * @param {object} input
 * @param {string} input.hex
 * @param {?object} input.layerRecord {lat, lon, positionTimeMs, altBaroFt,
 *   groundSpeedKt, trackDeg, sourceNode} from the selected map layer.
 * @param {?object} input.localRecord The local receiver's report, if heard.
 * @param {?{sources: Record<string, object>}} input.answer `/api/second-source/aircraft` body.
 */
export function corroborateAircraft(
  { hex, layerRecord = null, localRecord = null, answer = null },
  { checkedAt = null } = {},
) {
  const lol = answer?.sources?.['adsb-lol'];
  const fi = answer?.sources?.['adsb-fi'];
  const lolRecord = firstRecord(lol);
  const reference = lolRecord ?? layerRecord;
  const referenceNode = lolRecord
    ? 'adsb-lol'
    : layerRecord?.sourceNode || 'adsb-lol';
  const referenceLabel =
    referenceNode === 'opensky' ? 'OpenSky Network' : 'adsb.lol';
  const comparisons = [
    row(
      'adsb-fi',
      'adsb.fi',
      envState(fi),
      firstRecord(fi),
      reference,
      referenceLabel,
    ),
  ];
  if (localRecord) {
    comparisons.push(
      row(
        'local-receiver',
        'Local receiver',
        'loaded',
        localRecord,
        reference,
        referenceLabel,
      ),
    );
  }
  return assembleCard({
    kind: 'aircraft',
    primary: {
      nodeId: referenceNode,
      label: referenceLabel,
      quantities: reference
        ? [
            quantity({
              id: 'altitude',
              value: reference.altBaroFt,
              unit: 'ft',
              cls: 'observed',
              source: referenceLabel,
              at: reference.positionTimeMs,
            }),
            quantity({
              id: 'ground-speed',
              value: reference.groundSpeedKt,
              unit: 'kt',
              cls: 'observed',
              source: referenceLabel,
              at: reference.positionTimeMs,
            }),
          ]
        : [],
    },
    comparisons,
    notes: [
      { code: 'aircraft-hex', hex },
      { code: 'aircraft-window', ...AIRCRAFT_TOLERANCES },
      ...(!reference ? [{ code: 'no-reference' }] : []),
      ...(!lolRecord && layerRecord ? [{ code: 'reference-from-layer' }] : []),
    ],
    checkedAt,
  });
}
