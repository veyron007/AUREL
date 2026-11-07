import { AgentDeskController } from '../ui/agentDeskController.js';
import { createViewCapture } from '../ui/agentDeskCapture.js';
import { useAgentDeskStore } from '../ui/stores/agentDesk.js';
import { useDisplayStore } from '../ui/stores/display.js';
import { FIELD_KIT_SLOTS } from '../fieldkit/slots.js';
import { isEmbedded } from './embed.js';

const pendingTools = new Set(
  FIELD_KIT_SLOTS.filter((slot) => slot.status === 'pending').map(
    (slot) => slot.name,
  ),
);

/**
 * Compose the agent desk from existing owners: the Fieldbook controller's
 * repository (atomic revision checks), the Watchlist controller's repository,
 * and the viewer for render_view. An app embedded in another page (the MCP
 * Apps panel, ?embed=1) does not answer agent requests; only the owner's own
 * tab does. No request is made on construction; polling starts after init.
 */
export function createAgentDeskTools({
  pinia,
  viewer,
  dataManager,
  fieldbook,
  watchlists,
} = {}) {
  if (isEmbedded() || !fieldbook?.repository) return null;
  const display = useDisplayStore(pinia);
  const controller = new AgentDeskController({
    store: useAgentDeskStore(pinia),
    fieldbook: fieldbook.repository,
    watchlists: watchlists?.repository ?? null,
    has: (name) => !pendingTools.has(name),
    capture: createViewCapture({
      viewer,
      readLayers: () => dataManager?.getAll?.() ?? [],
      readBaseMap: () => {
        const label = display.mapSource?.status?.text;
        return label ? { label, capturedAt: null } : null;
      },
    }),
    onWrite: ({ op, result }) => {
      if (op === 'register_watch') void watchlists?.refresh?.();
      else if (result?.project_id)
        void fieldbook.syncExternalWrite(result.project_id);
    },
  });
  controller.init();
  return { controller, destroy: () => controller.destroy() };
}
