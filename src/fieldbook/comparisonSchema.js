/** Dated image evidence only: requested rendering dates never substitute for acquisition. */
import {
  fields,
  fail,
  text,
  id,
  number,
  array,
  nullable,
  oneOf,
  timestamp,
  extent,
  jsonTree,
} from './fields.js';

export function calendarDate(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(path, 'expected calendar date');
  timestamp(`${value}T00:00:00.000Z`, path);
}
export function comparisonTimeBounds(value, path = '$.time') {
  if (value?.kind === 'day') {
    fields(value, path, ['kind', 'date']);
    calendarDate(value.date, `${path}.date`);
    const start = Date.parse(`${value.date}T00:00:00.000Z`);
    return [start, start + 86400000];
  }
  if (value?.kind === 'instant') {
    fields(value, path, ['kind', 'at']);
    timestamp(value.at, `${path}.at`);
    return [Date.parse(value.at), Date.parse(value.at)];
  }
  fields(value, path, ['kind', 'start', 'end']);
  oneOf(value.kind, `${path}.kind`, ['interval']);
  timestamp(value.start, `${path}.start`);
  timestamp(value.end, `${path}.end`);
  const result = [Date.parse(value.start), Date.parse(value.end)];
  if (result[1] <= result[0])
    fail(path, 'acquisition interval must be ordered');
  return result;
}
const longitudeParts = ([west, , east]) =>
  west <= east
    ? [[west, east]]
    : [
        [west, 180],
        [-180, east],
      ];
