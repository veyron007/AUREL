import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFieldContextBudget } from './field-context-budget.js';
const clock = Date.parse('2026-11-07T12:00:00Z');
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aurel-budget-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'budget.json');
}
test('durable reservations count failed attempts and survive instances and UTC rollover', async (t) => {
  const file = await fixture(t);
  let now = clock;
  const first = createFieldContextBudget({
    file,
    now: () => now,
    dailyLimit: 2,
    monthlyLimit: 3,
  });
  assert.equal((await first.reserve()).ok, true);
  assert.equal(
    (
      await createFieldContextBudget({
        file,
        now: () => now,
        dailyLimit: 2,
        monthlyLimit: 3,
      }).reserve()
    ).ok,
    true,
  );
  assert.equal((await first.reserve()).reason, 'daily-limit');
  now += 86400000;
  assert.equal((await first.reserve()).ok, true);
  assert.equal((await first.reserve()).reason, 'monthly-limit');
  now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal((await first.reserve()).ok, true);
  const state = JSON.parse(await readFile(file));
  assert.equal(state.monthCount, 1);
});
test('corrupt, locked, oversized and clock-reversed ledgers fail closed without replacement', async (t) => {
  const file = await fixture(t);
  await writeFile(file, 'broken');
  const budget = createFieldContextBudget({ file, now: () => clock });
  assert.equal((await budget.reserve()).reason, 'budget-storage');
  assert.equal(await readFile(file, 'utf8'), 'broken');
  await rm(file);
  await mkdir(file + '.lock');
  assert.equal((await budget.reserve()).reason, 'budget-busy');
  await rm(file + '.lock', { recursive: true });
  await writeFile(file, ' '.repeat(5000));
  assert.equal((await budget.reserve()).ok, false);
  await rm(file);
  await budget.reserve();
  assert.equal(
    (await createFieldContextBudget({ file, now: () => clock - 1 }).reserve())
      .reason,
    'clock-reversed',
  );
});
test('concurrent budgets never exceed ceiling and per-minute reservations are bounded', async (t) => {
  const file = await fixture(t);
  const opts = { file, now: () => clock, dailyLimit: 1 };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => createFieldContextBudget(opts).reserve()),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  const other = await fixture(t);
  const budget = createFieldContextBudget({
    file: other,
    now: () => clock,
    minuteLimit: 2,
  });
  await budget.reserve();
  await budget.reserve();
  assert.equal((await budget.reserve()).reason, 'minute-limit');
});

test('invalid ledger fields, future periods and unwritable parent never reset budgets', async (t) => {
  const file = await fixture(t);
  const budget = createFieldContextBudget({ file, now: () => clock });
  await budget.reserve();
  const valid = JSON.parse(await readFile(file));
  for (const changed of [
    { ...valid, version: 2 },
    { ...valid, dayCount: -1 },
    { ...valid, day: '2026-11-08' },
    { ...valid, extra: true },
  ]) {
    const raw = JSON.stringify(changed);
    await writeFile(file, raw);
    assert.equal((await budget.reserve()).reason, 'budget-storage');
    assert.equal(await readFile(file, 'utf8'), raw);
  }
  const nested = createFieldContextBudget({
    file: path.join(file, 'child'),
    now: () => clock,
  });
  assert.equal((await nested.reserve()).reason, 'budget-storage');
});
