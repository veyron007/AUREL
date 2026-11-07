import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chronicleProductFor,
  createChronicleSceneOpener,
  createRideDirector,
} from './orbitWitnessTools.js';
import { RIDE_SCENE_PREFIX } from '../orbitWitness/ride.js';

const place = {
  id: 'mussoorie',
  name: 'Mussoorie',
  coordinates: [78.0644, 30.4598],
};
const observation = {
  id: 'earth-search:S2A_43RGP_20261111_0_L2A',
  sceneId: 'S2A_43RGP_20261111_0_L2A',
  platform: 'sentinel-2a',
  acquiredAt: '2026-11-11T05:40:40.000Z',
  productId: null,
};

function chronicle(candidates) {
  const calls = [];
  return {
    calls,
    candidates,
    async search(query) {
      calls.push(['search', query]);
      return true;
    },
    async choose(choice) {
      calls.push(['choose', choice]);
      return true;
    },
    async compare() {
      calls.push(['compare']);
      return true;
    },
  };
}

test('scenes map to the HLS product Chronicle can show', () => {
  assert.equal(chronicleProductFor(observation), 'S30');
  assert.equal(chronicleProductFor({ platform: 'landsat-9' }), 'L30');
  assert.equal(chronicleProductFor({ productId: 'L30', platform: 'x' }), 'L30');
  assert.equal(chronicleProductFor({ platform: 'iss' }), null);
});

test('a fired scene opens in Chronicle beside the previous scene of the same product', async () => {
  const fake = chronicle([
    { id: 'S30:2026-10-22', requestedDate: '2026-10-22' },
    { id: 'L30:2026-11-09', requestedDate: '2026-11-09' },
    { id: 'S30:2026-11-04', requestedDate: '2026-11-04' },
    { id: 'S30:2026-11-11', requestedDate: '2026-11-11' },
  ]);
  const selected = [];
  const destinations = [];
  const open = createChronicleSceneOpener({
    lens: { select: (record, options) => selected.push([record, options]) },
    chronicle: fake,
    workspace: { chooseDestination: (id) => destinations.push(id) },
  });
  assert.deepEqual(await open({ place, observation }), { ok: true });
  assert.deepEqual(selected[0][0].geometry.coordinates, place.coordinates);
  assert.deepEqual(destinations, ['compare']);
  assert.deepEqual(fake.calls, [
    ['search', { startDate: '2026-10-12', endDate: '2026-11-11' }],
    ['choose', { slot: 'a', id: 'S30:2026-11-04' }],
    ['choose', { slot: 'b', id: 'S30:2026-11-11' }],
    ['compare'],
  ]);
});

test('when HLS has not caught up, Chronicle says so instead of comparing', async () => {
  const fake = chronicle([
    { id: 'S30:2026-11-04', requestedDate: '2026-11-04' },
  ]);
  const open = createChronicleSceneOpener({
    lens: { select() {} },
    chronicle: fake,
    workspace: null,
  });
  const result = await open({ place, observation });
  assert.equal(result.ok, false);
  assert.match(result.message, /not in NASA CMR yet/);
  assert.equal(
    fake.calls.some(([name]) => name === 'compare'),
    false,
  );
  const none = await createChronicleSceneOpener({
    lens: null,
    chronicle: chronicle([
      { id: 'S30:2026-11-11', requestedDate: '2026-11-11' },
    ]),
  })({ place, observation });
  assert.match(none.message, /No earlier S30/);
});

test('the ride director adds one ride scene through the validated snapshot path', async () => {
  const restored = [];
  const started = [];
  const director = createRideDirector({
    running: false,
    subscribe: () => () => {},
    getProjectSnapshot: () => ({
      version: 6,
      scenes: [
        { id: `${RIDE_SCENE_PREFIX}-old`, shots: [] },
        { id: 'mine', shots: [] },
      ],
    }),
    restoreProjectSnapshot: async (project) => (restored.push(project), true),
    startScene: (id) => (started.push(id), new Promise(() => {})),
    stopScene() {},
  });
  assert.equal(
    await director.ride({ id: `${RIDE_SCENE_PREFIX}-new`, shots: [] }),
    true,
  );
  assert.deepEqual(
    restored[0].scenes.map((scene) => scene.id),
    ['mine', `${RIDE_SCENE_PREFIX}-new`],
  );
  assert.deepEqual(started, [`${RIDE_SCENE_PREFIX}-new`]);
  assert.equal(createRideDirector(null), null);
  const busy = createRideDirector({
    running: true,
    getProjectSnapshot: () => ({ scenes: [] }),
  });
  assert.equal(await busy.ride({ id: 'x' }), false);
});
