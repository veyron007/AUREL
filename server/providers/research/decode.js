import { GeoTIFF } from 'geotiff';
import proj4 from 'proj4';
import { createRangeSource, createRangeBudget } from './rangeSource.js';
import { calculateNdvi } from '../../../src/research/ndvi.js';
import { validateAnalysisInput } from './metadata.js';
function projection(epsg) {
  return `+proj=utm +zone=${epsg % 100} ${epsg >= 32700 ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
}
export function planWindows(item, input) {
  validateAnalysisInput({ ...input, sceneId: item.id });
  const [x, y] = proj4('EPSG:4326', projection(item.epsg), [
    input.lon,
    input.lat,
  ]);
  const col = Math.floor(
    (x - item.red.transform[2]) / 10 - input.sizePixels / 2,
  );
  const row = Math.floor(
    (item.red.transform[5] - y) / 10 - input.sizePixels / 2,
  );
  const red = [col, row, col + input.sizePixels, row + input.sizePixels];
  if (
    !red.every(Number.isSafeInteger) ||
    col < 0 ||
    row < 0 ||
    red[2] > item.red.width ||
    red[3] > item.red.height
  )
    throw new Error('scene-does-not-cover-roi');
  return {
    red,
    nir: [...red],
    scl: [
      Math.floor(col / 2),
      Math.floor(row / 2),
      Math.ceil(red[2] / 2),
      Math.ceil(red[3] / 2),
    ],
  };
}
export function verifyImage(image, band) {
  const origin = image.getOrigin(),
    resolution = image.getResolution(),
    keys = image.getGeoKeys();
  if (
    image.fileDirectory?.hasTag('ModelTransformation') ||
    image.getWidth() !== band.width ||
    image.getHeight() !== band.height ||
    image.getSamplesPerPixel() !== 1 ||
    !image.isTiled ||
    !Number.isInteger(image.getTileWidth()) ||
    !Number.isInteger(image.getTileHeight()) ||
    image.getTileWidth() < 1 ||
    image.getTileHeight() < 1 ||
    image.getTileWidth() > 1024 ||
    image.getTileHeight() > 1024 ||
    keys?.ProjectedCSTypeGeoKey !== band.epsg ||
    keys.GTRasterTypeGeoKey !== 1 ||
    origin[0] !== band.transform[2] ||
    origin[1] !== band.transform[5] ||
    resolution[0] !== band.transform[0] ||
    resolution[1] !== band.transform[4] ||
    image.getGDALNoData() !== 0 ||
    image.getBitsPerSample() !== (band.band === 'SCL' ? 8 : 16) ||
    image.getSampleFormat() !== 1
  )
    throw new Error('unsupported-tiff-grid');
}
function roiBand(band, window, data) {
  const [x, y, endX, endY] = window;
  return {
    ...band,
    data,
    width: endX - x,
    height: endY - y,
    transform: [
      band.transform[0],
      0,
      band.transform[2] + x * band.transform[0],
      0,
      band.transform[4],
      band.transform[5] + y * band.transform[4],
    ],
  };
}
export async function decodeSentinelRoi(
  item,
  input,
  { fetchImpl = fetch, signal, now = Date.now, openImage } = {},
) {
  const windows = planWindows(item, input),
    budget = createRangeBudget();
  const bands = {};
  for (const name of ['red', 'nir', 'scl']) {
    signal?.throwIfAborted();
    const band = item[name];
    let tiff;
    try {
      const image = openImage
        ? await openImage(band)
        : await (tiff = await GeoTIFF.fromSource(
            createRangeSource(band.url, { fetchImpl, budget }),
            undefined,
            signal,
          )).getImage(0);
      verifyImage(image, band);
      const data = await image.readRasters({
        window: windows[name],
        samples: [0],
        interleave: true,
        signal,
      });
      signal?.throwIfAborted();
      bands[name] = roiBand(band, windows[name], data);
    } finally {
      await tiff?.close();
    }
  }
  const result = calculateNdvi({
    ...bands,
    scene: { ...item, retrievedAt: new Date(now()).toISOString() },
  });
  const transform = result.grid.transform;
  const corners = [
    [0, 0],
    [result.grid.width, 0],
    [result.grid.width, result.grid.height],
    [0, result.grid.height],
    [0, 0],
  ].map(([x, y]) =>
    proj4(projection(item.epsg), 'EPSG:4326', [
      transform[2] + x * 10,
      transform[5] - y * 10,
    ]),
  );
  return {
    ...result,
    requested: { lat: input.lat, lon: input.lon, sizePixels: input.sizePixels },
    footprint: { type: 'Polygon', coordinates: [corners] },
    transfer: budget.snapshot(),
  };
}
