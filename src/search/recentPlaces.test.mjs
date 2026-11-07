import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentPlaces, RECENT_PLACES_MAX } from './recentPlaces.js';

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

const place = (i) => ({
  lat: 30 + i / 100,
  lng: 78,
  name: `P${i}`,
  label: `Place ${i}`,
});

test('recent places keep the newest first, deduplicated and bounded', () => {
  const recent = createRecentPlaces({ storage: memory() });
  for (let i = 0; i < 10; i++) recent.remember(place(i));
  recent.remember(place(9));
  const list = recent.read();
  assert.equal(list.length, RECENT_PLACES_MAX);
  assert.equal(list[0].name, 'P9');
  assert.equal(new Set(list.map((p) => p.label)).size, list.length);
});

test('invalid places are not stored', () => {
  const recent = createRecentPlaces({ storage: memory() });
  recent.remember({ lat: 999, lng: 0, label: 'bad' });
  recent.remember({ lat: 1, lng: 1, label: ' ' });
  assert.deepEqual(recent.read(), []);
});

test('blocked or corrupt storage degrades to an empty list', () => {
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  const recent = createRecentPlaces({ storage: throwing });
  recent.remember(place(1));
  assert.deepEqual(recent.read(), []);
  const corrupt = memory();
  corrupt.setItem('aurel:recent-places:v1', '{not json');
  assert.deepEqual(createRecentPlaces({ storage: corrupt }).read(), []);
  assert.deepEqual(createRecentPlaces({ storage: null }).read(), []);
});
