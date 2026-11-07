/** Native Sentinel-2 BOA reflectance only; display RGB is never an admitted input. */
export const NDVI_MAX_SIDE = 256;
export const NDVI_MIN_DENOMINATOR = 1e-6;
const CLEAR_CLASSES = [4, 5, 6];
const fail = () => {
  throw new Error('Invalid bounded Sentinel science input');
};
function grid(band, resolution, maxSide) {
  if (
    !band ||
    !Number.isInteger(band.width) ||
    !Number.isInteger(band.height) ||
    band.width < 1 ||
    band.height < 1 ||
    band.width > maxSide ||
    band.height > maxSide ||
    !Number.isInteger(band.epsg) ||
    !(
      (band.epsg >= 32601 && band.epsg <= 32660) ||
      (band.epsg >= 32701 && band.epsg <= 32760)
    ) ||
    !Array.isArray(band.transform) ||
    band.transform.length !== 6 ||
    !band.transform.every(Number.isFinite) ||
    band.transform[0] !== resolution ||
    band.transform[1] !== 0 ||
    band.transform[3] !== 0 ||
    band.transform[4] !== -resolution ||
    Math.abs(band.transform[2]) > 1000000 ||
    band.transform[5] < 0 ||
    band.transform[5] > 10000000 ||
    !(Array.isArray(band.data) || ArrayBuffer.isView(band.data)) ||
    band.data.length !== band.width * band.height ||
    band.noData !== 0
  )
    fail();
}
function reflectanceBand(band, name) {
  grid(band, 10, NDVI_MAX_SIDE);
  if (
    band.band !== name ||
    band.scale !== 0.0001 ||
    ![0, -0.1].includes(band.offset)
  )
    fail();
}
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT.*Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail();
  return new Date(value).toISOString();
}
function sceneMetadata(scene) {
  if (
    !scene ||
    !/^S2[ABC]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A$/.test(scene.id) ||
    typeof scene.processingBaseline !== 'string' ||
    !/^\d{2}\.\d{2}$/.test(scene.processingBaseline)
  )
    fail();
  return {
    sceneId: scene.id,
    acquiredAt: timestamp(scene.acquiredAt),
    retrievedAt: timestamp(scene.retrievedAt),
  };
}
function categoryAt(scl, red, x, y) {
  const worldX = red.transform[2] + (x + 0.5) * 10;
  const worldY = red.transform[5] - (y + 0.5) * 10;
  const col = Math.floor((worldX - scl.transform[2]) / 20);
  const row = Math.floor((scl.transform[5] - worldY) / 20);
  if (col < 0 || row < 0 || col >= scl.width || row >= scl.height) return null;
  return scl.data[row * scl.width + col];
}
function reflectance(band, index) {
  const value = band.data[index];
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 65535 ||
    value === band.noData
  )
    return null;
  const result = value * band.scale + band.offset;
  return result >= 0 ? result : null;
}
export function calculateNdvi({ red, nir, scl, scene } = {}) {
  reflectanceBand(red, 'B04');
  reflectanceBand(nir, 'B08');
  grid(scl, 20, 129);
  if (
    red.width !== nir.width ||
    red.height !== nir.height ||
    red.epsg !== nir.epsg ||
    red.epsg !== scl.epsg ||
    red.transform.some((value, i) => value !== nir.transform[i])
  )
    fail();
  const metadata = sceneMetadata(scene);
  const values = Array(red.width * red.height).fill(null);
  let sum = 0,
    min = Infinity,
    max = -Infinity,
    validPixels = 0;
  for (let y = 0; y < red.height; y++)
    for (let x = 0; x < red.width; x++) {
      const i = y * red.width + x;
      if (!CLEAR_CLASSES.includes(categoryAt(scl, red, x, y))) continue;
      const r = reflectance(red, i),
        n = reflectance(nir, i);
      if (r === null || n === null || n + r < NDVI_MIN_DENOMINATOR) continue;
      const value = (n - r) / (n + r);
      if (!Number.isFinite(value) || value < -1 || value > 1) continue;
      values[i] = value;
      sum += value;
      min = Math.min(min, value);
      max = Math.max(max, value);
      validPixels++;
    }
  return {
    version: 1,
    status: validPixels ? 'available' : 'rejected',
    reason: validPixels ? null : 'no-valid-pixels',
    ...metadata,
    grid: {
      epsg: red.epsg,
      width: red.width,
      height: red.height,
      transform: [...red.transform],
      resolutionM: 10,
    },
    values,
    statistics: {
      totalPixels: values.length,
      validPixels,
      maskedPixels: values.length - validPixels,
      min: validPixels ? min : null,
      max: validPixels ? max : null,
      mean: validPixels ? sum / validPixels : null,
    },
    provenance: {
      method: 'NDVI=(NIR-RED)/(NIR+RED)',
      processingBaseline: scene.processingBaseline,
      bands: [red, nir].map((band) => ({
        name: band.band,
        scale: band.scale,
        offset: band.offset,
        noData: band.noData,
      })),
      mask: {
        source: 'SCL',
        resolutionM: 20,
        resampling: 'nearest',
        acceptedClasses: [...CLEAR_CLASSES],
      },
      reflectanceResampling: 'none',
      minimumDenominator: NDVI_MIN_DENOMINATOR,
      sourceId: 'earth-search-sentinel-2-l2a',
      sourceLabel: 'Copernicus Sentinel-2 L2A / Earth Search',
      license: 'Copernicus Sentinel Data Terms',
      attribution:
        'Contains modified Copernicus Sentinel data; Earth Search / Element 84',
      link: 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a',
      limitations: [
        'A 10 m sampling grid cannot resolve small construction details.',
        'SCL is a 20 m classification mask and cannot guarantee cloud-free pixels.',
        'NDVI is a spectral index; a difference alone does not establish vegetation loss or causation.',
      ],
    },
  };
}
