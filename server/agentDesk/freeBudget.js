/**
 * Reads the Free-only ledgers from disk for `get_free_budget`. Read-only: it
 * never reserves, resets or repairs a ledger. A missing ledger means nothing
 * has been spent in its current periods; an unreadable one is reported as
 * unreadable rather than guessed.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_LEDGERS, freeBudgetAnswer } from '../../src/fieldkit/budget.js';
import { FREE_ONLY_STATUS } from '../standalone/free-only-status.js';

/** The repository's ledger directory, the one the providers write. */
export const DEFAULT_LEDGER_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.gev-cache',
);
/** The providers refuse ledgers above this size; so does the reader. */
const MAX_LEDGER_BYTES = 4096;

async function readLedger(file) {
  try {
    if ((await stat(file)).size > MAX_LEDGER_BYTES) return undefined;
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    return error?.code === 'ENOENT' ? null : undefined;
  }
}

/** The budget service the Field Kit tool reads. */
export function createFreeBudgetService({
  dir = DEFAULT_LEDGER_DIR,
  now = Date.now,
} = {}) {
  return Object.freeze({
    async read() {
      const states = {};
      for (const ledger of FREE_LEDGERS)
        states[ledger.id] = await readLedger(path.join(dir, ledger.file));
      return freeBudgetAnswer(states, {
        now: now(),
        paused: FREE_ONLY_STATUS.blockedProviders,
      });
    },
  });
}
