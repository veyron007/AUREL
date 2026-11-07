/**
 * F08 mission templates for agents: transparent, deterministic procedures
 * built on existing tools. A template never calls a provider and never runs
 * code; it returns the steps an agent should take (each a named tool with its
 * arguments) and, unless it is a dry run, the Fieldbook skeleton to save: the
 * places and one checklist note. Steps whose tool this server does not offer
 * are marked so, not replaced with invented evidence.
 */

import { FieldKitRefusalError } from './refusals.js';

const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
/** Template modes as plan_route names them. */
const ROUTE_MODES = Object.freeze({
  walk: 'walk',
  cycle: 'bike',
  drive: 'drive',
});

const at = (lat, lon) => ({ lat, lon });

const TEMPLATES = Object.freeze({
  sunrise_shoot: {
    title: 'Sunrise shoot',
    purpose:
      'Prepare a photography visit: budget, horizon, weather, viewpoint and a watch.',
    needs: ['date'],
    steps: (inputs) => [
      ['get_free_budget', {}, 'Check estimated remaining free units first.'],
      [
        'horizon_at',
        { lat: inputs.lat, lon: inputs.lon, date: inputs.date },
        'Terrain horizon and true sunrise for the viewpoint.',
      ],
      [
        'get_weather',
        { location: at(inputs.lat, inputs.lon) },
        'Modelled cloud cover and visibility near the viewpoint.',
      ],
      [
        'draw_area',
        { name: `${inputs.place_name} viewpoint` },
        'Mark the viewpoint area in the project.',
        true,
      ],
      [
        'register_watch',
        { kind: 'fires' },
        'Optional: watch the area for fire detections (smoke can spoil a shoot).',
        true,
      ],
      ['render_view', {}, 'A picture of the globe with its layer legend.'],
    ],
  },
  explore_neighborhood: {
    title: 'Explore a neighbourhood',
    purpose: 'Inspect mapped features, coverage and conditions around a place.',
    needs: [],
    steps: (inputs) => [
      [
        'places_nearby',
        {
          location: at(inputs.lat, inputs.lon),
          radius_m: Math.round((inputs.radius_km ?? 2) * 1000),
        },
        'Notable places nearby (needs a place-search provider).',
      ],
      [
        'get_map_features',
        { location: at(inputs.lat, inputs.lon), kind: 'named_places' },
        'Named OpenStreetMap areas around the place.',
      ],
      [
        'get_weather',
        { location: at(inputs.lat, inputs.lon) },
        'Current modelled weather.',
      ],
      [
        'fieldbook_add_note',
        {},
        'Record findings with evidence citations.',
        true,
      ],
    ],
  },
  plan_half_day_outing: {
    title: 'Plan a half-day outing',
    purpose: 'Route, terrain, daylight and a bounded forecast.',
    needs: ['destination_name', 'destination_lat', 'destination_lon'],
    steps: (inputs) => [
      ['get_free_budget', {}, 'Check estimated remaining free units first.'],
      [
        'plan_route',
        {
          from: at(inputs.lat, inputs.lon),
          to: at(inputs.destination_lat, inputs.destination_lon),
          mode: ROUTE_MODES[inputs.mode ?? 'walk'],
        },
        'Route distance and duration (derived).',
      ],
      [
        'get_terrain_height',
        { points: [at(inputs.destination_lat, inputs.destination_lon)] },
        'Destination height (modelled terrain).',
      ],
      [
        'get_weather',
        { location: at(inputs.destination_lat, inputs.destination_lon) },
        'Modelled weather at the destination.',
      ],
    ],
  },
  watch_my_region: {
    title: 'Watch my region',
    purpose: 'Save the place and register a bounded fire-detection watch.',
    needs: [],
    steps: () => [
      [
        'register_watch',
        { kind: 'fires', interval_minutes: 30 },
        'Fire detections, checked only while the owner starts monitoring.',
        true,
      ],
    ],
  },
});

export const MISSION_TEMPLATE_IDS = Object.freeze(Object.keys(TEMPLATES));

/**
 * The deterministic procedure for a template.
 * @param {string} templateId
 * @param {object} inputs Validated against MISSION_TEMPLATE_SCHEMA.inputs.
 * @param {{ has?: (name: string) => boolean }} [options]
 */
export function planMission(templateId, inputs, { has = () => true } = {}) {
  const template = Object.hasOwn(TEMPLATES, templateId)
    ? TEMPLATES[templateId]
    : null;
  if (!template)
    throw new FieldKitRefusalError(
      'not_found',
      `No mission template named ${templateId}.`,
      { templates: MISSION_TEMPLATE_IDS },
    );
  const missing = template.needs.filter((key) => inputs[key] === undefined);
  if (missing.length)
    throw new FieldKitRefusalError(
      'invalid_request',
      `The ${templateId} template needs ${missing.join(', ')}.`,
      { missing },
    );
  const timeZone = inputs.time_zone ?? DEFAULT_TIME_ZONE;
  const steps = template
    .steps(inputs)
    .map(([tool, args, purpose, writes], index) => ({
      order: index + 1,
      tool,
      args,
      purpose,
      writes: writes === true,
      available: has(tool),
    }));
  const places = [
    { name: inputs.place_name, lat: inputs.lat, lon: inputs.lon },
    ...(inputs.destination_name
      ? [
          {
            name: inputs.destination_name,
            lat: inputs.destination_lat,
            lon: inputs.destination_lon,
          },
        ]
      : []),
  ];
  const when = inputs.date ? ` on ${inputs.date} (${timeZone})` : '';
  const checklist = [
    `Mission: ${template.title} at ${inputs.place_name}${when}.`,
    template.purpose,
    ...steps.map(
      (step) =>
        `${step.order}. ${step.tool} — ${step.purpose}${step.available ? '' : ' (not offered by this server yet)'}`,
    ),
    'This checklist is a procedure, not evidence. Results are added as cited notes.',
  ].join('\n');
  return Object.freeze({
    template: templateId,
    title: `${template.title}: ${inputs.place_name}`,
    purpose: template.purpose,
    time_zone: timeZone,
    steps,
    skeleton: { places, note: checklist },
  });
}
