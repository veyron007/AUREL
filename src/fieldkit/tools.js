/**
 * Field Kit tools (AUREL Phase 6, WP6): MCP tools that act like an analyst.
 *
 * Writes reach the owner's open AUREL tab through the local agent-desk relay
 * (`services.agentDesk`, see server/agentDesk/relay.js). The tab decides: with
 * "Allow agent writes" off every write answers a typed refusal; with it on,
 * writes are revision-checked and author-tagged. Every answer carries a
 * provenance envelope beside its data.
 *
 * `horizon_at` is WP1's tool. This module leaves a named slot for it
 * (FIELD_KIT_SLOTS) and accepts its definition in `createFieldKitTools`; it
 * does not implement it.
 */

import { defineTool, ToolError } from '../tools/catalog.js';
import { budgetSummary } from './budget.js';
import { createEnvelope } from './envelope.js';
import { LEGEND_FOOTNOTE, legendLines } from './legend.js';
import { planMission } from './missionTemplates.js';
import { isRefusal } from './refusals.js';
import {
  ADD_NOTE_SCHEMA,
  ADD_PLACE_SCHEMA,
  DRAW_AREA_SCHEMA,
  FREE_BUDGET_SCHEMA,
  MISSION_TEMPLATE_SCHEMA,
  REGISTER_WATCH_SCHEMA,
  RENDER_VIEW_SCHEMA,
} from './schemas.js';

const FIELDBOOK_SOURCE = Object.freeze({
  id: 'aurel-fieldbook',
  label: "AUREL Fieldbook on the owner's device",
  licence: "Owner's local data; agent text is untrusted",
  url: null,
});
const LEDGER_SOURCE = Object.freeze({
  id: 'free-only-ledgers',
  label: 'AUREL Free-only request ledgers (.gev-cache)',
  licence: "Owner's local data",
  url: null,
});
const GLOBE_SOURCE = Object.freeze({
  id: 'aurel-globe',
  label: "AUREL globe as drawn in the owner's tab",
  licence: 'Per visible layer; see the legend and DATA_SOURCES.md',
  url: null,
});

const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
});
const LOCAL_READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  openWorldHint: false,
});

/**
 * Slots for tools other work packages deliver. A slot is documentation and
 * a registration point, never an implementation.
 */
export const FIELD_KIT_SLOTS = Object.freeze([
  Object.freeze({
    name: 'horizon_at',
    owner: 'WP1 Kshitij Horizon Engine',
    status: 'pending',
    note: 'Pass its tool definition as createFieldKitTools({ horizonAt }) once WP1 merges.',
  }),
]);

const iso = (now) => new Date(now).toISOString();

function noteEnvelope(tool, at, note) {
  return createEnvelope({
    tool,
    cls: 'note',
    sources: [FIELDBOOK_SOURCE],
    applicableTime: { from: at, to: at },
    retrievedAt: at,
    note,
  });
}

/** Relay one operation to the app; a refusal becomes a typed tool error. */
async function relay(services, op, args, signal) {
  const answer = await services.agentDesk.request(op, args, { signal });
  if (answer?.ok === true && answer.result && typeof answer.result === 'object')
    return answer.result;
  const refusal = isRefusal(answer?.refusal)
    ? answer.refusal
    : {
        code: 'no_app_session',
        message: 'The AUREL app gave no usable answer.',
      };
  throw new ToolError(
    'refused',
    `Refused (${refusal.code}): ${refusal.message}`,
    {
      details: { refusal },
    },
  );
}

function writeTool({ name, title, description, inputSchema, summarize, note }) {
  return defineTool({
    name,
    kind: 'action',
    title,
    description,
    inputSchema,
    annotations: WRITE_ANNOTATIONS,
    requires: ['agentDesk'],
    async run(args, { services, signal }) {
      const result = await relay(services, name, args, signal);
      const at = iso(services.agentDesk.now?.() ?? Date.now());
      return {
        summary: summarize(result, args),
        data: result,
        envelope: noteEnvelope(name, at, note),
      };
    },
  });
}

