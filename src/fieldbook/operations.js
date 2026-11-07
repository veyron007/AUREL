/** Immutable local edits. Repository save alone advances the durable revision. */
import {
  createFieldbook,
  validateFieldbook,
  FIELDBOOK_COLLECTIONS,
  newFieldbookId,
} from './document.js';
import { fail, jsonTree } from './fields.js';
const clone = (value) => JSON.parse(JSON.stringify(value));
function input(project) {
  validateFieldbook(project);
  return clone(project);
}
function finish(project, now) {
  return validateFieldbook({ ...project, updatedAt: now });
}
function append(project, collection, entry, defaults, now) {
  jsonTree(entry);
  const value = input(project);
  const row = {
    ...defaults,
    ...clone(entry),
    id: entry.id ?? newFieldbookId(),
  };
  return finish({ ...value, [collection]: [...value[collection], row] }, now);
}
export function renameFieldbook(
  project,
  title,
  { now = new Date().toISOString() } = {},
) {
  return finish({ ...input(project), title }, now);
}
export function setArchived(
  project,
  archived,
  { now = new Date().toISOString() } = {},
) {
  if (typeof archived !== 'boolean')
    fail('$.archivedAt', 'expected archive choice');
  return finish({ ...input(project), archivedAt: archived ? now : null }, now);
}
export function duplicateFieldbook(
  project,
  {
    id = newFieldbookId(),
    title = project.title,
    now = new Date().toISOString(),
  } = {},
) {
  const original = input(project);
  const copy = {
    ...original,
    ...createFieldbook({ id, title, now }),
    ...Object.fromEntries(
      FIELDBOOK_COLLECTIONS.map((name) => [name, original[name]]),
    ),
  };
  for (const name of ['notes', 'evidence'])
    copy[name] = copy[name].map((entry) => ({
      ...entry,
      subjectId: entry.subjectId === original.id ? id : entry.subjectId,
    }));
  return validateFieldbook(copy);
}
export function addPlace(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(
    project,
    'places',
    entry,
    { aliases: [], extent: null, createdAt: now },
    now,
  );
}
export function addNote(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(
    project,
    'notes',
    entry,
    { createdAt: now, updatedAt: now },
    now,
  );
}
export function updateNote(
  project,
  noteId,
  text,
  { now = new Date().toISOString() } = {},
) {
  const value = input(project);
  if (!value.notes.some((entry) => entry.id === noteId))
    fail('$.notes', 'note not found');
  return finish(
    {
      ...value,
      notes: value.notes.map((entry) =>
        entry.id === noteId ? { ...entry, text, updatedAt: now } : entry,
      ),
    },
    now,
  );
}
export function addEvidence(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(
    project,
    'evidence',
    entry,
    {
      applicableTime: null,
      retrievedAt: null,
      extent: null,
      resolutionM: null,
      uncertainty: null,
      coverage: 'unknown',
      feedState: 'unknown',
      attribution: null,
      license: null,
      link: null,
    },
    now,
  );
}
export function addAnalysis(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(
    project,
    'analyses',
    entry,
    { kind: entry.kind ?? 'route-context', createdAt: now },
    now,
  );
}
export function addRoute(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(
    project,
    'routes',
    entry,
    {
      distanceM: null,
      durationSec: null,
      createdAt: now,
      applicableTime: null,
      retrievedAt: null,
      snapshot: null,
    },
    now,
  );
}
export function addDrawing(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(
    project,
    'drawings',
    entry,
    { color: null, hidden: false, createdAt: now },
    now,
  );
}
export function addAttachment(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(project, 'attachments', entry, { createdAt: now }, now);
}
export function addSceneDocument(
  project,
  entry,
  { now = new Date().toISOString() } = {},
) {
  return append(project, 'sceneDocuments', entry, {}, now);
}
/** Referenced entities cannot disappear silently; notes can be removed directly. */
export function removeEntry(
  project,
  collection,
  entryId,
  { now = new Date().toISOString() } = {},
) {
  if (!FIELDBOOK_COLLECTIONS.includes(collection))
    fail('$', 'unknown collection');
  const value = input(project);
  if (!value[collection].some((entry) => entry.id === entryId))
    fail(`$.${collection}`, 'entry not found');
  if (
    [...value.notes, ...value.evidence, ...value.analyses].some(
      (entry) => entry.subjectId === entryId,
    )
  )
    fail(`$.${collection}`, 'entry still has references');
  return finish(
    {
      ...value,
      [collection]: value[collection].filter((entry) => entry.id !== entryId),
    },
    now,
  );
}
