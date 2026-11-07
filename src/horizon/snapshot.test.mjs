// i18n-ignore-file: Fieldbook horizon snapshot fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHorizon } from './compute.js';
import { toHorizonSnapshot } from './snapshot.js';
import { syntheticPayload } from './testFixtures.mjs';
import { validateHorizonSnapshot } from '../fieldbook/horizonAnalysis.js';
import { createFieldbook, validateFieldbook } from '../fieldbook/document.js';
import { prepareAnalysisSave } from '../ui/fieldbookPresentation.js';

const place = {
  kind: 'place',
  name: 'Lal Tibba',
  aliases: [],
  geometry: { type: 'Point', coordinates: [78.1058, 30.4597] },
  extent: null,
};
function snapshot(overrides = {}) {
  const result = computeHorizon({
    payload: syntheticPayload({
      groundM: 2000,
      height: (az, d) => (Math.abs(d - 4000) < 50 ? 2300 : 1900),
      ...overrides,
    }),
    localDate: '2026-12-21',
    timeZone: 'Asia/Kolkata',
    shadowAt: '2026-12-21T07:00:00Z',
    now: '2026-11-07T00:00:00.000Z',
  });
  return toHorizonSnapshot(result, { capturedAt: '2026-11-07T00:01:00.000Z' });
}

test('horizon snapshot is rounded to 1° and the minute and validates strictly', () => {
  const saved = snapshot();
  assert.equal(validateHorizonSnapshot(saved), saved);
  assert.equal(saved.horizon.elevationDeg.length, 360);
  assert.equal(saved.label, 'geometric visibility, terrain-only');
  assert.match(saved.sun.terrainRise, /:00\.000Z$/);
  assert.ok(Number.isInteger(saved.shadow.sunAzimuthDeg));
  assert.throws(() => validateHorizonSnapshot({ ...saved, refractionK: 0.2 }), /refractionK/);
  assert.throws(() => validateHorizonSnapshot({ ...saved, label: 'clear view' }), /label/);
  assert.throws(() => validateHorizonSnapshot({ ...saved, extra: 1 }), /unsupported/);
  assert.throws(
    () => validateHorizonSnapshot({ ...saved, horizon: { ...saved.horizon, elevationDeg: [1, 2] } }),
    /360/,
  );
});

test('a horizon saves to Fieldbook as its own analysis kind on the observed place', () => {
  const saved = snapshot();
  const project = prepareAnalysisSave(createFieldbook({ title: 'Doon' }), place, saved, 'horizon');
  assert.equal(project.analyses.length, 1);
  assert.equal(project.analyses[0].kind, 'horizon');
  assert.equal(validateFieldbook(project), project);
  const again = prepareAnalysisSave(project, place, saved, 'horizon');
  assert.equal(again.analyses.length, 1, 'retrying the same save does not duplicate');
  const moved = {
    ...project,
    analyses: [{ ...project.analyses[0], snapshot: { ...saved, observer: { ...saved.observer, lat: 30.5 } } }],
  };
  assert.throws(() => validateFieldbook(moved), /another place/);
  assert.throws(
    () => prepareAnalysisSave(createFieldbook({ title: 'Doon' }), place, { ...saved, peaks: 'none' }, 'horizon'),
    /peaks/,
  );
});
