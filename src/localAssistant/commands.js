import { GEV_ACTION_SCHEMAS } from '../voice/actionSchemas.js';
import { validateValue } from '../tools/schema.js';
export const LOCAL_LAYER_IDS = Object.freeze([
  'earthquakes',
  'satellites',
  'local-firms',
  'weather-radar',
]);
export const LOCAL_PANEL_IDS = Object.freeze([
  'lens-panel',
  'chronicle-panel',
  'planner-panel',
  'fieldbook-panel',
  'research-panel',
  'data-panel',
]);
const EMPTY = { type: 'object', properties: {}, additionalProperties: false };
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const SCHEMAS = {
  fly_to_location: GEV_ACTION_SCHEMAS.find((x) => x.name === 'fly_to_location')
    .parameters,
  set_layer_visibility: GEV_ACTION_SCHEMAS.find(
    (x) => x.name === 'set_layer_visibility',
  ).parameters,
  search_places: object({
    query: { type: 'string', minLength: 1, maxLength: 160 },
  }),
  open_panel: object({
    panelId: { type: 'string', enum: [...LOCAL_PANEL_IDS] },
  }),
  save_project: EMPTY,
  save_place: EMPTY,
  save_route: EMPTY,
  compare_selected: EMPTY,
  brief_selected: EMPTY,
};
export const LOCAL_COMMAND_TYPES = Object.freeze(Object.keys(SCHEMAS));
const PANELS = {
  explore: 'lens-panel',
  lens: 'lens-panel',
  compare: 'chronicle-panel',
  chronicle: 'chronicle-panel',
  plan: 'planner-panel',
  planner: 'planner-panel',
  library: 'fieldbook-panel',
  fieldbook: 'fieldbook-panel',
  research: 'research-panel',
  layers: 'data-panel',
};
const LAYERS = {
  earthquakes: 'earthquakes',
  satellites: 'satellites',
  fires: 'local-firms',
  fire: 'local-firms',
  'active fires': 'local-firms',
  'weather radar': 'weather-radar',
  radar: 'weather-radar',
};
const BLOCKED =
  /[\u0000-\u001f\u007f<>`$;|{}\\]|\p{Cf}|https?:|file:|javascript:|\b(?:openai|anthropic|gemini|photoreal|billing|curl|powershell|eval|exec)\b|\b(?:api\s+keys?|google\s+maps|ignore\s+(?:previous|all)|system\s+prompt|developer\s+instructions?|run\s+(?:shell|bash)|reveal\s+(?:keys?|tokens?))\b/iu;
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
function immutable(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
function safeQuery(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 160 &&
    !BLOCKED.test(value)
  );
}
function prerequisite(type, context) {
  const requirements = {
    save_project: ['hasProject', 'no-active-project'],
    save_place: ['hasSelection', 'no-selected-place'],
    save_route: ['hasRoute', 'no-current-route'],
    compare_selected: ['canCompare', 'choose-available-dates'],
  };
  const requirement = requirements[type];
  if (requirement && context[requirement[0]] !== true) fail(requirement[1]);
  if (
    type === 'brief_selected' &&
    !['ready', 'stale'].includes(context.evidenceState)
  )
    fail('missing-evidence');
}
/** Revalidate every proposal immediately before an existing owner handles it. No execution here. */
export function validateLocalCommand(value, context = {}) {
  if (context.origin && !['user', 'model'].includes(context.origin))
    fail('untrusted-origin');
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'type') ||
    !Object.hasOwn(value, 'args') ||
    !Object.hasOwn(SCHEMAS, value.type)
  )
    fail('unsupported-command');
  if (validateValue(SCHEMAS[value.type], value.args).length)
    fail('invalid-command');
  if (value.type === 'fly_to_location') {
    const keys = Object.keys(value.args);
    if (
      keys.some(
        (key) => !['latitude', 'longitude', 'viewMode'].includes(key),
      ) ||
      !Number.isFinite(value.args.latitude) ||
      !Number.isFinite(value.args.longitude)
    )
      fail('invalid-coordinates');
  }
  if (
    value.type === 'set_layer_visibility' &&
    !LOCAL_LAYER_IDS.includes(value.args.layerId)
  )
    fail('prohibited-provider');
  if (value.type === 'search_places' && !safeQuery(value.args.query))
    fail('blocked-input');
  prerequisite(value.type, context);
  return immutable({ type: value.type, args: { ...value.args } });
}
function result(status, command = null, reason = null, notice = null) {
  return immutable({ status, command, reason, notice });
}
function admit(command, context) {
  try {
    const value = validateLocalCommand(command, context);
    const notice =
      value.type === 'search_places'
        ? 'choose-search-result'
        : value.type === 'brief_selected' && context.evidenceState === 'stale'
          ? 'stale-evidence'
          : null;
    return result('ready', value, null, notice);
  } catch (error) {
    return result('needs-input', null, error.code || 'invalid-command');
  }
}
function selectedPair(context, first, second) {
  return (
    context.canCompare === true &&
    Array.isArray(context.selectedDates) &&
    context.selectedDates.length === 2 &&
    context.selectedDates[0] === first &&
    context.selectedDates[1] === second
  );
}
/** English command grammar; Unicode place names are preserved as data, never geocoded here. */
export function parseLocalCommand(value, context = {}) {
  if (context.origin && context.origin !== 'user')
    return result('blocked', null, 'untrusted-origin');
  if (typeof value !== 'string' || value.length > 256 || BLOCKED.test(value))
    return result('blocked', null, 'blocked-input');
  const text = value.normalize('NFC').trim();
  if (!text) return result('needs-input', null, 'empty-command');
  const lower = text.toLowerCase();
  const numeric =
    /^(?:(?:go to|fly to|focus|navigate to)\s+)?(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/i.exec(
      text,
    );
  if (numeric)
    return admit(
      {
        type: 'fly_to_location',
        args: {
          latitude: Number(numeric[1]),
          longitude: Number(numeric[2]),
          viewMode: 'overview',
        },
      },
      context,
    );
  const search = /^(?:search(?: for)?|find|go to|fly to)\s+(.+)$/i.exec(text);
  if (search) {
    if (
      /^(?:[-+\d.]|nan\b|infinity\b)/i.test(search[1]) &&
      search[1].includes(',')
    )
      return result('needs-input', null, 'invalid-coordinates');
    return admit(
      { type: 'search_places', args: { query: search[1].trim() } },
      context,
    );
  }
  const panel = /^open (.+)$/i.exec(text);
  if (panel && Object.hasOwn(PANELS, panel[1].toLowerCase()))
    return admit(
      { type: 'open_panel', args: { panelId: PANELS[panel[1].toLowerCase()] } },
      context,
    );
  const layer = /^(show|hide|enable|disable) (.+)$/i.exec(text);
  if (layer && Object.hasOwn(LAYERS, layer[2].toLowerCase()))
    return admit(
      {
        type: 'set_layer_visibility',
        args: {
          layerId: LAYERS[layer[2].toLowerCase()],
          enabled: ['show', 'enable'].includes(layer[1].toLowerCase()),
        },
      },
      context,
    );
  const save = /^save (?:current |this )?(project|place|route)$/i.exec(text);
  if (save)
    return admit({ type: 'save_' + save[1].toLowerCase(), args: {} }, context);
  if (lower === 'compare selected dates')
    return admit({ type: 'compare_selected', args: {} }, context);
  const dates =
    /^compare (\d{4}-\d\d-\d\d) (?:and|with) (\d{4}-\d\d-\d\d)$/i.exec(text);
  if (dates)
    return selectedPair(context, dates[1], dates[2])
      ? admit({ type: 'compare_selected', args: {} }, context)
      : result('needs-input', null, 'choose-available-dates');
  if (
    [
      'brief selected evidence',
      'summarize selected evidence',
      'summarise selected evidence',
    ].includes(lower)
  )
    return admit({ type: 'brief_selected', args: {} }, context);
  return result('unsupported', null, 'unsupported-command');
}
