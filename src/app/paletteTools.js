import { watch } from 'vue';
import { t } from '../i18n/index.js';
import { CommandPalette, paletteShortcut } from '../ui/commandPalette.js';
import { panelLabel, presentLayerToggle } from '../ui/layerPanel.js';
import { useGlobeActionsStore } from '../ui/stores/globeActions.js';
import { useLocationStore } from '../ui/stores/location.js';
import { usePaletteStore } from '../ui/stores/palette.js';
import { useVoiceStore } from '../ui/stores/voice.js';
import {
  useWorkspaceStore,
  WORKSPACE_DESTINATIONS,
} from '../ui/stores/workspace.js';

/**
 * Compose the command palette over existing owners: place suggestions and
 * choices through LocationControls, layer toggles through the data manager
 * exactly as the Data Layers row does, destinations through the workspace,
 * reset through the globe actions and voice through the voice presenter.
 * No model, request or new action path is added here.
 */
export function createPaletteTools({
  pinia,
  dataManager,
  documentRef = globalThis.document,
} = {}) {
  const store = usePaletteStore(pinia);
  const location = useLocationStore(pinia);
  const workspace = useWorkspaceStore(pinia);
  const voice = useVoiceStore(pinia);
  const globe = useGlobeActionsStore(pinia);
  let destroyed = false;

  const layerList = () =>
    (dataManager?.getAll?.() || [])
      .filter((layer) => layer?.showInTogglePanel)
      .map((layer) => ({
        id: layer.id,
        name: panelLabel(layer),
        enabled: Boolean(layer.enabled),
        available: !presentLayerToggle(layer).ariaDisabled,
      }));

  function actions() {
    const list = WORKSPACE_DESTINATIONS.map((destination) => ({
      id: `destination:${destination.id}`,
      title: t('Open {name}', { name: t(destination.label) }),
      meta: t('Workspace'),
      keywords: [t(destination.label), destination.id],
      run: () => workspace.chooseDestination(destination.id),
    }));
    list.push({
      id: 'data-layers',
      title: t('Open data layers'),
      meta: t('Workspace'),
      keywords: ['layers', 'data'],
      run: () => workspace.act('openPanel', 'data-panel'),
    });
    list.push({
      id: 'reset',
      title: t('Reset to full globe view'),
      keywords: ['globe', 'reset', 'home', 'earth'],
      run: () => globe.act('reset'),
    });
    if (voice.view && voice.controls)
      list.push({
        id: 'voice',
        title: voice.view.button?.pressed ? t('Stop voice') : t('Start voice'),
        keywords: ['voice', 'talk', 'microphone', 'mic'],
        run: () => voice.controls?.emit('button'),
      });
    return list;
  }

  const palette = new CommandPalette({
    places: {
      suggest: (text) => location.controls?.suggestPlaces?.(text),
      items: () => location.view?.suggest?.items ?? [],
      status: () => location.view?.suggest?.status ?? '',
      choose: (index) => location.controls?.chooseSuggestion(index),
      close: () => location.controls?.closeSuggestions?.(),
    },
    layers: {
      list: layerList,
      // The same operation and origin as the Data Layers row's toggle; a
      // busy or unavailable layer is not offered.
      toggle: (id) =>
        dataManager.setEnabled(id, !dataManager.isEnabled(id), {
          origin: 'user',
        }),
    },
    actions,
    words: () => ({ layer: t('Layer'), on: t('On'), off: t('Off') }),
    onChange: () => {
      if (!destroyed) store.publish(palette.view());
    },
  });
  const owner = store.connect({
    open: () => palette.open(),
    close: () => palette.close(),
    toggle: () => palette.toggle(),
    setQuery: (text) => palette.setQuery(text),
    key: (event) => palette.key(event),
    highlight: (index) => palette.highlight(index),
    activate: (index) => palette.activate(index),
  });
  // New place suggestions arrive through the location owner's publications.
  const stopWatching = watch(
    () => location.view?.suggest,
    () => palette.refresh(),
  );
  const onKeyDown = (event) => {
    // Only the AUREL workspace renders the palette.
    if (!documentRef?.body?.dataset?.workspaceAppearance) return;
    const shortcut = paletteShortcut(event);
    if (!shortcut || (shortcut === 'open' && palette.isOpen)) return;
    event.preventDefault();
    if (shortcut === 'toggle') palette.toggle();
    else palette.open();
  };
  documentRef?.addEventListener?.('keydown', onKeyDown);
  return {
    palette,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      documentRef?.removeEventListener?.('keydown', onKeyDown);
      stopWatching();
      store.detach(owner);
      palette.destroy();
      store.publish({ open: false });
    },
  };
}