const AGENT_TEXT_NOTE =
  'Written by an agent at the owner’s request; author-tagged, stored as untrusted text and never executed.';
const REVISION_HINT =
  ' Pass project_id and expected_revision from your last write; a stale revision is refused with revision_conflict.';

export const fieldbookAddPlace = writeTool({
  name: 'fieldbook_add_place',
  title: 'Add a place to the Fieldbook',
  description:
    "Save a named point to a Fieldbook project on the owner's device, optionally citing evidence (copied from earlier tools' provenance envelopes). Omit project_id to start a new project." +
    REVISION_HINT +
    ' Refused with writes_disabled unless the owner has turned on "Allow agent writes" for this session.',
  inputSchema: ADD_PLACE_SCHEMA,
  note: AGENT_TEXT_NOTE,
  summarize: (result, args) =>
    `Saved place ${args.name} to "${result.project_title}" (revision ${result.revision}), ${result.author}.`,
});

export const fieldbookAddNote = writeTool({
  name: 'fieldbook_add_note',
  title: 'Add a note to the Fieldbook',
  description:
    'Add a plain-text note about a project, place, route or drawing, citing evidence from earlier tool results. The text is stored verbatim as untrusted, author-tagged data and is never run as a command.' +
    REVISION_HINT,
  inputSchema: ADD_NOTE_SCHEMA,
  note: AGENT_TEXT_NOTE,
  summarize: (result) =>
    `Saved a note (${result.evidence_ids.length} citations) to "${result.project_title}" (revision ${result.revision}), ${result.author}.`,
});

export const drawArea = writeTool({
  name: 'draw_area',
  title: 'Draw an area in the Fieldbook',
  description:
    'Save a simple polygon (or bbox) of at most 2° on a side as a Fieldbook drawing, for a viewpoint or study area. Self-crossing or unbounded shapes are refused with invalid_geometry.' +
    REVISION_HINT,
  inputSchema: DRAW_AREA_SCHEMA,
  note: AGENT_TEXT_NOTE,
  summarize: (result, args) =>
    `Drew ${args.name} in "${result.project_title}" (revision ${result.revision}), ${result.author}.`,
});

export const registerWatch = writeTool({
  name: 'register_watch',
  title: 'Register a watch',
  description:
    'Register a local watch on a place saved in a Fieldbook project. AUREL watches NASA FIRMS fire detections only; other kinds are refused with unsupported. The watch is saved stopped: monitoring starts only when the owner presses Start.',
  inputSchema: REGISTER_WATCH_SCHEMA,
  note: AGENT_TEXT_NOTE,
  summarize: (result) =>
    `Registered a fire-detection watch (stopped until the owner starts it), ${result.author}.`,
});

export const runMissionTemplate = defineTool({
  name: 'run_mission_template',
  kind: 'action',
  title: 'Run a mission template',
  description:
    'A deterministic F08 procedure (sunrise_shoot, explore_neighborhood, plan_half_day_outing, watch_my_region): returns the steps to take, each a tool with its arguments, and saves the places and a checklist note to a Fieldbook project. With dry_run it only returns the steps and works with agent writes off. It never calls a provider itself.',
  inputSchema: MISSION_TEMPLATE_SCHEMA,
  annotations: WRITE_ANNOTATIONS,
  requires: ['agentDesk'],
  async run(args, { services, signal, tools }) {
    const at = iso(services.agentDesk.now?.() ?? Date.now());
    if (args.dry_run) {
      let plan;
      try {
        plan = planMission(args.template, args.inputs, { has: tools.has });
      } catch (error) {
        const refusal = error?.refusal;
        if (!refusal) throw error;
        throw new ToolError(
          'refused',
          `Refused (${refusal.code}): ${refusal.message}`,
          {
            details: { refusal },
          },
        );
      }
      return {
        summary: `${plan.title}: ${plan.steps.length} steps (dry run, nothing written).`,
        data: { plan, written: false },
        envelope: noteEnvelope(
          'run_mission_template',
          at,
          'A procedure, not evidence.',
        ),
      };
    }
    const result = await relay(services, 'run_mission_template', args, signal);
    return {
      summary: `${result.plan.title}: saved ${result.place_ids.length} places and a checklist to "${result.project_title}" (revision ${result.revision}), ${result.author}.`,
      data: result,
      envelope: noteEnvelope('run_mission_template', at, AGENT_TEXT_NOTE),
    };
  },
});

