import test from 'node:test';
import assert from 'node:assert/strict';
import { missionElementSets } from './tle.js';
import { missionById } from './missions.js';
import { buildRideScene, withRideScene, rideProvenance, RIDE_SCENE_PREFIX } from './ride.js';
import { validateSceneDocument, stringifySceneDocument } from '../director/document.js';
import { ringContains } from './swath.js';
import { FIXTURE_TLE, MUSSOORIE, S2B_SCENE } from './testFixtures.mjs';

const translate = (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key]));
const set = missionElementSets(FIXTURE_TLE).find((row) => row.missionId === 'sentinel-2b');
const input = {
  mission: missionById('sentinel-2b'),
  pass: { timeMs: Date.parse('2026-10-25T05:40:29Z') },
  set,
  place: { ...MUSSOORIE, name: 'Mussoorie' },
  sceneId: S2B_SCENE.id,
  translate,
  nowMs: Date.parse('2026-11-07T06:00:00Z'),
};

test('the ride is a valid director scene whose every shot says dramatised and names the epoch', () => {
  const { scene } = buildRideScene(input);
  assert.ok(scene.id.startsWith(RIDE_SCENE_PREFIX));
  const project = withRideScene({ version: 6, scenes: [] }, scene);
  assert.doesNotThrow(() => validateSceneDocument(project));
  assert.match(scene.title, /dramatisation/);
  for (const shot of scene.shots) {
    assert.match(shot.title, /Dramatised ride/);
    assert.match(shot.title, /orbit propagated, epoch 2026-11-06 20:45 UTC/);
    assert.match(shot.title, /Image: observed S2B_43RGP_20261025_0_L2A/);
  }
  // The export (scene JSON) carries the same label.
  assert.match(stringifySceneDocument(project), /orbit propagated, epoch 2026-11-06 20:45 UTC/);
});

test('the camera follows the propagated orbit and ends over the place', () => {
  const { scene } = buildRideScene(input);
  const last = scene.shots.at(-1).camera;
  assert.equal(last.pitch, -90);
  assert.ok(Math.abs(last.lat - MUSSOORIE.lat) < 1e-9);
  const ride = scene.shots.slice(0, -1);
  assert.ok(ride.every((shot) => shot.camera.alt > 780000 && shot.camera.alt < 800000));
  // Descending: each ride pose is further south than the last.
  assert.ok(ride.every((shot) => shot.camera.lat < shot.move.from.lat));
});

test('the exported record labels each class and keeps the TLE it propagated', () => {
  const { record, footprint } = buildRideScene(input);
  assert.equal(record.lane, 'ride');
  assert.equal(record.class, 'simulated');
  assert.match(record.label, /^Dramatised ride · orbit propagated, epoch /);
  assert.equal(record.orbit.class, 'modelled');
  assert.equal(record.orbit.epoch, '2026-11-06T20:45:23.948Z');
  assert.equal(record.orbit.line1, set.line1);
  assert.equal(record.image.class, 'observed');
  assert.equal(record.footprint.class, 'modelled');
  assert.ok(ringContains(footprint, MUSSOORIE.lon, MUSSOORIE.lat));
  assert.match(record.dramatisation, /dramatised/);
});

test('without a catalogued scene the image lane says none, and a new ride replaces the old one', () => {
  const { scene, record } = buildRideScene({ ...input, sceneId: null });
  assert.match(scene.shots[0].title, /Image: none catalogued/);
  assert.equal(record.image.sceneId, null);
  const user = { id: 'mine', title: 'Mine', shots: [] };
  const once = withRideScene({ version: 6, scenes: [user] }, scene);
  const twice = withRideScene(once, { ...scene, id: `${RIDE_SCENE_PREFIX}-other` });
  assert.deepEqual(twice.scenes.map((row) => row.id), ['mine', `${RIDE_SCENE_PREFIX}-other`]);
  assert.equal(rideProvenance(translate, { epochMs: set.epochMs }).includes('none catalogued'), true);
});

test('a ride that cannot be propagated throws instead of inventing a path', () => {
  const broken = { ...set, satrec: { ...set.satrec, error: 1, no: Number.NaN } };
  assert.throws(() => buildRideScene({ ...input, set: broken }));
});
