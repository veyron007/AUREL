import { h } from 'vue';

/**
 * A rail panel's body mounted at once inside the panel's root and inner
 * scroller and header (the markup UiPanel draws: `#{id}` > `.{id}-inner` >
 * `.ui-panel__head`). The
 * application loads bodies on demand (src/ui/rail/DeferredPanelBody.vue); a
 * body's own tests render it directly, without the wait.
 * @param {string} id The RailPanel id the body lives in.
 * @param {object} Body The body component.
 */
export function panelWithBody(id, Body) {
  return {
    name: `PanelWithBody(${id})`,
    render: () =>
      h('div', { id, 'data-panel-id': id }, [
        h('div', { class: `${id}-inner` }, [
          h('div', { class: 'ui-panel__head panel-header' }),
          h(Body),
        ]),
      ]),
  };
}
