/**
 * Agent writes to the Fieldbook. Each write loads the project, checks the
 * revision the agent named, applies one immutable edit through the existing
 * Fieldbook operations and saves it with the repository's own atomic
 * revision check, so a write made against a stale revision fails instead of
 * overwriting the owner's work. Every new entry carries an agent ID
 * (src/fieldkit/author.js). Agent text is stored verbatim as data.
 *
 * Portable: the repository is injected (IndexedDB in the app, memory in tests).
 */

import { createFieldbook } from '../fieldbook/document.js';
import {
  addDrawing,
  addEvidence,
  addNote,
  addPlace,
} from '../fieldbook/operations.js';
import { agentEntryId } from './author.js';
import { areaPolygon } from './geometry.js';
import { FieldKitRefusalError } from './refusals.js';

/** Envelope class → Fieldbook evidence kind. */
export const CLASS_TO_EVIDENCE_KIND = Object.freeze({
  observed: 'observation',
  modelled: 'forecast',
  derived: 'derived',
  simulated: 'simulation',
  note: 'manual',
});

const refuse = (code, message, details) => {
  throw new FieldKitRefusalError(code, message, details);
};

/**
 * The write context: the client's tag, the write time and an ID factory.
 * @param {{ client: string, now?: () => number, uuid?: () => string }} options
 */
export function writeContext({
  client,
  now = Date.now,
  uuid = () => globalThis.crypto.randomUUID(),
}) {
  return {
    client,
    now: new Date(now()).toISOString(),
    newId: () => agentEntryId(client, uuid()),
  };
}

