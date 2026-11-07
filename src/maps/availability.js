import { keySetupRequirementEnvVars } from '../keySetupCore.mjs';
import { t } from '../i18n/index.js';
import { photorealCoverageGapAt } from './photorealCoverage.js';
/**
 * Why Google 3D is unavailable, phrased so the tooltip and toast recommend the
 * RIGHT fix. With no credentials the fix is a key (or the ion route); with a
 * key or ion token configured, the tileset failed for another reason —
 * restrictions, quota, an EEA-billed key, or the network — and telling the
 * user to add a key they already added is the wrong advice. Where the camera
 * is over a known gap in Google's mesh (src/maps/photorealCoverage.js), the
 * reason leads with coverage, because no key brings 3D buildings there.
 * @param {boolean} hasCredentials
 * @param {{at?: {lat: number, lon: number}|null}} [options] Where the camera is.
 * @returns {string}
 */
export function photorealUnavailableReason(hasCredentials, { at = null } = {}) {
  const outsideCoverage = photorealCoverageGapAt(at) !== null;
  if (hasCredentials && outsideCoverage)
    return t(
      "Google 3D tiles unavailable — this area is likely outside Google's photorealistic coverage. If 3D fails elsewhere too, check the key's API restrictions, quota, or network",
    );
  if (hasCredentials)
    return t(
      "Google 3D tiles unavailable — check the key's API restrictions, quota, or network",
    );
  if (outsideCoverage)
    return t(
      "This area is likely outside Google's photorealistic coverage, so a Google key would not add 3D buildings here. Esri and OSM imagery cover it",
    );
  const envVars = keySetupRequirementEnvVars('google-maps');
  return t(
    'Needs {envVars} — add it in Provider Settings — or a Cesium ion token for the ion-hosted route',
    { envVars },
  );
}
