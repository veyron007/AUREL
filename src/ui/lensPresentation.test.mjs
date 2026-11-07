import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLensSelection,
  normalizeLensEvidence,
  buildLensEvidence,
} from './lensPresentation.js';

test('Lens whitelists selected geography without serializing entity or credentials', () => {
  const record = {
    id: 'd',
    name: 'देहरादून',
    lat: 30.3258,
    lon: 78.0438,
    aliases: ['Dehradun'],
    entity: {},
    apiKey: 'private',
    updatedAt: 123,
  };
  record.entity.self = record.entity;
  const place = normalizeLensSelection(record);
  assert.deepEqual(place.geometry, {
    type: 'Point',
    coordinates: [78.0438, 30.3258],
  });
  assert.equal(place.name, 'देहरादून');
  assert.deepEqual(place.aliases, ['Dehradun']);
  assert.equal('entity' in place, false);
  assert.equal('apiKey' in place, false);
  assert.equal('updatedAt' in place, false);
  record.aliases.push('changed');
  assert.deepEqual(place.aliases, ['Dehradun']);
});

test('Lens rejects invalid points and preserves bounded extents', () => {
  for (const record of [
    { lat: null, lon: 10 },
    { lat: '', lon: 10 },
    { lat: 91, lon: 10 },
    { lat: 10, lon: Infinity },
    { geometry: { type: 'Point', coordinates: [0, 200] } },
  ])
    assert.equal(normalizeLensSelection(record), null);
  const record = normalizeLensSelection({
    label: 'Area',
    latitude: 30,
    longitude: 78,
    extent: [77, 29, 79, 31],
  });
  assert.deepEqual(record.extent, [77, 29, 79, 31]);
  assert.equal(
    normalizeLensSelection({ lat: 0, lon: 0, extent: [-181, -90, 180, 90] })
      .extent,
    null,
  );
});

test('Layer counts are never converted to local observations or local absence', () => {
  const evidence = buildLensEvidence({
    selection: normalizeLensSelection({ lat: 30, lon: 78 }),
    layers: [
      {
        id: 'firms',
        name: 'Fire detections',
        enabled: true,
        stats: { count: 0, source: 'FIRMS', lastUpdate: 1700000000000 },
      },
    ],
    mapSource: { id: 'offline-overview', label: 'Natural Earth' },
  });
  assert.equal(evidence.length, 2);
  const feed = evidence.find((item) => item.sourceId === 'firms');
  assert.equal('count' in feed, false);
  assert.equal(feed.coverage, 'unknown');
  assert.equal(feed.applicableTime, null);
  assert.equal(feed.retrievedAt, null);
  assert.equal(feed.kind, 'unknown');
  assert.equal(feed.feedUpdatedAt, 1700000000000);
  assert.equal(feed.scope, 'layer');
});

test('Explicit evidence metadata remains separate from retrieval and camera altitude', () => {
  const result = buildLensEvidence({
    selection: normalizeLensSelection({ lat: 0, lon: 0, alt: 5 }),
    mapSource: {
      id: 'dated',
      label: 'Dated imagery',
      applicableTime: 946684800000,
      retrievedAt: 1700000000000,
      resolutionM: 10,
      coverage: 'partial',
    },
  })[0];
  assert.equal(result.kind, 'imagery');
  assert.equal(result.applicableTime, 946684800000);
  assert.equal(result.retrievedAt, 1700000000000);
  assert.equal(result.resolutionM, 10);
  assert.equal(result.coverage, 'partial');
  const unknown = buildLensEvidence({
    selection: normalizeLensSelection({ lat: 0, lon: 0, alt: 5 }),
    mapSource: { id: 'map' },
  })[0];
  assert.equal(unknown.resolutionM, null);
  assert.equal(unknown.applicableTime, null);
});

test('Untrusted unknown metadata fails to unknown, rather than zero uncertainty', () => {
  const result = buildLensEvidence({
    selection: normalizeLensSelection({ lat: 0, lon: 0 }),
    mapSource: {
      id: 'map',
      resolutionM: -1,
      uncertaintyM: 0,
      applicableTime: 'nonsense',
      coverage: 'everywhere',
    },
  })[0];
  assert.equal(result.resolutionM, null);
  assert.equal(result.uncertainty, 0);
  assert.equal(result.applicableTime, null);
  assert.equal(result.coverage, 'unknown');
});

test('unqualified uncertainty is not silently converted into metres', () => {
  const row = buildLensEvidence({
    selection: normalizeLensSelection({ lat: 0, lon: 0 }),
    mapSource: { id: 'map', uncertainty: 0.9 },
  })[0];
  assert.equal(row.uncertainty, null);
});

test('normalized evidence keeps explicit metre uncertainty through repeated projections', () => {
  const first = normalizeLensEvidence({ sourceId: 'survey', uncertaintyM: 12 });
  const second = normalizeLensEvidence(first);
  assert.equal(second.uncertainty, 12);
  const rows = buildLensEvidence({
    selection: normalizeLensSelection({ lat: 30.3, lon: 78 }),
    selectedSource: first,
  });
  assert.equal(rows[0].uncertainty, 12);
});

test('never-refreshed source timestamps remain unknown rather than January 1970', () => {
  for (const lastUpdate of [null, undefined, 0]) {
    const rows = buildLensEvidence({
      selection: normalizeLensSelection({ lat: 0, lon: 0 }),
      layers: [{ id: 'pending', enabled: true, stats: { lastUpdate } }],
    });
    assert.equal(rows[0].feedUpdatedAt, null);
  }
});
