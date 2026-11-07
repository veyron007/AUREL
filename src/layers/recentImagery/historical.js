/** Small dated-imagery contracts shared by the existing owner and keyless proxy. */
import {
  PRODUCTS,
  boxSideKm,
  validateBox,
  parseCandidateKey,
} from './model.js';

export const HISTORY_LIMITS = Object.freeze({
  days: 31,
  sideKm: 100,
  records: 400,
  previewBytes: 1048576,
  catalogBytes: 2097152,
});
export function historyDay(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new TypeError('Expected a real UTC acquisition date');
  return value;
}
export function validateHistoryWindow(
  { box, fromDay, toDay, products = ['S30', 'L30'] } = {},
  { now } = {},
) {
  const checked = validateBox(box);
  if (
    !checked.ok ||
    Math.max(...Object.values(boxSideKm(checked.box))) > HISTORY_LIMITS.sideKm
  )
    throw new TypeError(
      'Historical imagery requires a non-wrapped area no larger than 100 km per side',
    );
  historyDay(fromDay);
  historyDay(toDay);
  const duration = (Date.parse(toDay) - Date.parse(fromDay)) / 86400000 + 1;
  if (duration < 1 || duration > HISTORY_LIMITS.days)
    throw new TypeError('Choose between 1 and 31 UTC days');
  if (
    now !== undefined &&
    (fromDay < '2013-01-01' || toDay > new Date(now).toISOString().slice(0, 10))
  )
    throw new TypeError('Date outside the supported historical window');
  if (
    !Array.isArray(products) ||
    !products.length ||
    products.length > 3 ||
    new Set(products).size !== products.length ||
    products.some((p) => !Object.hasOwn(PRODUCTS, p))
  )
    throw new TypeError('Unknown or repeated imagery product');
  return { box: { ...checked.box }, fromDay, toDay, products: [...products] };
}
const iso = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
function acquisition(candidate, probe) {
  const reported = probe.acquisitionTime;
  if (reported && (!iso(reported) || reported.slice(0, 10) !== candidate.day))
    return null;
  const range = candidate.timeRange;
  const start = iso(range?.start),
    end = iso(range?.end);
  if (
    start &&
    end &&
    start <= end &&
    start.slice(0, 10) === candidate.day &&
    end.slice(0, 10) === candidate.day
  )
    return start === end
      ? { kind: 'instant', at: start }
      : { kind: 'interval', start, end };
  if (reported)
    return /^\d{4}-\d{2}-\d{2}$/.test(reported)
      ? { kind: 'day', date: reported }
      : { kind: 'instant', at: iso(reported) };
  return null;
}
/** Return only evidence that actually passed the dated pixel probe. Never infer time from the request. */
export function captureHistoricalInput(candidate, box) {
  const probe = candidate?.thumbnail;
  const parsed = parseCandidateKey(candidate?.key);
  if (
    !candidate ||
    probe?.status !== 'present' ||
    !iso(probe.probedAt) ||
    !parsed ||
    parsed.product !== candidate.product ||
    parsed.day !== candidate.day
  )
    return null;
  const spec = PRODUCTS[candidate.product],
    time = acquisition(candidate, probe),
    checked = validateBox(box);
  if (!time || !spec || !checked.ok) return null;
  const cloud = candidate.cloud?.max;
  return {
    sourceId: `nasa-gibs-${candidate.product.toLowerCase()}`,
    sourceLabel: `NASA GIBS · ${spec.label}`,
    time,
    retrievedAt: iso(candidate.retrievedAt) || iso(probe.probedAt),
    probedAt: iso(probe.probedAt),
    license: 'NASA Earthdata data-use policy',
    attribution:
      'NASA GIBS / Worldview; HLS: NASA, USGS and Copernicus Sentinel data; VIIRS: NOAA',
    asset: {
      kind: 'gibs',
      productId: candidate.product,
      requestedDate: candidate.day,
    },
    georeference: {
      crs: 'EPSG:4326',
      extent: [box.west, box.south, box.east, box.north],
    },
    nativeResolutionM: spec.resolutionM,
    cloudCoverPct:
      typeof cloud === 'number' && cloud >= 0 && cloud <= 100 ? cloud : null,
    cloudScope: 'scene',
    granuleIds: [
      ...new Set(
        (candidate.granules || [])
          .map((g) => g.id)
          .filter((id) => typeof id === 'string' && id.length <= 256),
      ),
    ].slice(0, 128),
    availability: 'present',
    coverage: ['full', 'partial'].includes(candidate.coverage)
      ? candidate.coverage
      : 'unknown',
    alignment: 'unverified',
  };
}
