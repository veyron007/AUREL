// Fails when the startup bundle grows past scripts/bundle-budget.json.
//
// Reads dist/.vite/manifest.json (build.manifest in build/vite.js) and measures
// the HTML entry chunk, every chunk it imports statically (transitively) and the
// CSS those chunks load, raw and gzip. Lazy chunks are not counted: they do not
// delay startup. Lower a budget when a work package shrinks the bundle.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGET_CATEGORIES = Object.freeze([
  'entryJs',
  'staticImportsJs',
  'entryCss',
]);
const MANIFEST_PATH = '.vite/manifest.json';
const SIZE_FIELDS = Object.freeze(['bytes', 'gzipBytes']);

/** Find the single HTML entry of a Vite manifest. */
export function findEntry(manifest) {
  const entries = Object.entries(manifest).filter(
    ([key, chunk]) => chunk?.isEntry && key.endsWith('.html'),
  );
  if (entries.length !== 1)
    throw new Error(
      `Expected one HTML entry in the manifest, found ${entries.length}`,
    );
  return entries[0];
}

/** Keys of every chunk the entry reaches through static imports, entry excluded. */
export function staticImportKeys(manifest, entryKey) {
  const seen = new Set([entryKey]);
  const pending = [...(manifest[entryKey].imports ?? [])];
  while (pending.length) {
    const key = pending.pop();
    if (seen.has(key)) continue;
    if (!manifest[key]) throw new Error(`Manifest import ${key} has no chunk`);
    seen.add(key);
    pending.push(...(manifest[key].imports ?? []));
  }
  seen.delete(entryKey);
  return [...seen].sort();
}

/** Output files per budget category for the manifest's startup graph. */
export function startupFiles(manifest) {
  const [entryKey, entry] = findEntry(manifest);
  const imports = staticImportKeys(manifest, entryKey);
  const css = [entryKey, ...imports].flatMap((key) => manifest[key].css ?? []);
  return Object.freeze({
    entryJs: [entry.file],
    staticImportsJs: imports.map((key) => manifest[key].file),
    entryCss: [...new Set(css)].sort(),
  });
}

/** Raw and gzip size of a set of files, read through `readBytes(file)`. */
export async function measureFiles(files, readBytes) {
  let totals = { bytes: 0, gzipBytes: 0 };
  for (const file of files) {
    const content = await readBytes(file);
    totals = {
      bytes: totals.bytes + content.length,
      gzipBytes: totals.gzipBytes + gzipSync(content).length,
    };
  }
  return Object.freeze({ ...totals, files: files.length });
}

/** Validate the budget file shape. */
export function parseBudget(document) {
  for (const category of BUDGET_CATEGORIES)
    for (const field of SIZE_FIELDS) {
      const limit = document?.[category]?.[field];
      if (!Number.isInteger(limit) || limit < 0)
        throw new Error(
          `Budget ${category}.${field} must be a nonnegative integer`,
        );
    }
  return document;
}

/** Every measured size over its budget, as readable messages. */
export function compareToBudget(sizes, budget) {
  return BUDGET_CATEGORIES.flatMap((category) =>
    SIZE_FIELDS.filter(
      (field) => sizes[category][field] > budget[category][field],
    ).map(
      (field) =>
        `${category}.${field} is ${sizes[category][field]} bytes, budget ${budget[category][field]} (+${sizes[category][field] - budget[category][field]})`,
    ),
  );
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/** One line per category: measured size against budget. */
export function formatReport(sizes, budget) {
  return BUDGET_CATEGORIES.map(
    (category) =>
      `${category}: ${sizes[category].files} files, ${formatKiB(sizes[category].bytes)} of ${formatKiB(budget[category].bytes)} raw, ${formatKiB(sizes[category].gzipBytes)} of ${formatKiB(budget[category].gzipBytes)} gzip`,
  ).join('\n');
}

async function readJson(file, what) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read ${what} at ${file} (${error.code}); run npm run build first`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${what} at ${file}: ${error.message}`);
  }
}

/** Measure a build directory against a budget file. */
export async function checkBundleBudget({
  distDir = 'dist',
  budgetFile = 'scripts/bundle-budget.json',
} = {}) {
  const manifest = await readJson(
    path.join(distDir, MANIFEST_PATH),
    'the Vite manifest',
  );
  const budget = parseBudget(await readJson(budgetFile, 'the bundle budget'));
  const files = startupFiles(manifest);
  const readBytes = (file) => readFile(path.join(distDir, file));
  const sizes = Object.fromEntries(
    await Promise.all(
      BUDGET_CATEGORIES.map(async (category) => [
        category,
        await measureFiles(files[category], readBytes),
      ]),
    ),
  );
  return { sizes, budget, failures: compareToBudget(sizes, budget) };
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  checkBundleBudget().then(
    ({ sizes, budget, failures }) => {
      console.log(formatReport(sizes, budget));
      if (failures.length) {
        console.error(`Bundle budget exceeded:\n${failures.join('\n')}`);
        process.exitCode = 1;
      }
    },
    (error) => {
      console.error(`[check:bundle] ${error.message}`);
      process.exitCode = 1;
    },
  );
}
