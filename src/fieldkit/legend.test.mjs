import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAYER_CLASSES,
  LEGEND_FOOTNOTE,
  UNCLASSIFIED,
  buildViewLegend,
  isCompleteLegend,
  legendLines,
} from './legend.js';
import { ENVELOPE_CLASSES } from './envelope.js';

const NOW = Date.parse('2026-11-08T00:30:00.000Z');
const layer = (id, enabled, stats = {}) => ({
  id,
  name: id.toUpperCase(),
  enabled,
  stats,
});

test('the legend lists every visible layer with a class and a timestamp field', () => {
  const rows = buildViewLegend(
    [
      layer('earthquakes', true, {
        count: 3,
        lastUpdate: NOW - 60000,
        source: 'USGS',
      }),
      layer('traffic', true, { count: 40, source: 'sim', lastUpdate: NOW }),
      layer('satellites', true, { count: 9 }),
      layer('flights', false, { count: 100, lastUpdate: NOW }),
      layer('brand-new-layer', true, { count: 1 }),
    ],
    { now: NOW, baseMap: { label: 'Esri World Imagery' } },
  );
  assert.ok(isCompleteLegend(rows));
  assert.deepEqual(
    rows.map((row) => [row.id, row.class]),
    [
      ['base-map', 'observed'],
      ['brand-new-layer', UNCLASSIFIED],
      ['earthquakes', 'observed'],
      ['satellites', 'modelled'],
      ['traffic', 'simulated'],
    ],
  );
  assert.equal(
    rows.find((row) => row.id === 'earthquakes').updated_at,
    '2026-11-08T00:29:00.000Z',
  );
  assert.equal(rows.find((row) => row.id === 'satellites').updated_at, null);
  assert.ok(!rows.some((row) => row.id === 'flights'));
});

test('printed lines name the class and time, or say they are unknown', () => {
  const lines = legendLines(
    buildViewLegend(
      [
        layer('traffic', true, { source: 'sim', lastUpdate: NOW }),
        layer('mystery', true, {}),
      ],
      { now: NOW },
    ),
  );
  assert.deepEqual(lines, [
    'MYSTERY — class not recorded · time unknown',
    'TRAFFIC — simulated · updated 2026-11-08 00:30Z',
  ]);
  assert.match(LEGEND_FOOTNOTE, /not each feature/);
});

test('traffic counts as observed only for nominal TomTom flow', () => {
  const [row] = buildViewLegend(
    [layer('traffic', true, { source: 'TomTom', lastUpdate: NOW, count: 5 })],
    { now: NOW },
  );
  assert.equal(row.class, 'observed');
});

test('every recorded layer class is an envelope class', () => {
  for (const [id, cls] of Object.entries(LAYER_CLASSES))
    assert.ok(ENVELOPE_CLASSES.includes(cls), id);
});
