import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitSentinelItem,
  validateAnalysisInput,
  validateSearchInput,
} from './metadata.js';
const id = 'S2B_43RGP_20261025_0_L2A';
import { itemFixture } from './testFixtures.mjs';
test('STAC admission preserves exact science scale, UTM grid and canonical acquisition', () => {
  const value = admitSentinelItem(itemFixture(), id);
  assert.equal(value.red.offset, -0.1);
  assert.equal(value.epsg, 32643);
  assert.equal(value.acquiredAt, '2026-10-25T05:40:34.715Z');
});
test('unsupported assets, altered scene IDs, bad projection and mismatched spectral grids reject', () => {
  for (const mutate of [
    (x) => (x.assets.red.href += '?token=x'),
    (x) => (x.id = 'other'),
    (x) => (x.properties['proj:epsg'] = 4326),
    (x) => (x.assets.red['raster:bands'][0].offset = undefined),
    (x) => (x.assets.nir['proj:transform'][2] += 10),
  ]) {
    const x = itemFixture();
    mutate(x);
    assert.throws(() => admitSentinelItem(x, id));
  }
});
test('analysis and search reject excessive ROI/date windows and unexpected parameters', () => {
  assert.equal(
    validateAnalysisInput({ sceneId: id, lat: 30, lon: 78, sizePixels: 128 })
      .sizePixels,
    128,
  );
  assert.throws(() =>
    validateAnalysisInput({ sceneId: id, lat: 30, lon: 78, sizePixels: 512 }),
  );
  assert.throws(() =>
    validateAnalysisInput({
      sceneId: id,
      lat: 30,
      lon: 78,
      sizePixels: 128,
      url: 'https://localhost',
    }),
  );
  assert.equal(
    validateSearchInput({
      lat: 30,
      lon: 78,
      fromDay: '2026-10-01',
      toDay: '2026-10-31',
    }).fromDay,
    '2026-10-01',
  );
  assert.throws(() =>
    validateSearchInput({
      lat: 30,
      lon: 78,
      fromDay: '2026-01-01',
      toDay: '2026-10-31',
    }),
  );
  assert.throws(() =>
    validateSearchInput({
      lat: 30,
      lon: 78,
      fromDay: '2026-02-30',
      toDay: '2026-03-01',
    }),
  );
});
