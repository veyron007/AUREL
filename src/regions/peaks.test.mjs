// i18n-ignore-file: peaks pack fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyPeaksPack, validatePeakExtent, PEAK_LIMITS } from './peaks.js';
import {
  buildPeakArtifacts,
  DEFAULT_PEAK_EXTENT,
} from '../../scripts/build-region-pack.mjs';

const META = {
  extractAt: '2026-11-05T21:23:02Z',
  retrievedAt: '2026-11-07T12:00:00Z',
  extractSha256: 'b'.repeat(64),
  skippedUnnamed: 3,
};
const ENTRIES = [
  {
    id: 'node/342110908',
    name: 'Bandarpunch I',
    nameHi: null,
    eleM: 6316,
    lat: 31.0035014,
    lon: 78.5531283,
  },
  {
    id: 'node/299492171',
    name: 'Nanda Devi',
    nameHi: 'नंदा देवी',
    eleM: 7816,
    lat: 30.3760768,
    lon: 79.9701154,
  },
];

test('peaks theme builds within caps and verifies with reproducible hashes', async () => {
  const one = buildPeakArtifacts({ version: 1, entries: ENTRIES }, META);
  const two = buildPeakArtifacts(
    { version: 1, entries: [...ENTRIES].reverse() },
    META,
  );
  assert.equal(one.manifest.assets[0].sha256, two.manifest.assets[0].sha256);
  assert.deepEqual(one.manifest.counts, {
    peaks: 2,
    withElevation: 2,
    withHindiName: 1,
    skippedUnnamed: 3,
  });
  const { entries } = await verifyPeaksPack(one.manifest, one.assets.peaks);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['node/299492171', 'node/342110908'],
  );
});

test('peaks pack refuses tampering, oversize extents and out-of-extent peaks', async () => {
  const built = buildPeakArtifacts({ version: 1, entries: ENTRIES }, META);
  const tampered = new Uint8Array(built.assets.peaks);
  tampered[tampered.length - 3] ^= 1;
  await assert.rejects(verifyPeaksPack(built.manifest, tampered), /digest/);
  assert.throws(() => validatePeakExtent([70, 20, 80, 30]), /limit/);
  assert.throws(
    () =>
      buildPeakArtifacts(
        { version: 1, entries: ENTRIES },
        { ...META, extent: [70, 20, 80, 30] },
      ),
    /limit/,
  );
  const outside = buildPeakArtifacts(
    { version: 1, entries: [{ ...ENTRIES[0], lon: 90 }] },
    META,
  );
  await assert.rejects(
    verifyPeaksPack(outside.manifest, outside.assets.peaks),
    /position/,
  );
  assert.equal(PEAK_LIMITS.features, 10000);
  assert.equal(PEAK_LIMITS.bytes, 4 * 1024 * 1024);
  assert.deepEqual([...DEFAULT_PEAK_EXTENT], [75.95, 28.5, 80.15, 32.15]);
});

test('the bundled Dehradun peaks pack verifies and names the Garhwal skyline', async () => {
  const root = new URL('../../public/regions/dehradun-peaks/', import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', root), 'utf8'),
  );
  const bytes = new Uint8Array(await readFile(new URL('peaks.json', root)));
  const { entries } = await verifyPeaksPack(manifest, bytes);
  assert.equal(
    manifest.source.extractSha256,
    'b6eaf4f9c098d77a1c8a05996fd6752e83ee8550b022aefa0c4de255af20eaeb',
  );
  assert.ok(entries.length > 100 && entries.length <= PEAK_LIMITS.features);
  for (const name of ['Bandarpunch I', 'Nanda Devi', 'Kamet', 'Swargarohini'])
    assert.ok(
      entries.some((entry) => entry.name === name),
      name,
    );
});
