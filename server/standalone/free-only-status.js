/**
 * Public admission metadata; no credentials or runtime dependencies.
 *
 * `blockedProviders` are services Free-only stops: their routes answer 403
 * (server/standalone/free-only.js) or their browser keys are withheld.
 * `pausedCredentials` are optional keys Free-only ignores while the service
 * itself keeps working without one: Launch Library 2 serves launches keyless,
 * and server/providers/local.js only blanks its paid higher-rate token.
 */
export const FREE_ONLY_STATUS = Object.freeze({
  freeOnly: true,
  blockedProviders: Object.freeze([
    'google-maps',
    'google-maps-server',
    'cesium-ion',
    'openai',
    'gemini',
    'tomtom',
    'opensky',
  ]),
  pausedCredentials: Object.freeze(['launch-library']),
});
