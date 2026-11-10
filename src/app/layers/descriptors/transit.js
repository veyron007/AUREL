// Transit's descriptor: what the application reads from it while it is off
// (src/app/deferredLayer.js). Checked against the real layer by
// src/app/layers/deferredDescriptors.test.mjs.

/** @type {import('../../deferredLayer.js').LayerDescriptor} */
export const TRANSIT_DESCRIPTOR = Object.freeze({
  id: 'transit',
  values: Object.freeze({
    updateInterval: 15000,
    name: 'Transit',
    icon: '🚌',
    source: 'GTFS-RT',
  }),
  methods: Object.freeze([
    'attachDataManager',
    'destroy',
    'disable',
    'enable',
    'getAnalystRecords',
    'getDetectableObjects',
    'getStats',
    'init',
    'update',
  ]),
  params: null,
  stats: Object.freeze({
    count: 0,
    lastUpdate: null,
    error: null,
    degraded: false,
    loading: false,
    loadingLabel: undefined,
    stale: false,
    source: 'GTFS-RT',
    coverage: '',
    feeds: Object.freeze([]),
  }),
  answers: Object.freeze({
    getAnalystRecords: Object.freeze([]),
    getDetectableObjects: Object.freeze([]),
  }),
});
