import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { createFieldbookRepository } from './repository.js';
import { createFieldbook } from './document.js';
import { captureComparison } from './comparisonOperations.js';
import { comparisonSnapshot } from './comparisonFixtures.mjs';

test('unavailable or denied IndexedDB never silently falls back or claims a save', async () => {
  const repo = createFieldbookRepository({ indexedDB: null });
  await assert.rejects(repo.list(), { code: 'STORAGE_UNAVAILABLE' });
  await assert.rejects(
    repo.save(createFieldbook({ id: 'test', title: 'Test' }), {
      expectedRevision: null,
    }),
    { code: 'STORAGE_UNAVAILABLE' },
  );
  repo.close();
  await assert.rejects(repo.list(), { code: 'CLOSED' });
});

test('native IndexedDB saves atomically, detects two-tab conflicts and preserves corrupt records', async (t) => {
  const root = process.cwd();
  const server = createServer(async (request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname;
    if (name === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Fieldbook storage fixture</title>');
      return;
    }
    const file = path.resolve(root, `.${name}`);
    if (
      !file.startsWith(path.join(root, 'src') + path.sep) ||
      !file.endsWith('.js')
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { createFieldbookRepository } =
      await import('/src/fieldbook/repository.js');
    const { createFieldbook } = await import('/src/fieldbook/document.js');
    const { renameFieldbook } = await import('/src/fieldbook/operations.js');
    const dbName = 'fieldbook-repository-fixture';
    const left = createFieldbookRepository({ dbName });
    const right = createFieldbookRepository({ dbName });
    const created = createFieldbook({ id: 'project-1', title: 'Dehradun' });
    const saved = await left.save(created, { expectedRevision: null });
    const secondRead = await right.get(saved.id);
    const races = await Promise.allSettled([
      left.save(renameFieldbook(saved, 'Left'), { expectedRevision: 1 }),
      right.save(renameFieldbook(secondRead, 'Right'), { expectedRevision: 1 }),
    ]);
    const winning = await left.get(saved.id);
    const loser = races.find((entry) => entry.status === 'rejected');
    const beforeInvalid = JSON.stringify(winning);
    let invalidCode;
    try {
      await right.save({ ...winning, title: '' }, { expectedRevision: 2 });
    } catch (error) {
      invalidCode = error.code;
    }
    const afterInvalid = JSON.stringify(await left.get(saved.id));
    const connection = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const { analyses, comparisons, changeNotes, ...legacy } = createFieldbook({
      id: 'legacy-v1',
      title: 'Old fieldbook',
    });
    legacy.version = 1;
    legacy.revision = 4;
    await new Promise((resolve, reject) => {
      const tx = connection.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(legacy);
      tx.objectStore('projects').put({
        ...legacy,
        id: 'legacy-v2',
        version: 2,
        analyses: [],
      });
      tx.objectStore('projects').put({
        id: 'corrupt',
        invalid: 'RECOVERY_SENTINEL',
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    const migrated = await left.get(legacy.id);
    const migratedV2 = await left.get('legacy-v2');
    const rawLegacy = await new Promise((resolve) => {
      const request = connection
        .transaction('projects')
        .objectStore('projects')
        .get(legacy.id);
      request.onsuccess = () => resolve(request.result);
    });
    const migratedSaved = await left.save(
      renameFieldbook(migrated, 'Explicitly upgraded'),
      { expectedRevision: 4 },
    );
    let corruptCode;
    let recoverable;
    try {
      await left.get('corrupt');
    } catch (error) {
      corruptCode = error.code;
      recoverable = error.original;
    }
    const listed = await left.list();
    const raw = await new Promise((resolve) => {
      const request = connection
        .transaction('projects')
        .objectStore('projects')
        .get('corrupt');
      request.onsuccess = () => resolve(request.result);
    });
    connection.close();
    left.close();
    right.close();
    const reopened = createFieldbookRepository({ dbName });
    const persisted = await reopened.get(saved.id);
    reopened.close();
    return {
      initialRevision: saved.revision,
      originalRevision: created.revision,
      raceStatuses: races.map((entry) => entry.status),
      conflictCode: loser?.reason?.code,
      conflictRevision: loser?.reason?.latest?.revision,
      latestRevision: winning.revision,
      invalidCode,
      invalidUnchanged: beforeInvalid === afterInvalid,
      corruptCode,
      recoverable,
      raw,
      listedIds: listed.projects.map((entry) => entry.id),
      corruptIds: listed.corrupt.map((entry) => entry.id),
      persisted: persisted.title === winning.title,
      migration: {
        readVersion: migrated.version,
        rawVersion: rawLegacy.version,
        readRevision: migrated.revision,
        analyses: migrated.analyses,
        savedVersion: migratedSaved.version,
        savedRevision: migratedSaved.revision,
      },
      migrationV2: {
        version: migratedV2.version,
        revision: migratedV2.revision,
        analyses: migratedV2.analyses,
        comparisons: migratedV2.comparisons,
      },
    };
  });
  assert.equal(result.initialRevision, 1);
  assert.equal(result.originalRevision, 0);
  assert.deepEqual(result.raceStatuses.sort(), ['fulfilled', 'rejected']);
  assert.equal(result.conflictCode, 'CONFLICT');
  assert.equal(result.conflictRevision, 2);
  assert.equal(result.latestRevision, 2);
  assert.equal(result.invalidCode, 'INVALID_DOCUMENT');
  assert.equal(result.invalidUnchanged, true);
  assert.equal(result.corruptCode, 'CORRUPT_DOCUMENT');
  assert.equal(result.recoverable.invalid, 'RECOVERY_SENTINEL');
  assert.equal(result.raw.invalid, 'RECOVERY_SENTINEL');
  assert.deepEqual(result.listedIds.sort(), [
    'legacy-v1',
    'legacy-v2',
    'project-1',
  ]);
  assert.deepEqual(result.corruptIds, ['corrupt']);
  assert.equal(result.persisted, true);
  assert.deepEqual(result.migration, {
    readVersion: 3,
    rawVersion: 1,
    readRevision: 4,
    analyses: [],
    savedVersion: 3,
    savedRevision: 5,
  });
  assert.deepEqual(result.migrationV2, {
    version: 3,
    revision: 4,
    analyses: [],
    comparisons: [],
  });
});

/** Fault-injection fixture only; the separate Chromium test proves native CAS. */
function fakeFactory({
  records = new Map(),
  openError,
  blocked = false,
  transactionError,
  writeError,
  asyncWriteError = false,
} = {}) {
  let closeCount = 0;
  let lastDb;
  const factory = {
    records,
    get closeCount() {
      return closeCount;
    },
    get db() {
      return lastDb;
    },
    open() {
      const request = {};
      const db = {
        objectStoreNames: { contains: () => false },
        createObjectStore() {},
        close() {
          closeCount++;
        },
        transaction() {
          if (transactionError) throw transactionError;
          let pending = 0;
          let aborted = false;
          const tx = {
            error: null,
            abort() {
              aborted = true;
              queueMicrotask(() => tx.onabort?.());
            },
          };
          const run = (request, value) => {
            pending++;
            queueMicrotask(() => {
              if (aborted) return;
              request.result = value();
              request.onsuccess?.();
              pending--;
              queueMicrotask(() => {
                if (!pending && !aborted) tx.oncomplete?.();
              });
            });
            return request;
          };
          const store = {
            get: (key) => run({}, () => records.get(key)),
            count: () => run({}, () => records.size),
            put(value) {
              if (writeError) {
                if (!asyncWriteError) throw writeError;
                pending++;
                queueMicrotask(() => {
                  tx.error = writeError;
                  tx.onerror?.();
                  tx.abort();
                });
                return {};
              }
              records.set(value.id, structuredClone(value));
              return {};
            },
            openCursor() {
              const entries = [...records.entries()];
              let index = 0;
              const request = {};
              const current = () =>
                index >= entries.length
                  ? null
                  : {
                      key: entries[index][0],
                      value: entries[index][1],
                      continue() {
                        index++;
                        run(request, current);
                      },
                    };
              return run(request, current);
            },
          };
          tx.objectStore = () => store;
          return tx;
        },
      };
      lastDb = db;
      request.result = db;
      queueMicrotask(() => {
        if (openError) {
          request.error = openError;
          request.onerror?.();
          return;
        }
        if (blocked) {
          request.onblocked?.();
          request.onsuccess?.();
          return;
        }
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return factory;
}

test('storage errors are actionable and failed writes never mutate the draft', async () => {
  const original = createFieldbook({ id: 'draft', title: 'Unsaved' });
  for (const asyncWriteError of [false, true]) {
    const factory = fakeFactory({
      writeError: new DOMException(
        'sensitive provider detail',
        'QuotaExceededError',
      ),
      asyncWriteError,
    });
    const repo = createFieldbookRepository({ indexedDB: factory });
    await assert.rejects(
      repo.save(original, { expectedRevision: null }),
      (error) =>
        error.code === 'STORAGE_FULL' && !error.message.includes('sensitive'),
    );
    assert.equal(factory.records.size, 0);
    assert.equal(original.revision, 0);
    repo.close();
  }
  for (const options of [
    { openError: new DOMException('blocked', 'SecurityError') },
    { transactionError: new Error('unavailable') },
  ]) {
    const repo = createFieldbookRepository({ indexedDB: fakeFactory(options) });
    await assert.rejects(repo.list(), { code: 'STORAGE_UNAVAILABLE' });
    repo.close();
  }
});

test('blocked upgrades and disposal close late connections without saving', async () => {
  const blocked = fakeFactory({ blocked: true });
  const repo = createFieldbookRepository({ indexedDB: blocked });
  await assert.rejects(repo.list(), { code: 'STORAGE_BLOCKED' });
  assert.equal(blocked.closeCount, 1);
  repo.close();
  const factory = fakeFactory();
  const closing = createFieldbookRepository({ indexedDB: factory });
  const opening = closing.list();
  closing.close();
  closing.close();
  await assert.rejects(opening, { code: 'CLOSED' });
  assert.equal(factory.closeCount, 1);
});

test('revision requirements prevent blind saves, missing reads are explicit and list is metadata only', async () => {
  const factory = fakeFactory();
  const repo = createFieldbookRepository({ indexedDB: factory });
  const draft = createFieldbook({ id: 'draft', title: 'Local' });
  await assert.rejects(repo.save(draft), { code: 'REVISION_REQUIRED' });
  await assert.rejects(repo.save(draft, { expectedRevision: 2 }), {
    code: 'REVISION_MISMATCH',
  });
  assert.equal(await repo.get('missing'), null);
  const saved = await repo.save(draft, { expectedRevision: null });
  await assert.rejects(repo.save(saved, { expectedRevision: null }), {
    code: 'REVISION_MISMATCH',
  });
  const list = await repo.list({ archived: false });
  assert.equal(list.projects[0].id, draft.id);
  assert.equal(list.projects[0].counts.attachments, 0);
  assert.equal(Object.hasOwn(list.projects[0], 'attachments'), false);
  assert.deepEqual((await repo.list({ archived: true })).projects, []);
  factory.db.onversionchange();
  assert.equal((await repo.get(draft.id)).revision, 1);
  assert.ok(factory.closeCount >= 1);
  repo.close();
});

test('project count limits bound enumeration and reject new writes without replacing existing work', async () => {
  const { FIELDBOOK_LIMITS } = await import('./document.js');
  const records = new Map(
    Array.from({ length: FIELDBOOK_LIMITS.projects }, (_, index) => {
      const value = {
        ...createFieldbook({ id: `p-${index}`, title: 'Local' }),
        revision: 1,
      };
      return [value.id, value];
    }),
  );
  const repo = createFieldbookRepository({
    indexedDB: fakeFactory({ records }),
  });
  await assert.rejects(
    repo.save(createFieldbook({ id: 'extra', title: 'Extra' }), {
      expectedRevision: null,
    }),
    { code: 'STORAGE_LIMIT' },
  );
  assert.equal(records.size, FIELDBOOK_LIMITS.projects);
  const first = await repo.get('p-0');
  assert.equal((await repo.save(first, { expectedRevision: 1 })).revision, 2);
  records.set('corrupt-extra', { id: 'corrupt-extra' });
  await assert.rejects(repo.list(), { code: 'STORAGE_LIMIT' });
  repo.close();
});

test('saved dated inputs and cited evidence cannot be rewritten under existing IDs', async () => {
  const repo = createFieldbookRepository({ indexedDB: fakeFactory() });
  const initial = captureComparison(
    createFieldbook(),
    {
      name: 'Dehradun',
      geometry: { type: 'Point', coordinates: [78.0438, 30.3258] },
    },
    comparisonSnapshot(),
  ).project;
  const saved = await repo.save(initial, { expectedRevision: null });
  const changed = structuredClone(saved);
  changed.comparisons[0].snapshot.before.sourceLabel = 'Changed provenance';
  changed.evidence.find(
    (entry) => entry.id === changed.comparisons[0].snapshot.before.evidenceId,
  ).sourceLabel = 'Changed provenance';
  await assert.rejects(repo.save(changed, { expectedRevision: 1 }), {
    code: 'INVALID_DOCUMENT',
  });
  assert.deepEqual(await repo.get(saved.id), saved);
  const evidenceEdit = structuredClone(saved);
  evidenceEdit.evidence[0].feedState = 'stale';
  await assert.rejects(repo.save(evidenceEdit, { expectedRevision: 1 }), {
    code: 'INVALID_DOCUMENT',
  });
  assert.equal((await repo.get(saved.id)).revision, 1);
  repo.close();
});
