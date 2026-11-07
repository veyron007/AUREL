import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleRoute } from './routeSampling.js';
import { calculateProfile } from './profile.js';
import {
  calculateDaylight,
  resolveLocalDateTime,
  localDateAt,
} from './daylight.js';

test('route sampling retains endpoints, limits samples and crosses dateline locally', () => {
  const result = sampleRoute({
    geometry: [
      [179.9, 30],
      [-179.9, 30],
    ],
  });
  assert.ok(result.samples.length <= 128);
  assert.ok(result.totalDistanceM < 25000);
  assert.deepEqual([result.samples[0].lon, result.samples[0].lat], [179.9, 30]);
  assert.deepEqual(
    [result.samples.at(-1).lon, result.samples.at(-1).lat],
    [-179.9, 30],
  );
  assert.ok(result.samples.every((point) => Math.abs(point.lon) > 179));
  assert.equal(
    sampleRoute({
      geometry: [
        [78, 30],
        [78, 30],
      ],
    }).samples.length,
    1,
  );
  assert.throws(
    () =>
      sampleRoute({
        geometry: [
          [999, 0],
          [0, 0],
        ],
      }),
    /route/i,
  );
});
test('profile uses evidenced EGM2008 elevation once, leaves unknown/fallback gaps and reports bounds', () => {
  const sampling = sampleRoute(
    {
      geometry: [
        [78, 30],
        [78.01, 30.01],
      ],
    },
    { maxSamples: 3 },
  );
  const provenance = {
    tileset: 'mapterhorn-egm08',
    version: '5',
    retrievedAt: '2026-11-07T00:00:00.000Z',
  };
  const profile = calculateProfile(sampling, {
    results: [
      { elevation: 650, ellipsoid: 607, geoid: -43, provenance },
      { elevation: 0, source: 'geoid-fallback', provenance },
      { elevation: 720, provenance },
    ].map((row, index) => ({
      ...row,
      lat: sampling.samples[index].lat,
      lon: sampling.samples[index].lon,
    })),
  });
  assert.deepEqual(
    profile.samples.map((point) => point.elevationM),
    [650, null, 720],
  );
  assert.equal(profile.datum, 'EGM2008');
  assert.equal(profile.minM, 650);
  assert.equal(profile.maxM, 720);
  assert.equal(profile.complete, false);
  assert.equal(profile.resolutionM, null);
  assert.deepEqual(profile.datasetVersions, ['mapterhorn-egm08@5']);
  const unknown = calculateProfile(sampling, {
    results: [{ elevation: 650 }, { elevation: 700 }, { elevation: 720 }],
  });
  assert.ok(unknown.samples.every((point) => point.elevationM === null));
});
test('local dates respect IST boundary and DST gaps/ambiguities', () => {
  assert.equal(
    resolveLocalDateTime('2026-11-07T00:15', 'Asia/Kolkata'),
    '2026-11-06T18:45:00.000Z',
  );
  assert.equal(
    localDateAt('2026-11-06T20:00:00.000Z', 'Asia/Kolkata'),
    '2026-11-07',
  );
  assert.throws(
    () => resolveLocalDateTime('2026-03-08T02:30', 'America/New_York'),
    /exist|gap/i,
  );
  assert.throws(
    () => resolveLocalDateTime('2026-11-01T01:30', 'America/New_York'),
    /ambiguous/i,
  );
  assert.throws(
    () => resolveLocalDateTime('2026-02-30T10:00', 'Asia/Kolkata'),
    /date/i,
  );
  assert.throws(
    () => resolveLocalDateTime('2026-11-07T10:00', 'Not/AZone'),
    /zone/i,
  );
});
test('profile rejects mismatched, incomplete and invalid result coordinates', () => {
  const sample = { lat: 30.25, lon: 78.125, distanceM: 0 };
  const sampling = { samples: [sample], sampleSpacingM: 0 };
  const provenance = { tileset: 'mapterhorn-egm08', version: '5' };
  for (const coordinates of [
    {},
    { lat: 31.25, lon: 78.125 },
    { lat: 30.25, lon: 79.125 },
    { lat: 30.25 },
    { lat: null, lon: 78.125 },
  ]) {
    const result = calculateProfile(sampling, {
      results: [{ elevation: 650, provenance, ...coordinates }],
    });
    assert.equal(result.samples[0].elevationM, null);
    assert.equal(result.complete, false);
  }
  const matched = calculateProfile(sampling, {
    results: [{ elevation: 650, provenance, lat: sample.lat, lon: sample.lon }],
  });
  assert.equal(matched.samples[0].elevationM, 650);
  assert.equal(matched.complete, true);
  const wrongRequest = calculateProfile(sampling, {
    results: [
      {
        elevation: 650,
        lat: sample.lat,
        lon: sample.lon,
        provenance: { ...provenance, requested: { lat: 30.3, lon: 78.125 } },
      },
    ],
  });
  assert.equal(wrongRequest.samples[0].elevationM, null);
  const roundedRequest = calculateProfile(sampling, {
    results: [
      {
        elevation: 650,
        lat: sample.lat,
        lon: sample.lon,
        provenance: {
          ...provenance,
          requested: { lat: 30.250001, lon: 78.125001 },
        },
      },
    ],
  });
  assert.equal(roundedRequest.samples[0].elevationM, 650);
});
test('Dehradun daylight and polar states retain truthful event dates', () => {
  const day = calculateDaylight({
    lat: 30.3258,
    lon: 78.0438,
    localDate: '2026-06-21',
    timeZone: 'Asia/Kolkata',
  });
  assert.equal(day.polarState, 'normal');
  assert.ok(day.daylightSeconds > 14 * 3600 && day.daylightSeconds < 15 * 3600);
  assert.equal(localDateAt(day.sunrise, 'Asia/Kolkata'), '2026-06-21');
  assert.ok(day.civilDawn < day.sunrise);
  assert.ok(day.civilDusk > day.sunset);
  const north = calculateDaylight({
    lat: 89,
    lon: 0,
    localDate: '2026-06-21',
    timeZone: 'UTC',
  });
  assert.equal(north.polarState, 'polar-day');
  assert.equal(north.sunrise, null);
  assert.equal(north.daylightSeconds, 86400);
  assert.equal(
    calculateDaylight({
      lat: 89,
      lon: 0,
      localDate: '2026-12-21',
      timeZone: 'UTC',
    }).polarState,
    'polar-night',
  );
});

