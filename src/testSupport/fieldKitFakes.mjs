/**
 * In-memory stand-ins for the Fieldbook and Watchlist repositories with the
 * same revision semantics as the IndexedDB ones: a save names the revision
 * it expects and fails with CONFLICT otherwise.
 */
import { validateFieldbook } from '../fieldbook/document.js';
import { validateWatchDefinition } from '../watchlists/model.js';

export function memoryFieldbookRepository() {
  const records = new Map();
  return {
    records,
    async get(id) {
      const value = records.get(id);
      return value ? structuredClone(value) : null;
    },
    async list() {
      return {
        projects: [...records.values()].map((value) => structuredClone(value)),
        corrupt: [],
      };
    },
    async save(project, { expectedRevision } = {}) {
      validateFieldbook(project);
      const current = records.get(project.id);
      if ((current?.revision ?? null) !== expectedRevision)
        throw Object.assign(new Error('conflict'), {
          code: 'CONFLICT',
          latest: current ?? null,
        });
      const saved = validateFieldbook({
        ...structuredClone(project),
        revision: (current?.revision ?? 0) + 1,
      });
      records.set(saved.id, saved);
      return structuredClone(saved);
    },
  };
}

export function memoryWatchlistRepository({ limit = 8 } = {}) {
  const records = new Map();
  return {
    records,
    async save(definition, { expectedRevision = null } = {}) {
      validateWatchDefinition(definition);
      const old = records.get(definition.id);
      if ((old?.revision ?? null) !== expectedRevision)
        throw Object.assign(new Error('conflict'), { code: 'CONFLICT' });
      if (!old && records.size >= limit)
        throw Object.assign(new Error('limit'), { code: 'LIMIT' });
      const saved = { ...definition, revision: (old?.revision || 0) + 1 };
      records.set(definition.id, saved);
      return { definition: saved };
    },
  };
}

/** A deterministic UUID sequence. */
export function uuidSequence(prefix = '00000000-0000-4000-8000-') {
  let next = 0;
  return () => `${prefix}${String((next += 1)).padStart(12, '0')}`;
}
