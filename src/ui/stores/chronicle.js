import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** Chronicle presents explicit dated comparisons; imagery ownership stays with its layer. */
export const useChronicleStore = defineStore('aurel-chronicle', () => {
  const view = shallowRef(null);
  const { connect, detach, act, owns } = createOwners();
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return { view, publish, connect, detach, act, owns };
});
