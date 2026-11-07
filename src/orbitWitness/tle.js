/**
 * Orbit Witness element sets from the existing CelesTrak proxy cache
 * (`/api/celestrak/active`). No new upstream request shape is introduced.
 */
import { twoline2satrec } from 'satellite.js';
import { parseTleText } from '../sources/tle.js';
import { ORBIT_WITNESS_MISSIONS } from './missions.js';

const MAX_TLE_BYTES = 16 * 1024 * 1024;

/** UTC epoch of a TLE line 1 (columns 19–32, YYDDD.DDDDDDDD), or null. */
export function tleEpochMs(line1) {
  const field = typeof line1 === 'string' ? line1.slice(18, 32).trim() : '';
  if (!/^\d{5}\.\d+$/.test(field)) return null;
  const yy = Number(field.slice(0, 2));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const day = Number(field.slice(2));
  if (!(day >= 1 && day < 367)) return null;
  return Date.UTC(year, 0, 1) + (day - 1) * 86400000;
}

function catalogNumber(line1) {
  const value = Number(String(line1).slice(2, 7).trim());
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Element sets for the Orbit Witness missions found in `text`.
 * @returns {Array<{ missionId: string, name: string, line1: string, line2: string, epochMs: number, satrec: object }>}
 */
export function missionElementSets(text, missions = ORBIT_WITNESS_MISSIONS) {
  const wanted = new Map(missions.map((mission) => [mission.norad, mission]));
  const found = new Map();
  for (const entry of parseTleText(text)) {
    const mission = wanted.get(catalogNumber(entry.line1));
    if (!mission || found.has(mission.id)) continue;
    const epochMs = tleEpochMs(entry.line1);
    let satrec;
    try {
      satrec = twoline2satrec(entry.line1, entry.line2);
    } catch {
      continue;
    }
    if (epochMs === null || !satrec || satrec.error) continue;
    found.set(mission.id, {
      missionId: mission.id,
      name: entry.name,
      line1: entry.line1,
      line2: entry.line2,
      epochMs,
      satrec,
    });
  }
  return missions.map((mission) => found.get(mission.id)).filter(Boolean);
}

/** Days between a TLE epoch and the instant it is propagated to (always ≥ 0). */
export function epochAgeDays(epochMs, atMs) {
  return Math.abs(atMs - epochMs) / 86400000;
}

/**
 * Confidence label for an SGP4 prediction by epoch distance. The bands are
 * presentation thresholds, not a published accuracy figure.
 */
export function epochConfidence(ageDays) {
  if (!Number.isFinite(ageDays)) return 'unknown';
  if (ageDays <= 3) return 'fresh';
  if (ageDays <= 7) return 'aging';
  return 'stale';
}

/** Same-origin reader for the cached `active` group. */
export function createOrbitElementSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async read({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/celestrak/active', {
        signal,
        credentials: 'same-origin',
      });
      if (!response.ok)
        throw Object.assign(new Error('Orbit elements are unavailable'), {
          code: 'UNAVAILABLE',
        });
      const length = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(length) && length > MAX_TLE_BYTES)
        throw new Error('Orbit element catalogue is too large');
      const text = await response.text();
      signal?.throwIfAborted();
      if (text.length > MAX_TLE_BYTES)
        throw new Error('Orbit element catalogue is too large');
      return {
        sets: missionElementSets(text),
        stale: response.headers?.get?.('x-tle-cache') === 'STALE-ERROR',
      };
    },
  };
}
