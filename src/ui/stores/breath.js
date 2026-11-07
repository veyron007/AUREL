import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** BreathController owns station, citizen and model air; this store renders it. */
export const useBreathStore = defineStore('aurel-breath', () => {
  const view = shallowRef(null);
  const { connect, detach, act } = createOwners();
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return { view, publish, connect, detach, act };
});
