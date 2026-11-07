import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BUDGET_WORDING,
  FREE_LEDGERS,
  budgetSummary,
  freeBudgetAnswer,
  ledgerEstimate,
} from './budget.js';

const NOW = Date.parse('2026-11-08T10:15:30.000Z');
const ledger = FREE_LEDGERS.find((entry) => entry.id === 'field-context');

test('a missing ledger means nothing spent in its periods', () => {
  const row = ledgerEstimate(ledger, null, NOW);
  assert.equal(row.status, 'available');
  assert.deepEqual(row.estimated_remaining, {
    minute: 10,
    day: 100,
    month: 2000,
  });
  assert.equal(row.estimated_remaining_units, 100);
});

test('current-period counts are subtracted; old periods roll over', () => {
  const row = ledgerEstimate(
    ledger,
    {
      version: 1,
      day: '2026-11-08',
      month: '2026-11',
      minute: '2026-11-08T10:15',
      dayCount: 97,
      monthCount: 1500,
      minuteCount: 10,
      lastAt: NOW - 1000,
    },
    NOW,
  );
  assert.deepEqual(row.used, { minute: 10, day: 97, month: 1500 });
  assert.equal(row.estimated_remaining_units, 3);
  assert.match(row.note, /wait a minute/);
  const yesterday = ledgerEstimate(
    ledger,
    {
      version: 1,
      day: '2026-11-07',
      month: '2026-11',
      minute: '2026-11-07T23:59',
      dayCount: 100,
      monthCount: 1999,
      minuteCount: 1,
      lastAt: NOW - 86400000,
    },
    NOW,
  );
  assert.equal(yesterday.estimated_remaining.day, 100);
  assert.equal(yesterday.estimated_remaining_units, 1);
  const spent = ledgerEstimate(
    ledger,
    {
      version: 1,
      day: '2026-11-08',
      month: '2026-11',
      minute: '2026-11-08T10:10',
      dayCount: 100,
      monthCount: 100,
      minuteCount: 0,
      lastAt: NOW - 300000,
    },
    NOW,
  );
  assert.equal(spent.status, 'exhausted');
});

test('an unreadable ledger is reported, not guessed', () => {
  for (const state of [undefined, { version: 2 }, { version: 1, day: 3 }]) {
    const row = ledgerEstimate(ledger, state, NOW);
    assert.equal(row.status, 'unreadable');
    assert.equal(row.estimated_remaining_units, null);
  }
});

test('the answer always says estimated and never promises free dispatch', () => {
  const nothingSpent = Object.fromEntries(
    FREE_LEDGERS.map((entry) => [entry.id, null]),
  );
  const answer = freeBudgetAnswer(nothingSpent, {
    now: NOW,
    paused: ['tomtom'],
  });
  assert.equal(answer.estimated, true);
  assert.equal(answer.wording, BUDGET_WORDING);
  assert.match(answer.wording, /Estimated remaining/);
  assert.match(answer.wording, /Not a guarantee of free dispatch/);
  assert.deepEqual(answer.paused_by_free_only, ['tomtom']);
  const summary = budgetSummary(answer);
  assert.match(summary, /^Estimated remaining free units/);
  assert.match(summary, /\(estimated\)/);
  assert.match(summary, /Not a guarantee of free dispatch\.$/);
  assert.doesNotMatch(summary, /\bguaranteed\b|\bunlimited\b/i);
  assert.match(budgetSummary(freeBudgetAnswer({}, { now: NOW })), /unreadable/);
});

test('ledger limits match the providers that keep them', async () => {
  const read = (file) =>
    readFile(
      new URL(`../../server/providers/${file}`, import.meta.url),
      'utf8',
    );
  const base = await read('field-context-budget.js');
  const defaults = (key) => Number(new RegExp(`${key} = (\\d+)`).exec(base)[1]);
  const fieldContext = FREE_LEDGERS.find(
    (entry) => entry.id === 'field-context',
  );
  const history = FREE_LEDGERS.find((entry) => entry.id === 'imagery-history');
  for (const entry of [fieldContext, history])
    assert.deepEqual(entry.limits, {
      minute: defaults('minuteLimit'),
      day: defaults('dailyLimit'),
      month: defaults('monthlyLimit'),
    });
  const research = await read('research/service.js');
  const research$ = FREE_LEDGERS.find((entry) => entry.id === 'research');
  assert.match(research, new RegExp(`dailyLimit: ${research$.limits.day},`));
  assert.match(
    research,
    new RegExp(`monthlyLimit: ${research$.limits.month},`),
  );
  assert.match(
    research,
    new RegExp(`minuteLimit: ${research$.limits.minute},`),
  );
  for (const entry of FREE_LEDGERS)
    assert.match(
      await read(
        entry.id === 'research'
          ? 'research/service.js'
          : entry.id === 'imagery-history'
            ? 'imagery-history.js'
            : 'field-context-budget.js',
      ),
      new RegExp(entry.file.replace('.', '\\.')),
    );
});
