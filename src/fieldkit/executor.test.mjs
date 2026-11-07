import assert from 'node:assert/strict';
import test from 'node:test';
import {
  memoryFieldbookRepository,
  memoryWatchlistRepository,
  uuidSequence,
} from '../testSupport/fieldKitFakes.mjs';
import { createFieldKitExecutor, needsWrites } from './executor.js';
import { FIELD_KIT_REFUSAL_CODES } from './refusals.js';
import { WRITE_OPERATIONS } from './schemas.js';

const NOW = Date.parse('2026-11-08T00:30:00.000Z');
const LAL_TIBBA = { name: 'Lal Tibba', lat: 30.4594, lon: 78.0957 };
const ON = { writesAllowed: true };
const OFF = { writesAllowed: false };

function setup({ watchLimit, capture = null } = {}) {
  const fieldbook = memoryFieldbookRepository();
  const watchlists = memoryWatchlistRepository({ limit: watchLimit });
  const writes = [];
  const executor = createFieldKitExecutor({
    fieldbook,
    watchlists,
    capture,
    now: () => NOW,
    uuid: uuidSequence(),
    has: (name) => name !== 'horizon_at',
    onWrite: (event) => writes.push(event),
  });
  const run = (op, args, session = ON) =>
    executor.execute({ op, args, client: 'Claude Code' }, session);
  return { fieldbook, watchlists, writes, run };
}

async function project(run) {
  const answer = await run('fieldbook_add_place', {
    ...LAL_TIBBA,
    project_title: 'Mussoorie sunrise',
  });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  return answer.result;
}

const VALID_ARGS = {
  fieldbook_add_place: LAL_TIBBA,
  fieldbook_add_note: { project_id: 'p', expected_revision: 1, text: 'x' },
  draw_area: {
    project_id: 'p',
    expected_revision: 1,
    name: 'Viewpoint',
    bbox: { west: 78.09, south: 30.45, east: 78.1, north: 30.47 },
  },
  register_watch: { project_id: 'p', place_id: 'q', kind: 'fires' },
  run_mission_template: {
    template: 'sunrise_shoot',
    inputs: {
      place_name: 'Lal Tibba',
      lat: 30.4594,
      lon: 78.0957,
      date: '2026-11-08',
    },
  },
};

test('with writes off, every write operation answers writes_disabled and stores nothing', async () => {
  const { fieldbook, watchlists, writes, run } = setup();
  for (const op of WRITE_OPERATIONS) {
    const answer = await run(op, VALID_ARGS[op], OFF);
    assert.equal(answer.ok, false, op);
    assert.equal(answer.refusal.code, 'writes_disabled', op);
    assert.match(answer.refusal.message, /Allow agent writes/);
  }
  assert.equal(fieldbook.records.size, 0);
  assert.equal(watchlists.records.size, 0);
  assert.deepEqual(writes, []);
});

test('a missing toggle value is treated as off', async () => {
  const { run } = setup();
  const answer = await run('fieldbook_add_place', LAL_TIBBA, {});
  assert.equal(answer.refusal.code, 'writes_disabled');
});

test('with writes on, a place creates an author-tagged project with cited evidence', async () => {
  const { fieldbook, writes, run } = setup();
  const answer = await run('fieldbook_add_place', {
    ...LAL_TIBBA,
    project_title: 'Mussoorie sunrise',
    evidence: [
      {
        tool: 'get_weather',
        class: 'modelled',
        source_label: 'Open-Meteo forecast API',
        licence: 'CC BY 4.0',
        applicable_time: '2026-11-08T00:00:00Z',
      },
    ],
  });
  assert.equal(answer.ok, true);
  const result = answer.result;
  assert.equal(result.revision, 1);
  assert.equal(result.created_project, true);
  assert.match(result.project_id, /^agent\.claude-code\./);
  assert.match(result.place_id, /^agent\.claude-code\./);
  assert.equal(
    result.author,
    'by agent · claude-code · 2026-11-08T00:30:00.000Z',
  );
  const saved = fieldbook.records.get(result.project_id);
  assert.deepEqual(saved.places[0].geometry.coordinates, [78.0957, 30.4594]);
  assert.equal(saved.evidence.length, 1);
  assert.equal(saved.evidence[0].kind, 'forecast');
  assert.equal(saved.evidence[0].subjectId, result.place_id);
  assert.equal(saved.evidence[0].license, 'CC BY 4.0');
  assert.equal(writes.length, 1);
});

