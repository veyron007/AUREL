// The Cyber theme's stylesheet is not part of the startup CSS: most sessions
// never choose Cyber. It is loaded when Cyber is applied (a restored or chosen
// HUD layout), when the pointer or focus reaches the HUD layout choice, and in
// the background once the app is idle, so a later switch has it parsed and
// shows no unstyled frame. Every rule in it is scoped to the Cyber theme, so
// loading it early changes nothing on screen.

/** Bundler-resolved address of the stylesheet (emitted as its own asset). */
export const CYBER_STYLESHEET_URL = new URL(
  './styles/cyber.css',
  import.meta.url,
).href;

const MARKER = 'data-gev-theme-sheet';
const loads = new WeakMap();

function insertLink(doc) {
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = CYBER_STYLESHEET_URL;
  link.setAttribute(MARKER, 'cyber');
  return link;
}

/**
 * Load the Cyber stylesheet into `doc` once. A failed load removes its link so
 * a later call can retry.
 * @param {Document} [doc]
 * @returns {Promise<boolean>} true once the stylesheet is in, false without a
 *   document.
 */
export function loadCyberStylesheet(doc = globalThis.document) {
  if (!doc?.head || typeof doc.createElement !== 'function')
    return Promise.resolve(false);
  const pending = loads.get(doc);
  if (pending) return pending;
  const link = insertLink(doc);
  const load = new Promise((resolve, reject) => {
    link.addEventListener('load', () => resolve(true), { once: true });
    link.addEventListener(
      'error',
      () => reject(new Error('The Cyber theme stylesheet did not load')),
      { once: true },
    );
  }).catch((error) => {
    link.remove();
    loads.delete(doc);
    throw error;
  });
  loads.set(doc, load);
  doc.head.append(link);
  return load;
}

/** Start loading the stylesheet; a failure is logged, never thrown. */
export function preloadCyberStylesheet(doc = globalThis.document) {
  loadCyberStylesheet(doc).catch((error) =>
    console.error('[theme] Cyber stylesheet unavailable', error),
  );
}

/**
 * Load the stylesheet when the page has nothing else to do.
 * @param {Window} [view]
 */
export function preloadCyberStylesheetWhenIdle(view = globalThis.window) {
  const doc = view?.document;
  if (!doc) return;
  const run = () => preloadCyberStylesheet(doc);
  if (typeof view.requestIdleCallback === 'function')
    view.requestIdleCallback(run, { timeout: 10_000 });
  else view.setTimeout?.(run, 2_000);
}
