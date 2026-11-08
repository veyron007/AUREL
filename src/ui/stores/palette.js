import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/**
 * The command palette as its view renders it. The palette composition
 * (src/app/paletteTools.js) publishes the list and answers the view's keys,
 * typing and choices; the rows run existing owners' operations.
 */
export const usePaletteStore = defineStore('aurel-command-palette', () => {
  const view = shallowRef({ open: false });
  const { connect, detach, act, owns } = createOwners();
  /** @param {?object} next A fresh presentation; every publish re-renders. */
  function publish(next) {
    view.value = markRaw(next ?? { open: false });
  }
  return { view, publish, connect, detach, act, owns };
});
