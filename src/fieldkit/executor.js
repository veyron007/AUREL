/**
 * The in-app side of Field Kit: runs one relayed operation against the
 * owner's local stores. Everything it receives crossed a local relay from an
 * MCP client, so it is untrusted: the operation must be known, its arguments
 * are checked against the tool's schema again, writes need the session's
 * "Allow agent writes" toggle, and agent text is only ever stored as data.
 * Nothing here interprets agent text, follows a URL or runs code.
 *
 * Answers are `{ ok: true, result }` or `{ ok: false, refusal }`.
 */

import { validateValue } from '../tools/schema.js';
import { createWatchDefinition } from '../watchlists/model.js';
import { agentAuthorLabel, sanitizeClientName } from './author.js';
import {
  applyAddNote,
  applyAddPlace,
  applyDrawArea,
  applyMission,
  writeContext,
  writeProject,
} from './fieldbookWrites.js';
import { planMission } from './missionTemplates.js';
import {
  FieldKitRefusalError,
  createRefusal,
  writesDisabledRefusal,
} from './refusals.js';
import { OPERATION_SCHEMAS, WRITE_OPERATIONS } from './schemas.js';

const DEFAULT_WATCH_INTERVAL_MINUTES = 30;

/** Whether an operation needs the write toggle. A mission dry run does not. */
export function needsWrites(op, args) {
  if (!WRITE_OPERATIONS.includes(op)) return false;
  return !(op === 'run_mission_template' && args?.dry_run === true);
}

function refuse(code, message, details) {
  throw new FieldKitRefusalError(code, message, details);
}

/**
 * @param {{
 *   fieldbook: { get: Function, save: Function },
 *   watchlists?: { save: Function },
 *   capture?: (options: { maxWidth?: number }) => Promise<object|null>,
 *   has?: (tool: string) => boolean,
 *   now?: () => number,
 *   uuid?: () => string,
 *   onWrite?: (event: object) => void,
 * }} deps
 */
export function createFieldKitExecutor({
  fieldbook,
  watchlists = null,
  capture = null,
  has = () => true,
  now = Date.now,
  uuid = () => globalThis.crypto.randomUUID(),
  onWrite = () => {},
}) {
  const operations = {
    fieldbook_add_place: (args, ctx) =>
      writeProject(fieldbook, args, ctx, {
        allowCreate: true,
        title: args.project_title ?? `${args.name} (agent project)`,
        apply: (project) => {
          const {
            project: next,
            place,
            evidenceIds,
          } = applyAddPlace(project, args, ctx);
          return {
            project: next,
            place_id: place.id,
            evidence_ids: evidenceIds,
            author: agentAuthorLabel(place),
          };
        },
      }),
    fieldbook_add_note: (args, ctx) =>
      writeProject(fieldbook, args, ctx, {
        apply: (project) => {
          const {
            project: next,
            note,
            evidenceIds,
          } = applyAddNote(project, args, ctx);
          return {
            project: next,
            note_id: note.id,
            subject_id: note.subjectId,
            evidence_ids: evidenceIds,
            stored_text: note.text,
            author: agentAuthorLabel(note),
          };
        },
      }),
    draw_area: (args, ctx) =>
      writeProject(fieldbook, args, ctx, {
        apply: (project) => {
          const { project: next, drawing } = applyDrawArea(project, args, ctx);
          return {
            project: next,
            drawing_id: drawing.id,
            geometry: drawing.geometry,
            author: agentAuthorLabel(drawing),
          };
        },
      }),
    run_mission_template: (args, ctx) => {
      const plan = planMission(args.template, args.inputs, { has });
      if (args.dry_run) return { plan, written: false };
      return writeProject(fieldbook, args, ctx, {
        allowCreate: true,
        title: args.project_title ?? plan.title,
        apply: (project) => {
          const {
            project: next,
            places,
            note,
          } = applyMission(project, plan, ctx);
          return {
            project: next,
            plan,
            written: true,
            place_ids: places.map((place) => place.id),
            note_id: note.id,
            author: agentAuthorLabel(note),
          };
        },
      });
    },
    register_watch: (args, ctx) => registerWatch(args, ctx),
    render_view: async (args) => {
      const frame = capture
        ? await capture({ maxWidth: args.max_width })
        : null;
      if (!frame)
        refuse(
          'unsupported',
          'The globe could not be captured: the AUREL tab is hidden or has not drawn a frame.',
        );
      return frame;
    },
  };

  async function registerWatch(args, ctx) {
    if (args.kind !== 'fires')
      refuse(
        'unsupported',
        `AUREL watches NASA FIRMS fire detections only; a ${args.kind} watch does not exist.`,
        { supported_kinds: ['fires'] },
      );
    if (!watchlists)
      refuse('unsupported', 'Watchlists are not available in this app.');
    let project;
    try {
      project = await fieldbook.get(args.project_id);
    } catch {
      refuse(
        'storage_unavailable',
        'Local project storage is unavailable; nothing was written.',
      );
    }
    const place = project?.places.find((entry) => entry.id === args.place_id);
    if (!place)
      refuse('not_found', 'The place is not saved in that project.', {
        project_id: args.project_id,
        place_id: args.place_id,
      });
    let definition;
    try {
      definition = createWatchDefinition(
        {
          place,
          title: args.title ?? `${place.name} fires`,
          intervalMinutes:
            args.interval_minutes ?? DEFAULT_WATCH_INTERVAL_MINUTES,
        },
        { id: ctx.newId(), now: Date.parse(ctx.now) },
      );
    } catch {
      refuse(
        'invalid_geometry',
        'The place is outside the bounded area a watch can cover.',
      );
    }
    try {
      await watchlists.save(definition, { expectedRevision: null });
    } catch (error) {
      if (error?.code === 'LIMIT')
        refuse(
          'limit_reached',
          'At most eight local watchlists are supported.',
        );
      refuse(
        'storage_unavailable',
        'Local watchlist storage is unavailable; nothing was written.',
      );
    }
    return {
      watch_id: definition.id,
      kind: 'fires',
      monitoring: 'stopped',
      interval_minutes: definition.intervalMs / 60000,
      bounds: definition.bounds,
      author: agentAuthorLabel({
        id: definition.id,
        createdAt: definition.createdAt,
      }),
      note: 'Monitoring starts only when the owner presses Start in Watchlists.',
    };
  }

  return Object.freeze({
    /**
     * @param {{ op: unknown, args: unknown, client: unknown }} request
     * @param {{ writesAllowed: boolean }} session
     */
    async execute(request, { writesAllowed }) {
      const op = request?.op;
      const args = request?.args ?? {};
      try {
        if (typeof op !== 'string' || !Object.hasOwn(operations, op))
          refuse('unsupported', 'Unknown Field Kit operation.');
        const problems = validateValue(OPERATION_SCHEMAS[op], args);
        if (problems.length)
          refuse('invalid_request', problems.slice(0, 5).join('; '));
        if (needsWrites(op, args) && writesAllowed !== true)
          return { ok: false, refusal: writesDisabledRefusal() };
        const client = sanitizeClientName(request?.client);
        const ctx = writeContext({ client, now, uuid });
        const result = await operations[op](args, ctx);
        if (needsWrites(op, args)) onWrite({ op, client, result });
        return { ok: true, result };
      } catch (error) {
        if (error instanceof FieldKitRefusalError)
          return { ok: false, refusal: error.refusal };
        return {
          ok: false,
          refusal: createRefusal(
            'storage_unavailable',
            'The app could not complete the request; nothing was written.',
          ),
        };
      }
    },
  });
}
