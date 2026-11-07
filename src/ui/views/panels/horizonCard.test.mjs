// i18n-ignore-file: horizon card fixtures
import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useHorizonStore } from '../../stores/horizon.js';
import HorizonCard from './HorizonCard.vue';
import { computeHorizon } from '../../../horizon/compute.js';
import { toProvenanceEnvelope } from '../../../horizon/envelope.js';
import { syntheticPayload } from '../../../horizon/testFixtures.mjs';
import { destination } from '../../../horizon/geodesy.js';
import { horizonRingPositions } from '../../../app/horizonTools.js';

function mount(t, view) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = useHorizonStore(pinia);
  const calls = [];
  store.connect({
    analyze: (...args) => calls.push(['analyze', ...args]),
    cancel: () => calls.push(['cancel']),
    save: () => calls.push(['save']),
  });
  const app = createApp(HorizonCard, { surface: 'lens' }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view);
  t.after(() => app.unmount());
  return { calls };
}
const observer = { lat: 30.4597, lon: 78.1058 };
const peak = { id: 'node/1', name: 'Bandarpunch I', nameHi: 'बंदरपूँछ', eleM: 6316, ...destination(observer.lat, observer.lon, 35, 15000) };
const result = computeHorizon({
  payload: syntheticPayload({
    ...observer,
    groundM: 2000,
    height: (az, d) => (az >= 34 && az <= 36 && Math.abs(d - 15000) < 160 ? 6200 : 1900),
  }),
  localDate: '2026-12-21',
  timeZone: 'Asia/Kolkata',
  shadowAt: '2026-12-21T07:00:00Z',
  peaks: { entries: [peak], source: { label: 'OSM peaks', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', link: 'https://www.openstreetmap.org/copyright', retrievedAt: '2026-11-06T19:58:02.272Z', extractAt: '2026-11-05T21:23:02Z' } },
  now: '2026-11-07T00:00:00.000Z',
});
const ready = {
  hasPlace: true,
  place: { name: 'Lal Tibba', ...observer },
  status: 'ready',
  busy: false,
  error: null,
  feedback: null,
  envelope: toProvenanceEnvelope(result),
  canSave: true,
};

test('the card asks for a place and computes nothing until asked', async (t) => {
  const { calls } = mount(t, { hasPlace: false, place: null, status: 'empty', busy: false, envelope: null });
  await nextTick();
  assert.match(document.body.textContent, /Select a place in Lens/);
  assert.match(document.body.textContent, /Geometric visibility, terrain-only/);
  assert.equal(calls.length, 0);
});

test('the card submits labelled inputs and renders sunrise, shadow, peaks and sources', async (t) => {
  const { calls } = mount(t, ready);
  await nextTick();
  for (const name of ['date', 'time', 'eye', 'gnomon', 'zone'])
    assert.ok(document.querySelector(`label[for="horizon-lens-${name}"]`), name);
  document.querySelector('#horizon-lens-form').dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(calls[0][0], 'analyze');
  assert.equal(calls[0][1].shadowTime, '12:00');
  const text = document.body.textContent;
  assert.match(text, /Astronomical sunrise \(flat horizon\)/);
  assert.match(text, /Sun clears the terrain/);
  assert.match(text, /Shadow of a 1 m gnomon/);
  assert.match(text, /Bandarpunch I/);
  assert.match(text, /az 35°/);
  assert.match(text, /OSM ele 6,316 m/);
  assert.match(text, /DEM void samples/);
  assert.match(text, /k = 0\.13/);
  assert.doesNotMatch(text, /guarantee/i);
  assert.ok(document.querySelector('.horizon-chart polyline').getAttribute('points').length > 100);
  document.querySelector('#horizon-lens-save').click();
  assert.deepEqual(calls.at(-1), ['save']);
});

test('the globe ring has one vertex per ray and closes on itself', () => {
  const ring = horizonRingPositions(result);
  assert.equal(ring.length, 721);
  assert.deepEqual(ring[0], ring.at(-1));
});
