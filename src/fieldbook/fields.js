/** Portable, bounded validators. Errors identify fields, never supplied values. */
export const FIELDBOOK_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  attachmentBytes: 2 * 1024 * 1024,
  attachments: 8,
  projects: 256,
  places: 1000,
  notes: 4000,
  evidence: 4000,
  routes: 128,
  drawings: 1000,
  sceneDocuments: 16,
  analyses: 64,
  comparisons: 64,
  changeNotes: 512,
  points: 20000,
  nodes: 200000,
  depth: 32,
});
export class FieldbookValidationError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'FieldbookValidationError';
    this.code = 'INVALID_DOCUMENT';
    this.path = path;
    this.reason = reason;
  }
}
export function fail(path, reason) {
  throw new FieldbookValidationError(path, reason);
}
export function fields(value, path, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'expected an object');
  if (Object.keys(value).some((key) => !names.includes(key)))
    fail(path, 'unsupported field');
  for (const name of names)
    if (!Object.hasOwn(value, name)) fail(`${path}.${name}`, 'required field');
}
export function text(value, path, max = 512) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    fail(path, 'expected bounded nonempty text');
}
export function id(value, path) {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
  )
    fail(path, 'expected a stable ID');
}
export function number(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(path, 'number outside allowed range');
}
export function integer(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) {
  number(value, path, min, max);
  if (!Number.isInteger(value)) fail(path, 'expected an integer');
}
export function array(value, path, max) {
  if (!Array.isArray(value) || value.length > max)
    fail(path, 'collection size limit exceeded');
}
export function nullable(value, path, check) {
  if (value !== null) check(value, path);
}
export function oneOf(value, path, choices) {
  if (!choices.includes(value)) fail(path, 'unsupported value');
}
export function timestamp(value, path) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    fail(path, 'expected a valid UTC timestamp');
}
export function extent(value, path) {
  array(value, path, 4);
  if (value.length !== 4) fail(path, 'expected a geographic extent');
  number(value[0], path, -180, 180);
  number(value[2], path, -180, 180);
  number(value[1], path, -90, 90);
  number(value[3], path, -90, 90);
  // West greater than east explicitly represents an antimeridian-wrapped extent.
  if (value[1] > value[3]) fail(path, 'extent latitude bounds must be ordered');
}
export function coordinate(value, path, budget) {
  array(value, path, 3);
  if (value.length < 2) fail(path, 'expected longitude and latitude');
  number(value[0], path, -180, 180);
  number(value[1], path, -90, 90);
  if (value.length === 3) number(value[2], path, -12000, 1000000);
  if (++budget.points > FIELDBOOK_LIMITS.points)
    fail(path, 'geometry point limit exceeded');
}
export function geometry(
  value,
  path,
  budget,
  types = ['Point', 'LineString', 'Polygon', 'MultiPolygon'],
) {
  fields(value, path, ['type', 'coordinates']);
  oneOf(value.type, `${path}.type`, types);
  if (value.type === 'Point') {
    coordinate(value.coordinates, path, budget);
    return;
  }
  const line = (points, at, minimum) => {
    array(points, at, FIELDBOOK_LIMITS.points);
    if (points.length < minimum) fail(at, 'too few geometry points');
    points.forEach((point, i) => coordinate(point, `${at}[${i}]`, budget));
  };
  if (value.type === 'LineString') {
    line(value.coordinates, path, 2);
    return;
  }
  if (value.type === 'MultiPolygon') {
    array(value.coordinates, path, 64);
    if (!value.coordinates.length) fail(path, 'multipolygon needs polygons');
    value.coordinates.forEach((coordinates, i) =>
      geometry({ type: 'Polygon', coordinates }, `${path}[${i}]`, budget, [
        'Polygon',
      ]),
    );
    return;
  }
  array(value.coordinates, path, 64);
  if (!value.coordinates.length) fail(path, 'polygon needs a ring');
  value.coordinates.forEach((ring, index) => {
    if (!Array.isArray(ring) || ring.length < 4)
      fail(`${path}[${index}]`, 'polygon ring requires four closed points');
    line(ring, `${path}[${index}]`, 4);
    if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))
      fail(`${path}[${index}]`, 'polygon ring is not closed');
  });
}
export function safeReference(value, path) {
  text(value, path, 2048);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(path, 'invalid reference URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !url.hostname ||
    /^(localhost|127\.|0\.|\[?::1\]?)/i.test(url.hostname) ||
    /[\u0000-\u0020]/u.test(value)
  )
    fail(path, 'unsafe reference URL');
  for (const key of url.searchParams.keys()) {
    if (
      /(?:key|token|auth|sign|credential|password|secret|session|jwt|x-amz|x-goog)/i.test(
        key,
      )
    )
      fail(path, 'credential-bearing reference URL');
  }
  if (
    /(?:key|token|auth|sign|credential|password|secret|session|jwt)=/i.test(
      url.hash,
    )
  )
    fail(path, 'credential-bearing reference URL');
}
/** Validate objects before JSON.stringify can invoke an accessor or toJSON. */
export function jsonTree(
  value,
  path = '$',
  budget = { nodes: 0, strings: 0 },
  ancestors = new WeakSet(),
  depth = 0,
) {
  if (++budget.nodes > FIELDBOOK_LIMITS.nodes || depth > FIELDBOOK_LIMITS.depth)
    fail(path, 'document complexity limit exceeded');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    budget.strings += value.length;
    if (budget.strings > FIELDBOOK_LIMITS.bytes)
      fail(path, 'document size limit exceeded');
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') fail(path, 'expected JSON data');
  if (ancestors.has(value)) fail(path, 'cyclic document');
  const prototype = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    fail(path, 'expected plain JSON data');
  if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol'))
    fail(path, 'unsafe JSON property');
  if (
    Array.isArray(value) &&
    (value.length > FIELDBOOK_LIMITS.nodes ||
      Object.keys(value).length !== value.length ||
      Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key)))
  )
    fail(path, 'expected a dense JSON array');
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (Array.isArray(value) && key === 'length') continue;
    if (
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)
    )
      fail(path, 'unsafe JSON property');
    jsonTree(descriptor.value, path, budget, ancestors, depth + 1);
  }
  ancestors.delete(value);
}
