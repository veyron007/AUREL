import { LocalCommandController } from '../ui/localCommandController.js';
import { validateLocalCommand } from '../localAssistant/commands.js';
import { useLocalCommandsStore } from '../ui/stores/localCommands.js';
import { useLensStore } from '../ui/stores/lens.js';
import { useFieldbookStore } from '../ui/stores/fieldbook.js';
import { useChronicleStore } from '../ui/stores/chronicle.js';
import { useWorkspaceStore } from '../ui/stores/workspace.js';
import { usePanelChromeStore } from '../ui/stores/panelChrome.js';

/** No model or acquisition on construction. Each accepted command uses an existing owner. */
export function createLocalCommandTools({
  pinia,
  personalWorkspace,
  chronicle,
  dataManager,
  runCoordinate,
  stageSearch,
} = {}) {
  const lens = useLensStore(pinia),
    fieldbook = useFieldbookStore(pinia),
    compare = useChronicleStore(pinia),
    workspace = useWorkspaceStore(pinia),
    chrome = usePanelChromeStore(pinia);
  let destroyed = false;
  const route = () =>
    dataManager?.layers?.get('directions')?.module?.getRouteSnapshot?.() ||
    null;
  function readContext() {
    const draft = fieldbook.view?.draft,
      selection = lens.view?.selection,
      snapshot = route(),
      slots = compare.view?.slots;
    const evidence = draft?.evidence || [];
    return {
      origin: 'user',
      hasProject: Boolean(draft),
      hasSelection: Boolean(selection),
      hasRoute: Boolean(snapshot),
      canCompare: compare.view?.canCompare === true,
      selectedDates: [
        slots?.a?.asset?.requestedDate,
        slots?.b?.asset?.requestedDate,
      ],
      evidenceState: evidence.some((row) => row.feedState === 'stale')
        ? 'stale'
        : evidence.some((row) =>
              ['nominal', 'partial', 'degraded', 'fallback'].includes(
                row.feedState,
              ),
            )
          ? 'ready'
          : 'unavailable',
      selectionKey: JSON.stringify(
        selection ? [selection.id, selection.geometry] : null,
      ),
      routeKey: JSON.stringify(snapshot),
      projectKey: draft?.id || null,
      compareKey: JSON.stringify([compare.view?.selection, slots]),
      evidenceKey: JSON.stringify(evidence),
    };
  }
  async function open(panelId) {
    await workspace.act('openPanel', panelId);
    return chrome.panels[panelId]?.collapsed === false;
  }
  const controller = new LocalCommandController({
    store: useLocalCommandsStore(pinia),
    readContext,
    async execute(proposal, { signal }) {
      signal.throwIfAborted();
      if (destroyed) return false;
      const command = validateLocalCommand(proposal, readContext());
      const { type, args } = command;
      if (type === 'open_panel') return open(args.panelId);
      if (type === 'search_places')
        return (await stageSearch?.(args.query, { signal })) === true;
      if (type === 'fly_to_location')
        return (await runCoordinate?.(args, { signal })) === true;
      if (type === 'save_place')
        return (await personalWorkspace?.lens?.savePlace()) === true;
      if (type === 'save_project') {
        if (!fieldbook.view?.dirty) return false;
        return (await personalWorkspace?.fieldbook?.save()) === true;
      }
      if (type === 'save_route') {
        if (!(await personalWorkspace?.fieldbook?.capture('route')))
          return false;
        signal.throwIfAborted();
        if (destroyed) return false;
        return (await personalWorkspace.fieldbook.save()) === true;
      }
      if (type === 'brief_selected') {
        if (!personalWorkspace?.fieldbook?.toggleBrief) return false;
        if (!fieldbook.view?.brief) personalWorkspace.fieldbook.toggleBrief();
        return open('fieldbook-panel');
      }
      if (type === 'compare_selected')
        return (
          (await (chronicle?.controller || chronicle)?.compare?.()) === true
        );
      if (type === 'set_layer_visibility') {
        const entry = dataManager?.layers?.get(args.layerId);
        if (!entry) return false;
        await dataManager.setEnabled(args.layerId, args.enabled, {
          signal,
          origin: 'local-command',
        });
        signal.throwIfAborted();
        return entry.enabled === args.enabled;
      }
      return false;
    },
  });
  controller.init();
  return {
    controller,
    destroy() {
      destroyed = true;
      controller.destroy();
    },
  };
}
