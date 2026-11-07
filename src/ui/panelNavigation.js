import PanelRailView from './PanelRailView.vue';
import { PANEL_RAIL_HOST_CLASS, PANEL_RAIL_ITEMS } from './panelRailCatalog.js';
import { usePanelStore } from './stores/panels.js';
import { useWorkspaceStore } from './stores/workspace.js';

/**
 * Own the desktop panel rails: publish each side's panels to the panel store
 * and open or close a panel when its rail item is selected. Disclosure itself
 * stays with PanelChrome, which enforces one open panel per side.
 */
export class PanelNavigation {
  /**
   * @param {object} options
   * @param {{pinia: object, mount: Function}} options.ui Shell Vue runtime.
   * @param {{left: HTMLElement|null, right: HTMLElement|null}} options.stacks Side panel stacks.
   * @param {Function} options.setPanelCollapsed PanelChrome's disclosure operation.
   */
  constructor({ ui, stacks, setPanelCollapsed, openMobileSheet = () => {} }) {
    this._ui = ui;
    this._openMobileSheet = openMobileSheet;
    this._workspace = useWorkspaceStore(ui.pinia);
    this._stacks = stacks;
    this._setPanelCollapsed = setPanelCollapsed;
    this._store = usePanelStore(ui.pinia);
    this._unmounts = [];
    this._hosts = [];
    this._observer = null;
    this._destroyed = false;
  }

  init() {
    if (this._destroyed) return;
    this._workspaceOwner = this._workspace.connect({
      openPanel: (id) => this.openPanel(id),
      openTray: (id) => this.openTray(id),
    });
    for (const side of ['left', 'right']) {
      const stack = this._stacks[side];
      if (!stack) continue;
      // Inside the stack, the rail shows and hides with its panels in every
      // presentation mode (Cockpit, clean view, recording, phone sheets).
      const host = stack.ownerDocument.createElement('div');
      host.className = `${PANEL_RAIL_HOST_CLASS} ${PANEL_RAIL_HOST_CLASS}--${side}`;
      stack.prepend(host);
      this._hosts.push(host);
      this._unmounts.push(
        this._ui.mount(PanelRailView, host, {
          side,
          onSelect: (panelId) => this.select(panelId),
        }),
      );
    }
    if (typeof MutationObserver !== 'undefined') {
      // Only the panels themselves matter: their order, disclosure and
      // availability, not changes inside them or inside the rails.
      this._observer = new MutationObserver((records) => {
        if (records.some((record) => this._isPanelRecord(record))) this.sync();
      });
      for (const stack of Object.values(this._stacks)) {
        if (!stack) continue;
        this._observer.observe(stack, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'hidden'],
        });
      }
    }
    this.sync();
  }

  /** Publish both sides' panels in display order. */
  sync() {
    if (this._destroyed) return;
    for (const side of ['left', 'right']) {
      const stack = this._stacks[side];
      const panels = stack
        ? [...stack.children]
            .filter((panel) => panel.matches('[data-panel-id]'))
            .map((panel) => {
              const shownBy = PANEL_RAIL_ITEMS[panel.id]?.shownBy;
              return {
                id: panel.id,
                title:
                  panel
                    .querySelector('.panel-title, .pp-header-label')
                    ?.textContent.trim() || panel.id,
                open: !panel.classList.contains('collapsed'),
                available:
                  !panel.hidden &&
                  (!shownBy || panel.classList.contains(shownBy)),
              };
            })
        : [];
      this._store.setSide(side, panels);
    }
    // Share restoration can legitimately restore an open panel on each side.
    // Present one inspector without rewriting either saved disclosure choice.
    const visible = [
      ...this._store.sides.left,
      ...this._store.sides.right,
    ].find((panel) => panel.available && panel.open)?.id;
    for (const stack of Object.values(this._stacks)) {
      for (const panel of stack?.children ?? []) {
        if (panel.matches('[data-panel-id]'))
          panel.dataset.workspaceSuppressed = String(
            Boolean(
              visible &&
              panel.id !== visible &&
              !panel.classList.contains('collapsed'),
            ),
          );
      }
    }
  }

  /**
   * Toggle a panel from its rail item.
   * @param {string} panelId Panel element id.
   */
  select(panelId) {
    if (this._destroyed) return;
    // The panel itself, not the store: the store follows its class a
    // microtask later, after a same-task setPanelCollapsed.
    const panel = document.getElementById(panelId);
    if (!panel) return;
    this._setPanelCollapsed(panelId, !panel.classList.contains('collapsed'), {
      explicit: true,
    });
  }

  /** Open an existing tool in the workspace's single inspector. */
  openPanel(panelId) {
    if (this._destroyed) return;
    const offered = [...this._store.sides.left, ...this._store.sides.right];
    const requested = offered.find(
      (panel) => panel.id === panelId && panel.available,
    );
    // Comparison's layer may not have been enabled yet. Keep its entry useful
    // by presenting the data catalog where the existing imagery toggle lives.
    const id = requested
      ? panelId
      : panelId === 'recent-imagery-panel'
        ? 'data-panel'
        : null;
    if (!id) return;
    const activator = document.activeElement;
    this._openMobileSheet(id);
    for (const panel of offered) {
      if (
        panel.id !== id &&
        !document.getElementById(panel.id)?.classList.contains('collapsed')
      )
        this._setPanelCollapsed(panel.id, true, { explicit: true });
    }
    this._setPanelCollapsed(id, false, { explicit: true });
    // The old mobile sheet focuses its first borrowed panel. That panel may
    // just have been collapsed above; keep keyboard focus on the workspace
    // action the person invoked instead of leaving it in hidden content.
    if (
      document.body?.classList.contains('mobile-shell') &&
      activator?.closest?.('#aurel-workspace')
    )
      activator.focus({ preventScroll: true });
  }

  /** Presets and the saved city/landmark tray keep their existing owners. */
  openTray(id) {
    if (this._destroyed || !['control-panel', 'location-bar'].includes(id))
      return;
    this._openMobileSheet(id);
    this._setPanelCollapsed(id, false, { explicit: true });
  }

  _isPanelRecord(record) {
    const stacks = Object.values(this._stacks);
    return record.type === 'childList'
      ? stacks.includes(record.target) &&
          [...record.addedNodes, ...record.removedNodes].some(
            (node) => !this._hosts.includes(node),
          )
      : stacks.includes(record.target.parentElement);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._workspace.detach(this._workspaceOwner);
    this._observer?.disconnect();
    this._observer = null;
    for (const stack of Object.values(this._stacks)) {
      for (const panel of stack?.children ?? [])
        delete panel.dataset.workspaceSuppressed;
    }
    for (const unmount of this._unmounts) unmount();
    this._unmounts = [];
    for (const host of this._hosts) host.remove();
    this._hosts = [];
  }
}
