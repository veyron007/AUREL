import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFieldbook,
  parseFieldbook,
  stringifyFieldbook,
  validateFieldbook,
} from './document.js';
import {
  addPlace,
  addRoute,
  addAnalysis,
  duplicateFieldbook,
  removeEntry,
} from './operations.js';
import { buildFieldbookBrief } from './brief.js';
import {
  analysisSnapshot,
  analysisTime,
  terrainProfile,
} from './analysisFixtures.mjs';
import {
  normalizeFieldProvider,
  unavailableFieldProvider,
} from '../sources/fieldContextModel.js';

const placed = () =>
  addPlace(
    createFieldbook({ id: 'project', title: 'Foothills', now: analysisTime }),
    {
      id: 'place',
      name: 'Dehradun',
      geometry: { type: 'Point', coordinates: [78.0438, 30.3258] },
    },
    { now: analysisTime },
  );
const analyzed = () =>
  addAnalysis(
    placed(),
    {
      id: 'analysis',
      subjectId: 'place',
      kind: 'route-context',
      snapshot: analysisSnapshot(),
    },
    { now: analysisTime },
  );

test('legacy v1 backups migrate in memory without changing identity, revisions or saved content', () => {
  const { analyses, comparisons, changeNotes, ...legacy } = placed();
  legacy.version = 1;
  legacy.revision = 7;
  const before = JSON.stringify(legacy);
  const migrated = parseFieldbook(before);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.analyses, []);
  const {
    analyses: ignored,
    comparisons: ignoredComparisons,
    changeNotes: ignoredNotes,
    version,
    ...retained
  } = migrated;
  const { version: legacyVersion, ...legacyContent } = legacy;
  assert.deepEqual(retained, legacyContent);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(migrated.revision, 7);
  assert.throws(
    () => parseFieldbook(JSON.stringify({ ...legacy, analyses: [] })),
    { code: 'INVALID_DOCUMENT' },
  );
  assert.throws(
    () => parseFieldbook(JSON.stringify({ ...legacy, version: 99 })),
    { code: 'INVALID_DOCUMENT' },
  );
});

test('analysis snapshots round-trip exact values and remain linked when a project is copied', () => {
  const project = analyzed();
  const restored = parseFieldbook(stringifyFieldbook(project));
  assert.deepEqual(restored, project);
  assert.equal(restored.analyses[0].snapshot.departureAt, null);
  assert.equal(restored.analyses[0].snapshot.daylight.daylightSeconds, 39000);
  const copy = duplicateFieldbook(restored, { id: 'copy', now: analysisTime });
  assert.equal(copy.analyses[0].subjectId, copy.places[0].id);
  assert.equal(buildFieldbookBrief(copy).counts.analyses, 1);
  assert.deepEqual(
    buildFieldbookBrief(copy).analyses[0].snapshot,
    project.analyses[0].snapshot,
  );
  assert.throws(() => removeEntry(project, 'places', 'place'), {
    code: 'INVALID_DOCUMENT',
  });
});

test('analysis boundaries reject dangling targets, unknown payloads, secret fields and oversized arrays', () => {
  const changes = [
    (p) => {
      p.analyses[0].subjectId = 'project';
    },
    (p) => {
      p.analyses[0].snapshot.apiKey = 'PRIVATE';
    },
    (p) => {
      p.analyses[0].snapshot.version = 2;
    },
    (p) => {
      p.analyses[0].snapshot.timeZone = 'Invented/Zone';
    },
    (p) => {
      p.analyses[0].snapshot.localDate = '2026-02-31';
    },
    (p) => {
      p.analyses[0].snapshot.daylight.daylightSeconds = -1;
    },
    (p) => {
      p.analyses[0].snapshot.checkpoints = Array(6).fill({});
    },
  ];
  for (const change of changes) {
    const value = analyzed();
    change(value);
    assert.throws(() => validateFieldbook(value), { code: 'INVALID_DOCUMENT' });
  }
});

test('place analyses bind their sole checkpoint to the saved point and exclude route profiles', () => {
  const changes = [
    (s) => {
      s.checkpoints = [];
    },
    (s) => {
      s.checkpoints.push(structuredClone(s.checkpoints[0]));
    },
    (s) => {
      s.checkpoints[0].distanceM = 1;
    },
    (s) => {
      const point = s.checkpoints[0];
      point.lat = 0;
      point.lon = 0;
      point.context.requested = { lat: 0, lon: 0 };
      point.context.queried = { lat: 0, lon: 0 };
    },
    (s) => {
      s.profile = terrainProfile();
    },
  ];
  for (const change of changes) {
    const value = analyzed();
    change(value.analyses[0].snapshot);
    assert.throws(() => validateFieldbook(value), { code: 'INVALID_DOCUMENT' });
  }
  assert.doesNotThrow(() => validateFieldbook(analyzed()));
});

