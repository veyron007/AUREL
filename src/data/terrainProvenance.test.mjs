import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchTerrainChunkWithRetry,
  terrainProfileCache,
} from './terrainHeightsProxy.js';
import { createApplicationRequestServices } from '../services/requests.js';

test('upstream terrain datum and retrieval time travel with each cached height', async () => {
  const rows = await fetchTerrainChunkWithRetry([[78.03, 30.31]], {
    now: () => Date.parse('2026-11-07T00:00:00Z'),
    fetchImpl: async () =>
      Response.json({
        tileset: 'mapterhorn-egm08',
        version: '5',
        results: [
          {
            lat: 30.31,
            lon: 78.03,
            elevation: 651.617,
            geoid: -43.138,
            ellipsoid: 608.479,
          },
        ],
      }),
  });
  assert.deepEqual(rows[0].provenance, {
    tileset: 'mapterhorn-egm08',
    version: '5',
    retrievedAt: '2026-11-07T00:00:00.000Z',
  });
  assert.equal(rows[0].elevation, 651.617);
  assert.equal(rows[0].ellipsoid, 608.479);
});

test('profile cache refreshes unprovenanced legacy rows without deleting renderer data', () => {
  const raw = new Map([
    ['old', { at: 1, result: { ellipsoid: 200 } }],
    [
      '78.03000,30.31000',
      {
        at: 2,
        result: {
          lat: 30.31,
          lon: 78.03,
          ellipsoid: 10,
          elevation: 20,
          provenance: {
            tileset: 'mapterhorn-egm08',
            version: '5',
            retrievedAt: '2026-11-07T00:00:00.000Z',
          },
        },
      },
    ],
  ]);
  const cache = terrainProfileCache(raw);
  assert.equal(cache.get('old'), undefined);
  assert.ok(raw.get('old'));
  assert.deepEqual(
    cache.get('78.03000,30.31000'),
    raw.get('78.03000,30.31000'),
  );
  cache.set('new', { at: 3, result: { ellipsoid: 7 } });
  assert.equal(raw.get('new').result.ellipsoid, 7);
});

test('profile request opts into provenance while the renderer endpoint stays unchanged', async () => {
  const urls = [];
  const services = createApplicationRequestServices({
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ results: [{ elevation: 20, ellipsoid: 10 }] });
    },
  });
  assert.deepEqual(
    await services.terrain.getProfileHeights([{ lat: 30, lon: 78 }]),
    [{ elevation: 20, ellipsoid: 10 }],
  );
  await services.terrain.getHeights([{ lat: 30, lon: 78 }]);
  assert.match(urls[0], /provenance=1/);
  assert.doesNotMatch(urls[1], /provenance/);
});

test('analytical provenance requires matching coordinates, and mismatches are never served', async () => {
  const rows = await fetchTerrainChunkWithRetry(
    [
      [78, 30],
      [79, 31],
      [80, 32],
    ],
    {
      fetchImpl: async () =>
        Response.json({
          tileset: 'mapterhorn-egm08',
          version: '5',
          results: [
            { lat: 50, lon: 0, elevation: 5000, ellipsoid: 5000 },
            {
              elevation: 100,
              ellipsoid: 100,
              provenance: { tileset: 'forged' },
            },
            { lat: 32, lon: 80, elevation: 200, ellipsoid: 200 },
          ],
        }),
    },
  );
  assert.equal(rows[0], null);
  assert.equal(rows[1].provenance, undefined);
  assert.equal(rows[2].provenance.tileset, 'mapterhorn-egm08');
  const cache = terrainProfileCache(
    new Map([['0.00000,0.00000', { result: rows[2] }]]),
  );
  assert.equal(cache.get('0.00000,0.00000'), undefined);
});
