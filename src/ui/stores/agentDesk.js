import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/** Presentation only; the agent desk controller owns the toggle and the relay. */
export const useAgentDeskStore = defineStore('aurel-agent-desk', () => {
  const view = shallowRef(null);
  const { connect, detach, act, owns } = createOwners();
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