function scientificSnapshot() {
  const snapshot = analysisSnapshot();
  snapshot.route = {
    name: 'Foothills trail',
    geometry: {
      type: 'LineString',
      coordinates: [
        [78.0438, 30.3258],
        [78.044, 30.326],
      ],
    },
    mode: 'foot',
    distanceM: 100,
    durationS: 80,
    retrievedAt: null,
  };
  snapshot.profile = terrainProfile();
  const weather = normalizeFieldProvider(
    {
      utc_offset_seconds: 0,
      latitude: 30.3,
      longitude: 78.0,
      hourly: {
        time: ['2026-11-07T06:00', '2026-11-07T07:00'],
        temperature_2m: [19, 20],
        precipitation: [0, 1],
        precipitation_probability: [0, 40],
        wind_speed_10m: [2, 3],
        wind_gusts_10m: [3, 4],
        weather_code: [0, 3],
      },
      hourly_units: {
        temperature_2m: '°C',
        precipitation: 'mm',
        precipitation_probability: '%',
        wind_speed_10m: 'm/s',
        wind_gusts_10m: 'm/s',
        weather_code: 'wmo code',
      },
    },
    'weather',
    Date.parse(analysisTime),
  );
  snapshot.checkpoints = [
    {
      lat: 30.3258,
      lon: 78.0438,
      distanceM: 0,
      context: {
        version: 1,
        requested: { lat: 30.3258, lon: 78.0438 },
        queried: { lat: 30.3258, lon: 78.0438 },
        weather,
        airQuality: unavailableFieldProvider('airQuality'),
      },
    },
  ];
  snapshot.fireContext = {
    status: 'partial',
    source: 'NASA FIRMS',
    fetchedAt: Date.parse(analysisTime),
    window: { start: '2026-11-06T06:00:00.000Z', end: analysisTime },
    bounds: { west: 78, south: 30, east: 79, north: 31 },
    sources: [{ id: 'VIIRS_SNPP_NRT', status: 'ok', count: 1 }],
    matchedCount: 1,
    count: 1,
    truncated: false,
    observations: [
      {
        id: 'hotspot',
        lat: 30.3,
        lon: 78.1,
        acquiredAt: '2026-11-07T05:00:00.000Z',
        sensor: 'VIIRS',
        satellite: 'NPP',
        confidence: 'n',
        frpMw: 1.5,
        source: 'VIIRS_SNPP_NRT',
      },
    ],
    limitations: ['Detections are not proof of a fire at an exact property.'],
  };
  return snapshot;
}
function scientificProject() {
  const row = scientificSnapshot().route;
  return addRoute(
    placed(),
    {
      id: 'route',
      name: row.name,
      geometry: row.geometry,
      mode: row.mode,
      distanceM: row.distanceM,
      durationSec: row.durationS,
      sourceId: 'osm-routing',
      sourceLabel: 'Routing',
    },
    { now: analysisTime },
  );
}
test('typed scientific values, gaps, source grids and acquisition times survive backup and brief', () => {
  const snapshot = scientificSnapshot();
  const value = addAnalysis(
    scientificProject(),
    { subjectId: 'route', snapshot },
    { now: analysisTime },
  );
  const restored = parseFieldbook(stringifyFieldbook(value));
  assert.deepEqual(restored.analyses[0].snapshot, snapshot);
  assert.notEqual(
    snapshot.checkpoints[0].context.weather.grid.lat,
    snapshot.checkpoints[0].lat,
  );
  assert.equal(
    restored.analyses[0].snapshot.profile.samples[1].elevationM,
    null,
  );
  const brief = buildFieldbookBrief(restored);
  brief.analyses[0].snapshot.profile.samples[0].elevationM = 0;
  assert.equal(
    restored.analyses[0].snapshot.profile.samples[0].elevationM,
    600,
  );
});
test('partial FIRMS sources retain valid detections without claiming complete retrieval', () => {
  const snapshot = scientificSnapshot();
  snapshot.fireContext.sources[0].status = 'partial';
  const value = addAnalysis(
    scientificProject(),
    { subjectId: 'route', snapshot },
    { now: analysisTime },
  );
  assert.equal(
    parseFieldbook(stringifyFieldbook(value)).analyses[0].snapshot.fireContext
      .count,
    1,
  );
  value.analyses[0].snapshot.fireContext.status = 'ok';
  assert.throws(() => validateFieldbook(value), { code: 'INVALID_DOCUMENT' });
});
test('typed source envelopes reject extra fields, incorrect units, metrics and out-of-area fire rows', () => {
  const changes = [
    (s) => {
      s.profile.datum = 'unknown';
    },
    (s) => {
      s.profile.minM = 0;
    },
    (s) => {
      s.profile.complete = true;
    },
    (s) => {
      s.profile.link = 'https://example.com/?api_key=private';
    },
    (s) => {
      s.profile.samples = Array(257).fill(s.profile.samples[0]);
    },
    (s) => {
      s.profile.samples[0].elevationM = Number.NaN;
    },
    (s) => {
      s.checkpoints[0].context.weather.units.temperatureC = '°F';
    },
    (s) => {
      s.checkpoints[0].context.weather.hours[0].token = 'private';
    },
    (s) => {
      s.checkpoints[0].context.weather.issuedAt = analysisTime;
    },
    (s) => {
      s.checkpoints[0].context.weather.hours[1].time = analysisTime;
    },
    (s) => {
      s.checkpoints[0].context.requested.lat = 0;
      s.checkpoints[0].context.queried.lat = 0;
    },
    (s) => {
      s.fireContext.observations[0].lat = 1;
    },
    (s) => {
      s.fireContext.observations[0].acquiredAt = '2026-11-05T06:00:00.000Z';
    },
    (s) => {
      s.fireContext.count = 0;
    },
    (s) => {
      s.fireContext.status = 'unavailable';
    },
    (s) => {
      s.fireContext.bounds.east = 90;
    },
  ];
  for (const change of changes) {
    const snapshot = scientificSnapshot();
    change(snapshot);
    assert.throws(
      () =>
        addAnalysis(
          scientificProject(),
          { subjectId: 'route', snapshot },
          { now: analysisTime },
        ),
      { code: 'INVALID_DOCUMENT' },
    );
  }
});
