// i18n-ignore-file: ephemeris reference values
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyPosition,
  moonCoordinates,
  refractionDeg,
  refractionScale,
  sunCoordinates,
} from './ephemeris.js';
import { observerSolarElevation } from '../data/satellitePass.js';
import { calculateDaylight } from '../planner/daylight.js';
import { horizonEvents, localDayBounds, shadowAt } from './events.js';
import { decodeGridPayload } from './grid.js';
import { marchHorizon } from './rayMarch.js';
import { syntheticPayload } from './testFixtures.mjs';

const near = (actual, expected, tolerance, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected} (±${tolerance})`,
  );

test('Sun matches Meeus Example 25.a (1992-10-13 0h)', () => {
  const sun = sunCoordinates(Date.UTC(1992, 9, 13));
  near(sun.apparentLongitude, 199.90988, 0.002, 'apparent longitude');
  near(sun.declination, -7.78507, 0.002, 'declination');
  near(sun.rightAscension, 198.38083, 0.002, 'right ascension');
});

test('equation of time matches its known extremes', () => {
  near(sunCoordinates(Date.UTC(2026, 1, 11, 12)).equationOfTimeMin, -14.2, 0.2, 'February');
  near(sunCoordinates(Date.UTC(2026, 10, 3, 12)).equationOfTimeMin, 16.4, 0.2, 'November');
});

test('Moon matches Meeus Example 47.a within the low-precision series', () => {
  const moon = moonCoordinates(Date.UTC(1992, 3, 12));
  near(moon.longitude, 133.162655, 0.3, 'longitude');
  near(moon.latitude, -3.229126, 0.2, 'latitude');
  near(moon.parallaxDeg, 0.99199, 0.003, 'horizontal parallax');
});

test('solar altitude agrees with the existing USNO routine at Lal Tibba', () => {
  for (const at of ['2026-12-21T07:00:00Z', '2026-06-21T03:00:00Z', '2026-03-20T10:00:00Z']) {
    const ms = Date.parse(at);
    const sun = bodyPosition('sun', 30.4597, 78.1058, ms, { scale: 0 });
    near(sun.trueAltitude, observerSolarElevation(30.4597, 78.1058, ms), 0.02, at);
  }
});

test('refraction is about 34′ at the horizon and shrinks with altitude', () => {
  near(refractionDeg(-0.57) * 60, 34.4, 0.5, 'horizon refraction arcmin');
  assert.equal(refractionDeg(90), 0);
  assert.ok(refractionScale(2300) < 0.85 && refractionScale(2300) > 0.75);
  assert.equal(refractionScale(0), 1);
});

test('flat horizon reproduces the Planner sunrise; an eastern ridge delays it', () => {
  const observer = { lat: 30.4597, lon: 78.1058 };
  const flat = marchHorizon(decodeGridPayload(syntheticPayload()).grid, 0);
  const daylight = calculateDaylight({ ...observer, localDate: '2026-12-21', timeZone: 'Asia/Kolkata' });
  const plain = horizonEvents({ observer, eyeM: 0, horizon: flat, localDate: '2026-12-21', timeZone: 'Asia/Kolkata' });
  assert.equal(plain.sun.astronomicalRise, daylight.sunrise);
  // The computed flat horizon dips below 0°, so the terrain-clipped rise is
  // no later than the standard one and within two minutes of it at sea level.
  const delta = (Date.parse(plain.sun.terrainRise) - Date.parse(daylight.sunrise)) / 60000;
  assert.ok(delta <= 0.5 && delta > -2, `flat delta ${delta} min`);
  // A 5° ridge from azimuth 90° to 150° (where the December Sun rises).
  const ridge = marchHorizon(
    decodeGridPayload(
      syntheticPayload({
        height: (az, d) => (az >= 90 && az <= 150 && Math.abs(d - 5000) < 60 ? 440 : 0),
      }),
    ).grid,
    0,
  );
  const clipped = horizonEvents({ observer, eyeM: 0, horizon: ridge, localDate: '2026-12-21', timeZone: 'Asia/Kolkata' });
  const late = (Date.parse(clipped.sun.terrainRise) - Date.parse(daylight.sunrise)) / 60000;
  assert.ok(late > 20 && late < 50, `ridge delay ${late} min`);
  assert.ok(clipped.sun.directSunMinutes < plain.sun.directSunMinutes);
});

test('local day bounds follow the IANA zone', () => {
  const [start, end] = localDayBounds('2026-12-21', 'Asia/Kolkata');
  assert.equal(new Date(start).toISOString(), '2026-12-20T18:30:00.000Z');
  assert.equal(end - start, 86400000);
  assert.throws(() => localDayBounds('21-12-2026', 'Asia/Kolkata'), /date/);
});

test('gnomon shadow at noon in December and the terrain-shadow case', () => {
  const observer = { lat: 30.4597, lon: 78.1058 };
  const flat = marchHorizon(decodeGridPayload(syntheticPayload()).grid, 0);
  const noon = shadowAt({ observer, eyeM: 0, horizon: flat, at: '2026-12-21T07:00:00Z', gnomonM: 1 });
  near(noon.sunAltitudeDeg, 36.0, 0.1, 'sun altitude');
  near(noon.shadowLengthM, 1 / Math.tan((noon.sunAltitudeDeg * Math.PI) / 180), 1e-9, 'shadow');
  near(noon.shadowAzimuthDeg, (noon.sunAzimuthDeg + 180) % 360, 1e-9, 'shadow azimuth');
  assert.equal(noon.sunlit, true);
  const wall = marchHorizon(
    decodeGridPayload(syntheticPayload({ height: (az, d) => (Math.abs(d - 500) < 20 ? 500 : 0) })).grid,
    0,
  );
  const shaded = shadowAt({ observer, eyeM: 0, horizon: wall, at: '2026-12-21T07:00:00Z', gnomonM: 1 });
  assert.equal(shaded.sunlit, false);
  assert.equal(shaded.shadowLengthM, null);
  assert.throws(() => shadowAt({ observer, eyeM: 0, horizon: flat, at: 'later' }), /time/);
  assert.throws(() => shadowAt({ observer, eyeM: 0, horizon: flat, at: '2026-12-21T07:00:00Z', gnomonM: 0 }), /gnomon/);
});

test('moonrise is reported against both horizons on a date with a moonrise', () => {
  const observer = { lat: 30.4597, lon: 78.1058 };
  const flat = marchHorizon(decodeGridPayload(syntheticPayload()).grid, 0);
  const events = horizonEvents({ observer, eyeM: 0, horizon: flat, localDate: '2026-12-21', timeZone: 'Asia/Kolkata' });
  assert.ok(events.moon.astronomicalRise);
  const delta = Math.abs(Date.parse(events.moon.terrainRise) - Date.parse(events.moon.astronomicalRise)) / 60000;
  assert.ok(delta < 3, `moon flat delta ${delta}`);
});
