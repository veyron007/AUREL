import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** Explicit local region controls; the file importer owns rendered geometry. */
export const useRegionsStore = defineStore('aurel-regions', () => {
  const view = shallowRef(null);
  const { connect, detach, act, owns } = createOwners();
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return { view, publish, connect, detach, act, owns };
});
