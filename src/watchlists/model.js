/** Local watch definitions and bounded event identity. No timers, storage or acquisition. */
import {
  normalizeFirmsArea,
  validateFirmsAreaBounds,
  FIRMS_AREA_SOURCES,
} from '../sources/firmsArea.js';
import {
  validateCrossingNote,
  validateStationCondition,
  validateStationState,
} from '../airQuality/watch.js';
export const WATCH_LIMITS = Object.freeze({
  definitions: 8,
  active: 4,
  minIntervalMs: 1800000,
  maxIntervalMs: 86400000,
  seen: 2000,
  notifications: 100,
  notificationRows: 25,
  leaseMs: 90000,
  heartbeatMs: 30000,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = () => {
  throw new TypeError('Invalid local watchlist data');
};
const text = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail();
  return value;
};
const num = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isFinite(value) || value < min || value > max) fail();
  return value;
};
const fields = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    fail();
};
const timestamp = (value) => {
  text(value, 24);
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
};
const maybeNumber = (value) => {
  if (value !== null) num(value, 0, 8640000000000000);
};
export function watchBounds(place) {
  const [lon, lat] = place?.geometry?.coordinates || [];
  num(lon, -180, 180);
  num(lat, -90, 90);
  const e = place.extent || [lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1];
  if (!Array.isArray(e) || e.length !== 4) fail();
  const bounds = validateFirmsAreaBounds({
    west: e[0],
    south: e[1],
    east: e[2],
    north: e[3],
  });
  if (
    lon < bounds.west ||
    lon > bounds.east ||
    lat < bounds.south ||
    lat > bounds.north
  )
    fail();
  return bounds;
}
/** `condition` is optional: absent means the FIRMS area watch. */
export function createWatchDefinition(
  { place, title = place?.name, intervalMinutes = 30, condition },
  { id = globalThis.crypto.randomUUID(), now = Date.now() } = {},
) {
  const bounds = watchBounds(place),
    stamp = new Date(now).toISOString();
  return validateWatchDefinition({
    version: 1,
    id,
    title,
    place: {
      id: place.id,
      name: place.name,
      coordinates: place.geometry.coordinates.slice(0, 2),
    },
    bounds,
    intervalMs: intervalMinutes * 60000,
    createdAt: stamp,
    updatedAt: stamp,
    revision: 0,
    ...(condition === undefined ? {} : { condition }),
  });
}
const DEFINITION_KEYS = [
  'version',
  'id',
  'title',
  'place',
  'bounds',
  'intervalMs',
  'createdAt',
  'updatedAt',
  'revision',
];
export function validateWatchDefinition(value) {
  const conditional = Boolean(value) && Object.hasOwn(value, 'condition');
  fields(
    value,
    conditional ? [...DEFINITION_KEYS, 'condition'] : DEFINITION_KEYS,
  );
  if (conditional) validateStationCondition(value.condition);
  if (value.version !== 1) fail();
  text(value.id);
  text(value.title, 160);
  fields(value.place, ['id', 'name', 'coordinates']);
  text(value.place.id);
  text(value.place.name, 256);
  if (
    !Array.isArray(value.place.coordinates) ||
    value.place.coordinates.length !== 2
  )
    fail();
  num(value.place.coordinates[0], -180, 180);
  num(value.place.coordinates[1], -90, 90);
  fields(value.bounds, ['west', 'south', 'east', 'north']);
  validateFirmsAreaBounds(value.bounds);
  const [lon, lat] = value.place.coordinates;
  if (
    lon < value.bounds.west ||
    lon > value.bounds.east ||
    lat < value.bounds.south ||
    lat > value.bounds.north
  )
    fail();
  num(value.intervalMs, WATCH_LIMITS.minIntervalMs, WATCH_LIMITS.maxIntervalMs);
  if (!Number.isSafeInteger(value.intervalMs)) fail();
  timestamp(value.createdAt);
  timestamp(value.updatedAt);
  if (value.updatedAt < value.createdAt) fail();
  num(value.revision);
  if (!Number.isSafeInteger(value.revision)) fail();
  return copy(value);
}
export function emptyWatchRuntime() {
  return {
    baselineAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastRetrievedAt: null,
    nextAllowedAt: null,
    errorCount: 0,
    coverage: 'unknown',
    sources: [],
    baselineSources: [],
    seen: [],
    notifications: [],
  };
}
function sourceRows(rows) {
  if (!Array.isArray(rows) || rows.length > 4) fail();
  const seen = new Set();
  for (const row of rows) {
    fields(row, ['id', 'status', 'count']);
    if (
      !FIRMS_AREA_SOURCES.includes(row.id) ||
      seen.has(row.id) ||
      ![
        'ok',
        'partial',
        'unavailable',
        'rate-limited',
        'timeout',
        'invalid-response',
      ].includes(row.status)
    )
      fail();
    seen.add(row.id);
    num(row.count);
    if (!Number.isSafeInteger(row.count)) fail();
  }
}
export function validateWatchRuntime(value) {
  const base = Object.keys(emptyWatchRuntime());
  const station = Boolean(value) && Object.hasOwn(value, 'station');
  fields(value, station ? [...base, 'station'] : base);
  if (station) validateStationState(value.station);
  for (const key of [
    'baselineAt',
    'lastAttemptAt',
    'lastSuccessAt',
    'lastRetrievedAt',
    'nextAllowedAt',
  ])
    maybeNumber(value[key]);
  if (
    value.nextAllowedAt !== null &&
    (value.lastAttemptAt === null ||
      value.nextAllowedAt < value.lastAttemptAt ||
      value.nextAllowedAt - value.lastAttemptAt > 2 * 86400000)
  )
    fail();
  num(value.errorCount, 0, 100);
  if (
    !Number.isInteger(value.errorCount) ||
    !['unknown', 'complete', 'partial', 'stale', 'unavailable'].includes(
      value.coverage,
    )
  )
    fail();
  sourceRows(value.sources);
  if (
    !Array.isArray(value.baselineSources) ||
    value.baselineSources.length > 4 ||
    new Set(value.baselineSources).size !== value.baselineSources.length ||
    value.baselineSources.some((x) => !FIRMS_AREA_SOURCES.includes(x))
  )
    fail();
  if (
    !Array.isArray(value.seen) ||
    value.seen.length > WATCH_LIMITS.seen ||
    new Set(value.seen.map((x) => x.id)).size !== value.seen.length
  )
    fail();
  for (const row of value.seen) {
    fields(row, ['id', 'acquiredAt']);
    text(row.id, 256);
    num(row.acquiredAt);
  }
  if (
    !Array.isArray(value.notifications) ||
    value.notifications.length > WATCH_LIMITS.notifications
  )
    fail();
  for (const note of value.notifications) {
    if (note?.kind === 'aq-crossing') {
      validateCrossingNote(note);
      continue;
    }
    fields(note, [
      'id',
      'createdAt',
      'newlyOccurredCount',
      'newlyRetrievedCount',
      'observations',
      'unlistedCount',
    ]);
    text(note.id);
    timestamp(note.createdAt);
    for (const key of [
      'newlyOccurredCount',
      'newlyRetrievedCount',
      'unlistedCount',
    ]) {
      num(note[key], 0, 500);
      if (!Number.isSafeInteger(note[key])) fail();
    }
    if (
      !Array.isArray(note.observations) ||
      note.observations.length > WATCH_LIMITS.notificationRows ||
      note.newlyOccurredCount + note.newlyRetrievedCount !==
        note.observations.length + note.unlistedCount
    )
      fail();
    for (const row of note.observations) {
      fields(row, ['id', 'lat', 'lon', 'acquiredAt', 'source']);
      text(row.id, 256);
      num(row.lat, -90, 90);
      num(row.lon, -180, 180);
      timestamp(row.acquiredAt);
      if (!FIRMS_AREA_SOURCES.includes(row.source)) fail();
    }
  }
  return copy(value);
}
export function validateWatchRecord(value) {
  fields(value, ['definition', 'runtime', 'lease']);
  const definition = validateWatchDefinition(value.definition),
    runtime = validateWatchRuntime(value.runtime);
  // A FIRMS area watch never carries station state or station notes.
  if (
    !definition.condition &&
    (runtime.station ||
      runtime.notifications.some((note) => note.kind === 'aq-crossing'))
  )
    fail();
  if (value.lease !== null) {
    fields(value.lease, ['ownerId', 'token', 'until']);
    text(value.lease.ownerId);
    text(value.lease.token);
    num(value.lease.until);
  }
  return {
    definition,
    runtime,
    lease: value.lease === null ? null : { ...value.lease },
  };
}
/** Provider ID is namespaced; missing IDs use source/satellite/4-decimal position/acquisition. */
function identity(row) {
  return `${row.source}:${row.id || `${row.satellite}:${row.lat.toFixed(4)}:${row.lon.toFixed(4)}:${row.acquiredAt}`}`;
}
export function reduceWatchCheck(
  previous,
  value,
  {
    now = Date.now(),
    baseline = false,
    intervalMs = WATCH_LIMITS.minIntervalMs,
    bounds = value?.bounds,
  } = {},
) {
  const runtime = validateWatchRuntime(previous),
    context = normalizeFirmsArea(value, bounds, now);
  const attempted = {
    ...runtime,
    lastAttemptAt: now,
    nextAllowedAt: now + intervalMs,
  };
  if (
    !['ok', 'partial'].includes(context.status) ||
    context.fetchedAt === null ||
    (runtime.lastRetrievedAt !== null &&
      context.fetchedAt <= runtime.lastRetrievedAt)
  )
    return {
      ...attempted,
      coverage:
        context.status === 'stale' || context.fetchedAt !== null
          ? 'stale'
          : 'unavailable',
    };
  const baselineSources = new Set(runtime.baselineSources),
    known = new Set(runtime.seen.map((row) => row.id)),
    fresh = [];
  const silent = baseline || runtime.baselineAt === null;
  for (const row of context.observations) {
    const id = identity(row);
    if (!silent && baselineSources.has(row.source) && !known.has(id))
      fresh.push({ ...row, id });
    known.add(id);
  }
  for (const source of context.sources)
    if (['ok', 'partial'].includes(source.status))
      baselineSources.add(source.id);
  const seen = new Map(
    runtime.seen
      .filter((row) => row.acquiredAt >= now - 86400000)
      .map((row) => [row.id, row]),
  );
  context.observations.forEach((row) =>
    seen.set(identity(row), {
      id: identity(row),
      acquiredAt: Date.parse(row.acquiredAt),
    }),
  );
  let notifications = runtime.notifications;
  if (fresh.length) {
    const occurred = fresh.filter(
      (row) => Date.parse(row.acquiredAt) > runtime.lastSuccessAt,
    ).length;
    notifications = [
      ...notifications,
      {
        id: `${now}:${fresh.length}:${notifications.length}`,
        createdAt: new Date(now).toISOString(),
        newlyOccurredCount: occurred,
        newlyRetrievedCount: fresh.length - occurred,
        observations: fresh
          .slice(0, WATCH_LIMITS.notificationRows)
          .map(({ id, lat, lon, acquiredAt, source }) => ({
            id,
            lat,
            lon,
            acquiredAt,
            source,
          })),
        unlistedCount: Math.max(
          0,
          fresh.length - WATCH_LIMITS.notificationRows,
        ),
      },
    ].slice(-WATCH_LIMITS.notifications);
  }
  return validateWatchRuntime({
    ...attempted,
    baselineAt: silent ? now : runtime.baselineAt,
    lastSuccessAt: now,
    lastRetrievedAt: context.fetchedAt,
    errorCount: 0,
    coverage:
      context.status === 'ok' && !context.truncated ? 'complete' : 'partial',
    sources: context.sources,
    baselineSources: [...baselineSources],
    seen: [...seen.values()]
      .sort((a, b) => a.acquiredAt - b.acquiredAt)
      .slice(-WATCH_LIMITS.seen),
    notifications,
  });
}
