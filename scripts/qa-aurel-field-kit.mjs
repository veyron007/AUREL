/**
 * Field Kit browser and MCP acceptance (AUREL Phase 6, WP6).
 *
 *   QA_BASE=http://127.0.0.1:4173 node scripts/qa-aurel-field-kit.mjs
 *
 * Needs `npm run dev` on QA_BASE. A fresh browser profile opens AUREL with
 * every request outside the local server blocked; a real stdio MCP server
 * (`server/mcp/stdio.js`) is driven as "claude-code" through the demo:
 * "Prepare a Fieldbook for a Mussoorie sunrise shoot on Sunday", first with
 * Allow agent writes off, then on. Evidence goes to
 * docs/design/aurel/phase-6/wp6/evidence.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import puppeteer from 'puppeteer';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173';
const output = path.resolve('docs/design/aurel/phase-6/wp6/evidence');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const errors = [];
const blocked = [];
const transcript = [];
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const local = (url) =>
  !['http:', 'https:'].includes(url.protocol) ||
  ['127.0.0.1', 'localhost'].includes(url.hostname);

/** The next Sunday's date, as the demo prompt asks. */
function nextSunday(now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

function startMcp() {
  const child = spawn(
    process.execPath,
    ['server/mcp/stdio.js', '--api-base', BASE],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const pending = new Map();
  let id = 0;
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  child.stderr.resume();
  const send = (method, params) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      );
    });
  const call = async (name, args = {}) => {
    const { result } = await send('tools/call', { name, arguments: args });
    const refusal = result.structuredContent?.details?.refusal ?? null;
    transcript.push({
      tool: name,
      isError: result.isError,
      summary: result.content[0]?.text?.slice(0, 400),
      refusal: refusal?.code ?? null,
      envelope: result._meta?.['aurel/envelope']?.class ?? null,
    });
    return result;
  };
  return { send, call, close: () => child.stdin.end() };
}

