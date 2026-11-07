/**
 * RADIO_PRIORITY_COUNTRIES: the operator's list of countries whose Radio
 * Browser stations are seeded first. Pure, so the radio directory and the
 * Provider Settings status can both read the same rule.
 * @module server/providers/radio/priority
 */
import { normalizeRadioCountryInput } from '../../../src/data/radioCountry.js';

/** Most countries the list may name. */
export const PRIORITY_COUNTRY_LIMIT = 8;
/** Stations each priority country may reserve in the directory. */
export const COUNTRY_RESERVED_STATIONS = 40;

/** Validate an operator-owned list; malformed configuration must not silently widen queries. */
export function parseRadioPriorityCountries(value = '') {
  const entries = Array.isArray(value) ? value : String(value).split(',');
  const countries = [];
  for (const entry of entries) {
    const input = String(entry).trim().toUpperCase();
    if (!input) continue;
    const normalized = normalizeRadioCountryInput(input);
    if (!/^[A-Z]{2}$/.test(input) || !normalized.valid)
      throw new TypeError(
        'RADIO_PRIORITY_COUNTRIES requires ISO alpha-2 country codes',
      );
    const code = normalized.code;
    if (!countries.includes(code)) countries.push(code);
  }
  if (countries.length > PRIORITY_COUNTRY_LIMIT)
    throw new RangeError(
      'RADIO_PRIORITY_COUNTRIES supports at most eight countries',
    );
  return countries;
}

/**
 * The list as Provider Settings reports it: never throws, never echoes the
 * raw value. `valid: false` means the radio directory will refuse to start.
 * @param {Record<string, string|undefined>} env
 * @returns {{countries: string[], valid: boolean, reservedPerCountry: number}}
 */
export function radioPriorityStatus(env = {}) {
  try {
    return {
      countries: parseRadioPriorityCountries(
        env.RADIO_PRIORITY_COUNTRIES || '',
      ),
      valid: true,
      reservedPerCountry: COUNTRY_RESERVED_STATIONS,
    };
  } catch {
    return {
      countries: [],
      valid: false,
      reservedPerCountry: COUNTRY_RESERVED_STATIONS,
    };
  }
}
