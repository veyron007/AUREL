import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';
/** Presentation only; OrbitWitnessController owns requests, plans and the ride. */
export const useOrbitWitnessStore = defineStore('aurel-orbit-witness', () => {
  const view = shallowRef(null),
    { connect, detach, act, owns } = createOwners();
  return {
    view,
    connect,
    detach,
    act,
    owns,
    publish(next) {
      view.value = next && markRaw(next);
    },
  };
});
