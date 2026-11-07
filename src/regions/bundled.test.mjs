// i18n-ignore-file: real bundled-data integrity test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyRegionPack, searchRegionNames } from './pack.js';

test('the shipped Dehradun dataset verifies and searches entirely offline', async () => {
  const base = new URL('../../public/regions/dehradun-core/', import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', base), 'utf8'),
  );
  const assets = Object.fromEntries(
    await Promise.all(
      manifest.assets.map(async (asset) => [
        asset.id,
        new Uint8Array(await readFile(new URL(asset.path, base))),
      ]),
    ),
  );
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Unexpected network request');
  };
  try {
    const result = await verifyRegionPack(manifest, assets);
    assert.ok(result.manifest.counts.features > 100);
    assert.ok(result.manifest.counts.roads > 0);
    assert.ok(result.manifest.counts.buildings > 0);
    assert.ok(result.manifest.counts.water > 0);
    assert.ok(result.index.entries.length > 0);
    const entry = result.index.entries[0];
    assert.ok(
      searchRegionNames(result.index, entry.name, { limit: 20 }).some(
        (hit) => hit.name === entry.name,
      ),
    );
    assert.equal(result.manifest.coverage, 'partial');
    assert.ok(
      result.geojson.features.some(
        (feature) =>
          feature.properties.kind === 'building' &&
          feature.properties.heightM === null,
      ),
    );
  } finally {
    globalThis.fetch = previous;
  }
});