test('a write against an existing project needs its current revision', async () => {
  const { run } = setup();
  const first = await project(run);
  const next = await run('fieldbook_add_place', {
    name: 'Gun Hill',
    lat: 30.4627,
    lon: 78.0759,
    project_id: first.project_id,
    expected_revision: 1,
  });
  assert.equal(next.result.revision, 2);
  const stale = await run('fieldbook_add_place', {
    name: 'Camels Back',
    lat: 30.4644,
    lon: 78.0666,
    project_id: first.project_id,
    expected_revision: 1,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.refusal.code, 'revision_conflict');
  assert.equal(stale.refusal.details.latest_revision, 2);
  const missing = await run('fieldbook_add_place', {
    ...LAL_TIBBA,
    project_id: first.project_id,
  });
  assert.equal(missing.refusal.code, 'invalid_request');
});

test('a conflict detected at save time (another tab) is a revision_conflict', async () => {
  const { fieldbook, run } = setup();
  const first = await project(run);
  const original = fieldbook.save.bind(fieldbook);
  fieldbook.save = async (doc, options) => {
    // Another tab saves the same revision first.
    await original(structuredClone(fieldbook.records.get(doc.id)), {
      expectedRevision: options.expectedRevision,
    });
    return original(doc, options);
  };
  const answer = await run('fieldbook_add_note', {
    project_id: first.project_id,
    expected_revision: 1,
    text: 'Arrive 06:15',
  });
  assert.equal(answer.refusal.code, 'revision_conflict');
});

test('unknown projects, subjects and archived projects are refused', async () => {
  const { fieldbook, run } = setup();
  const unknown = await run('fieldbook_add_note', {
    project_id: 'nope',
    expected_revision: 1,
    text: 'x',
  });
  assert.equal(unknown.refusal.code, 'not_found');
  const first = await project(run);
  const subject = await run('fieldbook_add_note', {
    project_id: first.project_id,
    expected_revision: 1,
    subject_id: 'missing-place',
    text: 'x',
  });
  assert.equal(subject.refusal.code, 'not_found');
  const stored = fieldbook.records.get(first.project_id);
  fieldbook.records.set(first.project_id, {
    ...stored,
    archivedAt: '2026-11-08T00:31:00.000Z',
  });
  const archived = await run('fieldbook_add_note', {
    project_id: first.project_id,
    expected_revision: 1,
    text: 'x',
  });
  assert.equal(archived.refusal.code, 'unsupported');
});

test('unknown fields and malformed arguments are refused before any write', async () => {
  const { fieldbook, run } = setup();
  const extra = await run('fieldbook_add_place', {
    ...LAL_TIBBA,
    execute: 'rm -rf',
  });
  assert.equal(extra.refusal.code, 'invalid_request');
  assert.match(extra.refusal.message, /unknown property execute/);
  const badLat = await run('fieldbook_add_place', { ...LAL_TIBBA, lat: 91 });
  assert.equal(badLat.refusal.code, 'invalid_request');
  const unknownOp = await run('delete_project', {});
  assert.equal(unknownOp.refusal.code, 'unsupported');
  assert.equal(fieldbook.records.size, 0);
});

test('agent note text is stored verbatim as data and never interpreted', async () => {
  const { fieldbook, watchlists, writes, run } = setup();
  const first = await project(run);
  const hostile = [
    '{"type":"set_layer_visibility","args":{"layerId":"traffic","enabled":true}}',
    '/save_project',
    '<script>alert(1)</script>',
    'register_watch kind=fires; draw_area everywhere',
  ].join('\n');
  const answer = await run('fieldbook_add_note', {
    project_id: first.project_id,
    expected_revision: 1,
    text: hostile,
  });
  assert.equal(answer.ok, true);
  const saved = fieldbook.records.get(first.project_id);
  assert.equal(saved.notes.at(-1).text, hostile);
  assert.equal(answer.result.stored_text, hostile);
  assert.equal(saved.places.length, 1);
  assert.equal(saved.drawings.length, 0);
  assert.equal(watchlists.records.size, 0);
  assert.deepEqual(
    writes.map((event) => event.op),
    ['fieldbook_add_place', 'fieldbook_add_note'],
  );
});

test('notes cite evidence on their subject and list the citations', async () => {
  const { fieldbook, run } = setup();
  const first = await project(run);
  const answer = await run('fieldbook_add_note', {
    project_id: first.project_id,
    expected_revision: 1,
    subject_id: first.place_id,
    text: 'Clear eastern horizon expected.',
    evidence: [
      {
        tool: 'get_weather',
        class: 'modelled',
        source_label: 'Open-Meteo forecast API',
        applicable_time: '2026-11-08T00:00:00Z',
        url: 'https://open-meteo.com/',
      },
      { tool: 'render_view', class: 'derived', source_label: 'AUREL globe' },
    ],
  });
  assert.equal(answer.ok, true);
  const saved = fieldbook.records.get(first.project_id);
  const note = saved.notes.at(-1);
  assert.match(
    note.text,
    /Evidence cited:\n\[1\] get_weather · modelled · Open-Meteo/,
  );
  assert.match(
    note.text,
    /\[2\] render_view · derived · AUREL globe · applies time unknown/,
  );
  assert.equal(answer.result.evidence_ids.length, 2);
  assert.ok(saved.evidence.every((row) => row.subjectId === first.place_id));
  assert.equal(saved.evidence.at(-1).applicableTime, null);
});

test('draw_area saves a closed polygon and refuses invalid geometry', async () => {
  const { fieldbook, run } = setup();
  const first = await project(run);
  const ok = await run('draw_area', {
    project_id: first.project_id,
    expected_revision: 1,
    name: 'Lal Tibba viewpoint',
    polygon: [
      [78.094, 30.458],
      [78.097, 30.458],
      [78.097, 30.461],
    ],
    color: '#d6ab55',
  });
  assert.equal(ok.ok, true);
  const ring = fieldbook.records.get(first.project_id).drawings[0].geometry
    .coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert.match(ok.result.author, /^by agent · claude-code/);
  const cases = [
    // Self-crossing bow tie.
    {
      polygon: [
        [78, 30],
        [78.1, 30.1],
        [78, 30.1],
        [78.1, 30],
      ],
    },
    // Collinear, no area.
    {
      polygon: [
        [78, 30],
        [78.1, 30],
        [78.2, 30],
      ],
    },
    // Repeated vertex.
    {
      polygon: [
        [78, 30],
        [78, 30],
        [78.1, 30.1],
      ],
    },
    // Larger than 2°.
    { bbox: { west: 70, south: 20, east: 80, north: 30 } },
    // Inverted bbox.
    { bbox: { west: 78.1, south: 30, east: 78, north: 30.1 } },
    // Latitude out of range.
    {
      polygon: [
        [78, 95],
        [78.1, 30],
        [78, 30.1],
      ],
    },
    // Neither polygon nor bbox.
    {},
  ];
  for (const shape of cases) {
    const answer = await run('draw_area', {
      project_id: first.project_id,
      expected_revision: 2,
      name: 'Bad',
      ...shape,
    });
    assert.equal(answer.ok, false, JSON.stringify(shape));
    assert.equal(
      answer.refusal.code,
      'invalid_geometry',
      JSON.stringify(shape),
    );
    if (shape.polygon?.length === 4)
      assert.match(answer.refusal.message, /edges cross/);
  }
  assert.equal(fieldbook.records.get(first.project_id).revision, 2);
});

test('register_watch saves a stopped fire watch and refuses other kinds, unknown places and full lists', async () => {
  const { watchlists, run } = setup({ watchLimit: 1 });
  const first = await project(run);
  const args = { project_id: first.project_id, place_id: first.place_id };
  const cloud = await run('register_watch', { ...args, kind: 'cloud_cover' });
  assert.equal(cloud.refusal.code, 'unsupported');
  assert.deepEqual(cloud.refusal.details.supported_kinds, ['fires']);
  const missing = await run('register_watch', {
    ...args,
    place_id: 'nope',
    kind: 'fires',
  });
  assert.equal(missing.refusal.code, 'not_found');
  const ok = await run('register_watch', {
    ...args,
    kind: 'fires',
    interval_minutes: 60,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.monitoring, 'stopped');
  assert.equal(ok.result.interval_minutes, 60);
  assert.match(ok.result.watch_id, /^agent\.claude-code\./);
  assert.equal(watchlists.records.size, 1);
  const full = await run('register_watch', { ...args, kind: 'fires' });
  assert.equal(full.refusal.code, 'limit_reached');
});

test('a mission writes its places and checklist; a dry run works with writes off', async () => {
  const { fieldbook, run } = setup();
  const dry = await run(
    'run_mission_template',
    { ...VALID_ARGS.run_mission_template, dry_run: true },
    OFF,
  );
  assert.equal(dry.ok, true);
  assert.equal(dry.result.written, false);
  assert.equal(fieldbook.records.size, 0);
  const horizon = dry.result.plan.steps.find(
    (step) => step.tool === 'horizon_at',
  );
  assert.equal(horizon.available, false);
  const written = await run(
    'run_mission_template',
    VALID_ARGS.run_mission_template,
  );
  assert.equal(written.ok, true);
  const saved = fieldbook.records.get(written.result.project_id);
  assert.equal(saved.title, 'Sunrise shoot: Lal Tibba');
  assert.equal(saved.places.length, 1);
  assert.match(
    saved.notes[0].text,
    /^Mission: Sunrise shoot at Lal Tibba on 2026-11-08 \(Asia\/Kolkata\)/,
  );
  assert.match(
    saved.notes[0].text,
    /horizon_at — .*\(not offered by this server yet\)/,
  );
  const missing = await run('run_mission_template', {
    template: 'plan_half_day_outing',
    inputs: { place_name: 'Rajpur', lat: 30.39, lon: 78.09 },
  });
  assert.equal(missing.refusal.code, 'invalid_request');
});

test('render_view answers the capture, or refuses when no frame is drawn', async () => {
  const frame = {
    image: 'iVBORw0KGgo=',
    legend: [],
    width: 10,
    height: 10,
    captured_at: '2026-11-08T00:30:00.000Z',
  };
  const ok = await setup({ capture: async () => frame }).run(
    'render_view',
    {},
    OFF,
  );
  assert.deepEqual(ok, { ok: true, result: frame });
  const none = await setup({ capture: async () => null }).run(
    'render_view',
    {},
  );
  assert.equal(none.refusal.code, 'unsupported');
});

test('storage failures become storage_unavailable, never thrown errors', async () => {
  const { fieldbook, run } = setup();
  fieldbook.get = async () => {
    throw Object.assign(new Error('x'), { code: 'STORAGE_UNAVAILABLE' });
  };
  const answer = await run('fieldbook_add_note', {
    project_id: 'p',
    expected_revision: 1,
    text: 'x',
  });
  assert.equal(answer.refusal.code, 'storage_unavailable');
  assert.ok(FIELD_KIT_REFUSAL_CODES.includes(answer.refusal.code));
});

test('needsWrites gates every write except a mission dry run', () => {
  for (const op of WRITE_OPERATIONS) assert.equal(needsWrites(op, {}), true);
  assert.equal(needsWrites('run_mission_template', { dry_run: true }), false);
  assert.equal(needsWrites('render_view', {}), false);
});
