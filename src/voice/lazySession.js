import { t } from '../i18n/index.js';

/**
 * A voice provider's session adapter whose code loads on first use
 * (PERFORMANCE-PLAN.md WP2.3).
 *
 * The voice controls bind to this adapter at start-up. Its capabilities are
 * known without the provider's code, so the controls render as before. The
 * real adapter (WebRTC or Gemini Live controller plus typed chat) is built
 * the first time the person starts voice or chat or sends text, or when the
 * application preloads the provider once start-up has settled. From then on
 * every call forwards to it, and push-to-talk, tier and cost bindings it was
 * asked for are applied. Until then nothing is connected, so stopping,
 * cancelling and map events have nothing to do. A failed import is a
 * translated error the session shows, and the next start retries.
 */

/**
 * @param {{load: () => Promise<Function>, capabilities: object|(() => object)}} input
 *   `load` resolves with the provider's real session factory.
 * @returns {Function & {preload: () => Promise<void>}} A session factory.
 */
export function createLazySession({ load, capabilities }) {
  if (typeof load !== 'function')
    throw new TypeError('A lazy voice session needs a loader');
  let module = null;
  const live = new Set();
  const loadModule = () =>
    (module ??= Promise.resolve()
      .then(load)
      .catch((error) => {
        module = null;
        throw new Error(
          t('{name} could not be loaded. Check the connection and try again.', {
            name: t('Voice and chat'),
          }),
          { cause: error },
        );
      }));
  const factory = (options) => {
    const adapter = createLazyAdapter(options, {
      capabilities:
        typeof capabilities === 'function' ? capabilities() : capabilities,
      loadModule,
      release: (build) => live.delete(build),
    });
    live.add(adapter.build);
    return adapter.public;
  };
  /** Load the provider's code and build every live adapter now. */
  factory.preload = () =>
    loadModule().then(() =>
      Promise.allSettled([...live].map((build) => build())),
    );
  return factory;
}

function createLazyAdapter(options, { capabilities, loadModule, release }) {
  let real = null;
  let building = null;
  let bound = false;
  const build = () => {
    if (real) return Promise.resolve(real);
    building ??= loadModule().then(
      (createSession) => {
        if (options.signal?.aborted) throw abortError();
        real = createSession(options);
        release(build);
        if (bound) real.bindControls?.();
        return real;
      },
      (error) => {
        building = null;
        throw error;
      },
    );
    return building;
  };
  // Once built, calls forward at once and return what the real adapter does.
  const withReal = (call) => (real ? call(real) : build().then(call));
  options.signal?.addEventListener('abort', () => release(build), {
    once: true,
  });
  return {
    build,
    public: {
      controller: createControllerStandIn(() => real?.controller),
      capabilities,
      start: (settings) => withReal((adapter) => adapter.start(settings)),
      stop: (settings) => real?.stop(settings),
      getStartOptions: () => real?.getStartOptions?.() ?? { pushToTalk: false },
      cancelTurn: () => real?.cancelTurn?.(),
      sendText: (text) => withReal((adapter) => adapter.sendText(text)),
      sendMapEvent: (event) => real?.sendMapEvent(event),
      ignoreButtonClick: () => Boolean(real?.ignoreButtonClick?.()),
      bindControls: () => {
        bound = true;
        real?.bindControls?.();
      },
    },
  };
}

/**
 * The public voice controls object: what the controls attach (session, ui,
 * card, panel accessors) stays on it; anything else reads the real
 * controller once it exists.
 */
function createControllerStandIn(readController) {
  return new Proxy(
    {},
    {
      get(target, name) {
        if (Reflect.has(target, name)) return target[name];
        const controller = readController();
        const value = controller?.[name];
        return typeof value === 'function' ? value.bind(controller) : value;
      },
    },
  );
}

function abortError() {
  return new DOMException('Voice session ended', 'AbortError');
}
