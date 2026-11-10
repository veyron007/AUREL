// The Bhote Koshi event layer's descriptor and facade (src/app/deferredLayer.js).
// Scenes drive it: the Director hands it its scene controller at start-up and
// grants it a shot's media owner just before enabling it for that shot, so the
// owner is kept and handed to the layer once loaded, before it starts. Checked
// against the real layer by src/app/layers/deferredDescriptors.test.mjs and
// src/app/layers/deferredFacades.test.mjs.

/** @type {import('../../deferredLayer.js').LayerDescriptor} */
export const BHOTE_KOSHI_EVENT_DESCRIPTOR = Object.freeze({
  id: 'bhote-koshi-2026',
  values: Object.freeze({
    name: 'Bhote Koshi Flood',
    showInTogglePanel: false,
    icon: '🌊',
    source: 'Vantor + GeoPera',
    updateInterval: 0,
  }),
  methods: Object.freeze([
    'attachDataManager',
    'attachMapStackController',
    'attachSceneController',
    'destroy',
    'disable',
    'enable',
    'getCinematicState',
    'getParams',
    'getPlaybackState',
    'getSceneShotMediaHold',
    'getStats',
    'init',
    'setParams',
    'setSceneMediaPlayback',
    'update',
  ]),
  params: Object.freeze({
    presentation: 'standalone',
    progress: 0,
    split: 0.5,
  }),
  stats: Object.freeze({
    count: 0,
    status: 'idle',
    source: 'Vantor + GeoPera',
    coverage: 'Event reconstruction',
  }),
  answers: Object.freeze({
    getCinematicState: Object.freeze({
      active: false,
      progress: 0,
      evidenceId: null,
      mediaReady: false,
      mediaEvidenceId: null,
    }),
    getSceneShotMediaHold: null,
  }),
  // Granted before the shot enables the layer: replayed when it loads.
  remember: Object.freeze(['setSceneMediaPlayback']),
});
