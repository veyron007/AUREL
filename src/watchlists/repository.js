/** One native IndexedDB transaction decides cross-tab leases and runtime writes. */
import {
  validateWatchDefinition,
  validateWatchRuntime,
  validateWatchRecord,
  emptyWatchRuntime,
  WATCH_LIMITS,
} from './model.js';
export const WATCHLIST_DATABASE = 'aurel.watchlists.v1';
const error = (code, message) => Object.assign(new Error(message), { code });
export function createWatchlistRepository(options = {}) {
  let connection,
    closed = false;
  const now = options.now || Date.now;
  function open() {
    if (closed)
      return Promise.reject(error('CLOSED', 'Watchlist storage is closed.'));
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      let request,
        failed = false;
      try {
        const factory = Object.hasOwn(options, 'indexedDB')
          ? options.indexedDB
          : globalThis.indexedDB;
        if (!factory?.open) throw Error();
        request = factory.open(options.dbName || WATCHLIST_DATABASE, 1);
      } catch {
        return reject(
          error(
            'STORAGE_UNAVAILABLE',
            'Local watchlist storage is unavailable.',
          ),
        );
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('watches'))
          request.result.createObjectStore('watches', {
            keyPath: 'definition.id',
          });
      };
      request.onerror = () => {
        failed = true;
        reject(
          error(
            'STORAGE_UNAVAILABLE',
            'Local watchlist storage is unavailable.',
          ),
        );
      };
      request.onblocked = () => {
        failed = true;
        reject(
          error(
            'STORAGE_BLOCKED',
            'Another tab is blocking watchlist storage.',
          ),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed || closed) {
          db.close();
          reject(error('CLOSED', 'Watchlist storage is closed.'));
          return;
        }
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
    });
    const active = connection;
    void active.catch(() => {
      if (connection === active) connection = null;
    });
    return active;
  }
  function record(value) {
    try {
      return value === undefined ? null : validateWatchRecord(value);
    } catch {
      throw Object.assign(
        error(
          'CORRUPT',
          'A local watchlist needs recovery; its original data was preserved.',
        ),
        { original: value },
      );
    }
  }
  async function read(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('watches', 'readonly'),
        req = tx.objectStore('watches').get(id);
      req.onsuccess = () => {
        try {
          resolve(record(req.result));
        } catch (e) {
          reject(e);
        }
      };
      req.onerror = () =>
        reject(
          error('STORAGE_UNAVAILABLE', 'Could not read local watchlists.'),
        );
    });
  }
  async function mutate(id, change) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('watches', 'readwrite'),
        store = tx.objectStore('watches');
      let result, reason;
      const count = store.count();
      count.onsuccess = () => {
        const get = store.get(id);
        get.onsuccess = () => {
          try {
            result = change(record(get.result), count.result);
            if (result === null) store.delete(id);
            else {
              result = validateWatchRecord(result);
              store.put(result);
            }
          } catch (e) {
            reason = e;
            tx.abort();
          }
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(
          reason ||
            error('STORAGE_UNAVAILABLE', 'The local watchlist write failed.'),
        );
      tx.onabort = () =>
        reject(
          reason ||
            error(
              'STORAGE_UNAVAILABLE',
              'The local watchlist write was cancelled.',
            ),
        );
    });
  }
  const live = (record, ownerId, token, clock) => {
    if (
      !record ||
      record.lease?.ownerId !== ownerId ||
      record.lease.token !== token ||
      record.lease.until <= clock
    )
      throw error('LEASE_LOST', 'Another tab owns this watchlist.');
  };
  const ownerText = (value) => {
    if (typeof value !== 'string' || !value || value.length > 160)
      throw error('INVALID', 'Invalid monitoring owner.');
  };
  return {
    async list() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('watches', 'readonly'),
          req = tx
            .objectStore('watches')
            .getAll(null, WATCH_LIMITS.definitions + 1);
        req.onsuccess = () => {
          const watches = [],
            corrupt = [];
          for (const value of req.result) {
            try {
              watches.push(record(value));
            } catch (e) {
              corrupt.push({ original: e.original });
            }
          }
          resolve({ watches, corrupt });
        };
        req.onerror = () =>
          reject(
            error('STORAGE_UNAVAILABLE', 'Could not list local watchlists.'),
          );
      });
    },
    get: read,
    save(value, { expectedRevision = null } = {}) {
      const definition = validateWatchDefinition(value);
      return mutate(definition.id, (old, count) => {
        if (old?.lease && old.lease.until > now())
          throw error(
            'OTHER_TAB',
            'Stop monitoring before editing this watchlist.',
          );
        if ((old?.definition.revision ?? null) !== expectedRevision)
          throw error(
            'CONFLICT',
            'This watchlist changed in another tab. Refresh and retry.',
          );
        if (!old && count >= WATCH_LIMITS.definitions)
          throw error('LIMIT', 'At most eight local watchlists are supported.');
        return {
          definition: {
            ...definition,
            revision: (old?.definition.revision || 0) + 1,
          },
          runtime: old?.runtime || emptyWatchRuntime(definition.kind),
          lease: null,
        };
      });
    },
    remove(id) {
      return mutate(id, (old) => {
        if (old?.lease && old.lease.until > now())
          throw error(
            'OTHER_TAB',
            'Stop monitoring before removing this watchlist.',
          );
        return null;
      });
    },
    claim(id, ownerId, clock = now()) {
      ownerText(ownerId);
      return mutate(id, (old) => {
        if (!old) throw error('MISSING', 'Watchlist not found.');
        if (
          old.lease &&
          old.lease.until > clock &&
          old.lease.ownerId !== ownerId
        )
          throw error('OTHER_TAB', 'This watchlist is running in another tab.');
        return {
          ...old,
          lease: {
            ownerId,
            token: globalThis.crypto.randomUUID(),
            until: clock + WATCH_LIMITS.leaseMs,
          },
        };
      });
    },
    renew(id, ownerId, token, clock = now()) {
      return mutate(id, (old) => {
        live(old, ownerId, token, clock);
        return {
          ...old,
          lease: { ...old.lease, until: clock + WATCH_LIMITS.leaseMs },
        };
      });
    },
    commit(id, ownerId, token, runtime, clock = now()) {
      const checked = validateWatchRuntime(runtime);
      return mutate(id, (old) => {
        live(old, ownerId, token, clock);
        const retained = new Set(
          old.runtime.notifications.map((note) => note.id),
        );
        return {
          ...old,
          runtime: {
            ...checked,
            notifications: checked.notifications.filter(
              (note) =>
                retained.has(note.id) ||
                Date.parse(note.createdAt) >= checked.lastAttemptAt,
            ),
          },
        };
      });
    },
    release(id, ownerId, token) {
      return mutate(id, (old) =>
        old && old.lease?.ownerId === ownerId && old.lease.token === token
          ? { ...old, lease: null }
          : old,
      );
    },
    clearNotifications(id) {
      return mutate(id, (old) => {
        if (!old) throw error('MISSING', 'Watchlist not found.');
        return { ...old, runtime: { ...old.runtime, notifications: [] } };
      });
    },
    close() {
      closed = true;
      connection?.then((db) => db.close()).catch(() => {});
    },
  };
}
