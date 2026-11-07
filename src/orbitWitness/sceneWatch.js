/**
 * The Watchlist's second watch type: "a new satellite scene is catalogued
 * over this place". Definitions, runtime and the pure check reducer. The
 * Watchlist controller and repository own timers, leases and storage.
 *
 * A scene fires once: identity is `<catalogue>:<scene id>` and every id seen
 * stays in the runtime while it can still appear in the search window. A
 * catalogue outage is "unknown"; it never removes or announces anything.
 */
import { validateFirmsAreaBounds } from '../sources/firmsArea.js';
import { CATALOGUE_SOURCES, SCENE_COLLECTIONS } from './catalogueModel.js';

export const SCENE_WATCH_KIND = 'scene';
export const SCENE_WATCH_LIMITS = Object.freeze({
  minIntervalMs: 3600000,
  maxIntervalMs: 86400000,
  intervalsMinutes: Object.freeze([60, 180, 360, 720]),
  lookbackDays: 10,
  seen: 2000,
  notifications: 100,
  notificationRows: 25,
});
const DAY_MS = 86400000;
const RUNTIME_STATUSES = Object.freeze([
  'ok',
  'partial',
  'unavailable',
  'rate-limited',
  'timeout',
  'invalid-response',
  'blocked',
]);

const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = () => {
  throw new TypeError('Invalid local scene watch data');
};
const text = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail();
  return value;
};
const num = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isFinite(value) || value < min || value > max) fail();
  return value;
};
const int = (value, min, max) => {
  num(value, min, max);
  if (!Number.isSafeInteger(value)) fail();
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

/** The same bounded area rule as the FIRMS watch: a point inside ≤ 2°. */
export function sceneWatchBounds(place) {
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

export function createSceneWatchDefinition(
  { place, title = place?.name, intervalMinutes = 180 },
  { id = globalThis.crypto.randomUUID(), now = Date.now() } = {},
) {
  const bounds = sceneWatchBounds(place),
    stamp = new Date(now).toISOString();
  return validateSceneWatchDefinition({
    version: 2,
    kind: SCENE_WATCH_KIND,
    id,
    title,
    place: {
      id: place.id,
      name: place.name,
      coordinates: place.geometry.coordinates.slice(0, 2),
    },
    bounds,
    intervalMs: intervalMinutes * 60000,
    scene: {
      collections: [...SCENE_COLLECTIONS],
      lookbackDays: SCENE_WATCH_LIMITS.lookbackDays,
    },
    createdAt: stamp,
    updatedAt: stamp,
    revision: 0,
  });
}

export function validateSceneWatchDefinition(value) {
  fields(value, [
    'version',
    'kind',
    'id',
    'title',
    'place',
    'bounds',
    'intervalMs',
    'scene',
    'createdAt',
    'updatedAt',
    'revision',
  ]);
  if (value.version !== 2 || value.kind !== SCENE_WATCH_KIND) fail();
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
  const [lon, lat] = value.place.coordinates;
  num(lon, -180, 180);
  num(lat, -90, 90);
  fields(value.bounds, ['west', 'south', 'east', 'north']);
  validateFirmsAreaBounds(value.bounds);
  if (
    lon < value.bounds.west ||
    lon > value.bounds.east ||
    lat < value.bounds.south ||
    lat > value.bounds.north
  )
    fail();
  int(
    value.intervalMs,
    SCENE_WATCH_LIMITS.minIntervalMs,
    SCENE_WATCH_LIMITS.maxIntervalMs,
  );
  fields(value.scene, ['collections', 'lookbackDays']);
  if (
    !Array.isArray(value.scene.collections) ||
    !value.scene.collections.length ||
    new Set(value.scene.collections).size !== value.scene.collections.length ||
    value.scene.collections.some((c) => !SCENE_COLLECTIONS.includes(c))
  )
    fail();
  int(value.scene.lookbackDays, 1, SCENE_WATCH_LIMITS.lookbackDays);
  timestamp(value.createdAt);
  timestamp(value.updatedAt);
  if (value.updatedAt < value.createdAt) fail();
  int(value.revision, 0, Number.MAX_SAFE_INTEGER);
  return copy(value);
}

export function emptySceneWatchRuntime() {
  return {
    kind: SCENE_WATCH_KIND,
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

function validateObservation(row) {
  fields(row, [
    'id',
    'sceneId',
    'collection',
    'platform',
    'acquiredAt',
    'cloudCover',
    'source',
    'productId',
  ]);
  text(row.id, 256);
  text(row.sceneId, 160);
  if (!SCENE_COLLECTIONS.includes(row.collection)) fail();
  text(row.platform, 40);
  timestamp(row.acquiredAt);
  if (row.cloudCover !== null) num(row.cloudCover, 0, 100);
  if (!CATALOGUE_SOURCES.includes(row.source)) fail();
  if (row.productId !== null && !['S30', 'L30'].includes(row.productId))
    fail();
}

export function validateSceneWatchRuntime(value) {
  fields(value, Object.keys(emptySceneWatchRuntime()));
  if (value.kind !== SCENE_WATCH_KIND) fail();
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
      value.nextAllowedAt - value.lastAttemptAt > 2 * DAY_MS)
  )
    fail();
  int(value.errorCount, 0, 100);
  if (
    !['unknown', 'complete', 'partial', 'stale', 'unavailable'].includes(
      value.coverage,
    )
  )
    fail();
  if (!Array.isArray(value.sources) || value.sources.length > 2) fail();
  const ids = new Set();
  for (const row of value.sources) {
    fields(row, ['id', 'status', 'count']);
    if (
      !CATALOGUE_SOURCES.includes(row.id) ||
      ids.has(row.id) ||
      !RUNTIME_STATUSES.includes(row.status)
    )
      fail();
    ids.add(row.id);
    int(row.count, 0, Number.MAX_SAFE_INTEGER);
  }
  if (
    !Array.isArray(value.baselineSources) ||
    value.baselineSources.length > 2 ||
    new Set(value.baselineSources).size !== value.baselineSources.length ||
    value.baselineSources.some((x) => !CATALOGUE_SOURCES.includes(x))
  )
    fail();
  if (
    !Array.isArray(value.seen) ||
    value.seen.length > SCENE_WATCH_LIMITS.seen ||
    new Set(value.seen.map((x) => x?.id)).size !== value.seen.length
  )
    fail();
  for (const row of value.seen) {
    fields(row, ['id', 'acquiredAt']);
    text(row.id, 256);
    num(row.acquiredAt);
  }
  if (
    !Array.isArray(value.notifications) ||
    value.notifications.length > SCENE_WATCH_LIMITS.notifications
  )
    fail();
  for (const note of value.notifications) {
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
    ])
      int(note[key], 0, 500);
    if (
      !Array.isArray(note.observations) ||
      note.observations.length > SCENE_WATCH_LIMITS.notificationRows ||
      note.newlyOccurredCount + note.newlyRetrievedCount !==
        note.observations.length + note.unlistedCount
    )
      fail();
    note.observations.forEach(validateObservation);
  }
  return copy(value);
}

