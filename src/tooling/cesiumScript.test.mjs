import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import cesium from 'vite-plugin-cesium';
import { cesiumScriptPlugin, deferCesiumScript } from '../../build/vite.js';
import { makeFixtureRoot } from './fixtureRoot.mjs';

const TAG = '<script src="/cesium/Cesium.js"></script>';
const ENTRY =
  '<script type="module" crossorigin src="/assets/index.js"></script>';

test('the Cesium script is deferred and versioned', () => {
  const html = `<head>${TAG}${ENTRY}</head>`;
  assert.equal(
    deferCesiumScript(html, '1.138.0'),
    `<head><script defer src="/cesium/Cesium.js?v=1.138.0"></script>${ENTRY}</head>`,
  );
  assert.equal(
    deferCesiumScript(html),
    `<head><script defer src="/cesium/Cesium.js"></script>${ENTRY}</head>`,
  );
});

test('a document without the Cesium tag (the dev server) is unchanged', () => {
  const html = `<head>${ENTRY}</head>`;
  assert.equal(deferCesiumScript(html, '1.138.0'), html);
});

test('a Cesium tag after the module entry fails instead of breaking start-up', () => {
  assert.throws(
    () => deferCesiumScript(`<head>${ENTRY}${TAG}</head>`, '1.138.0'),
    /before the module entry/,
  );
});

test('a real build defers Cesium ahead of the module entry', async (t) => {
  const root = await makeFixtureRoot('gev-cesium-script-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><title>x</title></head><body>' +
      '<script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(path.join(root, 'main.js'), 'globalThis.started = true;\n');
  await build({
    root,
    configFile: false,
    envFile: false,
    publicDir: false,
    logLevel: 'silent',
    build: { outDir: 'dist' },
    plugins: [cesium(), cesiumScriptPlugin({ cesiumVersion: '1.138.0' })],
  });
  const html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
  const cesiumAt = html.indexOf(
    '<script defer src="/cesium/Cesium.js?v=1.138.0"></script>',
  );
  const entryAt = html.indexOf('<script type="module"');
  assert.ok(cesiumAt > 0, html);
  assert.ok(entryAt > cesiumAt, 'the deferred classic script runs first');
  assert.doesNotMatch(html, /<script src="\/cesium\/Cesium\.js"/);
});
