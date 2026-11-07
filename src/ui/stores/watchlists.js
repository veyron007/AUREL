import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';
/** Presentation only; the controller owns explicit monitoring and its cross-tab lease. */
export const useWatchlistsStore = defineStore('aurel-watchlists', () => {
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
