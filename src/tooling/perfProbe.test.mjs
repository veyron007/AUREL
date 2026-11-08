import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_BASE_URL,
  DEFAULT_RUNS,
  formatMarkdown,
  isSoftwareRenderer,
  markGapLabels,
  markGaps,
  median,
  parseProbeArgs,
  parseScenes,
  parseThrottle,
  sceneUrl,
  selectScenes,
  summarizeRuns,
} from '../../scripts/perf-probe-core.mjs';

const SCENE_FILE = new URL('../../scripts/perf-scenes.json', import.meta.url);

const MARKS = Object.freeze({
  'cesium-ready': 1000,
  'viewer-created': 1500,
  'first-tile': 3000,
  'bootstrap-done': 3200,
  'splash-hidden': 4000,
});

function run(overrides = {}) {
  return {
    gpu: 'ANGLE Metal Renderer: Apple M4',
    readyMs: 6000,
    domReadyMs: 500,
    requests: 350,
    transferMB: 14.2,
    heapMB: 78,
    longTaskMs: 480,
    worstTaskMs: 168,
    restFps: 0,
    motionFps: 60,
    marks: MARKS,
    ...overrides,
  };
}

test('the committed scene file parses and keeps the baseline scenes', () => {
  const scenes = parseScenes(JSON.parse(readFileSync(SCENE_FILE, 'utf8')));
  // The baseline scenes stay first; later phases append their own.
  assert.deepEqual(
    scenes.slice(0, 3).map((scene) => scene.id),
    ['empty-dehradun', 'flights-quakes-sats', 'cables-datacenters-fires'],
  );
  assert.ok(scenes.every((scene) => scene.hash.includes('map=esri-imagery')));
});

test('scene parsing rejects missing, duplicate and malformed scenes', () => {
  assert.throws(() => parseScenes({}), /nonempty "scenes"/);
  assert.throws(() => parseScenes({ scenes: [] }), /nonempty "scenes"/);
  const scene = { id: 'a', label: 'A', hash: 'l=' };
  assert.throws(
    () => parseScenes({ scenes: [scene, scene] }),
    /Duplicate scene id a/,
  );
  assert.throws(
    () => parseScenes({ scenes: [{ ...scene, id: 'Bad Id' }] }),
    /\.id must/,
  );
  assert.throws(
    () => parseScenes({ scenes: [{ ...scene, label: ' ' }] }),
    /\.label must/,
  );
  assert.throws(
    () => parseScenes({ scenes: [{ ...scene, hash: '#l=' }] }),
    /\.hash must/,
  );
  assert.throws(
    () => parseScenes({ scenes: [{ ...scene, setup: 'eval' }] }),
    /\.setup must be one of annotations-10/,
  );
  assert.equal(
    parseScenes({ scenes: [{ ...scene, setup: 'annotations-10' }] })[0].setup,
    'annotations-10',
  );
});

test('scene selection keeps the requested order and names unknown ids', () => {
  const scenes = parseScenes({
    scenes: [
      { id: 'a', label: 'A', hash: 'l=' },
      { id: 'b', label: 'B', hash: 'l=f' },
    ],
  });
  assert.equal(selectScenes(scenes, null), scenes);
  assert.deepEqual(
    selectScenes(scenes, ['b', 'a']).map((scene) => scene.id),
    ['b', 'a'],
  );
  assert.throws(
    () => selectScenes(scenes, ['c']),
    /Unknown scene id c; known: a, b/,
  );
  assert.equal(
    sceneUrl('http://localhost:4181', scenes[1]),
    'http://localhost:4181/?welcome=0#v=2&l=f',
  );
});

test('CPU slowdown and pixel ratio are bounded numbers', () => {
  const options = parseProbeArgs(['--cpu-slowdown', '4', '--dpr', '2']);
  assert.equal(options.cpuSlowdown, 4);
  assert.equal(options.dpr, 2);
  assert.throws(() => parseProbeArgs(['--cpu-slowdown', '0']), /1 to 20/);
  assert.throws(() => parseProbeArgs(['--dpr', 'x']), /1 to 3/);
});

