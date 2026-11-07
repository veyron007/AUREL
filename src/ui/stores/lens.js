import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** LensController owns selection and evidence; this store only renders it. */
export const useLensStore = defineStore('aurel-lens', () => {
  const view = shallowRef(null);
  const { connect, detach, act } = createOwners();
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return { view, publish, connect, detach, act };
});
