import { defineStore } from 'pinia';
import { ref } from 'vue';
import { msg } from '../../i18n/marker.js';

/** localStorage key of the chosen display quality mode. */
export const QUALITY_PREFERENCE_KEY = 'gev-display-quality';

/**
 * Display quality choices in Settings. Auto lets the quality governor
 * (src/app/qualityGovernor.js) step down only while frames are slow; the
 * others hold one level.
 */
export const QUALITY_MODES = Object.freeze([
  Object.freeze({ id: 'auto', label: msg('Auto') }),
  Object.freeze({ id: 'high', label: msg('High') }),
  Object.freeze({ id: 'balanced', label: msg('Balanced') }),
  Object.freeze({ id: 'battery', label: msg('Battery') }),
]);

const isMode = (id) => QUALITY_MODES.some((mode) => mode.id === id);

/**
 * The chosen mode and the level the governor currently applies (0 is full
 * quality). The governor reads `mode` and publishes `level`.
 */
export const useQualityStore = defineStore('gev-display-quality', () => {
  const mode = ref('auto');
  const level = ref(0);

  function setMode(id, storage) {
    if (!isMode(id)) return;
    mode.value = id;
    // Private browsing and quota failures keep the choice for this session.
    try {
      (storage ?? globalThis.localStorage)?.setItem(QUALITY_PREFERENCE_KEY, id);
    } catch {
      /* session only */
    }
  }

  function restoreMode(storage) {
    try {
      const id = (storage ?? globalThis.localStorage)?.getItem(
        QUALITY_PREFERENCE_KEY,
      );
      if (isMode(id)) mode.value = id;
    } catch {
      /* keep Auto */
    }
  }

  function publishLevel(next) {
    if (Number.isInteger(next) && next >= 0) level.value = next;
  }

  return { mode, level, setMode, restoreMode, publishLevel };
});
