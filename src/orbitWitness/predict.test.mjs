import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { missionElementSets } from './tle.js';
import {
  predictOrbitWitness,
  cloudAtPass,
  productForPass,
  defaultWindow,
} from './predict.js';
import { parseAcquisitionPlan } from './plan.js';
import { LANES, FORBIDDEN_CLAIMS } from './lanes.js';
import { missionById } from './missions.js';
import { validateCataloguePayload } from './catalogueModel.js';
import {
  FIXTURE_TLE,
  MUSSOORIE,
  S2B_SCENE,
  syntheticPlan,
  boxAround,
  SYNTHETIC_PLAN_NAME,
} from './testFixtures.mjs';

const sets = missionElementSets(FIXTURE_TLE);
const nowMs = Date.parse('2026-11-07T06:00:00Z');
const catalogue = validateCataloguePayload({
  version: 1,
  retrievedAt: '2026-11-07T06:00:00.000Z',
  sources: [
    { id: 'earth-search', status: 'ok', count: 1, truncated: false },
    { id: 'cmr-stac-lpcloud', status: 'ok', count: 0, truncated: false },
  ],
  scenes: [
    {
      id: 'S2B_43RGP_20261104_0_L2A',
      collection: 'sentinel-2-l2a',
      source: 'earth-search',
      platform: 'sentinel-2b',
      datetime: '2026-11-04T05:40:35.189Z',
      cloudCover: 0.1,
    },
  ],
});
const cloud = {
  status: 'ok',
  retrievedAt: '2026-11-07T05:00:00.000Z',
  validFromMs: Date.parse('2026-11-07T00:00:00Z'),
  validToMs: Date.parse('2026-11-20T23:00:00Z'),
  hours: Array.from({ length: 14 * 24 }, (_, i) => ({
    timeMs: Date.parse('2026-11-07T00:00:00Z') + i * 3600000,
    cloudCoverPct: i % 100,
  })),
};
const plans = [
  parseAcquisitionPlan(
    syntheticPlan([
      {
        id: '1',
        start: '2026-11-04T05:30:00.000',
        end: '2026-11-04T05:52:00.000',
        ring: boxAround(MUSSOORIE),
      },
    ]),
    SYNTHETIC_PLAN_NAME,
  ),
];
const { fromMs, days } = defaultWindow(nowMs);
const result = predictOrbitWitness({
  sets,
  place: MUSSOORIE,
  fromMs,
  days,
  plans,
  cloud,
  catalogue,
  nowMs,
});
const row = (id) => result.missions.find((item) => item.mission.id === id);

test('every pass carries four separate lanes with their own class, source and time', () => {
  for (const mission of result.missions.filter((item) => item.mission.imaging))
    for (const pass of mission.passes) {
      assert.equal(pass.lanes.predicted.class, 'modelled');
      assert.equal(pass.lanes.planned.class, 'derived');
      assert.equal(pass.lanes.product.class, 'observed');
      assert.equal(pass.lanes.cloud.class, 'modelled');
      assert.equal(pass.lanes.cloud.unit, '%');
      assert.ok(
        pass.lanes.predicted.epoch && pass.lanes.predicted.applicableTime,
      );
      assert.ok(pass.lanes.predicted.source.url.startsWith('https://'));
    }
  assert.deepEqual(
    Object.values(LANES).map((lane) => [lane.id, lane.class]),
    [
      ['predicted', 'modelled'],
      ['planned', 'derived'],
      ['product', 'observed'],
      ['ride', 'simulated'],
    ],
  );
});

test('a past pass with its scene catalogued shows the product; plan-confirmed', () => {
  const pass = row('sentinel-2b').passes.find((item) =>
    item.time.startsWith('2026-11-04'),
  );
  assert.equal(pass.lanes.product.status, 'available');
  assert.equal(pass.lanes.product.scene.id, 'S2B_43RGP_20261104_0_L2A');
  assert.equal(pass.lanes.planned.status, 'confirmed');
  assert.equal(pass.lanes.cloud.status, 'beyond-forecast');
});

test('future passes are pending, with a cloud forecast when in range', () => {
  const future = row('sentinel-2a').passes.filter((item) => !item.past);
  assert.ok(future.length >= 1);
  for (const pass of future) {
    assert.equal(pass.lanes.product.status, 'pending');
    assert.equal(pass.lanes.cloud.status, 'ok');
    assert.equal(typeof pass.lanes.cloud.valuePct, 'number');
  }
});

test('a recent pass without a product reads "not yet", an outage reads "unknown", never "none"', () => {
  const mission = missionById('sentinel-2c');
  const pass = { timeMs: nowMs - 2 * 86400000 };
  assert.equal(
    productForPass(mission, pass, catalogue, nowMs).status,
    'not-yet',
  );
  assert.equal(
    productForPass(mission, { timeMs: nowMs - 9 * 86400000 }, catalogue, nowMs)
      .status,
    'not-found',
  );
  assert.equal(
    productForPass(mission, pass, { status: 'unavailable', scenes: [] }, nowMs)
      .status,
    'unknown',
  );
  assert.equal(productForPass(mission, pass, null, nowMs).status, 'unknown');
  assert.equal(
    productForPass(mission, pass, { ...catalogue, status: 'partial' }, nowMs)
      .status,
    'unknown',
  );
});

test('cloud cover joins the nearest forecast hour or says why it cannot', () => {
  const at = cloudAtPass(cloud, Date.parse('2026-11-08T05:40:00Z'));
  assert.equal(at.applicableTime, '2026-11-08T06:00:00.000Z');
  assert.equal(cloudAtPass(null, nowMs).status, 'unknown');
  assert.equal(cloudAtPass({ status: 'blocked' }, nowMs).status, 'unknown');
  assert.equal(
    cloudAtPass(cloud, Date.parse('2026-12-30T00:00:00Z')).status,
    'beyond-forecast',
  );
});

test('missing element sets are reported per mission, and the ISS has no imaging lanes', () => {
  const partial = predictOrbitWitness({
    sets: sets.slice(0, 1),
    place: MUSSOORIE,
    fromMs,
    days,
    nowMs,
  });
  assert.equal(
    partial.missions.find((item) => item.mission.id === 'landsat-9').status,
    'no-elements',
  );
  const iss = row('iss');
  assert.ok(iss.passes.length > 0);
  assert.ok(
    iss.passes.every((pass) => pass.lanes.product.status === 'not-applicable'),
  );
});

test('no Orbit Witness string claims a photograph from a pass', () => {
  const dir = new URL('.', import.meta.url);
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(new URL(file, dir), 'utf8'));
  sources.push(
    readFileSync(
      new URL('../ui/views/panels/OrbitWitnessPanel.vue', import.meta.url),
      'utf8',
    ),
    readFileSync(
      new URL('../ui/orbitWitnessController.js', import.meta.url),
      'utf8',
    ),
  );
  const text = sources
    .join('\n')
    .toLowerCase()
    .replace(/forbidden_claims[\s\S]*?\]\);/i, '');
  for (const word of FORBIDDEN_CLAIMS)
    assert.equal(text.includes(word), false, word);
  assert.ok(S2B_SCENE.id);
});
