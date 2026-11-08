import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DAILY_CACHE,
  IMMUTABLE_CACHE,
  REVALIDATE_CACHE,
  cacheControlFor,
  isBuiltFile,
} from './cacheHeaders.js';
import { makeFixtureRoot } from '../../src/tooling/fixtureRoot.mjs';

const VERSION = '1.138.0';

test('preview: hashed assets and the versioned Cesium script are immutable', () => {
  const at = (url) =>
    cacheControlFor({ url, preview: true, cesiumVersion: VERSION });
  assert.equal(at('/assets/index-CXNQaOLs.js'), IMMUTABLE_CACHE);
  assert.equal(at('/assets/index-wTqvF6nJ.css'), IMMUTABLE_CACHE);
  assert.equal(at(`/cesium/Cesium.js?v=${VERSION}`), IMMUTABLE_CACHE);
  // Unversioned Cesium files keep a day, then revalidate.
  assert.equal(at('/cesium/Cesium.js'), DAILY_CACHE);
  assert.equal(at('/cesium/Cesium.js?v=1.0.0'), DAILY_CACHE);
  assert.equal(at('/cesium/Workers/createGeometry.js'), DAILY_CACHE);
  assert.equal(at('/cesium/Widgets/widgets.css'), DAILY_CACHE);
});

test('the document, the API and other files keep the server default', () => {
  for (const preview of [true, false])
    for (const url of [
      '/',
      '/index.html',
      '/api/flights',
      '/api/assets/x.js',
      '/fonts/inter-7.woff2',
      '/assets/nested/x.js',
      '/style.css',
    ])
      assert.equal(
        cacheControlFor({ url, preview, cesiumVersion: VERSION }),
        null,
        `${preview} ${url}`,
      );
});

test('dev always revalidates Cesium files and leaves the rest alone', () => {
  const at = (url) =>
    cacheControlFor({ url, preview: false, cesiumVersion: VERSION });
  assert.equal(at('/cesium/Workers/createGeometry.js'), REVALIDATE_CACHE);
  assert.equal(at(`/cesium/Cesium.js?v=${VERSION}`), REVALIDATE_CACHE);
  assert.equal(at('/assets/index-CXNQaOLs.js'), null);
});

test('only an existing built file inside dist can receive a lifetime', async (t) => {
  const root = await makeFixtureRoot('gev-cache-headers-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'assets', 'index-abc.js'), 'x');
  assert.equal(isBuiltFile(root, '/assets/index-abc.js'), true);
  assert.equal(isBuiltFile(root, '/assets/missing.js'), false);
  assert.equal(isBuiltFile(root, '/assets'), false);
  assert.equal(isBuiltFile(root, '/../outside.js'), false);
});
