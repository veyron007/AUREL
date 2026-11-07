// i18n-ignore-file: build-only region fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegionArtifacts,
  buildRegionPack,
  publishRegionPack,
} from './build-region-pack.mjs';
import { verifyRegionPack } from '../src/regions/pack.js';
const properties = {
  kind: 'road',
  name: 'Rajpur Road',
  aliases: ['राजपुर रोड'],
  osmId: '123',
  osmType: 'way',
  category: 'primary',
  heightM: null,
  heightSource: null,
};
const collection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'way/123',
      properties,
      geometry: {
        type: 'LineString',
        coordinates: [
          [78.04, 30.32],
          [78.05, 30.33],
        ],
      },
    },
  ],
};
test('builder emits independently verifiable geometry and local name index with reproducible hashes', async () => {
  const metadata = {
    extractAt: '2026-11-05T21:23:02Z',
    retrievedAt: '2026-11-07T12:00:00Z',
    extractSha256: 'b'.repeat(64),
  };
  const first = buildRegionArtifacts(collection, metadata),
    second = buildRegionArtifacts(collection, metadata);
  assert.deepEqual(first.manifest, second.manifest);
  const verified = await verifyRegionPack(first.manifest, first.assets);
  assert.equal(verified.index.entries[0].name, 'Rajpur Road');
  assert.equal(verified.manifest.counts.roads, 1);
  assert.equal(verified.manifest.counts.suppliedHeights, 0);
  assert.deepEqual(verified.index.entries[0].coordinates, [78.045, 30.325]);
});
test('builder refuses absent or non-PBF input before invoking Python or downloading', async () => {
  await assert.rejects(
    buildRegionPack({
      input: 'https://example.com/file',
      output: '/tmp/unused',
    }),
    /local/,
  );
  await assert.rejects(
    buildRegionPack({
      input: '/tmp/does-not-exist.osm.pbf',
      output: '/tmp/unused',
    }),
    /ENOENT/,
  );
});

