import assert from 'node:assert/strict';
import test from 'node:test';
import { coreTools, composeCatalog, toolsForSurface } from '../tools/index.js';
import {
  ENVELOPE_CLASSES,
  ENVELOPE_SCHEMA,
  READ_TOOL_PROVENANCE,
  applicableTimeOf,
  createEnvelope,
  envelopeForResult,
  envelopeInterceptor,
  validateEnvelope,
} from './envelope.js';

const NOW = Date.parse('2026-11-08T00:30:00.000Z');
const SOURCE = { id: 's', label: 'Source', licence: 'CC BY 4.0', url: null };

test('the envelope schema has exactly the five classes', () => {
  assert.deepEqual(ENVELOPE_CLASSES, [
    'observed',
    'modelled',
    'derived',
    'simulated',
    'note',
  ]);
});

test('every read tool offered on MCP has recorded provenance', () => {
  const offered = toolsForSurface(coreTools, 'mcp')
    .filter((tool) => tool.ui?.visibility?.includes('model') !== false)
    .map((tool) => tool.name);
  const missing = offered.filter((name) => !READ_TOOL_PROVENANCE[name]);
  assert.deepEqual(missing, []);
  for (const [name, entry] of Object.entries(READ_TOOL_PROVENANCE)) {
    assert.ok(ENVELOPE_CLASSES.includes(entry.class), name);
    assert.ok(entry.sources.length > 0, name);
    for (const source of entry.sources) assert.ok(source.licence, name);
  }
});

test('createEnvelope validates and says when the applicable time is unknown', () => {
  const envelope = createEnvelope({
    tool: 't',
    cls: 'observed',
    sources: [SOURCE],
    retrievedAt: '2026-11-08T00:30:00.000Z',
  });
  assert.equal(envelope.schema, ENVELOPE_SCHEMA);
  assert.equal(envelope.applicable_time, null);
  assert.match(envelope.note, /treat it as unknown/);
  assert.ok(Object.isFrozen(envelope));
  for (const bad of [
    { ...envelope, class: 'guessed' },
    { ...envelope, sources: [] },
    { ...envelope, sources: [{ id: 's', label: 'x', url: null }] },
    { ...envelope, retrieved_at: 'yesterday' },
    {
      ...envelope,
      applicable_time: {
        from: '2026-11-08T00:00:00.000Z',
        to: '2026-11-07T00:00:00.000Z',
      },
    },
    { ...envelope, schema: 'other' },
  ])
    assert.throws(() => validateEnvelope(bad), /Invalid provenance envelope/);
});

test('applicable time spans the rows and top-level times the tool returned', () => {
  assert.deepEqual(
    applicableTimeOf({
      rows: [
        { time: '2026-11-07T10:00:00Z' },
        { time: '2026-11-07T08:00:00Z' },
        { time: null },
      ],
    }),
    { from: '2026-11-07T08:00:00.000Z', to: '2026-11-07T10:00:00.000Z' },
  );
  assert.equal(applicableTimeOf({ rows: [{ name: 'x' }] }), null);
  assert.equal(applicableTimeOf(null), null);
});

test('read results get an envelope without their data changing', async () => {
  const catalog = composeCatalog({
    tools: coreTools,
    services: {
      earthquakes: {
        getSnapshot: async () => [
          {
            usgsId: 'us1',
            mag: 5.1,
            place: 'near Uttarkashi',
            time: Date.parse('2026-11-07T22:10:00Z'),
            lat: 30.7,
            lon: 78.4,
            depthKm: 10,
          },
        ],
      },
      app: { baseUrl: 'http://localhost:4173' },
    },
    interceptors: [envelopeInterceptor({ now: () => NOW })],
  });
  const plain = await composeCatalog({
    tools: coreTools,
    services: {
      earthquakes: {
        getSnapshot: async () => [
          {
            usgsId: 'us1',
            mag: 5.1,
            place: 'near Uttarkashi',
            time: Date.parse('2026-11-07T22:10:00Z'),
            lat: 30.7,
            lon: 78.4,
            depthKm: 10,
          },
        ],
      },
      app: { baseUrl: 'http://localhost:4173' },
    },
  }).call('get_earthquakes', {});
  const result = await catalog.call('get_earthquakes', {});
  assert.deepEqual(result.data, plain.data);
  assert.equal(result.summary, plain.summary);
  assert.equal(result.envelope.class, 'observed');
  assert.equal(result.envelope.sources[0].id, 'usgs');
  assert.equal(result.envelope.sources[0].licence, 'U.S. public domain');
  assert.deepEqual(result.envelope.applicable_time, {
    from: '2026-11-07T22:10:00.000Z',
    to: '2026-11-07T22:10:00.000Z',
  });
  assert.equal(result.envelope.retrieved_at, '2026-11-08T00:30:00.000Z');
});

test('an unlisted tool is marked derived with unrecorded provenance, never observed', () => {
  const envelope = envelopeForResult('mystery', { data: {} }, { now: NOW });
  assert.equal(envelope.class, 'derived');
  assert.match(envelope.note, /not recorded/);
});

test('traffic is simulated, weather and satellites modelled', () => {
  assert.equal(READ_TOOL_PROVENANCE.get_traffic_flow.class, 'simulated');
  assert.equal(READ_TOOL_PROVENANCE.get_weather.class, 'modelled');
  assert.equal(READ_TOOL_PROVENANCE.satellites_overhead.class, 'modelled');
});

test('the interceptor leaves app-only and nested calls alone', async () => {
  const intercept = envelopeInterceptor({ now: () => NOW });
  const next = async () => ({ summary: 's', data: {} });
  const appOnly = await intercept(
    { tool: { name: 'panel_request', ui: { visibility: ['app'] } } },
    next,
  );
  assert.equal(appOnly.envelope, undefined);
  const nested = await intercept(
    { tool: { name: 'get_weather' }, parent: 'situation_brief' },
    next,
  );
  assert.equal(nested.envelope, undefined);
  const own = await intercept({ tool: { name: 'x' } }, async () => ({
    summary: 's',
    data: {},
    envelope: { mine: true },
  }));
  assert.deepEqual(own.envelope, { mine: true });
});
