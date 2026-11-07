import { readResponseJsonCapped } from './httpBody.js';
import { requestWithDeadline } from './requestDeadline.js';

export const FIRMS_AREA_SOURCES = Object.freeze([
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'VIIRS_SNPP_NRT',
  'MODIS_NRT',
]);
export const FIRMS_AREA_LIMIT = 500;
export const FIRMS_AREA_WINDOW_MS = 24 * 3600_000;
export const FIRMS_AREA_LIMITATIONS = Object.freeze([
  'Satellite thermal observations are not confirmed active fires or fire perimeters.',
  'An empty result does not establish that no fire exists; clouds, overpass timing and sensor coverage can hide observations.',
  'VIIRS nominal resolution is 375 m; MODIS is approximately 1 km. Acquisition time is distinct from retrieval time.',
]);

/** Small non-antimeridian extent; no date/source/URL choices are admitted. */
export function validateFirmsAreaBounds(value) {
  const keys = ['west', 'south', 'east', 'north'];
  if (!value || keys.some((key) => !Number.isFinite(value[key])))
    throw new Error('Invalid FIRMS area bounds');
  const { west, south, east, north } = value;
  if (
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    east <= west ||
    north <= south ||
    east - west > 2 ||
    north - south > 2
  )
    throw new Error('Invalid FIRMS area bounds: maximum span is 2 degrees');
  return { west, south, east, north };
}

export function emptyFirmsArea(
  bounds,
  now,
  status = 'unavailable',
  explanation = 'FIRMS observations are unavailable. Try again later.',
) {
  return {
    status,
    source: 'NASA FIRMS',
    fetchedAt: null,
    window: {
      start: new Date(now - FIRMS_AREA_WINDOW_MS).toISOString(),
      end: new Date(now).toISOString(),
    },
    bounds: validateFirmsAreaBounds(bounds),
    sources: [],
    matchedCount: 0,
    count: 0,
    truncated: false,
    observations: [],
    limitations: [explanation, ...FIRMS_AREA_LIMITATIONS],
  };
}

/** Validate provider data without carrying arbitrary upstream metadata or URLs. */
export function normalizeFirmsArea(value, bounds, now = Date.now()) {
  const expected = validateFirmsAreaBounds(bounds);
  const statuses = ['ok', 'partial', 'stale', 'unavailable', 'needs-key'];
  const sourceStatuses = [
    'ok',
    'partial',
    'unavailable',
    'rate-limited',
    'timeout',
    'invalid-response',
  ];
  if (
    !value ||
    value.source !== 'NASA FIRMS' ||
    !statuses.includes(value.status) ||
    !value.bounds ||
    Object.keys(expected).some((key) => value.bounds[key] !== expected[key]) ||
    !Array.isArray(value.observations) ||
    value.observations.length > 5000 ||
    !Array.isArray(value.sources)
  )
    throw new Error('Invalid FIRMS area response');
  const start = Date.parse(value.window?.start),
    end = Date.parse(value.window?.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end - start > FIRMS_AREA_WINDOW_MS ||
    end > now + 120_000
  )
    throw new Error('Invalid FIRMS acquisition window');
  const sources = value.sources.map((row) => {
    if (
      !FIRMS_AREA_SOURCES.includes(row?.id) ||
      !sourceStatuses.includes(row.status) ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0
    )
      throw new Error('Invalid FIRMS source status');
    return { id: row.id, status: row.status, count: row.count };
  });
  if (
    sources.length > 4 ||
    new Set(sources.map((row) => row.id)).size !== sources.length
  )
    throw new Error('Invalid FIRMS source list');
  const text = (input, limit) =>
    typeof input === 'string' ? input.trim().slice(0, limit) : '';
  const matches = value.observations.filter((row) => {
    const at = Date.parse(row?.acquiredAt);
    return (
      row &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lon) &&
      row.lon >= expected.west &&
      row.lon <= expected.east &&
      row.lat >= expected.south &&
      row.lat <= expected.north &&
      at >= start &&
      at <= end &&
      FIRMS_AREA_SOURCES.includes(row.source) &&
      Number.isFinite(row.frpMw) &&
      row.frpMw >= 0
    );
  });
  const observations = matches.slice(0, FIRMS_AREA_LIMIT).map((row) => ({
    id: text(row.id, 160),
    lat: row.lat,
    lon: row.lon,
    acquiredAt: new Date(Date.parse(row.acquiredAt)).toISOString(),
    sensor: text(row.sensor, 32),
    satellite: text(row.satellite, 32),
    confidence: text(row.confidence, 16),
    frpMw: row.frpMw,
    source: row.source,
  }));
  if (
    !Number.isSafeInteger(value.matchedCount) ||
    value.matchedCount < matches.length ||
    (value.fetchedAt !== null &&
      (!Number.isFinite(value.fetchedAt) ||
        value.fetchedAt < 0 ||
        value.fetchedAt > now + 120_000))
  )
    throw new Error('Invalid FIRMS retrieval metadata');
  if (
    (['ok', 'partial', 'stale'].includes(value.status) &&
      value.fetchedAt === null) ||
    (['unavailable', 'needs-key'].includes(value.status) &&
      (value.observations.length ||
        value.matchedCount ||
        value.fetchedAt !== null)) ||
    (value.status === 'ok' &&
      (!sources.length || sources.some((row) => row.status !== 'ok'))) ||
    (value.status === 'partial' &&
      !sources.some((row) => ['ok', 'partial'].includes(row.status)))
  )
    throw new Error('Invalid FIRMS availability metadata');
  return {
    status: value.status,
    source: 'NASA FIRMS',
    fetchedAt: value.fetchedAt,
    window: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    },
    bounds: expected,
    sources,
    matchedCount: value.matchedCount,
    count: observations.length,
    truncated: value.matchedCount > observations.length,
    observations,
    limitations: (Array.isArray(value.limitations)
      ? value.limitations
      : FIRMS_AREA_LIMITATIONS
    )
      .slice(0, 5)
      .map((line) => text(line, 240)),
  };
}

/** Same-origin, deadline/body-bounded reader. Credentials never enter the browser. */
export async function fetchFirmsAreaSource({
  bounds,
  fetchImpl = globalThis.fetch,
  signal,
  now = Date.now,
  timeoutMs = 45_000,
} = {}) {
  const area = validateFirmsAreaBounds(bounds);
  const query = new URLSearchParams(
    Object.entries(area).map(([key, value]) => [key, String(value)]),
  );
  try {
    return await requestWithDeadline(
      async (deadline) => {
        const response = await fetchImpl(`/api/firms/area?${query}`, {
          signal: deadline,
          credentials: 'same-origin',
        });
        const body = await readResponseJsonCapped(
          response,
          1024 * 1024,
          deadline,
        );
        if (
          !response.ok &&
          !['needs-key', 'unavailable'].includes(body?.status)
        )
          throw new Error('FIRMS request failed');
        return normalizeFirmsArea(body, area, now());
      },
      { signal, timeoutMs },
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return emptyFirmsArea(
      area,
      now(),
      'unavailable',
      error?.name === 'TimeoutError'
        ? 'FIRMS request timed out. Try again later.'
        : 'FIRMS observations could not be retrieved. Try again later.',
    );
  }
}
