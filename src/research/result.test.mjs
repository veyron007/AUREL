import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysisResult, validateSearchResult } from './result.js';
import { resultFixture } from './testFixtures.mjs';
const query = (result) => ({ sceneId: result.sceneId, ...result.requested });
test('analysis validation binds requested point, scene, grid, footprint, metadata and recomputed statistics', () => {
  const raw = resultFixture(),
    value = validateAnalysisResult(raw, query(raw));
  assert.equal(value.values.length, 16384);
  assert.notEqual(value, raw);
  assert.ok(Object.isFrozen(value.values));
  raw.values[0] = 0;
  assert.ok(value.values[0] > 0.49);
});
test('tampered raster counts, indices, geometry, URLs and metadata reject', () => {
  for (const mutate of [
    (x) => x.statistics.validPixels--,
    (x) => (x.values[0] = 2),
    (x) => (x.grid.width = 256),
    (x) => (x.footprint.coordinates[0][0][0] += 1),
    (x) => (x.provenance.link = 'https://evil.example'),
    (x) => (x.provenance.bands[0].offset = 1),
    (x) => (x.requested.lat += 1),
    (x) => (x.secret = 'hidden'),
  ]) {
    const raw = resultFixture(),
      expected = query(raw);
    mutate(raw);
    assert.throws(() => validateAnalysisResult(raw, expected));
  }
});
test('bounded rejection envelopes remain data; search cannot smuggle assets or a different request', () => {
  const expected = {
    lat: 30,
    lon: 78,
    fromDay: '2026-10-01',
    toDay: '2026-10-31',
  };
  const raw = {
    version: 1,
    status: 'available',
    reason: null,
    requested: expected,
    retrievedAt: '2026-11-07T12:00:00.000Z',
    scenes: [
      {
        id: 'S2B_43RGP_20261025_0_L2A',
        acquiredAt: '2026-10-25T05:40:34.715Z',
        cloudCoverPct: 3,
        resolutionM: 10,
        maskResolutionM: 20,
        processingBaseline: '05.13',
      },
    ],
  };
  assert.equal(validateSearchResult(raw, expected).scenes.length, 1);
  raw.scenes[0].url = 'https://evil.example';
  assert.throws(() => validateSearchResult(raw, expected));
  assert.equal(
    validateAnalysisResult(
      {
        version: 1,
        status: 'rejected',
        reason: 'busy',
        sceneId: 'S2B_43RGP_20261025_0_L2A',
      },
      {
        sceneId: 'S2B_43RGP_20261025_0_L2A',
        lat: 30,
        lon: 78,
        sizePixels: 128,
      },
    ).reason,
    'busy',
  );
});
