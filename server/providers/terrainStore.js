import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Disk store for the terrain point-height cache (server/providers/terrain.js).
 *
 * The cache used to rewrite its whole JSON file (up to ~8 MB) with
 * `JSON.stringify` every 15 s whenever any point changed, blocking the event
 * loop for every request while it ran. Here each point is one row in a
 * node:sqlite database, and a flush writes only the rows that changed since the
 * last one, in one transaction. Node 24 flags node:sqlite experimental; the
 * Nominatim gate already depends on it the same way.
 */

let sqlite = null;
/** node:sqlite, loaded on first use with its one experimental warning dropped. */
function sqliteModule() {
  if (sqlite) return sqlite;
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
    if (type === 'ExperimentalWarning' && /SQLite/.test(String(warning)))
      return;
    return emitWarning.call(this, warning, ...rest);
  };
  try {
    sqlite = process.getBuiltinModule('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
  return sqlite;
}

/**
 * The database path for a legacy JSON cache path: same name, `.sqlite`.
 * @param {string} jsonPath
 * @returns {string}
 */
export function terrainStorePath(jsonPath) {
  const ext = path.extname(jsonPath);
  const base = ext === '.json' ? jsonPath.slice(0, -ext.length) : jsonPath;
  return `${base}.sqlite`;
}

/**
 * Open (creating if needed) the point store. Returns null when the file
 * cannot be opened as a database; the caller then keeps the cache in memory.
 * @param {string} file
 */
export function openTerrainStore(file) {
  let db;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    db = new (sqliteModule().DatabaseSync)(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS points (key TEXT PRIMARY KEY, at INTEGER NOT NULL, result TEXT NOT NULL)',
    );
    db.exec('CREATE INDEX IF NOT EXISTS points_at ON points (at)');
  } catch {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
    return null;
  }
  const upsert = db.prepare(
    'INSERT INTO points (key, at, result) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, result = excluded.result',
  );
  const remove = db.prepare('DELETE FROM points WHERE key = ?');
  const newest = db.prepare(
    'SELECT key, at, result FROM points ORDER BY at DESC LIMIT ?',
  );
  const counter = db.prepare('SELECT COUNT(*) AS n FROM points');

  return {
    /**
     * The newest `limit` points, oldest first (the cache's eviction order).
     * Rows that do not parse are skipped.
     * @param {number} limit
     * @returns {Array<[string, {at: number, result: object}]>}
     */
    loadNewest(limit) {
      const rows = newest.all(limit);
      const entries = [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const { key, at, result } = rows[i];
        try {
          entries.push([key, { at: Number(at), result: JSON.parse(result) }]);
        } catch {
          /* a damaged row is a cache miss */
        }
      }
      return entries;
    },

    /**
     * Apply changed and removed points in one transaction.
     * @param {Array<[string, {at: number, result: object}]>} upserts
     * @param {string[]} deletes
     */
    write(upserts, deletes) {
      db.exec('BEGIN');
      try {
        for (const key of deletes) remove.run(key);
        for (const [key, entry] of upserts)
          upsert.run(key, entry.at, JSON.stringify(entry.result));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    count: () => Number(counter.get().n),
    close: () => db.close(),
  };
}

/**
 * A Map that remembers which keys were set or deleted since the last
 * `takeChanges()`, so a flush can write just those.
 * @returns {Map<string, any> & {takeChanges: () => {upserts: Array<[string, any]>, deletes: string[]}}}
 */
export function createTrackedPointMap() {
  const changed = new Set();

  class TrackedPointMap extends Map {
    set(key, value) {
      changed.add(key);
      return super.set(key, value);
    }

    delete(key) {
      const had = super.delete(key);
      if (had) changed.add(key);
      return had;
    }

    clear() {
      for (const key of this.keys()) changed.add(key);
      super.clear();
    }

    takeChanges() {
      const upserts = [];
      const deletes = [];
      for (const key of changed) {
        if (super.has(key)) upserts.push([key, super.get(key)]);
        else deletes.push(key);
      }
      changed.clear();
      return { upserts, deletes };
    }
  }

  return new TrackedPointMap();
}
