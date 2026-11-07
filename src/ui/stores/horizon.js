import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** The Kshitij owner computes horizons; this store only presents named actions. */
export const useHorizonStore = defineStore('aurel-horizon', () => {
  const view = shallowRef(null);
  const { connect, detach, act, owns } = createOwners();
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return { view, publish, connect, detach, act, owns };
});
