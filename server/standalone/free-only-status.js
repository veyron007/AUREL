/** Public admission metadata; no credentials or runtime dependencies. */
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
    'launch-library',
  ]),
});
