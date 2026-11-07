import path from 'node:path';
import { promises as fs } from 'node:fs';
const FIELD_CONTEXT_CEILINGS = Object.freeze({
  day: 100,
  month: 2000,
  minute: 10,
});

/**
 * Durable weighted ledger. Reservations are committed before dispatch,
 * including failed upstream attempts. `ceilings` are fixed by each owning
 * module; injected limits can lower them, never raise them. Each reservation
 * consumes `units` (a positive integer) from every period.
 */
export function createWeightedLedger({
  file,
  now = Date.now,
  ceilings,
  dailyLimit,
  monthlyLimit,
  minuteLimit,
}) {
  const cap = (value, max) =>
    Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : max;
  const limits = {
    day: cap(dailyLimit, ceilings.day),
    month: cap(monthlyLimit, ceilings.month),
    minute: cap(minuteLimit, ceilings.minute),
  };
  async function reserve(units = 1) {
    if (!Number.isSafeInteger(units) || units < 1 || units > limits.minute)
      return { ok: false, reason: 'budget-units' };
    let locked = false;
    const lock = file + '.lock';
    let temp;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        await fs.mkdir(lock);
        locked = true;
      } catch (e) {
        if (e.code === 'EEXIST') return { ok: false, reason: 'budget-busy' };
        throw e;
      }
      const clock = now();
      if (!Number.isFinite(clock) || clock < 0) throw new Error('clock');
      const iso = new Date(clock).toISOString(),
        day = iso.slice(0, 10),
        month = iso.slice(0, 7),
        minute = iso.slice(0, 16);
      let old = null;
      try {
        if ((await fs.stat(file)).size > 4096) throw new Error('size');
        old = JSON.parse(await fs.readFile(file, 'utf8'));
        if (
          old.version !== 1 ||
          !Number.isFinite(old.lastAt) ||
          !['day', 'month', 'minute'].every(
            (k) =>
              typeof old[k] === 'string' &&
              Number.isSafeInteger(old[k + 'Count']) &&
              old[k + 'Count'] >= 0,
          ) ||
          Object.keys(old).length !== 8
        )
          throw new Error('ledger');
        const previous = new Date(old.lastAt).toISOString();
        if (
          old.day !== previous.slice(0, 10) ||
          old.month !== previous.slice(0, 7) ||
          old.minute !== previous.slice(0, 16)
        )
          throw new Error('period');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (old && clock < old.lastAt)
        return { ok: false, reason: 'clock-reversed' };
      const state = {
        version: 1,
        day,
        month,
        minute,
        dayCount: old?.day === day ? old.dayCount : 0,
        monthCount: old?.month === month ? old.monthCount : 0,
        minuteCount: old?.minute === minute ? old.minuteCount : 0,
        lastAt: clock,
      };
      for (const [period, reason] of [
        ['month', 'monthly-limit'],
        ['day', 'daily-limit'],
        ['minute', 'minute-limit'],
      ])
        if (state[period + 'Count'] + units > limits[period])
          return { ok: false, reason };
      for (const period of ['day', 'month', 'minute'])
        state[period + 'Count'] += units;
      temp = path.join(lock, 'reservation.json');
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(state));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, file);
      temp = null;
      const directory = await fs.open(path.dirname(file), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'budget-storage' };
    } finally {
      if (locked) {
        if (temp) await fs.rm(temp, { force: true }).catch(() => {});
        await fs.rmdir(lock).catch(() => {});
      }
    }
  }
  return { reserve };
}

/** The Phase 3 Open-Meteo field-context ledger: one unit per outbound call. */
export function createFieldContextBudget({
  file = path.join(process.cwd(), '.gev-cache', 'field-context-budget.json'),
  now = Date.now,
  dailyLimit = FIELD_CONTEXT_CEILINGS.day,
  monthlyLimit = FIELD_CONTEXT_CEILINGS.month,
  minuteLimit = FIELD_CONTEXT_CEILINGS.minute,
} = {}) {
  return createWeightedLedger({
    file,
    now,
    ceilings: FIELD_CONTEXT_CEILINGS,
    dailyLimit,
    monthlyLimit,
    minuteLimit,
  });
}
