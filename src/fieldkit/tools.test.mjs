import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createAgentDeskRelay } from '../../server/agentDesk/relay.js';
import {
  createLocalMcpServer,
  localMcpTools,
} from '../../server/mcp/server.js';
import { serveStdio } from '../../server/mcp/stdio.js';
import {
  memoryFieldbookRepository,
  memoryWatchlistRepository,
  uuidSequence,
} from '../testSupport/fieldKitFakes.mjs';
import { defineTool } from '../tools/catalog.js';
import { validateEnvelope } from './envelope.js';
import { createFieldKitExecutor } from './executor.js';
import {
  FIELD_KIT_SLOTS,
  createFieldKitTools,
  fieldKitTools,
} from './tools.js';

const SESSION = 'test-tab-session-0001';
const NOW = Date.parse('2026-11-08T00:30:00.000Z');

/** A desk: the relay, an app tab answering it, and an MCP server reaching it. */
async function desk({ ledgerDir, capture } = {}) {
  const relay = createAgentDeskRelay();
  const fieldbook = memoryFieldbookRepository();
  const session = { writesAllowed: false };
  const executor = createFieldKitExecutor({
    fieldbook,
    watchlists: memoryWatchlistRepository(),
    capture,
    now: () => NOW,
    uuid: uuidSequence(),
  });
  let open = true;
  const tab = (async () => {
    while (open) {
      const request = await relay.poll(SESSION);
      if (request)
        relay.complete(
          SESSION,
          request.id,
          await executor.execute(request, session),
        );
    }
  })();
  const usgs = { type: 'FeatureCollection', features: [] };
  const server = createLocalMcpServer({
    apiBase: 'http://127.0.0.1:5000',
    ledgerDir,
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.pathname === '/api/agent-desk/requests')
        return Response.json(await relay.submit(JSON.parse(init.body)));
      return Response.json(usgs);
    },
  });
  let id = 0;
  const call = async (messages) => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk) => (written += chunk));
    const served = serveStdio(server, { input, output });
    for (const message of messages)
      input.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: (id += 1), ...message })}\n`,
      );
    input.end();
    await served;
    return written
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  };
  const tool = async (name, args) => {
    const [response] = await call([
      { method: 'tools/call', params: { name, arguments: args } },
    ]);
    return response.result;
  };
  const close = async () => {
    open = false;
    // Release the tab's pending poll with one last request.
    await relay.submit({ op: 'render_view', args: {}, client: 'x' });
    await tab;
  };
  return { session, fieldbook, call, tool, close };
}

test('the Field Kit is offered on MCP with tool annotations, plus Core', () => {
  const names = localMcpTools().map((tool) => tool.name);
  for (const tool of fieldKitTools) assert.ok(names.includes(tool.name));
  // WP1 delivers horizon_at as a core tool; it is offered exactly once.
  assert.equal(names.filter((name) => name === 'horizon_at').length, 1);
  const writes = fieldKitTools.filter(
    (tool) => tool.annotations.readOnlyHint === false,
  );
  assert.deepEqual(
    writes.map((tool) => tool.name),
    [
      'fieldbook_add_place',
      'fieldbook_add_note',
      'draw_area',
      'run_mission_template',
      'register_watch',
    ],
  );
  for (const tool of writes) {
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
});

test('the horizon_at slot is delivered by WP1 and still accepts a stand-in', () => {
  assert.deepEqual(
    FIELD_KIT_SLOTS.map((slot) => [slot.name, slot.status]),
    [['horizon_at', 'delivered']],
  );
  const horizonAt = defineTool({
    name: 'horizon_at',
    title: 'Horizon',
    description: 'Stand-in for WP1.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    run: async () => ({ summary: 's', data: {} }),
  });
  assert.equal(createFieldKitTools({ horizonAt }).at(-1), horizonAt);
  assert.ok(
    localMcpTools({ horizonAt }).some((tool) => tool.name === 'horizon_at'),
  );
  assert.throws(
    () => createFieldKitTools({ horizonAt: fieldKitTools[0] }),
    /horizon_at slot/,
  );
});

test('demo over stdio: writes are refused while the toggle is off, then succeed tagged by the client', async () => {
  const { session, fieldbook, call, tool, close } = await desk();
  try {
    const [init] = await call([
      {
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'claude-code', version: '2.0' },
        },
      },
    ]);
    assert.equal(init.result.serverInfo.name, 'gods-eye-view');
    assert.match(init.result.instructions, /Allow agent writes/);

    const place = {
      name: 'Lal Tibba',
      lat: 30.4594,
      lon: 78.0957,
      project_title: 'Mussoorie sunrise',
    };
    const refused = await tool('fieldbook_add_place', place);
    assert.equal(refused.isError, true);
    assert.equal(refused.structuredContent.error, 'refused');
    assert.equal(
      refused.structuredContent.details.refusal.code,
      'writes_disabled',
    );
    assert.match(refused.content[0].text, /^Refused \(writes_disabled\)/);
    assert.equal(fieldbook.records.size, 0);

    session.writesAllowed = true;
    const saved = await tool('fieldbook_add_place', place);
    assert.equal(saved.isError, false);
    assert.match(
      saved.content[0].text,
      /by agent · claude-code · 2026-11-08T00:30:00\.000Z/,
    );
    const {
      project_id: projectId,
      revision,
      place_id: placeId,
    } = saved.structuredContent;
    assert.equal(revision, 1);
    const envelope = saved._meta['aurel/envelope'];
    assert.equal(validateEnvelope(envelope).class, 'note');
    assert.match(saved.content.at(-1).text, /^Provenance envelope: \{/);

    const note = await tool('fieldbook_add_note', {
      project_id: projectId,
      expected_revision: 1,
      subject_id: placeId,
      text: 'Sunrise from the eastern rail; arrive 06:15 IST.',
      evidence: [
        {
          tool: 'get_weather',
          class: 'modelled',
          source_label: 'Open-Meteo forecast API',
        },
      ],
    });
    assert.equal(note.structuredContent.revision, 2);

    const conflict = await tool('draw_area', {
      project_id: projectId,
      expected_revision: 1,
      name: 'Viewpoint',
      bbox: { west: 78.094, south: 30.458, east: 78.097, north: 30.461 },
    });
    assert.equal(
      conflict.structuredContent.details.refusal.code,
      'revision_conflict',
    );
    assert.equal(
      conflict.structuredContent.details.refusal.details.latest_revision,
      2,
    );

    const unknownField = await tool('fieldbook_add_note', {
      project_id: projectId,
      expected_revision: 2,
      text: 'x',
      run: 'now',
    });
    assert.equal(unknownField.isError, true);
    assert.equal(unknownField.structuredContent.error, 'invalid_arguments');
    assert.equal(fieldbook.records.get(projectId).revision, 2);
  } finally {
    await close();
  }
});

test('a dry-run mission answers without the app; a written one needs the toggle', async () => {
  const { tool, close } = await desk();
  try {
    const args = {
      template: 'sunrise_shoot',
      inputs: {
        place_name: 'Lal Tibba',
        lat: 30.4594,
        lon: 78.0957,
        date: '2026-11-08',
      },
    };
    const dry = await tool('run_mission_template', { ...args, dry_run: true });
    assert.equal(dry.isError, false);
    const steps = dry.structuredContent.plan.steps;
    assert.equal(
      steps.find((step) => step.tool === 'horizon_at').available,
      true,
    );
    assert.equal(
      steps.find((step) => step.tool === 'get_free_budget').available,
      true,
    );
    const refused = await tool('run_mission_template', args);
    assert.equal(
      refused.structuredContent.details.refusal.code,
      'writes_disabled',
    );
  } finally {
    await close();
  }
});

test('render_view returns a PNG with a legend of classes and times', async () => {
  const frame = {
    image: 'iVBORw0KGgo=',
    width: 640,
    height: 420,
    captured_at: '2026-11-08T00:30:00.000Z',
    legend: [
      {
        id: 'traffic',
        name: 'Traffic',
        class: 'simulated',
        updated_at: '2026-11-08T00:29:00.000Z',
        feed_state: 'fallback',
        source: 'sim',
        count: 12,
      },
      {
        id: 'earthquakes',
        name: 'Earthquakes',
        class: 'observed',
        updated_at: null,
        feed_state: 'nominal',
        source: 'USGS',
        count: 2,
      },
    ],
  };
  const { tool, close } = await desk({ capture: async () => frame });
  try {
    const result = await tool('render_view', {});
    assert.equal(result.isError, false);
    const image = result.content.find((item) => item.type === 'image');
    assert.deepEqual(image, {
      type: 'image',
      data: frame.image,
      mimeType: 'image/png',
    });
    assert.match(
      result.content[0].text,
      /Traffic — simulated · updated 2026-11-08 00:29Z · fallback/,
    );
    assert.match(
      result.content[0].text,
      /Earthquakes — observed · time unknown/,
    );
    assert.equal(result.structuredContent.legend.length, 2);
    assert.equal(result._meta['aurel/envelope'].class, 'derived');
  } finally {
    await close();
  }
});

test('get_free_budget reads the ledgers on disk and says estimated', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurel-budget-'));
  const today = new Date();
  const iso = today.toISOString();
  await writeFile(
    path.join(dir, 'field-context-budget.json'),
    JSON.stringify({
      version: 1,
      day: iso.slice(0, 10),
      month: iso.slice(0, 7),
      minute: iso.slice(0, 16),
      dayCount: 40,
      monthCount: 40,
      minuteCount: 1,
      lastAt: today.getTime(),
    }),
  );
  await writeFile(path.join(dir, 'research-budget.json'), 'not json');
  const { tool, close } = await desk({ ledgerDir: dir });
  try {
    const result = await tool('get_free_budget', {});
    const rows = Object.fromEntries(
      result.structuredContent.ledgers.map((row) => [row.ledger, row]),
    );
    assert.equal(rows['field-context'].estimated_remaining_units, 60);
    assert.equal(rows['imagery-history'].estimated_remaining_units, 100);
    assert.equal(rows.research.status, 'unreadable');
    assert.equal(result.structuredContent.estimated, true);
    assert.ok(result.structuredContent.paused_by_free_only.includes('tomtom'));
    assert.match(result.content[0].text, /^Estimated remaining free units/);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('with no AUREL tab, writes answer no_app_session', async () => {
  const server = createLocalMcpServer({
    apiBase: 'http://127.0.0.1:5000',
    fetchImpl: async () => new Response('Not found', { status: 404 }),
  });
  const response = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'fieldbook_add_place',
      arguments: { name: 'x', lat: 1, lon: 1 },
    },
  });
  assert.equal(
    response.result.structuredContent.details.refusal.code,
    'no_app_session',
  );
});

test('read tools keep their data and gain an envelope over MCP', async () => {
  const usgs = {
    type: 'FeatureCollection',
    features: [
      {
        id: 'us1',
        geometry: { type: 'Point', coordinates: [78.4, 30.7, 10] },
        properties: { mag: 4.6, place: 'near Uttarkashi', time: NOW - 3600000 },
      },
    ],
  };
  const server = createLocalMcpServer({
    apiBase: 'http://127.0.0.1:5000',
    fetchImpl: async () => Response.json(usgs),
  });
  const response = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_earthquakes', arguments: {} },
  });
  const { result } = response;
  assert.equal(result.structuredContent.rows[0].magnitude, 4.6);
  assert.equal(result.structuredContent.envelope, undefined);
  assert.equal(result._meta['aurel/envelope'].class, 'observed');
  assert.equal(
    result._meta['aurel/envelope'].sources[0].licence,
    'U.S. public domain',
  );
  assert.equal(result.content.length, 3);
});
