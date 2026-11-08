import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeFirmsColumns, encodeFirmsColumns } from './firmsColumns.js';

const SATELLITES = ['N20', 'N21', 'N', 'Terra', 'Aqua'];
const CONFIDENCE = ['l', 'n', 'h', 0, 42, 100];

/** Deterministic PRNG so a failure reproduces. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Records in the parseFirmsCsv shape, with the odd values real feeds hold. */
function fixtureRecords(count, seed) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  return Array.from({ length: count }, () => ({
    lat: Number((random() * 180 - 90).toFixed(5)),
    lon: Number((random() * 360 - 180).toFixed(5)),
    frp: random() < 0.1 ? 0 : Number((random() * 900).toFixed(2)),
    confidence: pick(CONFIDENCE),
    brightness: Number((280 + random() * 120).toFixed(2)),
    brightnessTi5: Number((260 + random() * 60).toFixed(2)),
    daynight: pick(['D', 'N', '']),
    acqDate: pick(['2026-11-07', '2026-11-08']),
    acqTime: String(Math.floor(random() * 2400)),
    satellite: pick(SATELLITES),
    instrument: pick(['VIIRS', 'MODIS']),
  }));
}

/** What the row body hands a client: the records after a JSON round trip. */
function viaJson(value) {
  return JSON.parse(JSON.stringify(value));
}

test('decoding the columnar body yields the row body records exactly', () => {
  for (const seed of [1, 7, 99]) {
    const records = fixtureRecords(2_000, seed);
    const columnar = viaJson(encodeFirmsColumns(records));
    assert.deepStrictEqual(decodeFirmsColumns(columnar), viaJson(records));
  }
});

test('mixed, missing and null values survive the round trip', () => {
  const records = [
    { lat: 1, lon: 2, frp: 3, confidence: 'n', satellite: 'N20' },
    { lat: 4, lon: 5, frp: 'x', confidence: 80, extra: null },
    { lat: 6, lon: 7, confidence: null },
    { lat: 8, lon: 9, frp: undefined, satellite: undefined },
  ];
  const columnar = viaJson(encodeFirmsColumns(records));
  assert.deepStrictEqual(decodeFirmsColumns(columnar), viaJson(records));
});

test('an empty set encodes and decodes to an empty set', () => {
  assert.deepStrictEqual(
    decodeFirmsColumns(viaJson(encodeFirmsColumns([]))),
    [],
  );
});

test('numeric fields go plain, repeated text goes through a dictionary', () => {
  const encoded = encodeFirmsColumns(fixtureRecords(500, 3));
  assert.equal(encoded.dictionaries.lat, undefined);
  assert.equal(encoded.dictionaries.frp, undefined);
  assert.ok(encoded.dictionaries.satellite.length <= SATELLITES.length);
  assert.ok(encoded.dictionaries.acqDate.length <= 2);
});

test('the columnar body is much smaller than the row body', () => {
  const records = fixtureRecords(5_000, 11);
  const rows = JSON.stringify(records).length;
  const columns = JSON.stringify(encodeFirmsColumns(records)).length;
  assert.ok(columns < rows * 0.6, `${columns} vs ${rows}`);
});

test('a malformed columnar body is rejected, never read as fewer fires', () => {
  const good = viaJson(encodeFirmsColumns(fixtureRecords(10, 5)));
  const shortColumn = {
    ...good,
    columns: { ...good.columns, lon: good.columns.lon.slice(1) },
  };
  const badIndex = {
    ...good,
    columns: {
      ...good.columns,
      satellite: good.columns.satellite.map(() => 9),
    },
  };
  for (const payload of [
    {},
    { fields: 'lat', columns: {} },
    { fields: ['lat'], columns: { lat: 'x' } },
    shortColumn,
    badIndex,
  ]) {
    assert.throws(() => decodeFirmsColumns(payload), /[Cc]olumnar fire/);
  }
});
