import { parseFieldbook, FIELDBOOK_LIMITS } from '../fieldbook/document.js';

/** A bounded active draft plus one explicitly parked recovery, scoped to this tab. */
export const FIELDBOOK_DRAFT_KEY = 'aurel.fieldbook.draft.v1';
const MAX_ENVELOPE_BYTES = FIELDBOOK_LIMITS.bytes * 2 + 256 * 1024;
function readSlot(value) {
  if (value === null) return null;
  if (
    !value ||
    (value.baseRevision !== null &&
      (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 1))
  )
    throw new Error('invalid draft revision');
  if (
    value.noteDraft != null &&
    (typeof value.noteDraft !== 'string' || value.noteDraft.length > 16384)
  )
    throw new Error('invalid note draft');
  return {
    project: parseFieldbook(JSON.stringify(value.project)),
    baseRevision: value.baseRevision,
    noteDraft: value.noteDraft ?? '',
  };
}
export function readDraftEnvelope(raw) {
  if (new TextEncoder().encode(raw).byteLength > MAX_ENVELOPE_BYTES)
    throw new Error('oversized draft envelope');
  const value = JSON.parse(raw);
  if (value.version === 1) return { active: null, recovery: readSlot(value) };
  if (value.version !== 2) throw new Error('unsupported draft envelope');
  return { active: readSlot(value.active), recovery: readSlot(value.recovery) };
}
export function writeDraftEnvelope(storage, active, recovery) {
  if (!active && !recovery) {
    storage?.removeItem(FIELDBOOK_DRAFT_KEY);
    return;
  }
  if (!storage?.setItem) throw new Error('draft storage unavailable');
  const raw = JSON.stringify({ version: 2, active, recovery });
  if (new TextEncoder().encode(raw).byteLength > MAX_ENVELOPE_BYTES)
    throw new Error('oversized draft envelope');
  storage.setItem(FIELDBOOK_DRAFT_KEY, raw);
}