export const renderView = defineTool({
  name: 'render_view',
  title: 'Picture of the globe with its legend',
  description:
    "A PNG of the globe as drawn in the owner's open AUREL tab, with a legend listing each visible layer's class (observed, modelled, derived, simulated, note) and last refresh time. The frame may contain simulated traffic; read the legend before describing it.",
  inputSchema: RENDER_VIEW_SCHEMA,
  annotations: LOCAL_READ_ANNOTATIONS,
  requires: ['agentDesk'],
  async run(args, { services, signal }) {
    const frame = await relay(services, 'render_view', args, signal);
    if (typeof frame.image !== 'string' || !Array.isArray(frame.legend))
      throw new ToolError(
        'malformed',
        'The app returned an incomplete picture.',
      );
    const lines = legendLines(frame.legend);
    return {
      summary: `Globe picture ${frame.width}×${frame.height} with ${frame.legend.length} legend rows:\n${lines.join('\n')}\n${LEGEND_FOOTNOTE}`,
      data: {
        captured_at: frame.captured_at,
        width: frame.width,
        height: frame.height,
        legend: frame.legend,
        footnote: LEGEND_FOOTNOTE,
      },
      images: [{ mimeType: 'image/png', data: frame.image }],
      envelope: createEnvelope({
        tool: 'render_view',
        cls: 'derived',
        sources: [GLOBE_SOURCE],
        applicableTime: { from: frame.captured_at, to: frame.captured_at },
        retrievedAt: frame.captured_at,
        note: 'A rendering of several layers; each layer’s own class and refresh time is in the legend.',
      }),
    };
  },
});

export const getFreeBudget = defineTool({
  name: 'get_free_budget',
  title: 'Estimated remaining free units',
  description:
    'Estimated remaining units per Free-only provider ledger (Planner forecasts, Chronicle imagery, Research NDVI) and the providers Free-only pauses, so you can predict a refusal before asking. Always an estimate, never a guarantee of free dispatch.',
  inputSchema: FREE_BUDGET_SCHEMA,
  annotations: LOCAL_READ_ANNOTATIONS,
  requires: ['freeBudget'],
  async run(_args, { services }) {
    const answer = await services.freeBudget.read();
    return {
      summary: budgetSummary(answer),
      data: answer,
      envelope: createEnvelope({
        tool: 'get_free_budget',
        cls: 'derived',
        sources: [LEDGER_SOURCE],
        applicableTime: { from: answer.as_of, to: answer.as_of },
        retrievedAt: answer.as_of,
        note: 'Estimated remaining; not a guarantee of free dispatch.',
      }),
    };
  },
});

/** The Field Kit tools, in a stable order, plus any slotted tools supplied. */
export function createFieldKitTools({ horizonAt = null } = {}) {
  if (horizonAt !== null && horizonAt?.name !== 'horizon_at')
    throw new TypeError('The horizon_at slot takes the horizon_at tool');
  return Object.freeze([
    getFreeBudget,
    fieldbookAddPlace,
    fieldbookAddNote,
    drawArea,
    runMissionTemplate,
    registerWatch,
    renderView,
    ...(horizonAt ? [horizonAt] : []),
  ]);
}

export const fieldKitTools = createFieldKitTools();
