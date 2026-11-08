/**
 * One interval for many periodic UI refreshes (layer status rows, the local
 * ADS-B scene sync), instead of one timer each. It runs only
 * while someone is subscribed and the page is visible; when the page is shown
 * again every subscriber gets one catch-up tick at once.
 */

/**
 * @param {{
 *   intervalMs: number,
 *   visibility?: ?{hidden: boolean, addEventListener?: Function, removeEventListener?: Function},
 * }} options The page whose visibility gates the ticker; the host passes its
 *   document (null runs headless, never hidden).
 */
export function createSharedTicker({ intervalMs, visibility = null }) {
  const subscribers = new Set();
  let timer = null;

  function tick() {
    for (const subscriber of [...subscribers]) {
      try {
        subscriber();
      } catch (error) {
        console.warn('[ticker] subscriber failed:', error);
      }
    }
  }

  /** The clear function paired with the set function that made `timer`. */
  let clearTimer = null;

  function startTimer() {
    if (timer !== null || !subscribers.size || visibility?.hidden) return;
    // Pair the timer with the clear function of the same timer system: a
    // host (or a test's fake clock) may swap the globals while it runs.
    clearTimer = globalThis.clearInterval;
    timer = setInterval(tick, intervalMs);
    // A display ticker never keeps a Node process (tests, tools) alive.
    timer?.unref?.();
  }

  function stopTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
    clearTimer = null;
  }

  function onVisibilityChange() {
    if (visibility?.hidden) {
      stopTimer();
      return;
    }
    if (timer !== null || !subscribers.size) return;
    startTimer();
    tick();
  }

  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    visibility?.[method]?.('visibilitychange', onVisibilityChange);
  }

  return {
    /**
     * @param {() => void} subscriber
     * @returns {() => void} Unsubscribe.
     */
    subscribe(subscriber) {
      if (!subscribers.size) listen(true);
      subscribers.add(subscriber);
      startTimer();
      return () => {
        if (!subscribers.delete(subscriber)) return;
        if (subscribers.size) return;
        stopTimer();
        listen(false);
      };
    },
    running: () => timer !== null,
  };
}