test('sampling interpolates across uneven vertices and refuses invalid limits/antipodes', () => {
  const result = sampleRoute(
    {
      geometry: [
        [78, 30],
        [78.001, 30],
        [78.4, 30.4],
      ],
    },
    { maxSamples: 3, minSpacingM: 1 },
  );
  assert.equal(result.samples.length, 3);
  assert.ok(result.samples[1].lon > 78.001);
  assert.throws(
    () =>
      sampleRoute({
        geometry: [
          [0, 0],
          [180, 0],
        ],
      }),
    /antipodal/,
  );
  assert.throws(
    () =>
      sampleRoute(
        {
          geometry: [
            [0, 0],
            [1, 1],
          ],
        },
        { maxSamples: 129 },
      ),
    /limits/,
  );
});

test('sunrise solver supports DST calendar days and rejects impossible calendar inputs', () => {
  const result = calculateDaylight({
    lat: 40.7,
    lon: -74,
    localDate: '2026-03-08',
    timeZone: 'America/New_York',
  });
  assert.equal(result.polarState, 'normal');
  assert.equal(localDateAt(result.sunset, 'America/New_York'), '2026-03-08');
  assert.throws(
    () => calculateDaylight({ lat: 91, lon: 0, localDate: '2026-01-01' }),
    /location/,
  );
  assert.throws(
    () => calculateDaylight({ lat: 0, lon: 0, localDate: '2026-02-30' }),
    /date/,
  );
  assert.throws(() => localDateAt('not-a-date', 'UTC'), /instant/);
  assert.throws(() => resolveLocalDateTime('bad', 'UTC'), /date/);
});
