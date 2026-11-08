/**
 * Chrome rest: after a quiet spell without input the workspace chrome fades so
 * the globe is the only thing in view; any pointer, key, wheel, touch or focus
 * wakes it. The owner only sets a body class; the theme decides what resting
 * looks like (and, under prefers-reduced-motion, that it does not animate).
 *
 * Chrome never rests while the person is using something: an open side panel,
 * dock tray, dialog, popover, the search field, the command palette or a live
 * voice turn holds it awake. Resting starts only after the first real input,
 * so the opening view shows everything.
 */
export const CHROME_REST_CLASS = 'chrome-resting';
export const CHROME_REST_DELAY_MS = 5000;
/** How often a resting chrome re-checks that nothing now holds it awake. */
export const CHROME_REST_CHECK_MS = 1000;
export const CHROME_WAKE_EVENTS = Object.freeze([
  'pointermove',
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'focusin',
]);

/** Open surfaces that hold the chrome awake. */
export const CHROME_HOLD_SELECTORS = Object.freeze([
  ":is(#left-panel-stack, #right-context-rail) > [data-panel-id]:not(.collapsed):not([hidden]):not([data-workspace-suppressed='true'])",
  '#command-dock :is(#location-bar, #control-panel):not(.collapsed)',
  'dialog[open]',
  "[role='dialog']:not([hidden])",
  "[aria-modal='true']:not([hidden])",
  '#first-run-launcher:not([hidden])',
  '#key-setup:not([hidden])',
  '.command-palette',
  "#gev-voice-control:is([data-status='listening'], [data-status='connecting'], [data-status='executing'])",
  "#gev-voice-control[data-chat-open='true']",
]);

/** Expanded disclosures (popovers, menus) hold it only while on screen. */
export const CHROME_HOLD_EXPANDED = "[aria-expanded='true']";

/** Whether an element is rendered; engines without checkVisibility say yes. */
function shown(element) {
  return typeof element.checkVisibility === 'function'
    ? element.checkVisibility()
    : true;
}

const EDITABLE =
  "input, textarea, select, [contenteditable='true'], [contenteditable='']";

/**
 * Whether anything the person is using holds the chrome awake.
 * @param {Document} doc
 * @returns {boolean}
 */
export function chromeHeldAwake(doc = globalThis.document) {
  if (!doc) return false;
  const active = doc.activeElement;
  if (active && active !== doc.body && active.matches?.(EDITABLE)) return true;
  const held = CHROME_HOLD_SELECTORS.some((selector) => {
    try {
      return Boolean(doc.querySelector(selector));
    } catch {
      // A selector the engine cannot parse holds nothing.
      return false;
    }
  });
  return held || [...doc.querySelectorAll(CHROME_HOLD_EXPANDED)].some(shown);
}

export class ChromeRest {
  /**
   * @param {object} options
   * @param {{classList: DOMTokenList}} options.target Element given the class (the body).
   * @param {{addEventListener: Function, removeEventListener: Function}} options.events Where input is heard (the window).
   * @param {() => boolean} [options.isHeld] Whether something holds the chrome awake.
   * @param {number} [options.delayMs] Quiet time before resting.
   * @param {number} [options.checkMs] Re-check interval while resting.
   * @param {Function} [options.setTimer]
   * @param {Function} [options.clearTimer]
   */
  constructor({
    target,
    events,
    isHeld = () => false,
    delayMs = CHROME_REST_DELAY_MS,
    checkMs = CHROME_REST_CHECK_MS,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (id) => clearTimeout(id),
  }) {
    Object.assign(this, {
      target,
      events,
      isHeld,
      delayMs,
      checkMs,
      setTimer,
      clearTimer,
    });
    this.timer = null;
    this.resting = false;
    this.started = false;
    this.destroyed = false;
    this.onInput = () => this.wake();
  }

  /** Listen for input; the first input arms the rest timer. */
  start() {
    if (this.started || this.destroyed) return;
    this.started = true;
    for (const name of CHROME_WAKE_EVENTS)
      this.events?.addEventListener?.(name, this.onInput, {
        capture: true,
        passive: true,
      });
  }

  /** Input arrived: show the chrome and start the quiet spell again. */
  wake() {
    if (this.destroyed) return;
    this.setResting(false);
    this.schedule(this.delayMs);
  }

  schedule(ms) {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.tick(), ms);
  }

  tick() {
    this.timer = null;
    if (this.destroyed) return;
    let held = true;
    try {
      held = this.isHeld();
    } catch {
      // A failing check keeps the chrome visible rather than hiding controls.
      held = true;
    }
    if (held) {
      this.setResting(false);
      this.schedule(this.delayMs);
      return;
    }
    this.setResting(true);
    // Keep watching: a panel or voice turn can open without new input.
    this.schedule(this.checkMs);
  }

  setResting(resting) {
    if (this.resting === resting) return;
    this.resting = resting;
    this.target?.classList?.toggle(CHROME_REST_CLASS, resting);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    for (const name of CHROME_WAKE_EVENTS)
      this.events?.removeEventListener?.(name, this.onInput, { capture: true });
    this.target?.classList?.remove(CHROME_REST_CLASS);
    this.resting = false;
  }
}
