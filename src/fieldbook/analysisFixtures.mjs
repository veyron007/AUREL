import { unavailableFieldProvider } from '../sources/fieldContextModel.js';

export const analysisTime = '2026-11-07T06:00:00.000Z';
export const solarMethod =
  'USNO low-precision solar position; standard -0.833° sunrise and -6° civil twilight; no terrain horizon';
export function analysisSnapshot() {
  return {
    version: 1,
    capturedAt: analysisTime,
    route: null,
    departureAt: null,
    timeZone: 'Asia/Kolkata',
    localDate: '2026-11-07',
    profile: null,
    daylight: {
      sunrise: '2026-11-07T01:10:00.000Z',
      sunset: '2026-11-07T12:00:00.000Z',
      civilDawn: '2026-11-07T00:45:00.000Z',
      civilDusk: '2026-11-07T12:25:00.000Z',
      daylightSeconds: 39000,
      polarState: 'normal',
      method: solarMethod,
    },
    checkpoints: [
      {
        lat: 30.3258,
        lon: 78.0438,
        distanceM: 0,
        context: {
          version: 1,
          requested: { lat: 30.3258, lon: 78.0438 },
          queried: { lat: 30.3258, lon: 78.0438 },
          weather: unavailableFieldProvider('weather'),
          airQuality: unavailableFieldProvider('airQuality'),
        },
      },
    ],
    fireContext: null,
  };
}
export function terrainProfile() {
  return {
    datum: 'EGM2008',
    samples: [
      { distanceM: 0, lat: 30.3258, lon: 78.0438, elevationM: 600 },
      { distanceM: 100, lat: 30.326, lon: 78.044, elevationM: null },
    ],
    minM: 600,
    maxM: 600,
    sampleSpacingM: 100,
    resolutionM: null,
    complete: false,
    sourceId: 'mapterhorn',
    sourceLabel: 'Mapterhorn terrain',
    retrievedAt: analysisTime,
    attribution: 'Mapterhorn',
    license: null,
    link: 'https://mapterhorn.com/',
    datasetVersions: ['mapterhorn-egm08@5'],
  };
}
