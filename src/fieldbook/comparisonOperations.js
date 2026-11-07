/** Atomic immutable comparison edits; only the controller performs persistence. */
import { newFieldbookId, validateFieldbook } from './document.js';
import { addPlace, addEvidence } from './operations.js';
import { validateComparisonSnapshot } from './comparisonSchema.js';
import { fail, jsonTree } from './fields.js';
const clone = (value) => JSON.parse(JSON.stringify(value));
const withoutLink = ({ evidenceId, ...input }) => input;
export function comparisonCaptureValue(snapshot) {
  return {
    ...snapshot,
    before: withoutLink(snapshot.before),
    after: withoutLink(snapshot.after),
  };
}
export function sameComparisonValue(left, right) {
  if (left === right) return true;
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && sameComparisonValue(left[key], right[key]),
    )
  );
}
function evidenceInput(input, subjectId) {
  return {
    subjectId,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    kind: 'imagery',
    applicableTime: input.time.kind === 'instant' ? input.time.at : null,
    retrievedAt: input.retrievedAt,
    extent: input.georeference.extent,
    resolutionM: input.nativeResolutionM,
    coverage: input.coverage === 'full' ? 'supported' : input.coverage,
    feedState: 'nominal',
    attribution: input.attribution,
    license: input.license,
  };
}
export function captureComparison(
  project,
  subject,
  snapshot,
  { now = new Date().toISOString() } = {},
) {
  validateFieldbook(project);
  validateComparisonSnapshot(snapshot);
  jsonTree(subject);
  let next = clone(project);
  let place = next.places.find((entry) => entry.id === subject?.id);
  if (!place && subject?.geometry?.type === 'Point') {
    place = next.places.find(
      (entry) =>
        entry.name === subject.name &&
        sameComparisonValue(entry.geometry, subject.geometry),
    );
    if (!place) {
      next = addPlace(
        next,
        {
          name: subject.name,
          aliases: subject.aliases ?? [],
          geometry: subject.geometry,
          extent: subject.extent ?? null,
        },
        { now },
      );
      place = next.places.at(-1);
    }
  }
  if (!place) fail('$.subject', 'comparison requires a saved place');
  if (
    subject.geometry &&
    !sameComparisonValue(subject.geometry, place.geometry)
  )
    fail('$.subject', 'selected place differs from saved place');
  const existing = next.comparisons.find(
    (entry) =>
      entry.subjectId === place.id &&
      sameComparisonValue(comparisonCaptureValue(entry.snapshot), snapshot),
  );
  if (existing) return { project: next, comparisonId: existing.id };
  const inputs = {};
  for (const side of ['before', 'after']) {
    next = addEvidence(next, evidenceInput(snapshot[side], place.id), { now });
    inputs[side] = {
      ...clone(snapshot[side]),
      evidenceId: next.evidence.at(-1).id,
    };
  }
  const comparison = {
    id: newFieldbookId(),
    subjectId: place.id,
    createdAt: now,
    snapshot: { ...clone(snapshot), ...inputs },
  };
  return {
    project: validateFieldbook({
      ...next,
      updatedAt: now,
      comparisons: [...next.comparisons, comparison],
    }),
    comparisonId: comparison.id,
  };
}
function changeNoteBody(comparison, input) {
  return {
    comparisonId: comparison.id,
    text: input.text,
    interpretation: input.interpretation,
    supportingEvidenceIds: input.supportingEvidenceIds ?? [
      comparison.snapshot.before.evidenceId,
      comparison.snapshot.after.evidenceId,
    ],
    drawingId: input.drawingId ?? null,
  };
}
export function findChangeNote(project, comparisonId, input) {
  const comparison = project.comparisons.find(
    (entry) => entry.id === comparisonId,
  );
  if (!comparison) return null;
  const value = changeNoteBody(comparison, input);
  return (
    project.changeNotes.find(({ id, createdAt, updatedAt, ...entry }) =>
      sameComparisonValue(entry, value),
    ) ?? null
  );
}
export function appendChangeNote(
  project,
  comparisonId,
  input,
  { now = new Date().toISOString() } = {},
) {
  validateFieldbook(project);
  jsonTree(input);
  const next = clone(project),
    comparison = next.comparisons.find((entry) => entry.id === comparisonId);
  if (!comparison) fail('$.comparisonId', 'comparison not found');
  const value = changeNoteBody(comparison, input);
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'text',
          'interpretation',
          'supportingEvidenceIds',
          'drawingId',
        ].includes(key),
    )
  )
    fail('$.changeNote', 'unsupported field');
  const existing = findChangeNote(next, comparisonId, input);
  if (existing) return next;
  return validateFieldbook({
    ...next,
    updatedAt: now,
    changeNotes: [
      ...next.changeNotes,
      { id: newFieldbookId(), ...clone(value), createdAt: now, updatedAt: now },
    ],
  });
}
/** Saved inputs and their cited evidence may be removed explicitly, never rewritten in place. */
export function assertComparisonHistory(current, next) {
  if (!current) return;
  for (const previous of current.comparisons) {
    const kept = next.comparisons.find((entry) => entry.id === previous.id);
    if (!kept) continue;
    if (!sameComparisonValue(previous, kept))
      fail('$.comparisons', 'saved comparison inputs are immutable');
    for (const side of ['before', 'after']) {
      const id = previous.snapshot[side].evidenceId;
      if (
        !sameComparisonValue(
          current.evidence.find((entry) => entry.id === id),
          next.evidence.find((entry) => entry.id === id),
        )
      )
        fail('$.evidence', 'comparison evidence is immutable');
    }
  }
}
