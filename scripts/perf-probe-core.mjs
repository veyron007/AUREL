// Pure parts of scripts/perf-probe.mjs: arguments, scenes, medians and tables.
// No browser, network or filesystem access here, so it is unit tested directly.
import { STARTUP_MARK_ORDER } from '../src/app/startupMarks.js';

export const DEFAULT_BASE_URL = 'http://localhost:4181';
export const DEFAULT_RUNS = 3;
export const MAX_RUNS = 25;
const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** In-page steps a scene may run once the app is ready (see perf-probe.mjs). */
export const SCENE_SETUPS = Object.freeze(['annotations-10']);
const THROTTLE_PATTERN = /^(\d+(?:\.\d+)?)(kbps|mbps)$/i;
const BITS_PER_UNIT = Object.freeze({ kbps: 1e3, mbps: 1e6 });
const THROTTLE_LATENCY_MS = 20;
const THROTTLE_UPLOAD_SHARE = 0.2;
const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|softpipe|software rasterizer|basic render driver/i;

/** Metrics summarised by median, in report order. */
export const PROBE_METRICS = Object.freeze([
  'readyMs',
  'domReadyMs',
  'requests',
  'transferMB',
  'heapMB',
  'longTaskMs',
  'worstTaskMs',
  'restFps',
  'motionFps',
  'motionP95FrameMs',
  'motionTaskMsPerFrame',
]);

const USAGE = `Usage: node scripts/perf-probe.mjs [options]
  --base URL         app origin (default ${DEFAULT_BASE_URL})
  --scenes a,b       scene ids from scripts/perf-scenes.json (default: all)
  --runs N           runs per scene, median reported (default ${DEFAULT_RUNS})
  --throttle 50mbps  emulate a download link (kbps or mbps)
  --cpu-slowdown N   slow the page's CPU N times (1 to 20, default 1)
  --dpr N            device pixel ratio (1 to 3, default 1)
  --allow-software   accept a software GPU renderer
  --help             show this text`;

export function probeUsage() {
  return USAGE;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--'))
    throw new Error(`${flag} needs a value\n${USAGE}`);
  return value;
}

function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--base must be an absolute URL, received ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error(`--base must be http or https, received ${value}`);
  return url.origin;
}

function parseRuns(value) {
  const runs = Number(value);
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS)
    throw new Error(`--runs must be an integer from 1 to ${MAX_RUNS}`);
  return runs;
}

function parseSceneIds(value) {
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error('--scenes needs at least one scene id');
  return [...new Set(ids)];
}

const VALUE_OPTIONS = Object.freeze({
  '--base': ['base', parseBaseUrl],
  '--runs': ['runs', parseRuns],
  '--scenes': ['sceneIds', parseSceneIds],
  '--throttle': ['throttle', parseThrottle],
  '--cpu-slowdown': [
    'cpuSlowdown',
    (value) => parseBounded(value, 1, 20, '--cpu-slowdown'),
  ],
  '--dpr': ['dpr', (value) => parseBounded(value, 1, 3, '--dpr')],
});

function parseBounded(value, min, max, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new Error(`${flag} must be a number from ${min} to ${max}`);
  return number;
}

/** Parse command-line arguments into frozen probe options. */
export function parseProbeArgs(argv) {
  let options = {
    base: DEFAULT_BASE_URL,
    runs: DEFAULT_RUNS,
    sceneIds: null,
    throttle: null,
    cpuSlowdown: 1,
    dpr: 1,
    allowSoftware: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--allow-software')
      options = { ...options, allowSoftware: true };
    else if (flag === '--help') options = { ...options, help: true };
    else if (VALUE_OPTIONS[flag]) {
      const [key, parse] = VALUE_OPTIONS[flag];
      options = { ...options, [key]: parse(requireValue(argv, index, flag)) };
      index++;
    } else throw new Error(`Unknown option ${flag}\n${USAGE}`);
  }
  return Object.freeze(options);
}

/** Convert `50mbps` into Chrome DevTools network conditions. */
export function parseThrottle(value) {
  const match = THROTTLE_PATTERN.exec(String(value).trim());
  if (!match)
    throw new Error(
      `--throttle must look like 50mbps or 800kbps, received ${value}`,
    );
  const bitsPerSecond =
    Number(match[1]) * BITS_PER_UNIT[match[2].toLowerCase()];
  if (!(bitsPerSecond > 0)) throw new Error('--throttle must be above zero');
  const bytesPerSecond = bitsPerSecond / 8;
  return Object.freeze({
    label: match[0].toLowerCase(),
    offline: false,
    latency: THROTTLE_LATENCY_MS,
    downloadThroughput: bytesPerSecond,
    uploadThroughput: bytesPerSecond * THROTTLE_UPLOAD_SHARE,
  });
}

function validateScene(scene, index, seen) {
  const where = `scenes[${index}]`;
  if (!scene || typeof scene !== 'object')
    throw new Error(`${where} must be an object`);
  if (typeof scene.id !== 'string' || !SCENE_ID_PATTERN.test(scene.id))
    throw new Error(`${where}.id must be lowercase letters, digits and dashes`);
  if (seen.has(scene.id)) throw new Error(`Duplicate scene id ${scene.id}`);
  if (typeof scene.label !== 'string' || !scene.label.trim())
    throw new Error(`${where}.label must be a nonempty string`);
  if (typeof scene.hash !== 'string' || scene.hash.startsWith('#'))
    throw new Error(`${where}.hash must be a string without the leading #`);
  if (scene.setup !== undefined && !SCENE_SETUPS.includes(scene.setup))
    throw new Error(
      `${where}.setup must be one of ${SCENE_SETUPS.join(', ')}, received ${scene.setup}`,
    );
  return Object.freeze({
    id: scene.id,
    label: scene.label.trim(),
    hash: scene.hash,
    ...(scene.setup ? { setup: scene.setup } : {}),
  });
}

