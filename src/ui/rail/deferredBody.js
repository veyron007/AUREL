// When a rail panel's body, whose code is a separate chunk, should load
// (src/ui/rail/DeferredPanelBody.vue): at once when its panel opens, else once
// start-up has settled, so the bodies of closed panels are in place before
// anyone opens them and never compete with the start-up bundle.

/** The startup mark set when the loading cover is told to hide. */
const SPLASH_HIDDEN = 'splash-hidden';
/** Idle wait after the cover lifts before closed panels load their bodies. */
const IDLE_TIMEOUT_MS = 2000;

let settled = null;

function coverGone(doc, timing) {
  if (timing?.getEntriesByName?.(SPLASH_HIDDEN, 'mark')?.length) return true;
  // A page without the loading cover (a test, an embed) has no start-up wait.
  return !doc?.getElementById?.('loading-screen');
}

function whenCoverGone(doc, timing, Observer) {
  if (coverGone(doc, timing) || typeof Observer !== 'function')
    return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new Observer((list) => {
      if (!list.getEntriesByName(SPLASH_HIDDEN).length) return;
      observer.disconnect();
      resolve();
    });
    observer.observe({ type: 'mark', buffered: true });
  });
}

function whenIdle(scope) {
  return new Promise((resolve) => {
    if (typeof scope.requestIdleCallback === 'function')
      scope.requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    else scope.setTimeout(resolve, 0);
  });
}

/**
 * Resolves as soon as the loading cover is told to hide, without waiting for
 * an idle moment. For code the person may need the instant the map shows
 * (push-to-talk on Space), loaded after the start-up bundle but before idle.
 * @param {object} [scope] The window; injectable for tests.
 * @returns {Promise<void>}
 */
export function whenStartupCoverGone(scope = globalThis) {
  return whenCoverGone(
    scope.document,
    scope.performance,
    scope.PerformanceObserver,
  );
}

/**
 * Resolves once start-up has settled: the loading cover is gone and the page
 * has been idle once. Shared by every deferred body.
 * @param {object} [scope] The window; injectable for tests.
 * @returns {Promise<void>}
 */
export function whenStartupSettled(scope = globalThis) {
  const wait = () =>
    whenCoverGone(
      scope.document,
      scope.performance,
      scope.PerformanceObserver,
    ).then(() => whenIdle(scope));
  if (scope !== globalThis) return wait();
  settled ??= wait();
  return settled;
}
