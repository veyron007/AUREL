import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** Plain Fieldbook presentation; persistence and actions belong to its controller. */
export const useFieldbookStore = defineStore('aurel-fieldbook', () => {
  const view = shallowRef(null);
  const { connect, detach, act, owns } = createOwners();
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return { view, publish, connect, detach, act, owns };
});
