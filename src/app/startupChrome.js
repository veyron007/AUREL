import { initFirstRunExperience } from '../firstRunExperience.js';

/** The splash stays at least this long after navigation started. */
export const MINIMUM_SPLASH_MS = 1000;
/** Fallback when no transitionend arrives (reduced motion, hidden tab). */
export const COVER_FADE_FALLBACK_MS = 400;

/** Milliseconds since navigation started (`performance.timeOrigin`). */
function sinceNavigationStart() {
  return globalThis.performance?.now() ?? MINIMUM_SPLASH_MS;
}

/**
 * Take the faded cover out of the page. Its children (the pulsing logo and
 * status line) leave the DOM, so their infinite animations stop; the empty
 * `#loading-screen` node stays, hidden and `display: none`, so code and QA
 * scripts that query it keep finding a hidden cover.
 */
export function retireLoadingScreen(loadingScreen) {
  loadingScreen.replaceChildren?.();
  loadingScreen.classList.add('retired');
}

/** Reveal welcome controls only after restoration and the loading transition. */
export function startApplicationChrome({
  loadingScreen,
  styleManager,
  dataManager,
  signal,
  initializeWelcome = initFirstRunExperience,
  initializeSettings,
  now = sinceNavigationStart,
  waitForView = () => Promise.resolve(),
}) {
  let disposed = false;
  let firstRun;
  let revealTimer;
  let resolveDelay;
  const minimumDelay = new Promise((resolve) => {
    resolveDelay = resolve;
  });
  // Measured from navigation start, so a slow start never waits longer.
  const delayTimer = setTimeout(
    resolveDelay,
    Math.max(0, MINIMUM_SPLASH_MS - now()),
  );
  const revealFirstRun = () => {
    if (disposed || signal.aborted || firstRun) return;
    retireLoadingScreen(loadingScreen);
    firstRun = initializeWelcome?.({ styleManager, dataManager });
    clearTimeout(revealTimer);
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
  };
  void Promise.all([styleManager.initialRestorePromise, minimumDelay])
    .catch(() => {
      /* Restoration reports its own outcome through the controls. */
    })
    // A bounded wait (src/app/startupView.js) that never rejects.
    .then(() => (disposed || signal.aborted ? null : waitForView()))
    .then(() => {
      if (disposed || signal.aborted) return;
      loadingScreen.classList.add('hidden');
      loadingScreen.addEventListener('transitionend', revealFirstRun, {
        once: true,
      });
      revealTimer = setTimeout(revealFirstRun, COVER_FADE_FALLBACK_MS);
    });
  const keySetup = Promise.resolve(
    signal.aborted ? null : initializeSettings?.({ signal }),
  );
  // Own the pending initializer too; it must not reveal a dialog after abort.
  void keySetup.catch(() =>
    console.error('Provider settings initialization failed'),
  );
  return async () => {
    disposed = true;
    clearTimeout(delayTimer);
    clearTimeout(revealTimer);
    resolveDelay();
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
    firstRun?.destroy();
    (await keySetup.catch(() => null))?.destroy();
  };
}