/** Scene identity: the catalogue namespace and its item id. */
export const sceneIdentity = (scene) => `${scene.source}:${scene.id}`;

/** The past UTC-day window a check searches, ending today. */
export function sceneSearchWindow(definition, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  const start = new Date(
    Date.parse(`${today}T00:00:00Z`) -
      (definition.scene.lookbackDays - 1) * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  const { west, south, east, north } = definition.bounds;
  return { bbox: [west, south, east, north], from: start, to: today };
}

function observationOf(scene) {
  return {
    id: sceneIdentity(scene),
    sceneId: scene.id,
    collection: scene.collection,
    platform: scene.platform,
    acquiredAt: scene.datetime,
    cloudCover: scene.cloudCover ?? null,
    source: scene.source,
    productId: scene.productId ?? null,
  };
}

const summary = (row) => ({ id: row.id, status: row.status, count: row.count });

/**
 * Fold one catalogue response into the runtime. The first answer from each
 * catalogue is a quiet baseline. Later, each unseen scene id fires once.
 * @param {object} previous runtime
 * @param {{ status: string, retrievedAt: string, sources: Array<object>, scenes: Array<object> }} catalogue validated payload
 */
export function reduceSceneWatchCheck(
  previous,
  catalogue,
  {
    now = Date.now(),
    baseline = false,
    intervalMs = SCENE_WATCH_LIMITS.minIntervalMs,
    lookbackDays = SCENE_WATCH_LIMITS.lookbackDays,
  } = {},
) {
  const runtime = validateSceneWatchRuntime(previous);
  const attempted = {
    ...runtime,
    lastAttemptAt: now,
    nextAllowedAt: now + intervalMs,
  };
  const answered = (catalogue?.sources || []).filter((row) =>
    ['ok', 'partial'].includes(row.status),
  );
  const retrievedAt = Date.parse(catalogue?.retrievedAt);
  if (
    !answered.length ||
    !Number.isFinite(retrievedAt) ||
    (runtime.lastRetrievedAt !== null && retrievedAt <= runtime.lastRetrievedAt)
  )
    return validateSceneWatchRuntime({
      ...attempted,
      // Outage or a repeated cached answer: availability is unknown, nothing is announced.
      coverage: answered.length ? 'stale' : 'unavailable',
      sources: (catalogue?.sources || []).map(summary),
    });
  const answeredIds = new Set(answered.map((row) => row.id));
  const baselineSources = new Set(runtime.baselineSources);
  const known = new Set(runtime.seen.map((row) => row.id));
  const silent = baseline || runtime.baselineAt === null;
  const fresh = [];
  for (const scene of catalogue.scenes) {
    if (!answeredIds.has(scene.source)) continue;
    const id = sceneIdentity(scene);
    if (!silent && baselineSources.has(scene.source) && !known.has(id))
      fresh.push(observationOf(scene));
    known.add(id);
  }
  answeredIds.forEach((id) => baselineSources.add(id));
  // Keep ids while the search window can still return them, plus two days.
  const horizon = now - (lookbackDays + 2) * DAY_MS;
  const seen = new Map(
    runtime.seen
      .filter((row) => row.acquiredAt >= horizon)
      .map((row) => [row.id, row]),
  );
  for (const scene of catalogue.scenes)
    if (answeredIds.has(scene.source))
      seen.set(sceneIdentity(scene), {
        id: sceneIdentity(scene),
        acquiredAt: Date.parse(scene.datetime),
      });
  let notifications = runtime.notifications;
  if (fresh.length) {
    const occurred = fresh.filter(
      (row) => Date.parse(row.acquiredAt) > (runtime.lastSuccessAt ?? 0),
    ).length;
    notifications = [
      ...notifications,
      {
        id: `${now}:${fresh.length}:${notifications.length}`,
        createdAt: new Date(now).toISOString(),
        newlyOccurredCount: occurred,
        newlyRetrievedCount: fresh.length - occurred,
        observations: fresh.slice(0, SCENE_WATCH_LIMITS.notificationRows),
        unlistedCount: Math.max(
          0,
          fresh.length - SCENE_WATCH_LIMITS.notificationRows,
        ),
      },
    ].slice(-SCENE_WATCH_LIMITS.notifications);
  }
  return validateSceneWatchRuntime({
    ...attempted,
    baselineAt: silent ? now : runtime.baselineAt,
    lastSuccessAt: now,
    lastRetrievedAt: retrievedAt,
    errorCount: 0,
    coverage: catalogue.status === 'ok' ? 'complete' : 'partial',
    sources: catalogue.sources.map(summary),
    baselineSources: [...baselineSources],
    seen: [...seen.values()]
      .sort((a, b) => a.acquiredAt - b.acquiredAt)
      .slice(-SCENE_WATCH_LIMITS.seen),
    notifications,
  });
}

/** Scene watch source: one bounded catalogue search per check, keeping HTTP cooldowns. */
export function createSceneWatchSource({ catalogue, now = Date.now }) {
  return {
    async check(definition, { signal } = {}) {
      const result = await catalogue.search(
        sceneSearchWindow(definition, now()),
        { signal },
      );
      const wait = Number(result.retryAfter);
      return {
        context: result,
        retryAt:
          result.reason === 'rate-limited'
            ? now() +
              Math.min(
                DAY_MS,
                Math.max(
                  SCENE_WATCH_LIMITS.minIntervalMs,
                  Number.isFinite(wait) ? wait * 1000 : 0,
                ),
              )
            : null,
      };
    },
  };
}
