// Provider Settings: Free-only row policy and the read-only radio priority
// line, from the /api/setup/status payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from './i18n/index.js';
import {
  freeOnlyRowPolicy,
  radioPriorityHint,
} from './providerSettingsPolicy.js';
import { FREE_ONLY_STATUS } from '../server/standalone/free-only-status.js';
import { radioPriorityStatus } from '../server/providers/radio/priority.js';

test.afterEach(() => setLocale('en'));

const FREE_ONLY = { ...FREE_ONLY_STATUS };

test('Free-only blocks the stopped providers and only pauses Launch Library', () => {
  assert.deepEqual(freeOnlyRowPolicy(FREE_ONLY, 'google-maps'), {
    blocked: true,
    paused: false,
  });
  assert.deepEqual(freeOnlyRowPolicy(FREE_ONLY, 'launch-library'), {
    blocked: false,
    paused: true,
  });
  assert.deepEqual(freeOnlyRowPolicy(FREE_ONLY, 'firms'), {
    blocked: false,
    paused: false,
  });
});

test('outside Free-only nothing is blocked or paused', () => {
  const full = { ...FREE_ONLY, freeOnly: false };
  for (const id of ['google-maps', 'launch-library'])
    assert.deepEqual(freeOnlyRowPolicy(full, id), {
      blocked: false,
      paused: false,
    });
  assert.deepEqual(freeOnlyRowPolicy(null, 'google-maps'), {
    blocked: false,
    paused: false,
  });
});

test('a row listed both ways reads as blocked, the stronger state', () => {
  const both = {
    freeOnly: true,
    blockedProviders: ['x'],
    pausedCredentials: ['x'],
  };
  assert.deepEqual(freeOnlyRowPolicy(both, 'x'), {
    blocked: true,
    paused: false,
  });
});

test('the radio status parses the env without echoing it', () => {
  assert.deepEqual(radioPriorityStatus({ RADIO_PRIORITY_COUNTRIES: 'in' }), {
    countries: ['IN'],
    valid: true,
    reservedPerCountry: 40,
  });
  assert.deepEqual(radioPriorityStatus({}), {
    countries: [],
    valid: true,
    reservedPerCountry: 40,
  });
  const invalid = radioPriorityStatus({
    RADIO_PRIORITY_COUNTRIES: 'India,secret-value',
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.countries, []);
  assert.doesNotMatch(JSON.stringify(invalid), /secret-value|India/);
});

test('the radio hint names the countries when set', () => {
  const hint = radioPriorityHint(
    radioPriorityStatus({ RADIO_PRIORITY_COUNTRIES: 'IN,PL' }),
  );
  assert.equal(hint.set, true);
  assert.equal(hint.valid, true);
  assert.match(hint.text, /up to 40 radio stations per country for IN, PL/);
  assert.match(hint.text, /RADIO_PRIORITY_COUNTRIES in \.env/);
});

test('unset, the radio hint shows how to prioritise India', () => {
  const hint = radioPriorityHint(radioPriorityStatus({}));
  assert.equal(hint.set, false);
  assert.match(hint.text, /RADIO_PRIORITY_COUNTRIES=IN/);
  assert.match(hint.text, /up to 40 Indian stations/);
});

test('an invalid setting says the directory will not start', () => {
  const hint = radioPriorityHint(
    radioPriorityStatus({ RADIO_PRIORITY_COUNTRIES: 'XX' }),
  );
  assert.equal(hint.valid, false);
  assert.match(hint.text, /not valid.*will not start/);
});

test('no radio status (an older server) shows no line', () => {
  assert.equal(radioPriorityHint(undefined), null);
  assert.equal(radioPriorityHint(null), null);
});

test('stray values in the payload never reach the text', () => {
  const hint = radioPriorityHint({
    countries: ['IN', '<b>x</b>', 'lowercase'],
    valid: true,
    reservedPerCountry: 40,
  });
  assert.match(hint.text, /for IN\./);
  assert.doesNotMatch(hint.text, /<b>|lowercase/);
});

test('the radio hint follows the UI language', () => {
  setLocale('ru');
  const hint = radioPriorityHint(
    radioPriorityStatus({ RADIO_PRIORITY_COUNTRIES: 'IN' }),
  );
  assert.match(hint.text, /Резервирует/);
  assert.match(hint.text, /IN/);
});
