import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNdvi } from './ndvi.js';
const scene = {
  id: 'S2B_43RGP_20261025_0_L2A',
  acquiredAt: '2026-10-25T05:40:34.715Z',
  retrievedAt: '2026-11-07T12:00:00.000Z',
  processingBaseline: '05.13',
};
function input() {
  const grid = {
    width: 2,
    height: 2,
    epsg: 32643,
    transform: [10, 0, 700000, 0, -10, 3400000],
  };
  return {
    scene,
    red: {
      ...grid,
      band: 'B04',
      data: new Uint16Array([2000, 2000, 2000, 2000]),
      scale: 0.0001,
      offset: -0.1,
      noData: 0,
    },
    nir: {
      ...grid,
      band: 'B08',
      data: new Uint16Array([4000, 4000, 4000, 4000]),
      scale: 0.0001,
      offset: -0.1,
      noData: 0,
    },
    scl: {
      width: 1,
      height: 1,
      epsg: 32643,
      transform: [20, 0, 700000, 0, -20, 3400000],
      data: new Uint8Array([4]),
      noData: 0,
    },
  };
}
test('NDVI uses actual reflectance scale and offset, preserves inputs and native provenance', () => {
  const source = input();
  const before = structuredClone(source);
  const result = calculateNdvi(source);
  assert.equal(result.status, 'available');
  assert.ok(result.values.every((value) => Math.abs(value - 0.5) < 1e-12));
  assert.equal(result.statistics.validPixels, 4);
  assert.equal(result.grid.resolutionM, 10);
  assert.equal(result.provenance.mask.resolutionM, 20);
  assert.equal(result.provenance.bands[0].offset, -0.1);
  assert.deepEqual(source, before);
});
test('clouds, shadows, snow and unknown categories are excluded rather than zero vegetation', () => {
  for (const category of [0, 1, 2, 3, 7, 8, 9, 10, 11, 99]) {
    const source = input();
    source.scl.data[0] = category;
    const result = calculateNdvi(source);
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, 'no-valid-pixels');
    assert.deepEqual(result.values, [null, null, null, null]);
    assert.equal(result.statistics.mean, null);
  }
});
test('nodata, negative reflectance and near-zero denominator remain explicit gaps', () => {
  const source = input();
  source.red.data = [0, 999, 1000, 2000];
  source.nir.data = [4000, 4000, 1000, 4000];
  const result = calculateNdvi(source);
  assert.deepEqual(result.values.slice(0, 3), [null, null, null]);
  assert.equal(result.statistics.validPixels, 1);
});
test('SCL nearest categorical sampling uses world pixel centers across uneven crop origins', () => {
  const source = input();
  source.red.transform = source.nir.transform = [
    10, 0, 700010, 0, -10, 3400000,
  ];
  source.scl.width = 2;
  source.scl.data = [4, 9];
  const result = calculateNdvi(source);
  assert.ok(result.values[0] > 0.49);
  assert.equal(result.values[1], null);
  assert.ok(result.values[2] > 0.49);
  assert.equal(result.values[3], null);
});
test('unbounded rasters, wrong bands, unsupported scale and mismatched grids reject before computation', () => {
  for (const change of [
    (x) => (x.red.width = 257),
    (x) => (x.red.band = 'RGB'),
    (x) => (x.red.scale = 1),
    (x) => (x.nir.transform = [10, 0, 700010, 0, -10, 3400000]),
    (x) => (x.scl.epsg = 32644),
    (x) => (x.red.data = [2000]),
    (x) => (x.red.transform = [10, 1, 700000, 0, -10, 3400000]),
  ]) {
    const x = input();
    change(x);
    assert.throws(() => calculateNdvi(x));
  }
});
