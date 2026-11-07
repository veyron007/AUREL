import test from 'node:test';
import assert from 'node:assert/strict';
import { planWindows, verifyImage, decodeSentinelRoi } from './decode.js';
import { admitSentinelItem } from './metadata.js';
import { itemFixture } from './testFixtures.mjs';
const item = () => admitSentinelItem(itemFixture(), 'S2B_43RGP_20261025_0_L2A');
test('native UTM ROI is bounded and SCL window encloses red pixel centers', () => {
  const windows = planWindows(item(), {
    lat: 30.3258,
    lon: 78.0438,
    sizePixels: 256,
  });
  assert.equal(windows.red[2] - windows.red[0], 256);
  assert.ok(windows.scl[2] - windows.scl[0] <= 129);
  assert.throws(() => planWindows(item(), { lat: 0, lon: 0, sizePixels: 256 }));
});
function image(band) {
  return {
    getWidth: () => band.width,
    getHeight: () => band.height,
    getSamplesPerPixel: () => 1,
    isTiled: true,
    getTileWidth: () => 1024,
    getTileHeight: () => 1024,
    getGeoKeys: () => ({
      ProjectedCSTypeGeoKey: band.epsg,
      GTRasterTypeGeoKey: 1,
    }),
    getOrigin: () => [band.transform[2], band.transform[5], 0],
    getResolution: () => [band.transform[0], band.transform[4], 0],
    getGDALNoData: () => 0,
    getBitsPerSample: () => (band.band === 'SCL' ? 8 : 16),
    getSampleFormat: () => 1,
  };
}
test('TIFF projection, grid, pixel type and decode tile bounds must match metadata', () => {
  const band = item().red;
  verifyImage(image(band), band);
  for (const change of [
    (x) => (x.getWidth = () => 999),
    (x) => (x.getTileWidth = () => 16384),
    (x) => (x.getOrigin = () => [0, 0, 0]),
    (x) => (x.getGeoKeys = () => ({ ProjectedCSTypeGeoKey: 4326 })),
  ]) {
    const value = image(band);
    change(value);
    assert.throws(() => verifyImage(value, band));
  }
});
test('decoder asks only for native bounded windows and never RGB or overview resampling', async () => {
  const metadata = item();
  const calls = [];
  const result = await decodeSentinelRoi(
    metadata,
    { lat: 30.3258, lon: 78.0438, sizePixels: 128 },
    {
      openImage: async (band) => ({
        ...image(band),
        readRasters: async (opts) => {
          calls.push(opts);
          return new Uint16Array(
            (opts.window[2] - opts.window[0]) *
              (opts.window[3] - opts.window[1]),
          ).fill(band.band === 'SCL' ? 4 : band.band === 'B04' ? 2000 : 4000);
        },
      }),
      now: () => Date.parse('2026-11-07T12:00:00Z'),
    },
  );
  assert.equal(result.status, 'available');
  assert.equal(result.values.length, 128 * 128);
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every((x) => x.samples.length === 1 && !x.width && !x.height),
  );
});
