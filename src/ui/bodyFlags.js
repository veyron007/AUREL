/**
 * Page-state flags on <body> for stylesheet rules that used `body:has(...)`.
 * A `:has()` on body is re-matched against the whole document on every DOM
 * change; a data attribute set by the owner of that state costs one write.
 *
 * - `data-hud-minimal`: the HUD is shown in its minimal layout
 *   (set by views/IntelHudView.vue from the HUD store).
 * - `data-left-panel-open`: a collapsible panel in #left-panel-stack is open
 *   (set by views/LayerPanelsView.vue, watching its own panels).
 */
export const HUD_MINIMAL_FLAG = 'data-hud-minimal';
export const LEFT_PANEL_OPEN_FLAG = 'data-left-panel-open';

/**
 * @param {{toggleAttribute: Function}|null|undefined} body
 * @param {string} name
 * @param {boolean} on
 * @returns {void}
 */
export function setBodyFlag(body, name, on) {
  body?.toggleAttribute?.(name, Boolean(on));
}

/** Whether a HUD presentation is the active minimal layout. */
export function hudIsMinimal(hud) {
  return Boolean(hud?.active) && hud?.variant === 'minimal';
}

/** Whether any direct collapsible child of the stack is open. */
export function hasOpenPanel(stack) {
  return Boolean(
    stack?.querySelector?.(':scope > .panel-collapsible:not(.collapsed)'),
  );
}

/**
 * Keep `data-left-panel-open` in step with the stack's panels.
 * @param {Element} stack #left-panel-stack
 * @param {{toggleAttribute: Function}} body
 * @param {typeof MutationObserver} [Observer]
 * @returns {() => void} Disposer; clears the flag.
 */
export function watchLeftPanels(
  stack,
  body,
  Observer = globalThis.MutationObserver,
) {
  if (!stack || !body) throw new TypeError('watchLeftPanels needs elements');
  const sync = () =>
    setBodyFlag(body, LEFT_PANEL_OPEN_FLAG, hasOpenPanel(stack));
  sync();
  if (typeof Observer !== 'function')
    return () => setBodyFlag(body, LEFT_PANEL_OPEN_FLAG, false);
  const observer = new Observer((records) => {
    // Only a panel's own class or the stack's children change the answer.
    if (
      records.some((record) =>
        record.type === 'childList'
          ? record.target === stack
          : record.target.parentElement === stack,
      )
    )
      sync();
  });
  observer.observe(stack, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => {
    observer.disconnect();
    setBodyFlag(body, LEFT_PANEL_OPEN_FLAG, false);
  };
}
