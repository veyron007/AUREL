import proj4 from 'proj4';
import {
  SCENE_ID,
  validateAnalysisInput,
  validateSearchInput,
} from './request.js';
const fail = () => {
  throw new Error('Invalid Sentinel research response');
};
const REASONS = new Set([
  'busy',
  'cooldown',
  'budget-storage',
  'budget-busy',
  'clock-reversed',
  'daily-limit',
  'monthly-limit',
  'minute-limit',
  'unsupported-science-metadata',
  'unsupported-asset',
  'scene-does-not-cover-roi',
  'unsupported-tiff-grid',
  'range-budget-exceeded',
  'invalid-range-response',
  'analysis-timeout',
  'decode-failed',
  'rate-limited',
  'upstream-unavailable',
]);
function fields(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function finite(value, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) fail();
}
function integer(value, min, max) {
  finite(value, min, max);
  if (!Number.isSafeInteger(value)) fail();
}
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
  return Date.parse(value);
}
function equal(a, b) {
  if (a !== b) fail();
}
function close(a, b, tolerance = 1e-9) {
  finite(a);
  finite(b);
  if (Math.abs(a - b) > tolerance) fail();
}
function freezeCopy(value) {
  const copy = structuredClone(value);
  const freeze = (x) => {
    if (x && typeof x === 'object') {
      Object.values(x).forEach(freeze);
      Object.freeze(x);
    }
    return x;
  };
  return freeze(copy);
}
function samePoint(actual, expected) {
  equal(actual.lat, expected.lat);
  equal(actual.lon, expected.lon);
}
function baseline(value) {
  if (typeof value !== 'string' || !/^\d{2}\.\d{2}$/.test(value)) fail();
}
function scene(value) {
  if (typeof value !== 'string' || !SCENE_ID.test(value)) fail();
}
function verifyProvenance(p) {
  fields(p, [
    'method',
    'processingBaseline',
    'bands',
    'mask',
    'reflectanceResampling',
    'minimumDenominator',
    'sourceId',
    'sourceLabel',
    'license',
    'attribution',
    'link',
    'limitations',
  ]);
  equal(p.method, 'NDVI=(NIR-RED)/(NIR+RED)');
  baseline(p.processingBaseline);
  equal(p.reflectanceResampling, 'none');
  equal(p.minimumDenominator, 1e-6);
  equal(p.sourceId, 'earth-search-sentinel-2-l2a');
  equal(p.sourceLabel, 'Copernicus Sentinel-2 L2A / Earth Search');
  equal(p.license, 'Copernicus Sentinel Data Terms');
  equal(
    p.attribution,
    'Contains modified Copernicus Sentinel data; Earth Search / Element 84',
  );
  equal(
    p.link,
    'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a',
  );
  if (!Array.isArray(p.bands) || p.bands.length !== 2) fail();
  p.bands.forEach((band, i) => {
    fields(band, ['name', 'scale', 'offset', 'noData']);
    equal(band.name, i === 0 ? 'B04' : 'B08');
    equal(band.scale, 0.0001);
    equal(band.noData, 0);
    if (![0, -0.1].includes(band.offset)) fail();
  });
  equal(p.bands[0].offset, p.bands[1].offset);
  fields(p.mask, ['source', 'resolutionM', 'resampling', 'acceptedClasses']);
  equal(p.mask.source, 'SCL');
  equal(p.mask.resolutionM, 20);
  equal(p.mask.resampling, 'nearest');
  equal(JSON.stringify(p.mask.acceptedClasses), '[4,5,6]');
  if (
    !Array.isArray(p.limitations) ||
    p.limitations.length < 1 ||
    p.limitations.length > 5 ||
    p.limitations.some(
      (x) => typeof x !== 'string' || x.length < 1 || x.length > 240,
    )
  )
    fail();
}
function verifyGrid(value, input) {
  const g = value.grid;
  fields(g, ['epsg', 'width', 'height', 'transform', 'resolutionM']);
  equal(g.width, input.sizePixels);
  equal(g.height, input.sizePixels);
  equal(g.resolutionM, 10);
  integer(g.epsg, 32601, 32760);
  if (g.epsg > 32660 && g.epsg < 32701) fail();
  if (!Array.isArray(g.transform) || g.transform.length !== 6) fail();
  g.transform.forEach((x) => finite(x));
  const [a, b, c, d, e, f] = g.transform;
  equal(a, 10);
  equal(b, 0);
  equal(d, 0);
  equal(e, -10);
  finite(c, 0, 1000000);
  finite(f, 0, 10000000);
  const projection = `+proj=utm +zone=${g.epsg % 100} ${g.epsg >= 32700 ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
  const center = proj4('EPSG:4326', projection, [input.lon, input.lat]);
  close(center[0], c + g.width * 5, 10.0001);
  close(center[1], f - g.height * 5, 10.0001);
  fields(value.footprint, ['type', 'coordinates']);
  equal(value.footprint.type, 'Polygon');
  const rings = value.footprint.coordinates;
  if (
    !Array.isArray(rings) ||
    rings.length !== 1 ||
    !Array.isArray(rings[0]) ||
    rings[0].length !== 5
  )
    fail();
  const corners = [
    [0, 0],
    [g.width, 0],
    [g.width, g.height],
    [0, g.height],
    [0, 0],
  ];
  corners.forEach(([x, y], i) => {
    const point = rings[0][i];
    if (!Array.isArray(point) || point.length !== 2) fail();
    finite(point[0], -180, 180);
    finite(point[1], -90, 90);
    const expected = proj4(projection, 'EPSG:4326', [c + x * 10, f - y * 10]);
    close(point[0], expected[0]);
    close(point[1], expected[1]);
  });
}
function verifyStatistics(value) {
  const stats = value.statistics;
  fields(stats, [
    'totalPixels',
    'validPixels',
    'maskedPixels',
    'min',
    'max',
    'mean',
  ]);
  const total = value.grid.width * value.grid.height;
  if (!Array.isArray(value.values) || value.values.length !== total) fail();
  let valid = 0,
    sum = 0,
    min = Infinity,
    max = -Infinity;
  for (const pixel of value.values) {
    if (pixel === null) continue;
    finite(pixel, -1, 1);
    valid++;
    sum += pixel;
    min = Math.min(min, pixel);
    max = Math.max(max, pixel);
  }
  equal(stats.totalPixels, total);
  equal(stats.validPixels, valid);
  equal(stats.maskedPixels, total - valid);
  if (valid) {
    close(stats.min, min);
    close(stats.max, max);
    close(stats.mean, sum / valid);
    equal(value.status, 'available');
    equal(value.reason, null);
  } else {
    equal(stats.min, null);
    equal(stats.max, null);
    equal(stats.mean, null);
    equal(value.status, 'rejected');
    equal(value.reason, 'no-valid-pixels');
  }
}
export function validateAnalysisResult(value, expected) {
  const input = validateAnalysisInput(expected);
  if (value?.status === 'rejected' && value.reason !== 'no-valid-pixels') {
    fields(value, ['version', 'status', 'reason', 'sceneId']);
    equal(value.version, 1);
    equal(value.sceneId, input.sceneId);
    if (!REASONS.has(value.reason)) fail();
    return freezeCopy(value);
  }
  fields(value, [
    'version',
    'status',
    'reason',
    'sceneId',
    'acquiredAt',
    'retrievedAt',
    'grid',
    'values',
    'statistics',
    'provenance',
    'requested',
    'footprint',
    'transfer',
  ]);
  equal(value.version, 1);
  equal(value.sceneId, input.sceneId);
  fields(value.requested, ['lat', 'lon', 'sizePixels']);
  samePoint(value.requested, input);
  equal(value.requested.sizePixels, input.sizePixels);
  if (timestamp(value.acquiredAt) > timestamp(value.retrievedAt)) fail();
  verifyGrid(value, input);
  verifyStatistics(value);
  verifyProvenance(value.provenance);
  fields(value.transfer, ['bytes', 'requests', 'maxBytes', 'maxRequests']);
  equal(value.transfer.maxBytes, 25165824);
  equal(value.transfer.maxRequests, 64);
  integer(value.transfer.bytes, 0, 25165824);
  integer(value.transfer.requests, 0, 64);
  return freezeCopy(value);
}
export function validateSearchResult(value, expected) {
  const input = validateSearchInput(expected);
  if (value?.status === 'rejected') {
    fields(value, ['version', 'status', 'reason', 'scenes']);
    equal(value.version, 1);
    if (
      !REASONS.has(value.reason) ||
      !Array.isArray(value.scenes) ||
      value.scenes.length
    )
      fail();
    return freezeCopy(value);
  }
  fields(value, [
    'version',
    'status',
    'reason',
    'requested',
    'retrievedAt',
    'scenes',
  ]);
  equal(value.version, 1);
  equal(value.status, 'available');
  equal(value.reason, null);
  fields(value.requested, ['lat', 'lon', 'fromDay', 'toDay']);
  samePoint(value.requested, input);
  equal(value.requested.fromDay, input.fromDay);
  equal(value.requested.toDay, input.toDay);
  timestamp(value.retrievedAt);
  if (!Array.isArray(value.scenes) || value.scenes.length > 10) fail();
  const ids = new Set();
  value.scenes.forEach((row) => {
    fields(row, [
      'id',
      'acquiredAt',
      'cloudCoverPct',
      'resolutionM',
      'maskResolutionM',
      'processingBaseline',
    ]);
    scene(row.id);
    if (ids.has(row.id)) fail();
    ids.add(row.id);
    if (
      timestamp(row.acquiredAt) > timestamp(value.retrievedAt) ||
      row.acquiredAt.slice(0, 10) < input.fromDay ||
      row.acquiredAt.slice(0, 10) > input.toDay
    )
      fail();
    if (row.cloudCoverPct !== null) finite(row.cloudCoverPct, 0, 100);
    equal(row.resolutionM, 10);
    equal(row.maskResolutionM, 20);
    baseline(row.processingBaseline);
  });
  return freezeCopy(value);
}
