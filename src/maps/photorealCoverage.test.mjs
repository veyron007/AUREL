// Google 3D unavailability advice follows where the camera is: over a known
// gap in Google's photorealistic mesh (India) it names coverage, not the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n/index.js';
import { photorealUnavailableReason } from './availability.js';
import { createDefaultMapSources } from './defaultSources.js';
import { cameraGeoPoint, photorealCoverageGapAt } from './photorealCoverage.js';

test.afterEach(() => setLocale('en'));

const DEHRADUN = { lat: 30.3245, lon: 78.0413 };
const COVERAGE = /outside Google's photorealistic coverage/;

for (const [name, lat, lon] of [
  ['Dehradun', 30.3245, 78.0413],
  ['Mussoorie', 30.4597, 78.0773],
  ['Delhi', 28.6129, 77.2295],
  ['Amritsar', 31.634, 74.8723],
  ['Leh', 34.1526, 77.5771],
  ['Mumbai', 18.922, 72.8347],
  ['Bengaluru', 12.9791, 77.5913],
  ['Chennai', 13.0827, 80.2707],
  ['Kolkata', 22.5448, 88.3426],
  ['Siliguri', 26.7271, 88.3953],
  ['Guwahati', 26.1445, 91.7362],
  ['Kanyakumari', 8.0883, 77.5385],
]) {
  test(`${name} lies in the India coverage gap`, () => {
    assert.equal(photorealCoverageGapAt({ lat, lon }), 'india');
  });
}

for (const [name, lat, lon] of [
  ['Lahore', 31.5497, 74.3436],
  ['Karachi', 24.8607, 67.0011],
  ['Kathmandu', 27.7172, 85.324],
  ['Dhaka', 23.8103, 90.4125],
  ['Colombo', 6.9271, 79.8612],
  ['Lhasa', 29.652, 91.1721],
  ['Tokyo', 35.6762, 139.6503],
  ['Austin', 30.2747, -97.7403],
]) {
  test(`${name} is not in a known coverage gap`, () => {
    assert.equal(photorealCoverageGapAt({ lat, lon }), null);
  });
}

test('no point, or a malformed one, is no gap', () => {
  assert.equal(photorealCoverageGapAt(null), null);
  assert.equal(photorealCoverageGapAt(undefined), null);
  assert.equal(photorealCoverageGapAt({ lat: 'x', lon: 78 }), null);
  assert.equal(photorealCoverageGapAt({ lat: Number.NaN, lon: 78 }), null);
});

test('with credentials over Dehradun the reason names coverage first', () => {
  const reason = photorealUnavailableReason(true, { at: DEHRADUN });
  assert.match(reason, COVERAGE);
  // The key can still be at fault, so the check stays as a second step.
  assert.match(
    reason,
    /If 3D fails elsewhere too.*restrictions, quota, or network/,
  );
  assert.ok(reason.indexOf('coverage') < reason.indexOf('restrictions'));
});

test('without credentials over Dehradun a key is not offered as the fix', () => {
  const reason = photorealUnavailableReason(false, { at: DEHRADUN });
  assert.match(reason, COVERAGE);
  assert.match(reason, /would not add 3D buildings here/);
  assert.doesNotMatch(reason, /Needs|add it in Provider Settings/);
});

test('outside a gap the credential advice is unchanged', () => {
  const austin = { lat: 30.2747, lon: -97.7403 };
  assert.equal(
    photorealUnavailableReason(true, { at: austin }),
    "Google 3D tiles unavailable — check the key's API restrictions, quota, or network",
  );
  assert.match(
    photorealUnavailableReason(false, { at: austin }),
    /Needs GOOGLE_MAPS_API_KEY.*Provider Settings/,
  );
  // An unknown camera position keeps the original advice.
  assert.doesNotMatch(photorealUnavailableReason(true), COVERAGE);
  assert.doesNotMatch(photorealUnavailableReason(false), COVERAGE);
});

test('the coverage reason follows the UI language', () => {
  setLocale('ru');
  assert.match(
    photorealUnavailableReason(true, { at: DEHRADUN }),
    /фотореалистичного покрытия Google/,
  );
});

test('the photoreal source reads the camera when its reason is shown', () => {
  let at = { lat: 40.7128, lon: -74.006 };
  const sources = createDefaultMapSources({
    googleApiKey: 'configured',
    cameraPoint: () => at,
  });
  const photoreal = sources.sources.find(
    ({ descriptor }) => descriptor.kind === 'photoreal',
  );
  assert.equal(photoreal.available, false);
  assert.doesNotMatch(photoreal.unavailableReason(), COVERAGE);
  at = DEHRADUN;
  assert.match(photoreal.unavailableReason(), COVERAGE);
});

test('Free-only keeps its policy reason over India', () => {
  const sources = createDefaultMapSources({
    googleApiKey: 'configured',
    freeOnly: true,
    cameraPoint: () => DEHRADUN,
  });
  const photoreal = sources.sources.find(
    ({ descriptor }) => descriptor.kind === 'photoreal',
  );
  assert.match(photoreal.unavailableReason(), /Paused by Free-only/);
});

test('the camera point is read in degrees from a Cesium-shaped camera', () => {
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const point = cameraGeoPoint({
    camera: {
      positionCartographic: {
        latitude: toRadians(DEHRADUN.lat),
        longitude: toRadians(DEHRADUN.lon),
      },
    },
  });
  assert.ok(Math.abs(point.lat - DEHRADUN.lat) < 1e-9);
  assert.ok(Math.abs(point.lon - DEHRADUN.lon) < 1e-9);
  assert.equal(cameraGeoPoint(null), null);
  assert.equal(cameraGeoPoint({ camera: {} }), null);
  const destroyed = {
    get camera() {
      throw new Error('destroyed');
    },
  };
  assert.equal(cameraGeoPoint(destroyed), null);
});