test(
  'the optional isolated PyOsmium builder crops real PBF geometry and publishes a verified pack',
  { skip: !process.env.AUREL_PYOSMIUM },
  async () => {
    const { promises: fs } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aurel-region-test-'));
    try {
      const input = path.join(temp, 'fixture.osm.pbf'),
        output = path.join(temp, 'pack');
      await promisify(execFile)(process.env.AUREL_PYOSMIUM, [
        '-c',
        `
import osmium,sys
header=osmium.io.Header()
header.set('osmosis_replication_timestamp','2026-11-05T21:23:02Z')
with osmium.SimpleWriter(sys.argv[1],header=header) as writer:
 for id,loc in [(1,(78.04,30.32)),(2,(78.041,30.32)),(3,(78.041,30.321)),(4,(78.04,30.321))]:
  writer.add_node(osmium.osm.mutable.Node(id=id,location=loc))
 writer.add_way(osmium.osm.mutable.Way(id=123,nodes=[1,2,3,4,1],tags={'building':'yes','name':'Mapped building','height':'12 m'}))
 writer.add_way(osmium.osm.mutable.Way(id=124,nodes=[1,2],tags={'highway':'residential','name':'Mapped road'}))
 writer.add_way(osmium.osm.mutable.Way(id=125,nodes=[1,2,3,4,1],tags={'building':'yes','building:levels':'3'}))
`,
        input,
      ]);
      const manifest = await buildRegionPack({
        input,
        output,
        python: process.env.AUREL_PYOSMIUM,
      });
      assert.match(
        await fs.readFile(path.join(output, 'LICENSE.txt'), 'utf8'),
        /ODbL/,
      );
      const assets = Object.fromEntries(
        await Promise.all(
          manifest.assets.map(async (asset) => [
            asset.id,
            new Uint8Array(await fs.readFile(path.join(output, asset.path))),
          ]),
        ),
      );
      const verified = await verifyRegionPack(manifest, assets);
      assert.equal(verified.manifest.counts.buildings, 2);
      assert.equal(
        verified.geojson.features.find((f) => f.id === 'way/125').properties
          .heightM,
        null,
      );
      assert.equal(verified.manifest.counts.roads, 1);
      assert.equal(verified.manifest.counts.suppliedHeights, 1);
      assert.equal(
        verified.geojson.features.find((f) => f.properties.kind === 'building')
          .properties.heightM,
        12,
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);

test('publication stages and verifies all bytes before swapping; asset and commit failures preserve the previous pack', async () => {
  const { promises: fs } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aurel-region-publication-'),
    ),
    output = path.join(temp, 'pack');
  const result = buildRegionArtifacts(collection, {
    extractAt: '2026-11-05T21:23:02Z',
    retrievedAt: '2026-11-07T12:00:00Z',
    extractSha256: 'b'.repeat(64),
  });
  try {
    await publishRegionPack(result, output);
    const oldManifest = await fs.readFile(
      path.join(output, 'manifest.json'),
      'utf8',
    );
    const replacement = buildRegionArtifacts(
      {
        ...collection,
        features: collection.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            name: 'Changed generation road',
          },
        })),
      },
      {
        ...result.manifest.source,
        extractSha256: result.manifest.source.extractSha256,
      },
    );
    assert.notEqual(
      replacement.manifest.assets[0].sha256,
      result.manifest.assets[0].sha256,
    );
    for (const stage of ['write', 'integrity', 'commit']) {
      let failed = false;
      const fileSystem = {
        ...fs,
        writeFile: async (file, bytes, ...args) => {
          if (file.includes('.stage-') && file.endsWith('names.json')) {
            if (stage === 'write') throw new Error('injected asset write');
            if (stage === 'integrity') return fs.writeFile(file, '{}', ...args);
          }
          return fs.writeFile(file, bytes, ...args);
        },
        rename: async (from, to) => {
          if (
            stage === 'commit' &&
            !failed &&
            from.includes('.stage-') &&
            to === output
          ) {
            failed = true;
            throw new Error('injected commit rename');
          }
          return fs.rename(from, to);
        },
      };
      await assert.rejects(
        publishRegionPack(replacement, output, { fileSystem }),
      );
      assert.equal(
        await fs.readFile(path.join(output, 'manifest.json'), 'utf8'),
        oldManifest,
      );
      const assets = Object.fromEntries(
        await Promise.all(
          result.manifest.assets.map(async (asset) => [
            asset.id,
            new Uint8Array(await fs.readFile(path.join(output, asset.path))),
          ]),
        ),
      );
      await verifyRegionPack(JSON.parse(oldManifest), assets);
      assert.deepEqual(await fs.readdir(temp), ['pack']);
    }
    const updated = {
      ...result,
      manifest: { ...result.manifest, name: 'Updated region' },
    };
    await publishRegionPack(updated, output);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'))
        .name,
      'Updated region',
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('publication refuses an unrelated output directory and never follows an output symlink', async () => {
  const { promises: fs } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aurel-region-preserve-'),
    ),
    output = path.join(temp, 'pack');
  const result = buildRegionArtifacts(collection, {
    extractAt: '2026-11-05T21:23:02Z',
    retrievedAt: '2026-11-07T12:00:00Z',
    extractSha256: 'b'.repeat(64),
  });
  try {
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, 'personal-notes.txt'), 'preserve');
    await assert.rejects(publishRegionPack(result, output), /unrelated/);
    assert.equal(
      await fs.readFile(path.join(output, 'personal-notes.txt'), 'utf8'),
      'preserve',
    );
    const alias = path.join(temp, 'alias');
    await fs.symlink(output, alias, 'dir');
    await assert.rejects(publishRegionPack(result, alias), /directory/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('a failed rollback retains the complete prior generation and reports its recovery path', async () => {
  const { promises: fs } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aurel-region-rollback-'),
    ),
    output = path.join(temp, 'pack');
  const result = buildRegionArtifacts(collection, {
    extractAt: '2026-11-05T21:23:02Z',
    retrievedAt: '2026-11-07T12:00:00Z',
    extractSha256: 'b'.repeat(64),
  });
  try {
    await publishRegionPack(result, output);
    let failure;
    const fileSystem = {
      ...fs,
      rename: async (from, to) => {
        if (to === output)
          throw new Error('injected commit or rollback failure');
        return fs.rename(from, to);
      },
    };
    try {
      await publishRegionPack(result, output, { fileSystem });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure?.backupPath);
    assert.match(failure.message, /previous pack preserved/);
    const old = JSON.parse(
      await fs.readFile(path.join(failure.backupPath, 'manifest.json'), 'utf8'),
    );
    const assets = Object.fromEntries(
      await Promise.all(
        old.assets.map(async (asset) => [
          asset.id,
          new Uint8Array(
            await fs.readFile(path.join(failure.backupPath, asset.path)),
          ),
        ]),
      ),
    );
    await verifyRegionPack(old, assets);
    await fs.rename(failure.backupPath, output);
    assert.deepEqual(await fs.readdir(temp), ['pack']);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