async function openApp(page, hash) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (local(url)) return request.continue();
    blocked.push(url.hostname);
    return request.abort();
  });
  await page.goto(`${BASE}/?welcome=0#${hash}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
}

const refusalOf = (result) => result.structuredContent?.details?.refusal?.code;
const WRITE_TOOLS = [
  'fieldbook_add_place',
  'fieldbook_add_note',
  'draw_area',
  'run_mission_template',
  'register_watch',
];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const mcp = startMcp();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await openApp(
    page,
    'v=2&lat=30.4594&lon=78.0957&alt=60000&map=offline-overview&l=',
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-agent-desk] [role="status"]')
        ?.textContent.includes('ready'),
    { timeout: 30000 },
  );
  check(
    'Allow agent writes is visible in the workspace tools and off by default',
    await page.$eval(
      '#aurel-workspace-tools #agent-writes-toggle',
      (el) => el.getBoundingClientRect().width > 0 && el.checked === false,
    ),
  );
  await page.screenshot({ path: path.join(output, 'toggle-off-desktop.png') });

  const init = await mcp.send('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'claude-code', version: 'qa' },
  });
  check(
    'stdio MCP server initializes',
    init.result?.serverInfo?.name === 'gods-eye-view',
  );
  const listed = (await mcp.send('tools/list', {})).result.tools.map(
    (tool) => tool.name,
  );
  check(
    'Field Kit tools are listed; horizon_at waits for WP1',
    [...WRITE_TOOLS, 'get_free_budget', 'render_view'].every((name) =>
      listed.includes(name),
    ) && !listed.includes('horizon_at'),
  );

  const date = nextSunday();
  const budget = await mcp.call('get_free_budget');
  check(
    'get_free_budget answers estimated remaining units per ledger',
    budget.structuredContent.estimated === true &&
      budget.structuredContent.ledgers.length === 3 &&
      /Not a guarantee of free dispatch/.test(budget.content[0].text),
  );

  // Toggle off: every write is refused, nothing is written.
  const mission = {
    template: 'sunrise_shoot',
    inputs: {
      place_name: 'Lal Tibba, Mussoorie',
      lat: 30.4594,
      lon: 78.0957,
      date,
      time_zone: 'Asia/Kolkata',
    },
    project_title: `Mussoorie sunrise shoot, ${date}`,
  };
  const bbox = { west: 78.094, south: 30.458, east: 78.097, north: 30.461 };
  const offAnswers = [
    await mcp.call('fieldbook_add_place', {
      name: 'Lal Tibba',
      lat: 30.4594,
      lon: 78.0957,
    }),
    await mcp.call('run_mission_template', mission),
    await mcp.call('fieldbook_add_note', {
      project_id: 'none',
      expected_revision: 1,
      text: 'x',
    }),
    await mcp.call('draw_area', {
      project_id: 'none',
      expected_revision: 1,
      name: 'x',
      bbox,
    }),
    await mcp.call('register_watch', {
      project_id: 'none',
      place_id: 'none',
      kind: 'fires',
    }),
  ];
  check(
    'with writes off every write tool returns the typed refusal writes_disabled',
    offAnswers.every(
      (result) => result.isError && refusalOf(result) === 'writes_disabled',
    ),
  );
  const dry = await mcp.call('run_mission_template', {
    ...mission,
    dry_run: true,
  });
  check(
    'a dry-run mission plan works with writes off',
    dry.isError === false && dry.structuredContent.written === false,
  );

  // The owner turns writes on.
  await page.click('#agent-writes-toggle');
  check(
    'turning writes on is kept for this tab session only',
    await page.evaluate(
      () =>
        sessionStorage.getItem('aurel.agent-writes.v1') === 'on' &&
        localStorage.getItem('aurel.agent-writes.v1') === null,
    ),
  );

  const run = await mcp.call('run_mission_template', mission);
  check(
    'the sunrise mission saves a project as claude-code',
    run.isError === false && /by agent · claude-code/.test(run.content[0].text),
  );
  const projectId = run.structuredContent.project_id;
  const placeId = run.structuredContent.place_ids?.[0];
  let revision = run.structuredContent.revision;
  const second = await mcp.call('fieldbook_add_place', {
    project_id: projectId,
    expected_revision: revision,
    name: 'Gun Hill',
    lat: 30.4627,
    lon: 78.0759,
  });
  revision = second.structuredContent?.revision;
  const envelope = budget._meta['aurel/envelope'];
  const note = await mcp.call('fieldbook_add_note', {
    project_id: projectId,
    expected_revision: revision,
    subject_id: placeId,
    text: `Sunrise on ${date}: arrive before civil twilight. Free budget checked first.`,
    evidence: [
      {
        tool: 'get_free_budget',
        class: envelope.class,
        source_label: envelope.sources[0].label,
        licence: envelope.sources[0].licence,
        retrieved_at: envelope.retrieved_at,
      },
    ],
  });
  revision = note.structuredContent?.revision;
  const area = await mcp.call('draw_area', {
    project_id: projectId,
    expected_revision: revision,
    name: 'Lal Tibba viewpoint',
    bbox,
  });
  const stale = await mcp.call('draw_area', {
    project_id: projectId,
    expected_revision: revision,
    name: 'Stale',
    bbox,
  });
  check(
    'writes chain revisions; a stale revision is refused with revision_conflict',
    second.isError === false &&
      note.isError === false &&
      area.isError === false &&
      refusalOf(stale) === 'revision_conflict',
  );
  const cloud = await mcp.call('register_watch', {
    project_id: projectId,
    place_id: placeId,
    kind: 'cloud_cover',
  });
  const watch = await mcp.call('register_watch', {
    project_id: projectId,
    place_id: placeId,
    kind: 'fires',
  });
  check(
    'a cloud-cover watch is refused as unsupported; a fire watch is saved stopped',
    refusalOf(cloud) === 'unsupported' &&
      watch.isError === false &&
      watch.structuredContent.monitoring === 'stopped',
  );
  const bowTie = await mcp.call('draw_area', {
    project_id: projectId,
    expected_revision: area.structuredContent?.revision,
    name: 'Bow tie',
    polygon: [
      [78.09, 30.45],
      [78.1, 30.46],
      [78.09, 30.46],
      [78.1, 30.45],
    ],
  });
  check(
    'a self-crossing area is refused with invalid_geometry',
    refusalOf(bowTie) === 'invalid_geometry',
  );

  const render = await mcp.call('render_view', { max_width: 960 });
  const image = render.content.find((item) => item.type === 'image');
  if (image)
    fs.writeFileSync(
      path.join(output, 'render-view.png'),
      Buffer.from(image.data, 'base64'),
    );
  check(
    'render_view returns a PNG whose legend gives each visible layer a class and time field',
    render.isError === false &&
      image?.mimeType === 'image/png' &&
      render.structuredContent.legend.length > 0 &&
      render.structuredContent.legend.every(
        (row) => row.class && Object.hasOwn(row, 'updated_at'),
      ),
  );
  check(
    'every answer carried a provenance envelope',
    transcript.filter((row) => !row.isError).every((row) => row.envelope),
  );

  // Library: the agent's entries read "by agent · claude-code · time".
  await page.click('[data-workspace="library"]');
  await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll('.workspace-tools button'),
    ].find((el) => el.textContent.trim().endsWith('Fieldbook'));
    if (!button) throw Error('Missing Fieldbook workspace tool');
    button.click();
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('#fieldbook-panel [data-agent-author]')
        .length >= 4,
    { timeout: 20000 },
  );
  const tags = await page.$$eval(
    '#fieldbook-panel [data-agent-author]',
    (nodes) => nodes.map((node) => node.textContent),
  );
  check(
    'Library shows the agent entries as "by agent · claude-code · time"',
    tags.every((tag) => tag.startsWith('by agent · claude-code · ')),
  );
  await page.screenshot({ path: path.join(output, 'library-desktop.png') });

  // Per session: a reload keeps it; a new browser session starts off.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#agent-writes-toggle', { timeout: 90000 });
  check(
    'a reload in the same tab session keeps writes on',
    await page.$eval('#agent-writes-toggle', (el) => el.checked),
  );
  const fresh = await browser.createBrowserContext();
  const other = await fresh.newPage();
  other.on('pageerror', (error) => errors.push(error.message));
  await openApp(
    other,
    'v=2&lat=30.32&lon=78.04&alt=1800000&map=offline-overview&l=',
  );
  await other.waitForSelector('#agent-writes-toggle', { timeout: 90000 });
  check(
    'a new browser session starts with writes off',
    await other.$eval('#agent-writes-toggle', (el) => !el.checked),
  );
  await fresh.close();

  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'field-kit-mobile.png') });
  check(
    'mobile document has no horizontal overflow',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  check('no unhandled browser errors', errors.length === 0);
  fs.writeFileSync(
    path.join(output, 'field-kit-checks.json'),
    JSON.stringify(
      {
        base: BASE,
        date,
        checks,
        errors,
        blockedHosts: [...new Set(blocked)].sort(),
        transcript,
      },
      null,
      2,
    ),
  );
  assert.ok(
    checks.every((entry) => entry.pass),
    'Field Kit acceptance failure',
  );
} finally {
  mcp.close();
  await browser.close();
}
