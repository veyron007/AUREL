/**
 * Input schemas for the Field Kit tools, shared by the MCP tool definitions
 * (src/fieldkit/tools.js) and the in-app executor, which validates again
 * because everything crossing the local relay is untrusted.
 *
 * Every object is closed (`additionalProperties: false`), so an unknown
 * field is refused rather than ignored.
 */

import { ENVELOPE_CLASSES } from './envelope.js';

const ISO_TIME =
  '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d(?::\\d\\d(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d\\d:\\d\\d)$';
const ID = '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$';
const LAT = { type: 'number', minimum: -90, maximum: 90 };
const LON = { type: 'number', minimum: -180, maximum: 180 };

const PROJECT_ID = {
  type: 'string',
  pattern: ID,
  description: 'A Fieldbook project ID returned by an earlier Field Kit write.',
};
const EXPECTED_REVISION = {
  type: 'integer',
  minimum: 1,
  description:
    'The project revision your last write returned. A write fails with revision_conflict when the project changed since.',
};

/** A citation of an earlier tool result, normally copied from its envelope. */
export const EVIDENCE_REF_SCHEMA = Object.freeze({
  type: 'object',
  description:
    'A citation of an earlier tool result, copied from its provenance envelope.',
  properties: {
    tool: { type: 'string', minLength: 1, maxLength: 64 },
    class: { type: 'string', enum: [...ENVELOPE_CLASSES] },
    source_label: { type: 'string', minLength: 1, maxLength: 256 },
    source_id: { type: 'string', minLength: 1, maxLength: 128 },
    licence: { type: 'string', minLength: 1, maxLength: 256 },
    applicable_time: { type: 'string', pattern: ISO_TIME },
    retrieved_at: { type: 'string', pattern: ISO_TIME },
    url: {
      type: 'string',
      minLength: 9,
      maxLength: 2048,
      pattern: '^https://',
    },
    summary: { type: 'string', minLength: 1, maxLength: 500 },
  },
  required: ['tool', 'class', 'source_label'],
  additionalProperties: false,
});
const EVIDENCE = {
  type: 'array',
  maxItems: 8,
  items: EVIDENCE_REF_SCHEMA,
  description: 'Up to eight citations; each becomes a Fieldbook evidence row.',
};

export const ADD_PLACE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    project_id: PROJECT_ID,
    expected_revision: EXPECTED_REVISION,
    project_title: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description:
        'Title for a new project, used only when project_id is omitted.',
    },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    lat: LAT,
    lon: LON,
    aliases: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
    evidence: EVIDENCE,
  },
  required: ['name', 'lat', 'lon'],
  additionalProperties: false,
});

export const ADD_NOTE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    project_id: PROJECT_ID,
    expected_revision: EXPECTED_REVISION,
    subject_id: {
      type: 'string',
      pattern: ID,
      description:
        'The saved place, route or drawing the note is about; the project itself when omitted.',
    },
    text: {
      type: 'string',
      minLength: 1,
      maxLength: 8000,
      description: 'Plain text. It is stored as written and never executed.',
    },
    evidence: EVIDENCE,
  },
  required: ['project_id', 'expected_revision', 'text'],
  additionalProperties: false,
});

const POSITION = {
  type: 'array',
  minItems: 2,
  maxItems: 2,
  items: { type: 'number', minimum: -180, maximum: 180 },
};

export const DRAW_AREA_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    project_id: PROJECT_ID,
    expected_revision: EXPECTED_REVISION,
    name: { type: 'string', minLength: 1, maxLength: 200 },
    polygon: {
      type: 'array',
      minItems: 3,
      maxItems: 256,
      items: POSITION,
      description:
        'Outer ring as [lon, lat] pairs; it is closed for you. Give polygon or bbox, not both.',
    },
    bbox: {
      type: 'object',
      properties: { west: LON, south: LAT, east: LON, north: LAT },
      required: ['west', 'south', 'east', 'north'],
      additionalProperties: false,
    },
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
  },
  required: ['project_id', 'expected_revision', 'name'],
  additionalProperties: false,
});

/** Watch kinds an agent may name; only `fires` exists in AUREL today. */
export const WATCH_KINDS = Object.freeze([
  'fires',
  'cloud_cover',
  'rainfall',
  'air_quality',
]);

export const REGISTER_WATCH_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    project_id: PROJECT_ID,
    place_id: { type: 'string', pattern: ID },
    kind: {
      type: 'string',
      enum: [...WATCH_KINDS],
      description:
        'What to watch. AUREL watches NASA FIRMS fire detections only; other kinds are refused.',
    },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    interval_minutes: { type: 'integer', minimum: 30, maximum: 1440 },
  },
  required: ['project_id', 'place_id', 'kind'],
  additionalProperties: false,
});

export const MISSION_TEMPLATE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    template: {
      type: 'string',
      enum: [
        'sunrise_shoot',
        'explore_neighborhood',
        'plan_half_day_outing',
        'watch_my_region',
      ],
    },
    inputs: {
      type: 'object',
      properties: {
        place_name: { type: 'string', minLength: 1, maxLength: 200 },
        lat: LAT,
        lon: LON,
        date: { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\d$' },
        time_zone: {
          type: 'string',
          pattern: '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+){0,2}$',
          maxLength: 64,
        },
        radius_km: { type: 'number', minimum: 0.1, maximum: 25 },
        destination_name: { type: 'string', minLength: 1, maxLength: 200 },
        destination_lat: LAT,
        destination_lon: LON,
        mode: { type: 'string', enum: ['walk', 'cycle', 'drive'] },
      },
      required: ['place_name', 'lat', 'lon'],
      additionalProperties: false,
    },
    project_id: PROJECT_ID,
    expected_revision: EXPECTED_REVISION,
    project_title: { type: 'string', minLength: 1, maxLength: 200 },
    dry_run: {
      type: 'boolean',
      description:
        'Return the procedure without writing anything. Works with agent writes off.',
    },
  },
  required: ['template', 'inputs'],
  additionalProperties: false,
});

export const RENDER_VIEW_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    max_width: { type: 'integer', minimum: 320, maximum: 1600 },
  },
  additionalProperties: false,
});

export const FREE_BUDGET_SCHEMA = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

/** The schema the in-app executor checks for each relayed operation. */
export const OPERATION_SCHEMAS = Object.freeze({
  fieldbook_add_place: ADD_PLACE_SCHEMA,
  fieldbook_add_note: ADD_NOTE_SCHEMA,
  draw_area: DRAW_AREA_SCHEMA,
  register_watch: REGISTER_WATCH_SCHEMA,
  run_mission_template: MISSION_TEMPLATE_SCHEMA,
  render_view: RENDER_VIEW_SCHEMA,
});

/** Operations that change saved data and need "Allow agent writes". */
export const WRITE_OPERATIONS = Object.freeze([
  'fieldbook_add_place',
  'fieldbook_add_note',
  'draw_area',
  'register_watch',
  'run_mission_template',
]);
