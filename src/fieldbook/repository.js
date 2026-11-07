/** Native IndexedDB persistence: one atomic revision comparison/write per save. */
import {
  validateFieldbook,
  migrateFieldbook,
  FIELDBOOK_LIMITS,
} from './document.js';
import { assertComparisonHistory } from './comparisonOperations.js';

export const FIELDBOOK_DATABASE = 'aurel.fieldbook.v1';
export class FieldbookStorageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldbookStorageError';
    this.code = code;
    Object.assign(this, details);
  }
}
const storageError = (error) =>
  new FieldbookStorageError(
    error?.name === 'QuotaExceededError'
      ? 'STORAGE_FULL'
      : 'STORAGE_UNAVAILABLE',
    error?.name === 'QuotaExceededError'
      ? 'Local storage is full. Keep the draft and export a backup.'
      : 'Local project storage is unavailable. Keep the draft and export a backup.',
  );
const detached = (value) => JSON.parse(JSON.stringify(value));
function validatedRecord(value) {
  if (value === undefined) return null;
  try {
    return detached(migrateFieldbook(value));
  } catch {
    throw new FieldbookStorageError(
      'CORRUPT_DOCUMENT',
      'Stored project needs recovery; its original data has not been changed.',
      { original: value },
    );
  }
}

/**
 * `save(project,{expectedRevision:null})` creates; a numeric expected revision
 * updates. Both are compared inside the readwrite transaction, including across
 * tabs. Rejected saves leave both the stored version and the caller's draft intact.
 * list returns {projects,corrupt}; corrupt original records remain recoverable.
 */
export function createFieldbookRepository(options = {}) {
  let pending = null;
  let closed = false;
  const dbName = options.dbName ?? FIELDBOOK_DATABASE;
  const open = () => {
    if (closed)
      return Promise.reject(
        new FieldbookStorageError('CLOSED', 'Project storage is closed.'),
      );
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      let request;
      let failed = false;
      try {
        const factory = Object.hasOwn(options, 'indexedDB')
          ? options.indexedDB
          : globalThis.indexedDB;
        if (!factory?.open) throw new Error('Unavailable');
        request = factory.open(dbName, 1);
      } catch (error) {
        reject(storageError(error));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects'))
          db.createObjectStore('projects', { keyPath: 'id' });
      };
      request.onerror = () => {
        failed = true;
        reject(storageError(request.error));
      };
      request.onblocked = () => {
        failed = true;
        reject(
          new FieldbookStorageError(
            'STORAGE_BLOCKED',
            'Another tab is holding project storage open. Keep the draft and retry after closing that tab.',
          ),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        if (closed || failed) {
          db.close();
          if (closed)
            reject(
              new FieldbookStorageError('CLOSED', 'Project storage is closed.'),
            );
          return;
        }
        db.onversionchange = () => {
          db.close();
          pending = null;
        };
        resolve(db);
      };
    }).catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  const transaction = async (mode, execute) => {
    const db = await open();
    if (closed)
      throw new FieldbookStorageError('CLOSED', 'Project storage is closed.');
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let failure;
      const abort = (error) => {
        failure = error;
        try {
          tx.abort();
        } catch {
          reject(error);
        }
      };
      try {
        tx = db.transaction('projects', mode);
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure ?? storageError(tx.error));
        tx.onerror = () => {
          if (!failure) failure = storageError(tx.error);
        };
        execute(
          tx.objectStore('projects'),
          (value) => {
            result = value;
          },
          abort,
        );
      } catch (error) {
        if (tx)
          abort(
            error instanceof FieldbookStorageError
              ? error
              : storageError(error),
          );
        else reject(storageError(error));
      }
    });
  };
  async function get(projectId) {
    return transaction('readonly', (store, result, abort) => {
      const request = store.get(projectId);
      request.onsuccess = () => {
        try {
          result(validatedRecord(request.result));
        } catch (error) {
          abort(error);
        }
      };
    });
  }
  async function list({ archived } = {}) {
    return transaction('readonly', (store, result, abort) => {
      const projects = [];
      const corrupt = [];
      let count = 0;
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          projects.sort(
            (a, b) =>
              b.updatedAt.localeCompare(a.updatedAt) ||
              a.id.localeCompare(b.id),
          );
          result({ projects, corrupt });
          return;
        }
        if (++count > FIELDBOOK_LIMITS.projects) {
          abort(
            new FieldbookStorageError(
              'STORAGE_LIMIT',
              'The project list exceeds its supported size. Existing projects have not been changed.',
            ),
          );
          return;
        }
        try {
          const record = migrateFieldbook(cursor.value);
          if (
            typeof archived !== 'boolean' ||
            Boolean(record.archivedAt) === archived
          ) {
            const { id, title, createdAt, updatedAt, revision, archivedAt } =
              record;
            projects.push({
              id,
              title,
              createdAt,
              updatedAt,
              revision,
              archivedAt,
              counts: {
                places: record.places.length,
                notes: record.notes.length,
                evidence: record.evidence.length,
                routes: record.routes.length,
                drawings: record.drawings.length,
                attachments: record.attachments.length,
                scenes: record.sceneDocuments.length,
                analyses: record.analyses.length,
                comparisons: record.comparisons.length,
                changeNotes: record.changeNotes.length,
              },
            });
          }
        } catch {
          corrupt.push({
            id: typeof cursor.key === 'string' ? cursor.key : null,
            code: 'CORRUPT_DOCUMENT',
          });
        }
        cursor.continue();
      };
    });
  }
  async function save(project, { expectedRevision } = {}) {
    validateFieldbook(project);
    if (
      expectedRevision !== null &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    )
      throw new FieldbookStorageError(
        'REVISION_REQUIRED',
        'Saving requires the last known revision.',
      );
    if (
      (expectedRevision === null && project.revision !== 0) ||
      (expectedRevision !== null && project.revision !== expectedRevision)
    )
      throw new FieldbookStorageError(
        'REVISION_MISMATCH',
        'The draft does not match the expected saved revision.',
      );
    const candidate = detached(project);
    return transaction('readwrite', (store, result, abort) => {
      const request = store.get(candidate.id);
      request.onsuccess = () => {
        try {
          const current = validatedRecord(request.result);
          if ((current?.revision ?? null) !== expectedRevision) {
            abort(
              new FieldbookStorageError(
                'CONFLICT',
                'Another tab saved this project. Keep this draft, then reload or save it as a copy.',
                { latest: current },
              ),
            );
            return;
          }
          const write = () => {
            try {
              assertComparisonHistory(current, candidate);
              const saved = validateFieldbook({
                ...candidate,
                revision: (current?.revision ?? 0) + 1,
              });
              store.put(saved);
              result(detached(saved));
            } catch (error) {
              abort(
                error instanceof FieldbookStorageError ||
                  error?.code === 'INVALID_DOCUMENT'
                  ? error
                  : storageError(error),
              );
            }
          };
          if (current) write();
          else {
            const count = store.count();
            count.onsuccess = () => {
              if (count.result >= FIELDBOOK_LIMITS.projects)
                abort(
                  new FieldbookStorageError(
                    'STORAGE_LIMIT',
                    'The local project limit has been reached. Export this draft or update an existing project.',
                  ),
                );
              else write();
            };
          }
        } catch (error) {
          abort(
            error instanceof FieldbookStorageError ||
              error?.code === 'INVALID_DOCUMENT'
              ? error
              : storageError(error),
          );
        }
      };
    });
  }
  function close() {
    if (closed) return;
    closed = true;
    pending?.then(
      (db) => db.close(),
      () => {},
    );
  }
  return { get, list, save, close };
}
