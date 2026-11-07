import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAcquisitionPlan,
  planIdentityFromName,
  crossCheckPass,
  unmatchedPlannedTakes,
  PLAN_LIMITS,
} from './plan.js';
import { missionById } from './missions.js';
import {
  MUSSOORIE,
  syntheticPlan,
  boxAround,
  SYNTHETIC_PLAN_NAME,
} from './testFixtures.mjs';

const s2b = missionById('sentinel-2b');
const passAt = (iso) => ({ timeMs: Date.parse(iso) });
const plan = parseAcquisitionPlan(
  syntheticPlan([
    {
      id: '50001-1',
      start: '2026-10-25T05:29:04.107',
      end: '2026-10-25T05:51:40.715',
      ring: boxAround(MUSSOORIE),
    },
    {
      id: '50002-1',
      start: '2026-11-04T05:30:02.059',
      end: '2026-11-04T05:51:40.939',
      ring: boxAround({ lat: 10, lon: 10 }),
    },
    {
      id: '50003-1',
      mode: 'VIC',
      start: '2026-11-01T05:30:00.000',
      end: '2026-11-01T05:50:00.000',
      ring: boxAround(MUSSOORIE),
    },
    {
      id: '50004-1',
      start: '2026-10-28T05:30:00.000',
      end: '2026-10-28T05:50:00.000',
      ring: boxAround(MUSSOORIE),
    },
  ]),
  SYNTHETIC_PLAN_NAME,
);

test('a plan file is identified by ESA name and parsed in UTC', () => {
  assert.equal(plan.satellite, 'S2B');
  assert.equal(
    new Date(plan.coverageStartMs).toISOString(),
    '2026-10-22T12:00:00.000Z',
  );
  assert.equal(plan.datatakes.length, 4);
  assert.equal(
    new Date(plan.datatakes[0].startMs).toISOString(),
    '2026-10-25T05:29:04.107Z',
  );
  assert.equal(planIdentityFromName('random.kml'), null);
});

test('matching plan confirms the predicted pass', () => {
  const check = crossCheckPass(
    s2b,
    passAt('2026-10-25T05:40:29Z'),
    [plan],
    MUSSOORIE,
  );
  assert.equal(check.status, 'confirmed');
  assert.equal(check.datatake.id, '50001-1');
});

test('a plan covering the time without a nominal datatake over the place contradicts the pass', () => {
  // 4 Nov: the nominal take is elsewhere. 1 Nov: only a non-nominal (VIC) take covers the place.
  for (const iso of ['2026-11-04T05:40:35Z', '2026-11-01T05:40:00Z'])
    assert.equal(
      crossCheckPass(s2b, passAt(iso), [plan], MUSSOORIE).status,
      'contradicted',
    );
});

test('missing plans read as no-plan; other satellites and Landsat are never confirmed by it', () => {
  assert.equal(
    crossCheckPass(s2b, passAt('2026-12-01T05:40:00Z'), [plan], MUSSOORIE)
      .status,
    'no-plan',
  );
  assert.equal(
    crossCheckPass(s2b, passAt('2026-10-25T05:40:29Z'), [], MUSSOORIE).status,
    'no-plan',
  );
  assert.equal(
    crossCheckPass(
      missionById('sentinel-2a'),
      passAt('2026-10-25T05:40:29Z'),
      [plan],
      MUSSOORIE,
    ).status,
    'no-plan',
  );
  assert.equal(
    crossCheckPass(
      missionById('landsat-9'),
      passAt('2026-11-01T05:18:30Z'),
      [plan],
      MUSSOORIE,
    ).status,
    'not-published',
  );
});

test('planned datatakes with no predicted pass are listed separately', () => {
  const rows = unmatchedPlannedTakes(
    s2b,
    [passAt('2026-10-25T05:40:29Z')],
    [plan],
    MUSSOORIE,
    {
      fromMs: Date.parse('2026-10-22T00:00:00Z'),
      toMs: Date.parse('2026-11-05T00:00:00Z'),
    },
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['50004-1'],
  );
});

test('files that are not ESA plans, or are too large, are refused', () => {
  assert.throws(
    () => parseAcquisitionPlan('<kml></kml>', SYNTHETIC_PLAN_NAME),
    TypeError,
  );
  assert.throws(
    () => parseAcquisitionPlan(syntheticPlan([]), 'notes.kml'),
    TypeError,
  );
  assert.throws(
    () =>
      parseAcquisitionPlan(
        'x'.repeat(PLAN_LIMITS.bytes + 1),
        SYNTHETIC_PLAN_NAME,
      ),
    TypeError,
  );
  const broken = parseAcquisitionPlan(
    syntheticPlan([
      {
        id: 'bad',
        start: 'not a time',
        end: '2026-10-25T05:51:40',
        ring: boxAround(MUSSOORIE),
      },
    ]),
    SYNTHETIC_PLAN_NAME,
  );
  assert.equal(broken.datatakes.length, 0);
});
