/**
 * What Provider Settings says about policy and keyless configuration, from
 * the /api/setup/status payload: which key rows Free-only blocks, which
 * optional tokens it only ignores, and the read-only radio priority line.
 *
 * Pure apart from translation; src/keySetup.js presents the result.
 * @module providerSettingsPolicy
 */
import { t } from './i18n/index.js';

/**
 * How Free-only treats one key row.
 * `blocked`: the service is stopped. `paused`: only its optional token is
 * ignored and the service keeps working without one.
 * @param {{freeOnly?: boolean, blockedProviders?: string[], pausedCredentials?: string[]}|null} status
 * @param {string} keyId
 * @returns {{blocked: boolean, paused: boolean}}
 */
export function freeOnlyRowPolicy(status, keyId) {
  if (status?.freeOnly !== true) return { blocked: false, paused: false };
  const listed = (list) => Array.isArray(list) && list.includes(keyId);
  const blocked = listed(status.blockedProviders);
  return {
    blocked,
    paused: !blocked && listed(status.pausedCredentials),
  };
}

/**
 * The radio priority line, or null when the server does not report it.
 * Shows only country codes, which are configuration, never a credential.
 * @param {{countries?: string[], valid?: boolean, reservedPerCountry?: number}|null|undefined} radioPriority
 * @returns {{set: boolean, valid: boolean, text: string}|null}
 */
export function radioPriorityHint(radioPriority) {
  if (!radioPriority || typeof radioPriority !== 'object') return null;
  const count = Number(radioPriority.reservedPerCountry) || 0;
  if (radioPriority.valid === false)
    return {
      set: false,
      valid: false,
      text: t(
        'RADIO_PRIORITY_COUNTRIES is not valid: use up to eight two-letter country codes, such as IN. The radio directory will not start until it is fixed',
      ),
    };
  const countries = (
    Array.isArray(radioPriority.countries) ? radioPriority.countries : []
  ).filter((code) => /^[A-Z]{2}$/.test(code));
  if (countries.length === 0)
    return {
      set: false,
      valid: true,
      text: t(
        'Not set. Add RADIO_PRIORITY_COUNTRIES=IN to .env to reserve up to {count} Indian stations in the radio directory, then restart',
        { count },
      ),
    };
  return {
    set: true,
    valid: true,
    text: t(
      'Reserves up to {count} radio stations per country for {countries}. Set by RADIO_PRIORITY_COUNTRIES in .env; restart after changing it',
      { count, countries: countries.join(', ') },
    ),
  };
}
