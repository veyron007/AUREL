import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { createWatchlistRepository } from './repository.js';
test('unavailable watch storage fails closed', async () => {
  const repo = createWatchlistRepository({ indexedDB: null });
  await assert.rejects(repo.list());
  repo.close();
  await assert.rejects(repo.list());
});
test('native IndexedDB prevents concurrent tab leases and commits only current owners', async (t) => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') {
      res.end('<!doctype html><title>Watch test</title>');
      return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + '/src/') || !file.endsWith('.js')) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const { createWatchlistRepository } =
        await import('/src/watchlists/repository.js'),
      { createWatchDefinition } = await import('/src/watchlists/model.js');
    const left = createWatchlistRepository({
        dbName: 'watch-test',
        now: () => 1000000,
      }),
      right = createWatchlistRepository({
        dbName: 'watch-test',
        now: () => 1000000,
      });
    const definition = createWatchDefinition(
      {
        place: {
          id: 'p',
          name: 'Dehradun',
          geometry: { type: 'Point', coordinates: [78, 30] },
        },
      },
      { id: 'w', now: 1000000 },
    );
    await left.save(definition, { expectedRevision: null });
    const results = await Promise.allSettled([
      left.claim('w', 'left', 1000000),
      right.claim('w', 'right', 1000000),
    ]);
    const wins = results.filter((r) => r.status === 'fulfilled').length,
      record = await left.get('w');
    await left.renew('w', record.lease.ownerId, record.lease.token, 1000001);
    let editDenied = false;
    try {
      await left.save(
        { ...definition, title: 'Changed' },
        { expectedRevision: 1 },
      );
    } catch {
      editDenied = true;
    }
    let denied = false;
    try {
      await right.commit('w', 'wrong', 'wrong', record.runtime, 1000001);
    } catch {
      denied = true;
    }
    await left.commit(
      'w',
      record.lease.ownerId,
      record.lease.token,
      { ...record.runtime, lastAttemptAt: 1000001 },
      1000001,
    );
    let removeDenied = false;
    try {
      await right.remove('w');
    } catch {
      removeDenied = true;
    }
    await left.release('w', record.lease.ownerId, record.lease.token);
    const after = await right.get('w');
    await right.clearNotifications('w');
    let conflict = false;
    try {
      await right.save(definition, { expectedRevision: 9 });
    } catch {
      conflict = true;
    }
    await right.save(
      { ...definition, title: 'Renamed' },
      { expectedRevision: 1 },
    );
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('watch-test');
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction('watches', 'readwrite');
      tx.objectStore('watches').put({ definition: { id: 'corrupt' } });
      tx.oncomplete = resolve;
    });
    const corrupted = (await right.list()).corrupt.length;
    let preserved = false;
    try {
      await right.get('corrupt');
    } catch (e) {
      preserved =
        e.code === 'CORRUPT' && e.original.definition.id === 'corrupt';
    }
    await new Promise((resolve) => {
      const tx = db.transaction('watches', 'readwrite');
      tx.objectStore('watches').delete('corrupt');
      tx.oncomplete = resolve;
    });
    db.close();
    const errors = [];
    for (const action of [
      () => right.claim('missing', 'owner'),
      () => right.clearNotifications('missing'),
      () => right.claim('w', ''),
    ]) {
      try {
        await action();
      } catch (e) {
        errors.push(e.code);
      }
    }
    for (let i = 0; i < 7; i++)
      await right.save({ ...definition, id: `extra-${i}` });
    let limited = false;
    try {
      await right.save({ ...definition, id: 'too-many' });
    } catch (e) {
      limited = e.code === 'LIMIT';
    }
    for (let i = 0; i < 7; i++) await right.remove(`extra-${i}`);
    await right.release('w', 'wrong', 'wrong');
    await right.remove('w');
    const missing = await right.get('w');
    const remaining = (await right.list()).watches.length;
    left.close();
    right.close();
    return {
      wins,
      denied,
      removeDenied,
      afterLease: after.lease,
      lastAttemptAt: after.runtime.lastAttemptAt,
      remaining,
      editDenied,
      conflict,
      corrupted,
      preserved,
      errors,
      limited,
      missing,
    };
  });
  assert.deepEqual(result, {
    wins: 1,
    denied: true,
    removeDenied: true,
    afterLease: null,
    lastAttemptAt: 1000001,
    remaining: 0,
    editDenied: true,
    conflict: true,
    corrupted: 1,
    preserved: true,
    errors: ['MISSING', 'MISSING', 'INVALID'],
    limited: true,
    missing: null,
  });
  const entry = (await page.coverage.stopJSCoverage()).find((row) =>
    row.url.endsWith('/src/watchlists/repository.js'),
  );
  const covered = new Set();
  for (const range of entry.ranges)
    for (let i = range.start; i < range.end; i++)
      if (/\S/.test(entry.text[i])) covered.add(i);
  const ratio = covered.size / entry.text.replace(/\s/g, '').length;
  t.diagnostic(
    `Native IndexedDB executed-source coverage ${(ratio * 100).toFixed(1)}%`,
  );
  assert.ok(ratio >= 0.8);
});
