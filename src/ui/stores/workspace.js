import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import { msg } from '../../i18n/index.js';
import { createOwners } from './owners.js';

export const WORKSPACE_PREFERENCE_KEY = 'aurel.workspace.appearance.v1';
export const WORKSPACE_DESTINATIONS = Object.freeze([
  {
    id: 'explore',
    label: msg('Explore'),
    icon: 'explore',
    panel: 'lens-panel',
  },
  {
    id: 'compare',
    label: msg('Compare'),
    icon: 'compare',
    panel: 'chronicle-panel',
  },
  { id: 'plan', label: msg('Plan'), icon: 'route', panel: 'planner-panel' },
  {
    id: 'library',
    label: msg('Library'),
    icon: 'bookmarks',
    panel: 'fieldbook-panel',
  },
]);
export const WORKSPACE_APPEARANCES = Object.freeze([
  { id: 'observatory', label: msg('Observatory') },
  { id: 'field', label: msg('Field') },
  { id: 'instrument', label: msg('Instrument') },
]);

/** Existing phone sheets that contain each workspace tool. */
export function workspaceSheetForPanel(panelId) {
  if (panelId === 'location-bar') return 'search';
  if (
    [
      'data-panel',
      'utilities-panel',
      'scene-panel',
      'lens-panel',
      'fieldbook-panel',
      'planner-panel',
      'chronicle-panel',
      'research-panel',
      'watchlist-panel',
      'region-panel',
      'local-commands-panel',
    ].includes(panelId)
  )
    return 'layers';
  if (['cctv-panel', 'street-level-panel'].includes(panelId)) return 'cameras';
  if (
    ['global-context-panel', 'recent-imagery-panel', 'weather-panel'].includes(
      panelId,
    )
  )
    return 'context';
  return 'more';
}

/** Presentation preferences only. Existing owners retain data and tool state. */
export const useWorkspaceStore = defineStore('aurel-workspace', () => {
  const destination = shallowRef('explore');
  const appearance = shallowRef('observatory');
  const sheetSize = shallowRef('half');
  const { connect, detach, act } = createOwners();
  function chooseDestination(id) {
    const item = WORKSPACE_DESTINATIONS.find((entry) => entry.id === id);
    if (!item) return;
    destination.value = id;
    if (sheetSize.value === 'collapsed') sheetSize.value = 'half';
    act('openPanel', item.panel);
  }
  function setAppearance(id, storage) {
    if (!WORKSPACE_APPEARANCES.some((entry) => entry.id === id)) return;
    appearance.value = id;
    // Private browsing and quota failures must not block the map. The choice
    // stays active for this session when persistence is unavailable.
    try {
      (storage ?? globalThis.localStorage)?.setItem(
        WORKSPACE_PREFERENCE_KEY,
        id,
      );
    } catch {
      /* session only */
    }
  }
  function restoreAppearance(storage) {
    try {
      const id = (storage ?? globalThis.localStorage)?.getItem(
        WORKSPACE_PREFERENCE_KEY,
      );
      if (WORKSPACE_APPEARANCES.some((entry) => entry.id === id))
        appearance.value = id;
    } catch {
      /* use the default presentation */
    }
  }
  function setSheetSize(size) {
    if (['collapsed', 'half', 'full'].includes(size)) sheetSize.value = size;
  }
  return {
    destination,
    appearance,
    sheetSize,
    connect,
    detach,
    act,
    chooseDestination,
    setAppearance,
    restoreAppearance,
    setSheetSize,
  };
});
