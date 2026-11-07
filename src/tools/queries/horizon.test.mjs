// i18n-ignore-file: horizon_at tool fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeCatalog, coreTools, toolsForSurface } from '../index.js';
import { createHorizonService } from '../../horizon/service.js';
import { syntheticPayload } from '../../horizon/testFixtures.mjs';

const payload = syntheticPayload({
  groundM: 2000,
  radiusKm: 20,
  height: (az, d) => (az >= 60 && az <= 120 && Math.abs(d - 6000) < 60 ? 2500 : 1800),
});
function catalog(respond) {
  const fetchImpl = async (url) => {
    if (url.startsWith('/api/horizon/terrain')) return respond(url);
    return new Response('missing', { status: 404 });
  };
  return composeCatalog({
    tools: coreTools,
    services: { horizon: createHorizonService({ fetchImpl }) },
  });
}

test('horizon_at is offered on MCP and returns a provenance envelope', async () => {
  assert.ok(toolsForSurface(coreTools, 'mcp').some((tool) => tool.name === 'horizon_at'));
  assert.ok(!toolsForSurface(coreTools, 'voice').some((tool) => tool.name === 'horizon_at'));
  const tools = catalog(() => new Response(JSON.stringify(payload), { status: 200 }));
  const result = await tools.call('horizon_at', {
    lat: 30.4597,
    lon: 78.1058,
    date: '2026-12-21',
    time: '12:30',
    radiusKm: 20,
  });
  assert.match(result.summary, /Terrain-only horizon at 30\.4597, 78\.1058 on 2026-12-21/);
  assert.match(result.summary, /Geometric visibility, terrain-only\.$/);
  assert.equal(result.data.kind, 'aurel.horizon');
  assert.equal(result.data.label, 'geometric visibility, terrain-only');
  assert.equal(result.data.refractionK, 0.13);
  assert.equal(result.data.shadow.at, '2026-12-21T07:00:00.000Z');
  assert.equal(result.data.sun.terrainRise.class, 'derived');
  assert.equal(result.data.sun.astronomicalRise.class, 'modelled');
  assert.equal(result.data.observer.groundM.class, 'observed');
  assert.ok(result.data.sources.some((source) => source.id === 'copernicus-glo30'));
  assert.ok(Date.parse(result.data.sun.terrainRise.value) > Date.parse(result.data.sun.astronomicalRise.value));
});

test('horizon_at refuses bad arguments and maps provider limits', async () => {
  const tools = catalog(() =>
    new Response(JSON.stringify({ error: 'Horizon request limit reached' }), { status: 429 }),
  );
  await assert.rejects(tools.call('horizon_at', { lat: 95, lon: 78 }), (error) => error.code === 'invalid_arguments');
  await assert.rejects(
    tools.call('horizon_at', { lat: 30, lon: 78, timeZone: 'Nowhere/Zone' }),
    (error) => error.code === 'invalid_arguments',
  );
  await assert.rejects(
    tools.call('horizon_at', { lat: 30, lon: 78, date: '2026-12-21' }),
    (error) => error.code === 'retry_later' && /limit/.test(error.message),
  );
});