export function extentContains(outer, inner) {
  return (
    inner[1] >= outer[1] &&
    inner[3] <= outer[3] &&
    longitudeParts(inner).every(([west, east]) =>
      longitudeParts(outer).some(
        ([left, right]) => west >= left && east <= right,
      ),
    )
  );
}
export function extentContainsPoint(box, coordinates) {
  const [lon, lat] = coordinates;
  return (
    lat >= box[1] &&
    lat <= box[3] &&
    longitudeParts(box).some(([west, east]) => lon >= west && lon <= east)
  );
}
function imageInput(value, path, linked) {
  fields(value, path, [
    ...(linked ? ['evidenceId'] : []),
    'sourceId',
    'sourceLabel',
    'time',
    'retrievedAt',
    'probedAt',
    'license',
    'attribution',
    'asset',
    'georeference',
    'nativeResolutionM',
    'cloudCoverPct',
    'cloudScope',
    'granuleIds',
    'availability',
    'coverage',
    'alignment',
  ]);
  if (linked) id(value.evidenceId, `${path}.evidenceId`);
  text(value.sourceId, `${path}.sourceId`, 256);
  text(value.sourceLabel, `${path}.sourceLabel`, 4096);
  comparisonTimeBounds(value.time, `${path}.time`);
  nullable(value.retrievedAt, `${path}.retrievedAt`, timestamp);
  timestamp(value.probedAt, `${path}.probedAt`);
  text(value.license, `${path}.license`, 4096);
  text(value.attribution, `${path}.attribution`, 4096);
  fields(value.asset, `${path}.asset`, ['kind', 'productId', 'requestedDate']);
  oneOf(value.asset.kind, `${path}.asset.kind`, ['gibs']);
  oneOf(value.asset.productId, `${path}.asset.productId`, [
    'S30',
    'L30',
    'VIIRS',
  ]);
  calendarDate(value.asset.requestedDate, `${path}.asset.requestedDate`);
  const acquired = comparisonTimeBounds(value.time),
    requested = Date.parse(`${value.asset.requestedDate}T00:00:00.000Z`);
  if (
    acquired[0] < requested ||
    acquired[0] >= requested + 86400000 ||
    acquired[1] > requested + 86400000
  )
    fail(`${path}.time`, 'acquisition does not belong to the dated asset');
  if (acquired[0] > Date.parse(value.probedAt))
    fail(`${path}.time`, 'availability check precedes acquisition');
  fields(value.georeference, `${path}.georeference`, ['crs', 'extent']);
  oneOf(value.georeference.crs, `${path}.georeference.crs`, ['EPSG:4326']);
  extent(value.georeference.extent, `${path}.georeference.extent`);
  oneOf(value.nativeResolutionM, `${path}.nativeResolutionM`, [
    value.asset.productId === 'VIIRS' ? 250 : 30,
  ]);
  nullable(value.cloudCoverPct, `${path}.cloudCoverPct`, (v, p) =>
    number(v, p, 0, 100),
  );
  oneOf(value.cloudScope, `${path}.cloudScope`, ['scene']);
  array(value.granuleIds, `${path}.granuleIds`, 128);
  value.granuleIds.forEach((entry) => text(entry, `${path}.granuleIds`, 512));
  if (new Set(value.granuleIds).size !== value.granuleIds.length)
    fail(`${path}.granuleIds`, 'duplicate granule identifier');
  oneOf(value.availability, `${path}.availability`, ['present']);
  oneOf(value.coverage, `${path}.coverage`, ['full', 'partial', 'unknown']);
  oneOf(value.alignment, `${path}.alignment`, ['unverified']);
}
export function validateComparisonInput(
  value,
  { linked = false, path = '$.input' } = {},
) {
  jsonTree(value);
  imageInput(value, path, linked);
  return value;
}
export function validateComparisonSnapshot(
  snapshot,
  { linked = false, path = '$.snapshot' } = {},
) {
  jsonTree(snapshot);
  fields(snapshot, path, [
    'version',
    'title',
    'capturedAt',
    'extent',
    'method',
    'splitPosition',
    'before',
    'after',
  ]);
  oneOf(snapshot.version, `${path}.version`, [1]);
  text(snapshot.title, `${path}.title`);
  timestamp(snapshot.capturedAt, `${path}.capturedAt`);
  extent(snapshot.extent, `${path}.extent`);
  if (
    snapshot.extent[0] === snapshot.extent[2] ||
    snapshot.extent[1] === snapshot.extent[3]
  )
    fail(`${path}.extent`, 'comparison needs a nonempty extent');
  oneOf(snapshot.method, `${path}.method`, ['manual-visual']);
  number(snapshot.splitPosition, `${path}.splitPosition`, 0, 1);
  for (const side of ['before', 'after']) {
    imageInput(snapshot[side], `${path}.${side}`, linked);
    if (!extentContains(snapshot[side].georeference.extent, snapshot.extent))
      fail(
        `${path}.${side}.georeference`,
        'input does not cover comparison extent',
      );
  }
  const before = comparisonTimeBounds(snapshot.before.time),
    after = comparisonTimeBounds(snapshot.after.time);
  if (before[1] > after[0] || before[0] >= after[0])
    fail(path, 'comparison requires ordered distinct acquisition times');
  if (linked && snapshot.before.evidenceId === snapshot.after.evidenceId)
    fail(path, 'comparison requires two distinct evidence records');
  return snapshot;
}
export function validateComparison(entry, path) {
  fields(entry, path, ['id', 'subjectId', 'createdAt', 'snapshot']);
  id(entry.subjectId, `${path}.subjectId`);
  timestamp(entry.createdAt, `${path}.createdAt`);
  validateComparisonSnapshot(entry.snapshot, {
    linked: true,
    path: `${path}.snapshot`,
  });
}
export function validateChangeNote(entry, path) {
  fields(entry, path, [
    'id',
    'comparisonId',
    'text',
    'interpretation',
    'supportingEvidenceIds',
    'drawingId',
    'createdAt',
    'updatedAt',
  ]);
  id(entry.comparisonId, `${path}.comparisonId`);
  text(entry.text, `${path}.text`, 16384);
  oneOf(entry.interpretation, `${path}.interpretation`, [
    'observed',
    'inferred',
    'unresolved',
  ]);
  array(entry.supportingEvidenceIds, `${path}.supportingEvidenceIds`, 2);
  if (
    !entry.supportingEvidenceIds.length ||
    new Set(entry.supportingEvidenceIds).size !==
      entry.supportingEvidenceIds.length
  )
    fail(path, 'change note requires distinct supporting evidence');
  entry.supportingEvidenceIds.forEach((value) =>
    id(value, `${path}.supportingEvidenceIds`),
  );
  nullable(entry.drawingId, `${path}.drawingId`, id);
  timestamp(entry.createdAt, `${path}.createdAt`);
  timestamp(entry.updatedAt, `${path}.updatedAt`);
  if (Date.parse(entry.updatedAt) < Date.parse(entry.createdAt))
    fail(path, 'update precedes creation');
}
function assertMatchingEvidence(record, input, subjectId, path) {
  if (!record || record.subjectId !== subjectId || record.kind !== 'imagery')
    fail(path, 'comparison requires its own imagery evidence');
  for (const key of [
    'sourceId',
    'sourceLabel',
    'retrievedAt',
    'license',
    'attribution',
  ])
    if (record[key] !== input[key])
      fail(path, 'comparison metadata does not match evidence');
  if (
    record.applicableTime !==
      (input.time.kind === 'instant' ? input.time.at : null) ||
    record.resolutionM !== input.nativeResolutionM ||
    JSON.stringify(record.extent) !== JSON.stringify(input.georeference.extent)
  )
    fail(path, 'comparison time or geography does not match evidence');
}
export function validateComparisonLinks(project) {
  for (const comparison of project.comparisons) {
    const place = project.places.find(
      (entry) => entry.id === comparison.subjectId,
    );
    if (
      !place ||
      !extentContainsPoint(
        comparison.snapshot.extent,
        place.geometry.coordinates,
      )
    )
      fail(
        '$.comparisons.subjectId',
        'comparison requires its own saved place inside the area',
      );
    for (const side of ['before', 'after']) {
      const input = comparison.snapshot[side];
      assertMatchingEvidence(
        project.evidence.find((entry) => entry.id === input.evidenceId),
        input,
        place.id,
        `$.comparisons.snapshot.${side}`,
      );
    }
  }
  for (const note of project.changeNotes) {
    const comparison = project.comparisons.find(
      (entry) => entry.id === note.comparisonId,
    );
    if (!comparison) fail('$.changeNotes.comparisonId', 'missing comparison');
    const allowed = [
      comparison.snapshot.before.evidenceId,
      comparison.snapshot.after.evidenceId,
    ];
    if (!note.supportingEvidenceIds.every((value) => allowed.includes(value)))
      fail(
        '$.changeNotes.supportingEvidenceIds',
        'note cites evidence outside this comparison',
      );
    if (note.drawingId !== null) {
      const drawing = project.drawings.find(
        (entry) => entry.id === note.drawingId,
      );
      if (
        !drawing ||
        !['Polygon', 'MultiPolygon'].includes(drawing.geometry.type)
      )
        fail('$.changeNotes.drawingId', 'change note requires a saved polygon');
      const points = drawing.geometry.coordinates.flat(
        drawing.geometry.type === 'Polygon' ? 1 : 2,
      );
      if (
        !points.every((point) =>
          extentContainsPoint(comparison.snapshot.extent, point),
        )
      )
        fail(
          '$.changeNotes.drawingId',
          'change polygon lies outside comparison extent',
        );
    }
  }
}
