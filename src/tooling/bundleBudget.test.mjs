import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkBundleBudget,
  compareToBudget,
  findEntry,
  parseBudget,
  startupFiles,
  staticImportKeys,
} from '../../scripts/check-bundle-budget.mjs';

const KIB = 1024;
const ADDED_IMPORT_BYTES = 200 * KIB;

const MANIFEST = Object.freeze({
  'index.html': {
    file: 'assets/index.js',
    isEntry: true,
    imports: ['_shared.js'],
    dynamicImports: ['src/lazy.js'],
    css: ['assets/index.css'],
  },
  '_shared.js': {
    file: 'assets/shared.js',
    imports: ['_leaf.js'],
    css: ['assets/shared.css'],
  },
  '_leaf.js': { file: 'assets/leaf.js', imports: ['_shared.js'] },
  'src/lazy.js': {
    file: 'assets/lazy.js',
    isDynamicEntry: true,
    css: ['assets/lazy.css'],
  },
});

/** Write a tiny build: entry JS, entry CSS and optionally a static import. */
function writeBuild(root, { staticImportBytes = 0 } = {}) {
  const dist = path.join(root, 'dist');
  mkdirSync(path.join(dist, '.vite'), { recursive: true });
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  const entry = {
    file: 'assets/index.js',
    isEntry: true,
    css: ['assets/index.css'],
  };
  const manifest = staticImportBytes
    ? {
        'index.html': { ...entry, imports: ['_big.js'] },
        '_big.js': { file: 'assets/big.js' },
      }
    : { 'index.html': entry };
  writeFileSync(
    path.join(dist, '.vite/manifest.json'),
    JSON.stringify(manifest),
  );
  writeFileSync(path.join(dist, 'assets/index.js'), 'x'.repeat(10 * KIB));
  writeFileSync(path.join(dist, 'assets/index.css'), 'a{}'.repeat(KIB));
  // Deterministic, poorly compressible bytes so gzip grows with the import too.
  const noise = Buffer.from(
    Array.from(
      { length: staticImportBytes },
      (_, index) => (index * 7919 + (index >> 3)) % 251,
    ),
  );
  if (staticImportBytes) writeFileSync(path.join(dist, 'assets/big.js'), noise);
  return dist;
}

/** Budget at the baseline's measured sizes plus 3%, rounded up to whole KiB. */
function writeBudgetFor(root, sizes) {
  const up = (bytes) => Math.max(KIB, Math.ceil((bytes * 1.03) / KIB) * KIB);
  const budget = Object.fromEntries(
    Object.entries(sizes).map(([category, size]) => [
      category,
      { bytes: up(size.bytes), gzipBytes: up(size.gzipBytes) },
    ]),
  );
  const file = path.join(root, 'budget.json');
  writeFileSync(file, JSON.stringify(budget));
  return file;
}

test('the startup graph follows static imports transitively, never lazy chunks', () => {
  assert.equal(findEntry(MANIFEST)[0], 'index.html');
  assert.deepEqual(staticImportKeys(MANIFEST, 'index.html'), [
    '_leaf.js',
    '_shared.js',
  ]);
  assert.deepEqual(
    { ...startupFiles(MANIFEST) },
    {
      entryJs: ['assets/index.js'],
      staticImportsJs: ['assets/leaf.js', 'assets/shared.js'],
      entryCss: ['assets/index.css', 'assets/shared.css'],
    },
  );
});

test('a manifest without one HTML entry or with a dangling import is an error', () => {
  assert.throws(() => findEntry({}), /Expected one HTML entry/);
  assert.throws(
    () =>
      staticImportKeys(
        { 'index.html': { isEntry: true, imports: ['_gone.js'] } },
        'index.html',
      ),
    /_gone\.js has no chunk/,
  );
});

test('budget files must give every category a nonnegative integer limit', () => {
  assert.throws(() => parseBudget({}), /entryJs\.bytes/);
  assert.throws(
    () =>
      parseBudget({
        entryJs: { bytes: 1, gzipBytes: 1 },
        staticImportsJs: { bytes: -1, gzipBytes: 1 },
        entryCss: { bytes: 1, gzipBytes: 1 },
      }),
    /staticImportsJs\.bytes/,
  );
});

test('only sizes above their limit are reported', () => {
  const size = (bytes) => ({ bytes, gzipBytes: bytes, files: 1 });
  const limit = (bytes) => ({ bytes, gzipBytes: bytes });
  const failures = compareToBudget(
    { entryJs: size(10), staticImportsJs: size(5), entryCss: size(3) },
    { entryJs: limit(10), staticImportsJs: limit(4), entryCss: limit(3) },
  );
  assert.deepEqual(failures, [
    'staticImportsJs.bytes is 5 bytes, budget 4 (+1)',
    'staticImportsJs.gzipBytes is 5 bytes, budget 4 (+1)',
  ]);
});

test('the gate passes on the baseline and fails when a 200 KB static import is added', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gev-bundle-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baselineDist = writeBuild(path.join(root, 'baseline'));
  await assert.rejects(
    checkBundleBudget({
      distDir: baselineDist,
      budgetFile: path.join(root, 'none.json'),
    }),
    /Cannot read the bundle budget/,
  );

  // Measure the baseline under a generous budget, then budget it at +3%.
  const { sizes } = await checkBundleBudget({
    distDir: baselineDist,
    budgetFile: writeBudgetFor(root, {
      entryJs: { bytes: 1e9, gzipBytes: 1e9 },
      staticImportsJs: { bytes: 1e9, gzipBytes: 1e9 },
      entryCss: { bytes: 1e9, gzipBytes: 1e9 },
    }),
  });
  const budgetFile = writeBudgetFor(root, sizes);

  const passing = await checkBundleBudget({
    distDir: baselineDist,
    budgetFile,
  });
  assert.deepEqual(passing.failures, []);

  const grown = await checkBundleBudget({
    distDir: writeBuild(path.join(root, 'grown'), {
      staticImportBytes: ADDED_IMPORT_BYTES,
    }),
    budgetFile,
  });
  assert.equal(grown.sizes.staticImportsJs.bytes, ADDED_IMPORT_BYTES);
  assert.match(
    grown.failures.join('\n'),
    /^staticImportsJs\.bytes is 204800 bytes/m,
  );
  assert.match(grown.failures.join('\n'), /staticImportsJs\.gzipBytes/);
});

test('a missing build names the command that produces it', async () => {
  await assert.rejects(
    checkBundleBudget({ distDir: path.join(tmpdir(), 'gev-no-such-dist') }),
    /Cannot read the Vite manifest .*run npm run build first/,
  );
});

test('the committed budget file is valid and covers every category', () => {
  const file = new URL('../../scripts/bundle-budget.json', import.meta.url);
  const budget = parseBudget(JSON.parse(readFileSync(file, 'utf8')));
  assert.ok(budget.entryJs.bytes > 0);
});
