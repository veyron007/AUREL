import assert from 'node:assert/strict';
import test from 'node:test';
import { coreTools, toolsForSurface } from '../tools/index.js';
import { validateValue } from '../tools/schema.js';
import { MISSION_TEMPLATE_IDS, planMission } from './missionTemplates.js';
import { fieldKitTools } from './tools.js';

const INPUTS = {
  place_name: 'Lal Tibba',
  lat: 30.4594,
  lon: 78.0957,
  date: '2026-11-08',
  destination_name: 'George Everest',
  destination_lat: 30.4381,
  destination_lon: 78.0436,
  mode: 'walk',
};

test('templates are deterministic', () => {
  for (const id of MISSION_TEMPLATE_IDS)
    assert.deepEqual(planMission(id, INPUTS), planMission(id, INPUTS));
});

test('every step names a real tool with arguments that tool accepts', () => {
  const tools = new Map(
    [...toolsForSurface(coreTools, 'mcp'), ...coreTools, ...fieldKitTools].map(
      (tool) => [tool.name, tool],
    ),
  );
  for (const id of MISSION_TEMPLATE_IDS) {
    for (const step of planMission(id, INPUTS).steps) {
      if (step.tool === 'horizon_at') continue;
      const tool = tools.get(step.tool);
      assert.ok(tool, `${id}: ${step.tool}`);
      if (step.writes) continue; // Write steps need IDs from earlier writes.
      assert.deepEqual(
        validateValue(tool.inputSchema, step.args),
        [],
        `${id}: ${step.tool}`,
      );
    }
  }
});

test('steps whose tool is not offered are marked, not dropped', () => {
  const plan = planMission('sunrise_shoot', INPUTS, {
    has: (name) => name !== 'horizon_at',
  });
  const horizon = plan.steps.find((step) => step.tool === 'horizon_at');
  assert.equal(horizon.available, false);
  assert.match(plan.skeleton.note, /not offered by this server yet/);
});

test('unknown templates and missing inputs are refused', () => {
  assert.throws(
    () => planMission('rob_a_bank', INPUTS),
    (error) => error.refusal.code === 'not_found',
  );
  assert.throws(
    () => planMission('sunrise_shoot', { place_name: 'x', lat: 1, lon: 1 }),
    (error) =>
      error.refusal.code === 'invalid_request' &&
      error.refusal.details.missing[0] === 'date',
  );
});
