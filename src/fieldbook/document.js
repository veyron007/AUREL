/** Separate local project format; existing scene documents remain unchanged. */
import { validateRouteSnapshot } from '../layers/directions/snapshot.js';
import { validateSceneDocument } from '../director/document.js';
import { validateAnalysis } from './analysis.js';
import {
  validateComparison,
  validateChangeNote,
  validateComparisonLinks,
} from './comparisonSchema.js';
import {
  FIELDBOOK_LIMITS,
  FieldbookValidationError,
  fail,
  fields,
  text,
  id,
  number,
  integer,
  array,
  nullable,
  oneOf,
  timestamp,
  extent,
  geometry,
  safeReference,
  jsonTree,
} from './fields.js';
export { FIELDBOOK_LIMITS, FieldbookValidationError } from './fields.js';
export const FIELDBOOK_VERSION = 3;
export const FIELDBOOK_COLLECTIONS = Object.freeze([
  'places',
  'notes',
  'evidence',
  'routes',
  'drawings',
  'attachments',
  'sceneDocuments',
  'analyses',
  'comparisons',
  'changeNotes',
]);
export const EVIDENCE_KINDS = Object.freeze([
  'observation',
  'forecast',
  'imagery',
  'derived',
  'manual',
  'simulation',
  'unknown',
]);
export const ATTACHMENT_TYPES = Object.freeze([
  'text/plain',
  'application/json',
  'application/geo+json',
  'application/gpx+xml',
  'application/vnd.google-earth.kml+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const optionalText = (v, p) =>
  nullable(v, p, (entry, at) => text(entry, at, 4096));
const optionalTime = (v, p) => nullable(v, p, timestamp);

export function newFieldbookId() {
  if (!globalThis.crypto?.randomUUID)
    throw new FieldbookValidationError(
      '$.id',
      'secure ID generation unavailable',
    );
  return globalThis.crypto.randomUUID();
}
export function createFieldbook({
  title = 'Untitled project',
  id: projectId = newFieldbookId(),
  now = new Date().toISOString(),
} = {}) {
  const project = {
    kind: 'aurel-fieldbook',
    version: FIELDBOOK_VERSION,
    id: projectId,
    title,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    archivedAt: null,
    places: [],
    notes: [],
    evidence: [],
    routes: [],
    drawings: [],
    attachments: [],
    sceneDocuments: [],
    analyses: [],
    comparisons: [],
    changeNotes: [],
  };
  return validateFieldbook(project);
}
function place(entry, path, budget) {
  fields(entry, path, [
    'id',
    'name',
    'aliases',
    'geometry',
    'extent',
    'createdAt',
  ]);
  text(entry.name, `${path}.name`);
  array(entry.aliases, `${path}.aliases`, 32);
  entry.aliases.forEach((alias) => text(alias, `${path}.aliases`));
  geometry(entry.geometry, `${path}.geometry`, budget, ['Point']);
  nullable(entry.extent, `${path}.extent`, extent);
  timestamp(entry.createdAt, `${path}.createdAt`);
}
function note(entry, path) {
  fields(entry, path, ['id', 'subjectId', 'text', 'createdAt', 'updatedAt']);
  id(entry.subjectId, `${path}.subjectId`);
  text(entry.text, `${path}.text`, 16384);
  timestamp(entry.createdAt, `${path}.createdAt`);
  timestamp(entry.updatedAt, `${path}.updatedAt`);
  if (Date.parse(entry.updatedAt) < Date.parse(entry.createdAt))
    fail(path, 'update precedes creation');
}
function evidence(entry, path) {
  fields(entry, path, [
    'id',
    'subjectId',
    'sourceId',
    'sourceLabel',
    'kind',
    'applicableTime',
    'retrievedAt',
    'extent',
    'resolutionM',
    'uncertainty',
    'coverage',
    'feedState',
    'attribution',
    'license',
    'link',
  ]);
  id(entry.subjectId, `${path}.subjectId`);
  text(entry.sourceId, `${path}.sourceId`, 256);
  text(entry.sourceLabel, `${path}.sourceLabel`, 4096);
  oneOf(entry.kind, `${path}.kind`, EVIDENCE_KINDS);
  optionalTime(entry.applicableTime, `${path}.applicableTime`);
  optionalTime(entry.retrievedAt, `${path}.retrievedAt`);
  nullable(entry.extent, `${path}.extent`, extent);
  nullable(entry.resolutionM, `${path}.resolutionM`, (v, p) =>
    number(v, p, Number.MIN_VALUE, 40000000),
  );
  nullable(entry.uncertainty, `${path}.uncertainty`, (v, p) =>
    number(v, p, 0, 40000000),
  ); // Explicit source uncertainty in meters.
  oneOf(entry.coverage, `${path}.coverage`, [
    'unknown',
    'supported',
    'unsupported',
    'partial',
  ]);
  oneOf(entry.feedState, `${path}.feedState`, [
    'unknown',
    'nominal',
    'loading',
    'degraded',
    'stale',
    'partial',
    'fallback',
    'unavailable',
    'blocked',
  ]);
  optionalText(entry.attribution, `${path}.attribution`);
  optionalText(entry.license, `${path}.license`);
  nullable(entry.link, `${path}.link`, safeReference);
}
function exactProjection(value, normalized) {
  if (value === normalized) return true;
  if (
    !value ||
    !normalized ||
    typeof value !== 'object' ||
    typeof normalized !== 'object' ||
    Array.isArray(value) !== Array.isArray(normalized)
  )
    return false;
  const keys = Object.keys(value);
  const expected = Object.keys(normalized);
  return (
    keys.length === expected.length &&
    keys.every(
      (key) =>
        Object.hasOwn(normalized, key) &&
        exactProjection(value[key], normalized[key]),
    )
  );
}
function route(entry, path, budget) {
  fields(entry, path, [
    'id',
    'name',
    'geometry',
    'mode',
    'sourceId',
    'sourceLabel',
    'distanceM',
    'durationSec',
    'createdAt',
    'applicableTime',
    'retrievedAt',
    'snapshot',
  ]);
  text(entry.name, `${path}.name`);
  text(entry.mode, `${path}.mode`, 64);
  text(entry.sourceId, `${path}.sourceId`, 256);
  text(entry.sourceLabel, `${path}.sourceLabel`, 4096);
  geometry(entry.geometry, `${path}.geometry`, budget, ['LineString']);
  nullable(entry.distanceM, `${path}.distanceM`, (v, p) =>
    number(v, p, 0, 100000000),
  );
  nullable(entry.durationSec, `${path}.durationSec`, (v, p) =>
    number(v, p, 0, 31536000),
  );
  timestamp(entry.createdAt, `${path}.createdAt`);
  optionalTime(entry.applicableTime, `${path}.applicableTime`);
  optionalTime(entry.retrievedAt, `${path}.retrievedAt`);
  if (entry.snapshot !== null) {
    const snapshot = validateRouteSnapshot(entry.snapshot);
    if (
      !snapshot ||
      !exactProjection(entry.snapshot, snapshot) ||
      snapshot.mode !== entry.mode ||
      snapshot.distanceM !== entry.distanceM ||
      snapshot.durationS !== entry.durationSec ||
      JSON.stringify(snapshot.geometry) !==
        JSON.stringify(entry.geometry.coordinates)
    )
      fail(`${path}.snapshot`, 'route snapshot does not match saved route');
  }
}
function drawing(entry, path, budget) {
  fields(entry, path, [
    'id',
    'name',
    'geometry',
    'color',
    'hidden',
    'createdAt',
  ]);
  text(entry.name, `${path}.name`);
  geometry(entry.geometry, `${path}.geometry`, budget);
  if (typeof entry.hidden !== 'boolean')
    fail(`${path}.hidden`, 'expected visibility flag');
  nullable(entry.color, `${path}.color`, (value, at) => {
    if (
      typeof value !== 'string' ||
      !/^(?:#[a-f0-9]{3,8}|[a-z][a-z0-9-]{0,31})$/i.test(value)
    )
      fail(at, 'invalid drawing color');
  });
  timestamp(entry.createdAt, `${path}.createdAt`);
}
function attachment(entry, path) {
  fields(entry, path, [
    'id',
    'name',
    'mimeType',
    'encoding',
    'data',
    'bytes',
    'createdAt',
  ]);
  text(entry.name, `${path}.name`, 256);
  oneOf(entry.mimeType, `${path}.mimeType`, ATTACHMENT_TYPES);
  oneOf(entry.encoding, `${path}.encoding`, ['utf8', 'base64']);
  integer(entry.bytes, `${path}.bytes`, 0, FIELDBOOK_LIMITS.attachmentBytes);
  timestamp(entry.createdAt, `${path}.createdAt`);
  if (typeof entry.data !== 'string')
    fail(`${path}.data`, 'expected local file content');
  let bytes;
  if (entry.encoding === 'utf8') {
    if (
      ![
        'text/plain',
        'application/json',
        'application/geo+json',
        'application/gpx+xml',
        'application/vnd.google-earth.kml+xml',
      ].includes(entry.mimeType)
    )
      fail(path, 'binary files require base64 encoding');
    bytes = new TextEncoder().encode(entry.data).length;
  } else {
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        entry.data,
      )
    )
      fail(path, 'invalid base64 data');
    bytes =
      (entry.data.length * 3) / 4 -
      (entry.data.endsWith('==') ? 2 : entry.data.endsWith('=') ? 1 : 0);
  }
  if (bytes !== entry.bytes)
    fail(`${path}.bytes`, 'local file byte length mismatch');
}
function scanSceneReferences(value, path, key = '') {
  if (
    typeof value === 'string' &&
    (/^\s*https?:\/\//i.test(value) || /(?:url|uri|href|src|link)$/i.test(key))
  )
    safeReference(value, path);
  else if (value && typeof value === 'object')
    for (const [name, child] of Object.entries(value))
      scanSceneReferences(child, path, name);
}
function scene(entry, path) {
  fields(entry, path, ['id', 'name', 'document']);
  text(entry.name, `${path}.name`);
  try {
    validateSceneDocument(entry.document);
  } catch {
    fail(`${path}.document`, 'invalid scene document');
  }
  scanSceneReferences(entry.document, `${path}.document`);
}
const validators = {
  places: place,
  notes: note,
  evidence,
  routes: route,
  drawings: drawing,
  attachments: attachment,
  sceneDocuments: scene,
  analyses: validateAnalysis,
  comparisons: validateComparison,
  changeNotes: validateChangeNote,
};

/** Validate, without mutation. Do not substitute retrieval time for observation time. */
export function validateFieldbook(project) {
  jsonTree(project);
  fields(project, '$', [
    'kind',
    'version',
    'id',
    'title',
    'createdAt',
    'updatedAt',
    'revision',
    'archivedAt',
    ...FIELDBOOK_COLLECTIONS,
  ]);
  if (
    project.kind !== 'aurel-fieldbook' ||
    project.version !== FIELDBOOK_VERSION
  )
    fail('$', 'unsupported Fieldbook format or version');
  id(project.id, '$.id');
  text(project.title, '$.title');
  timestamp(project.createdAt, '$.createdAt');
  timestamp(project.updatedAt, '$.updatedAt');
  optionalTime(project.archivedAt, '$.archivedAt');
  integer(project.revision, '$.revision');
  if (Date.parse(project.updatedAt) < Date.parse(project.createdAt))
    fail('$.updatedAt', 'update precedes creation');
  const seen = new Set([project.id]);
  const subjects = new Set([project.id]);
  const budget = { points: 0 };
  for (const name of FIELDBOOK_COLLECTIONS) {
    array(project[name], `$.${name}`, FIELDBOOK_LIMITS[name]);
    project[name].forEach((entry, index) => {
      const at = `$.${name}[${index}]`;
      id(entry?.id, `${at}.id`);
      if (seen.has(entry.id)) fail(`${at}.id`, 'duplicate ID');
      seen.add(entry.id);
      if (
        ![
          'notes',
          'evidence',
          'analyses',
          'comparisons',
          'changeNotes',
        ].includes(name)
      )
        subjects.add(entry.id);
      validators[name](entry, at, budget);
    });
  }
  for (const name of ['notes', 'evidence'])
    for (const entry of project[name])
      if (!subjects.has(entry.subjectId))
        fail(`$.${name}.subjectId`, 'dangling subject reference');
  const analysisSubjects = new Set(
    [...project.places, ...project.routes].map((entry) => entry.id),
  );
  for (const entry of project.analyses) {
    if (!analysisSubjects.has(entry.subjectId))
      fail(
        '$.analyses.subjectId',
        'analysis requires an existing place or route',
      );
    const route = project.routes.find((value) => value.id === entry.subjectId);
    if (route) {
      const saved = entry.snapshot.route;
      if (
        !saved ||
        saved.mode !== route.mode ||
        saved.distanceM !== route.distanceM ||
        saved.durationS !== route.durationSec ||
        !exactProjection(saved.geometry, route.geometry)
      )
        fail(
          '$.analyses.snapshot.route',
          'analysis does not match its saved route',
        );
    } else {
      const place = project.places.find(
        (value) => value.id === entry.subjectId,
      );
      const [lon, lat] = place.geometry.coordinates;
      const checkpoint = entry.snapshot.checkpoints[0];
      if (entry.snapshot.route !== null || entry.snapshot.profile !== null)
        fail(
          '$.analyses.snapshot',
          'place analysis cannot claim a route or route profile',
        );
      if (
        entry.snapshot.checkpoints.length !== 1 ||
        checkpoint.lat !== lat ||
        checkpoint.lon !== lon ||
        checkpoint.distanceM !== 0
      )
        fail(
          '$.analyses.snapshot.checkpoints',
          'place analysis requires its own sole checkpoint',
        );
    }
  }
  validateComparisonLinks(project);
  if (
    new TextEncoder().encode(JSON.stringify(project)).length >
    FIELDBOOK_LIMITS.bytes
  )
    fail('$', 'document size limit exceeded');
  return project;
}
/** Version upgrades are read projections; only explicit repository save writes them. */
export function migrateFieldbook(value) {
  jsonTree(value);
  if (value?.version === 1 || value?.version === 2) {
    if (
      (value.version === 1 && Object.hasOwn(value, 'analyses')) ||
      Object.hasOwn(value, 'comparisons') ||
      Object.hasOwn(value, 'changeNotes')
    )
      fail('$', 'unsupported legacy field');
    return validateFieldbook({
      ...value,
      version: FIELDBOOK_VERSION,
      ...(value.version === 1 ? { analyses: [] } : {}),
      comparisons: [],
      changeNotes: [],
    });
  }
  return validateFieldbook(value);
}
export function parseFieldbook(textValue) {
  if (
    typeof textValue !== 'string' ||
    textValue.length > FIELDBOOK_LIMITS.bytes ||
    new TextEncoder().encode(textValue).length > FIELDBOOK_LIMITS.bytes
  )
    fail('$', 'document size limit exceeded');
  let value;
  try {
    value = JSON.parse(textValue);
  } catch {
    fail('$', 'invalid JSON document');
  }
  return migrateFieldbook(value);
}
export function stringifyFieldbook(project) {
  validateFieldbook(project);
  const encoded = JSON.stringify(project, null, 2);
  if (new TextEncoder().encode(encoded).length > FIELDBOOK_LIMITS.bytes)
    fail('$', 'document size limit exceeded');
  return encoded;
}