/** Validate the parsed scene file and return frozen scenes. */
export function parseScenes(document) {
  const scenes = document?.scenes;
  if (!Array.isArray(scenes) || !scenes.length)
    throw new Error('Scene file must have a nonempty "scenes" array');
  const seen = new Set();
  return Object.freeze(
    scenes.map((scene, index) => {
      const valid = validateScene(scene, index, seen);
      seen.add(valid.id);
      return valid;
    }),
  );
}

/** Keep the requested scenes in the requested order; reject unknown ids. */
export function selectScenes(scenes, ids) {
  if (!ids) return scenes;
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length)
    throw new Error(
      `Unknown scene id ${unknown.join(', ')}; known: ${[...byId.keys()].join(', ')}`,
    );
  return Object.freeze(ids.map((id) => byId.get(id)));
}

/** The app URL a scene opens, with the welcome dialog suppressed. */
export function sceneUrl(base, scene) {
  return `${base}/?welcome=0#v=2&${scene.hash}`;
}

/** Whether a WebGL renderer string is missing or a software rasterizer. */
export function isSoftwareRenderer(renderer) {
  if (typeof renderer !== 'string' || !renderer.trim() || renderer === '?')
    return true;
  return SOFTWARE_RENDERER_PATTERN.test(renderer);
}

/** Median of the finite numbers; null when there are none. */
export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Gap label for each consecutive pair, starting at navigation. */
export function markGapLabels() {
  return ['navigation', ...STARTUP_MARK_ORDER]
    .slice(0, -1)
    .map((from, index) => `${from}→${STARTUP_MARK_ORDER[index]}`);
}

/** Gaps between consecutive startup marks; null where either end is missing. */
export function markGaps(marks) {
  const times = [0, ...STARTUP_MARK_ORDER.map((name) => marks?.[name] ?? null)];
  return Object.freeze(
    Object.fromEntries(
      markGapLabels().map((label, index) => {
        const from = times[index];
        const to = times[index + 1];
        return [label, from === null || to === null ? null : to - from];
      }),
    ),
  );
}

const REPORT_SCALE = 10;

/** Median across runs, rounded to 0.1 so JSON lines stay readable. */
function medianOf(runs, read) {
  const value = median(runs.map(read));
  return value === null
    ? null
    : Math.round(value * REPORT_SCALE) / REPORT_SCALE;
}

/** Median of every metric, mark and gap across runs of one scene. */
export function summarizeRuns(scene, runs) {
  if (!runs.length) throw new Error(`No runs recorded for ${scene.id}`);
  const metrics = Object.fromEntries(
    PROBE_METRICS.map((key) => [key, medianOf(runs, (run) => run[key])]),
  );
  const marks = Object.fromEntries(
    STARTUP_MARK_ORDER.map((name) => [
      name,
      medianOf(runs, (run) => run.marks?.[name]),
    ]),
  );
  const gaps = Object.fromEntries(
    markGapLabels().map((label) => [
      label,
      medianOf(runs, (run) => markGaps(run.marks)[label]),
    ]),
  );
  return Object.freeze({
    scene: scene.id,
    label: scene.label,
    runs: runs.length,
    gpu: [...new Set(runs.map((run) => run.gpu))].join(' | '),
    ...metrics,
    marks: Object.freeze(marks),
    markGaps: Object.freeze(gaps),
  });
}

function seconds(ms) {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;
}

function milliseconds(ms) {
  return ms === null ? '—' : `${Math.round(ms)} ms`;
}

function count(value, unit = '') {
  return value === null
    ? '—'
    : `${Math.round(value).toLocaleString('en-US')}${unit}`;
}

function fixed(value, unit) {
  return value === null ? '—' : `${value.toFixed(1)} ${unit}`;
}

function fps(value) {
  return value === null ? '—' : String(Math.round(value));
}

function tableRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

function metricRow(summary) {
  return tableRow([
    summary.label,
    seconds(summary.readyMs),
    seconds(summary.domReadyMs),
    count(summary.requests),
    fixed(summary.transferMB, 'MB'),
    count(summary.heapMB, ' MB'),
    `${seconds(summary.longTaskMs)} (${milliseconds(summary.worstTaskMs)})`,
    `${fps(summary.restFps)} / ${fps(summary.motionFps)}`,
  ]);
}

function gapRow(summary) {
  return tableRow([
    summary.label,
    ...markGapLabels().map((label) => milliseconds(summary.markGaps[label])),
  ]);
}

/** Markdown tables of scene medians and startup mark gaps. */
export function formatMarkdown(summaries) {
  const gapHeader = markGapLabels();
  return [
    tableRow([
      'Scene',
      'Ready',
      'DOM ready',
      'Requests',
      'Transfer',
      'Heap',
      'Long tasks (worst)',
      'Rest / motion FPS',
    ]),
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...summaries.map(metricRow),
    '',
    tableRow(['Scene', ...gapHeader]),
    `|---|${gapHeader.map(() => '---:').join('|')}|`,
    ...summaries.map(gapRow),
  ].join('\n');
}
