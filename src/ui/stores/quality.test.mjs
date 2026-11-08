import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { QUALITY_PREFERENCE_KEY, useQualityStore } from './quality.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test('display quality defaults to Auto and persists a valid choice', () => {
  const store = useQualityStore(createPinia());
  assert.equal(store.mode, 'auto');
  const storage = memoryStorage();
  store.setMode('battery', storage);
  assert.equal(store.mode, 'battery');
  assert.equal(storage.values.get(QUALITY_PREFERENCE_KEY), 'battery');
  store.setMode('ultra', storage);
  assert.equal(store.mode, 'battery', 'unknown modes are ignored');
});

test('a stored choice is restored; a bad or unreadable one keeps Auto', () => {
  const store = useQualityStore(createPinia());
  store.restoreMode(memoryStorage({ [QUALITY_PREFERENCE_KEY]: 'nonsense' }));
  assert.equal(store.mode, 'auto');
  store.restoreMode({
    getItem() {
      throw new Error('denied');
    },
  });
  assert.equal(store.mode, 'auto');
  store.restoreMode(memoryStorage({ [QUALITY_PREFERENCE_KEY]: 'high' }));
  assert.equal(store.mode, 'high');
});

test('only whole non-negative levels are published', () => {
  const store = useQualityStore(createPinia());
  store.publishLevel(2);
  store.publishLevel(-1);
  store.publishLevel(1.5);
  assert.equal(store.level, 2);
});