function time(value) {
  if (value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Fieldbook evidence rows for agent citations about one subject. */
export function evidenceRows(refs = [], subjectId, ctx) {
  return refs.map((ref) => ({
    id: ctx.newId(),
    subjectId,
    sourceId: ref.source_id ?? `tool:${ref.tool}`,
    sourceLabel: `${ref.source_label} (cited by agent via ${ref.tool})`,
    kind: CLASS_TO_EVIDENCE_KIND[ref.class] ?? 'unknown',
    applicableTime: time(ref.applicable_time),
    retrievedAt: time(ref.retrieved_at),
    extent: null,
    resolutionM: null,
    uncertainty: null,
    coverage: 'unknown',
    feedState: 'unknown',
    attribution: ref.source_label,
    license: ref.licence ?? null,
    link: ref.url ?? null,
  }));
}

/** One citation line per reference, appended to an agent note. */
export function citationLines(refs = []) {
  return refs.map(
    (ref, index) =>
      `[${index + 1}] ${ref.tool} · ${ref.class} · ${ref.source_label} · applies ${ref.applicable_time ?? 'time unknown'}${ref.licence ? ` · ${ref.licence}` : ''}${ref.summary ? ` — ${ref.summary}` : ''}`,
  );
}

function withEvidence(project, refs, subjectId, ctx) {
  const rows = evidenceRows(refs, subjectId, ctx);
  let next = project;
  for (const row of rows) next = addEvidence(next, row, { now: ctx.now });
  return { project: next, evidenceIds: rows.map((row) => row.id) };
}

/** Add one place (and its cited evidence). */
export function applyAddPlace(project, args, ctx) {
  const place = {
    id: ctx.newId(),
    name: args.name,
    aliases: args.aliases ?? [],
    geometry: { type: 'Point', coordinates: [args.lon, args.lat] },
    extent: null,
    createdAt: ctx.now,
  };
  const added = addPlace(project, place, { now: ctx.now });
  const { project: next, evidenceIds } = withEvidence(
    added,
    args.evidence,
    place.id,
    ctx,
  );
  return { project: next, place, evidenceIds };
}

/** Add one note about a subject; citations become evidence on that subject. */
export function applyAddNote(project, args, ctx) {
  const subjectId = args.subject_id ?? project.id;
  const subjects = [
    project,
    ...project.places,
    ...project.routes,
    ...project.drawings,
  ];
  if (!subjects.some((entry) => entry.id === subjectId))
    refuse('not_found', 'The note subject is not in this project.', {
      subject_id: subjectId,
    });
  const lines = citationLines(args.evidence);
  const text = lines.length
    ? `${args.text}\n\nEvidence cited:\n${lines.join('\n')}`
    : args.text;
  const note = {
    id: ctx.newId(),
    subjectId,
    text,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const added = addNote(project, note, { now: ctx.now });
  const { project: next, evidenceIds } = withEvidence(
    added,
    args.evidence,
    subjectId,
    ctx,
  );
  return { project: next, note, evidenceIds };
}

/** Add one drawn area after checking it is a simple, bounded polygon. */
export function applyDrawArea(project, args, ctx) {
  const drawing = {
    id: ctx.newId(),
    name: args.name,
    geometry: areaPolygon(args),
    color: args.color ?? null,
    hidden: false,
    createdAt: ctx.now,
  };
  return { project: addDrawing(project, drawing, { now: ctx.now }), drawing };
}

/** Add a mission's places and its checklist note in one edit. */
export function applyMission(project, plan, ctx) {
  let next = project;
  const places = [];
  for (const entry of plan.skeleton.places) {
    const result = applyAddPlace(next, entry, ctx);
    next = result.project;
    places.push(result.place);
  }
  const { project: withNote, note } = applyAddNote(
    next,
    { text: plan.skeleton.note, subject_id: places[0]?.id },
    ctx,
  );
  return { project: withNote, places, note };
}

function storageRefusal(error) {
  if (error instanceof FieldKitRefusalError) return error;
  if (error?.code === 'CONFLICT')
    return new FieldKitRefusalError(
      'revision_conflict',
      'The project changed while saving. Nothing was written; read the latest revision and retry.',
      { latest_revision: error.latest?.revision ?? null },
    );
  if (error?.code === 'STORAGE_LIMIT')
    return new FieldKitRefusalError('limit_reached', error.message);
  if (error?.code === 'INVALID_DOCUMENT')
    return new FieldKitRefusalError(
      'invalid_request',
      `The write does not fit the Fieldbook format: ${error.reason ?? 'invalid value'}.`,
    );
  return new FieldKitRefusalError(
    'storage_unavailable',
    'Local project storage is unavailable; nothing was written.',
  );
}

/**
 * Load the project an agent names, checking its revision, or start a new one
 * when `allowCreate` and no project is named.
 */
export async function loadForWrite(
  repository,
  args,
  ctx,
  { allowCreate, title },
) {
  if (args.project_id === undefined) {
    if (!allowCreate)
      refuse('invalid_request', 'Name the project_id to write to.');
    try {
      return {
        project: createFieldbook({ id: ctx.newId(), title, now: ctx.now }),
        expectedRevision: null,
        created: true,
      };
    } catch (error) {
      throw storageRefusal(error);
    }
  }
  if (args.expected_revision === undefined)
    refuse(
      'invalid_request',
      'Writing to an existing project needs expected_revision from your last write.',
    );
  let stored;
  try {
    stored = await repository.get(args.project_id);
  } catch (error) {
    throw storageRefusal(error);
  }
  if (!stored)
    refuse('not_found', 'No saved project has that ID.', {
      project_id: args.project_id,
    });
  if (stored.archivedAt)
    refuse(
      'unsupported',
      'The project is archived; the owner must restore it first.',
    );
  if (stored.revision !== args.expected_revision)
    refuse(
      'revision_conflict',
      `The project is at revision ${stored.revision}, not ${args.expected_revision}. Nothing was written.`,
      { latest_revision: stored.revision },
    );
  return { project: stored, expectedRevision: stored.revision, created: false };
}

/** Save with the repository's atomic revision check. */
export async function saveWrite(repository, project, expectedRevision) {
  try {
    return await repository.save(project, { expectedRevision });
  } catch (error) {
    throw storageRefusal(error);
  }
}

/** Run an edit (`apply(project) => { project, ...result }`) as one write. */
export async function writeProject(
  repository,
  args,
  ctx,
  { allowCreate = false, title, apply },
) {
  const loaded = await loadForWrite(repository, args, ctx, {
    allowCreate,
    title,
  });
  let applied;
  try {
    applied = apply(loaded.project);
  } catch (error) {
    throw storageRefusal(error);
  }
  const saved = await saveWrite(
    repository,
    applied.project,
    loaded.expectedRevision,
  );
  const { project: _ignored, ...rest } = applied;
  return {
    ...rest,
    project_id: saved.id,
    project_title: saved.title,
    revision: saved.revision,
    created_project: loaded.created,
  };
}
