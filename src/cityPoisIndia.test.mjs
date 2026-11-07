// INDIA PRESETS — the eight Indian destinations land where they claim to.
//
// src/cityPresets.test.mjs checks every row's shape. This file checks the
// Indian rows against independent references: the city centre each preset
// opens on, landmark coordinates a reviewer can look up on any map, and the
// fallback ground height against the repo's own EGM96 model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITY_POIS } from './cityPois.js';
import { INDIA_CITY_POIS } from './cityPoisIndia.js';
import { LOCATIONS } from './locations.js';
import { greatCircleKm } from './geoDistance.js';
import { ensureGeoidReady, orthometricToEllipsoidal } from './data/geoid.js';

// Centre is the city's commonly cited coordinate; mslM the approximate
// height of the centre above mean sea level.
const CITY_REFERENCES = Object.freeze([
  { id: 'dehradun', name: 'Dehradun', lat: 30.3165, lon: 78.0322, mslM: 640 },
  {
    id: 'mussoorie',
    name: 'Mussoorie',
    lat: 30.4598,
    lon: 78.0644,
    mslM: 1990,
  },
  {
    id: 'rishikesh',
    name: 'Rishikesh',
    lat: 30.0869,
    lon: 78.2676,
    mslM: 340,
  },
  { id: 'delhi', name: 'Delhi', lat: 28.6139, lon: 77.209, mslM: 215 },
  { id: 'mumbai', name: 'Mumbai', lat: 19.076, lon: 72.8777, mslM: 10 },
  {
    id: 'bengaluru',
    name: 'Bengaluru',
    lat: 12.9716,
    lon: 77.5946,
    mslM: 920,
  },
  { id: 'chennai', name: 'Chennai', lat: 13.0827, lon: 80.2707, mslM: 7 },
  { id: 'kolkata', name: 'Kolkata', lat: 22.5726, lon: 88.3639, mslM: 9 },
]);

/** How far a destination's first landmark may sit from the city centre. */
const FIRST_LANDMARK_RADIUS_KM = 20;
/** How far any landmark may sit from the city centre. */
const ANY_LANDMARK_RADIUS_KM = 30;
/** Tolerance on the ellipsoidal ground fallback, metres. */
const GROUND_TOLERANCE_M = 15;
/** Tolerance on a named landmark against its reference, km. */
const LANDMARK_TOLERANCE_KM = 0.3;
/** Smallest camera range over the hill stations, metres. */
const HILL_MIN_RANGE_M = 900;

/** Landmarks a reviewer can check on any map. */
const LANDMARK_REFERENCES = Object.freeze([
  ['dehradun', 'Clock Tower (Ghanta Ghar)', 30.3243, 78.0418],
  ['dehradun', 'Forest Research Institute', 30.342, 77.9997],
  ['dehradun', 'Jolly Grant Airport', 30.1897, 78.1803],
  ['mussoorie', 'Gun Hill', 30.4597, 78.0773],
  ['rishikesh', 'Laxman Jhula', 30.1263, 78.3304],
  ['delhi', 'India Gate', 28.6129, 77.2295],
  ['delhi', 'Qutub Minar', 28.5245, 77.1855],
  ['mumbai', 'Gateway of India', 18.922, 72.8347],
  ['bengaluru', 'Vidhana Soudha', 12.9791, 77.5913],
  ['chennai', 'Fort St. George', 13.0796, 80.2873],
  ['kolkata', 'Victoria Memorial', 22.5448, 88.3426],
  ['kolkata', 'Howrah Bridge', 22.5851, 88.3468],
]);

const km = (a, b) => greatCircleKm(a, { lat: b.lat, lon: b.lon });

test('the eight Indian presets are registered after the originals, Doon valley first', () => {
  const ids = Object.keys(CITY_POIS);
  const indian = ids.filter((id) => Object.hasOwn(INDIA_CITY_POIS, id));
  assert.deepEqual(
    indian,
    CITY_REFERENCES.map(({ id }) => id),
  );
  assert.equal(ids[0], 'austin');
  assert.equal(ids.indexOf('dehradun'), ids.indexOf('tallinn') + 1);
});

test('each preset carries the English name the tray and voice match on', () => {
  for (const { id, name } of CITY_REFERENCES) {
    assert.equal(CITY_POIS[id].name, name, id);
    assert.ok(
      LOCATIONS.some((row) => row.id === id && row.name === name),
      `${id} is missing from LOCATIONS`,
    );
  }
});

test('each preset opens on a landmark in its own city', () => {
  for (const centre of CITY_REFERENCES) {
    const [first, ...rest] = CITY_POIS[centre.id].pois;
    const firstKm = km(centre, first);
    assert.ok(
      firstKm <= FIRST_LANDMARK_RADIUS_KM,
      `${centre.id} opens ${firstKm.toFixed(1)} km from its centre`,
    );
    for (const poi of rest) {
      const distance = km(centre, poi);
      assert.ok(
        distance <= ANY_LANDMARK_RADIUS_KM,
        `${centre.id} · ${poi.name} is ${distance.toFixed(1)} km from its centre`,
      );
    }
  }
});

test('named landmarks sit where a map puts them', () => {
  for (const [id, name, lat, lon] of LANDMARK_REFERENCES) {
    const poi = CITY_POIS[id].pois.find((entry) => entry.name === name);
    assert.ok(poi, `${id} has no landmark ${name}`);
    const distance = km({ lat, lon }, poi);
    assert.ok(
      distance <= LANDMARK_TOLERANCE_KM,
      `${id} · ${name} is ${(distance * 1000).toFixed(0)} m off`,
    );
  }
});

test('the ground fallback is the city height on the WGS84 ellipsoid', async () => {
  await ensureGeoidReady();
  for (const { id, lat, lon, mslM } of CITY_REFERENCES) {
    const expected = orthometricToEllipsoidal(mslM, lat, lon);
    const actual = CITY_POIS[id].groundElevation;
    assert.ok(
      Math.abs(actual - expected) <= GROUND_TOLERANCE_M,
      `${id} ground ${actual} m, expected about ${Math.round(expected)} m`,
    );
  }
});

test('the hill stations are framed from further out than a street', () => {
  // A ridge under a short range puts the camera inside the hill.
  for (const id of ['dehradun', 'mussoorie']) {
    for (const poi of CITY_POIS[id].pois)
      assert.ok(
        poi.alt >= HILL_MIN_RANGE_M,
        `${id} · ${poi.name} range ${poi.alt}`,
      );
  }
});
