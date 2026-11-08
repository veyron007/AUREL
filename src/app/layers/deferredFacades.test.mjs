// A deferred layer's facade answers the shell exactly as the real layer does
// while it is off: the same UI state after the same parameters, the same
// emissions to subscribers, the same refusals of commands. Each case builds
// two catalogs: one whose stand-ins never load, one whose layers are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceServices } from '../surfaceServices.js';
import { createApplicationCatalog } from '../constructCatalog.js';
import { createStandaloneLayerSources } from '../../standalone/layerSources.js';
import { isDeferredLayerPending, loadDeferredLayer } from '../deferredLayer.js';
import { CCTV_IDLE_LIMITS } from './descriptors/cctv.js';
import {
  MAX_AUTO_HOP_SEC,
  MIN_AUTO_HOP_SEC,
} from '../../layers/cctv/policy.js';
import { CCTV_AMBIENT_CARD_MAX } from '../../data/cctvLod.js';

const CASES = Object.freeze({
  cctv: {
    params: [
      {},
      {
        coverageMode: 'viewshed',
        showProjection: false,
        autoHop: true,
        autoHopSec: 3.7,
        calibrationMode: true,
      },
      { showCoverage: false, autoHopSec: 41.4 },
      { coverageMode: 'nonsense', autoHopSec: 500 },
    ],
    reads: ['getUIState', 'getParams', 'getStats'],
    calls: [
      ['focusNearest', { focus: false }],
      ['cycleCamera', 1],
      ['selectCamera', 'cam-1'],
      ['focusCamera', 'cam-1', 1.8],
      ['getActiveVideoElement'],
      ['getDetectableObjects'],
    ],
  },
  radio: {
    params: [
      {},
      { filter: 'news', volume: 1.7 },
      { filter: 'genre:jazz', volume: 0 },
      { filter: 'not a filter!' },
      { volume: 'loud' },
    ],
    reads: ['getUIState', 'getRadioUIState', 'getParams', 'getStats'],
    calls: [
      ['beginTuning'],
      ['cancelTuning'],
      ['commitTuningStation', 'station-1'],
      ['cycleStation', 1],
      ['endTuning'],
      ['getTunerStations'],
      ['previewTuningStation', 'station-1'],
      ['selectRequestedStation', { query: 'jazz' }],
      ['selectStation', 'station-1'],
      ['setFilter', 'news'],
      ['setRadioFilter', 'news'],
      ['setVolume', 0.4],
      ['setRadioVolume', 0.4],
      ['pause'],
      ['play'],
      ['togglePlayback'],
      ['toggleRadioPlayback'],
      ['stopPlayback'],
      ['stopPlayback', { attemptId: 'voice-1' }],
      ['getAcceptedCatalogSnapshot'],
    ],
  },
  'rocket-launches': {
    params: [{}],
    reads: ['getStats'],
    calls: [
      ['getAnalystRecords'],
      ['releaseCameraOwnership'],
      ['cancelReplay'],
      ['deselectMission'],
      ['selectMissionAt', 0],
      ['selectNextMission'],
      ['startSelectedReplay'],
      ['toggleReplayPause'],
      ['rosterPointerEnter', 0],
    ],
  },
  'bhote-koshi-2026': {
    params: [{}],
    reads: ['getStats', 'getParams'],
    calls: [['getCinematicState'], ['getSceneShotMediaHold', 'beat-1']],
  },
  transit: {
    params: [{}],
    reads: ['getStats'],
    calls: [['getAnalystRecords'], ['getDetectableObjects']],
  },
});

function createCatalog(signal) {
  return createApplicationCatalog({
    sources: createStandaloneLayerSources(),
    signal,
    surface: createSurfaceServices({
      terrainSource: { getHeights: async () => [] },
      signal,
      eventTarget: null,
    }),
  });
}

/** Everything a caller can observe of one call: value, promise-ness. */
async function observe(layer, [name, ...args]) {
  const result = layer[name](...args);
  const promised = result instanceof Promise;
  return { promised, value: plain(promised ? await result : result) };
}

const plain = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function subscriptions(layer) {
  return Object.keys(layer)
    .filter((key) => key.startsWith('subscribe'))
    .sort();
}

async function pair(t, id) {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const standIn = createCatalog(lifetime.signal).get(id);
  const real = await loadDeferredLayer(createCatalog(lifetime.signal).get(id));
  return { standIn, real };
}

for (const [id, cases] of Object.entries(CASES)) {
  test(`${id}: the facade answers like the real layer while off`, async (t) => {
    for (const params of cases.params) {
      const { standIn, real } = await pair(t, id);
      const seen = { standIn: new Map(), real: new Map() };
      for (const name of subscriptions(real))
        for (const [side, layer] of [
          ['standIn', standIn],
          ['real', real],
        ]) {
          const log = [];
          seen[side].set(name, log);
          layer[name]((value) => log.push(plain(value)));
        }
      if (typeof real.setParams === 'function')
        assert.equal(
          standIn.setParams(params) !== false,
          real.setParams(params) !== false,
          `${id} accepts ${JSON.stringify(params)}`,
        );
      for (const name of cases.reads)
        assert.deepEqual(
          plain(standIn[name]()),
          plain(real[name]()),
          `${id}.${name}() after ${JSON.stringify(params)}`,
        );
      for (const [name, log] of seen.real)
        assert.deepEqual(seen.standIn.get(name), log, `${id}.${name}`);
      for (const call of cases.calls)
        assert.deepEqual(
          await observe(standIn, call),
          await observe(real, call),
          `${id}.${call[0]}(${JSON.stringify(call.slice(1))})`,
        );
      assert.ok(isDeferredLayerPending(standIn), `${id} never loaded`);
    }
  });
}

test('the CCTV facade mirrors the layer limits', () => {
  assert.deepEqual(CCTV_IDLE_LIMITS, {
    minAutoHopSec: MIN_AUTO_HOP_SEC,
    maxAutoHopSec: MAX_AUTO_HOP_SEC,
    ambientCardMax: CCTV_AMBIENT_CARD_MAX,
  });
});

test('radio voice ducking loads the layer and forwards in order', async (t) => {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const radio = createCatalog(lifetime.signal).get('radio');
  assert.equal(radio.setVoiceDucked(false), undefined);
  assert.ok(isDeferredLayerPending(radio), 'lifting no duck loads nothing');
  const ducked = radio.setVoiceDucked(true);
  const played = radio.playForVoice({ attemptId: 'voice-1', timeoutMs: 10 });
  await ducked;
  assert.equal(isDeferredLayerPending(radio), false);
  assert.equal(radio.getUIState().voiceDucked, true);
  assert.equal(await played, false, 'nothing selected to play');
  radio.setVoiceDucked(false);
  assert.equal(radio.getUIState().voiceDucked, false);
});

test('the event layer loads cleanly with a scene media owner granted first', async (t) => {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const event = createCatalog(lifetime.signal).get('bhote-koshi-2026');
  const token = { cancelled: false, signal: lifetime.signal };
  event.setSceneMediaPlayback({ sceneId: 'scene', shotId: 'shot', token });
  assert.ok(isDeferredLayerPending(event));
  const real = await loadDeferredLayer(event);
  assert.equal(real.getSceneShotMediaHold('beat-1'), null);
  assert.equal(event.getCinematicState().active, false);
});