test('arguments default to three runs of every scene and validate each option', () => {
  assert.deepEqual(
    { ...parseProbeArgs([]) },
    {
      base: DEFAULT_BASE_URL,
      runs: DEFAULT_RUNS,
      sceneIds: null,
      throttle: null,
      cpuSlowdown: 1,
      dpr: 1,
      allowSoftware: false,
      help: false,
    },
  );
  const options = parseProbeArgs([
    '--base',
    'http://127.0.0.1:4182/ignored',
    '--scenes',
    'a, b,a',
    '--runs',
    '5',
    '--throttle',
    '50mbps',
    '--allow-software',
  ]);
  assert.equal(options.base, 'http://127.0.0.1:4182');
  assert.deepEqual(options.sceneIds, ['a', 'b']);
  assert.equal(options.runs, 5);
  assert.equal(options.throttle.label, '50mbps');
  assert.equal(options.allowSoftware, true);
  assert.throws(() => parseProbeArgs(['--runs', '0']), /--runs must be/);
  assert.throws(() => parseProbeArgs(['--runs', '2.5']), /--runs must be/);
  assert.throws(() => parseProbeArgs(['--base', 'file:///x']), /http or https/);
  assert.throws(() => parseProbeArgs(['--base']), /--base needs a value/);
  assert.throws(() => parseProbeArgs(['--frobnicate']), /Unknown option/);
});

test('throttle profiles convert bits per second into DevTools bytes per second', () => {
  const profile = parseThrottle('50mbps');
  assert.equal(profile.downloadThroughput, 6_250_000);
  assert.equal(profile.uploadThroughput, 1_250_000);
  assert.equal(profile.latency, 20);
  assert.equal(parseThrottle('800KBPS').downloadThroughput, 100_000);
  assert.throws(() => parseThrottle('fast'), /--throttle must look like/);
  assert.throws(() => parseThrottle('0mbps'), /above zero/);
});

test('software and missing renderers are rejected, hardware ones accepted', () => {
  for (const renderer of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Microsoft Basic Render Driver',
    '?',
    '',
    undefined,
  ])
    assert.equal(isSoftwareRenderer(renderer), true, String(renderer));
  assert.equal(isSoftwareRenderer('ANGLE Metal Renderer: Apple M4'), false);
});

test('median handles odd and even counts and ignores missing values', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, 5, Number.NaN, 7, undefined]), 6);
  assert.equal(median([null]), null);
  const values = [3, 1, 2];
  median(values);
  assert.deepEqual(values, [3, 1, 2], 'input is not reordered');
});

test('mark gaps run from navigation through each mark in order', () => {
  assert.deepEqual(markGapLabels(), [
    'navigation→cesium-ready',
    'cesium-ready→viewer-created',
    'viewer-created→first-tile',
    'first-tile→bootstrap-done',
    'bootstrap-done→splash-hidden',
  ]);
  assert.deepEqual(Object.values(markGaps(MARKS)), [1000, 500, 1500, 200, 800]);
  const missingTile = markGaps({ ...MARKS, 'first-tile': null });
  assert.equal(missingTile['viewer-created→first-tile'], null);
  assert.equal(missingTile['first-tile→bootstrap-done'], null);
  assert.equal(missingTile['bootstrap-done→splash-hidden'], 800);
});

test('run summaries report the median of each metric, mark and gap', () => {
  const scene = { id: 'empty', label: 'Empty globe' };
  const summary = summarizeRuns(scene, [
    run({ readyMs: 5000 }),
    run({ readyMs: 7000, marks: { ...MARKS, 'splash-hidden': 4600 } }),
    run({ readyMs: 6000 }),
  ]);
  assert.equal(summary.runs, 3);
  assert.equal(summary.readyMs, 6000);
  assert.equal(summary.gpu, 'ANGLE Metal Renderer: Apple M4');
  assert.equal(summary.marks['splash-hidden'], 4000);
  assert.equal(summary.markGaps['bootstrap-done→splash-hidden'], 800);
  assert.throws(() => summarizeRuns(scene, []), /No runs recorded for empty/);
});

test('markdown output has a metrics table and a mark gap table', () => {
  const summary = summarizeRuns({ id: 'empty', label: 'Empty globe' }, [
    run({ marks: { ...MARKS, 'first-tile': null } }),
  ]);
  const lines = formatMarkdown([summary]).split('\n');
  assert.equal(
    lines[0],
    '| Scene | Ready | DOM ready | Requests | Transfer | Heap | Long tasks (worst) | Rest / motion FPS |',
  );
  assert.equal(
    lines[2],
    '| Empty globe | 6.0 s | 0.5 s | 350 | 14.2 MB | 78 MB | 0.5 s (168 ms) | 0 / 60 |',
  );
  assert.equal(lines[3], '');
  assert.match(lines[4], /^\| Scene \| navigation→cesium-ready \|/);
  assert.equal(lines[5], '|---|---:|---:|---:|---:|---:|');
  assert.equal(lines[6], '| Empty globe | 1000 ms | 500 ms | — | — | 800 ms |');
});
