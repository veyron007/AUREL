import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** CorroborationController owns the Second Source card; this store only renders it. */
export const useCorroborationStore = defineStore('aurel-corroboration', () => {
  const view = shallowRef(null);
  const { connect, detach, act } = createOwners();
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return { view, publish, connect, detach, act };
});
