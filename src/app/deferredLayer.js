import { t } from '../i18n/index.js';

/**
 * A layer whose code downloads the first time it is used.
 *
 * The catalog registers this stand-in in the startup bundle. It carries the
 * layer's descriptor (id, name, icon, source, intervals, default parameters
 * and idle statistics) and answers the calls the application makes on a layer
 * that is off. The first `init()` or `enable()` (a toggle, a restored share
 * link, voice or the command palette, all through the lifecycle) imports the
 * layer, constructs it, replays what was handed to the stand-in (attached
 * services, listeners, parameters) and from then on forwards every property.
 * During the import the lifecycle reports the layer as loading; an import
 * failure rejects `init()` like any other layer error, with a readable message.
 *
 * A layer the shell talks to while it is off (CCTV, radio, launches, ...)
 * also declares a facade in its descriptor: the idle answers of the queries
 * the shell reads, the subscriptions that answer at once like the real layer,
 * and the commands that load the layer and forward the call.
 */

/** Lifecycle calls that need the real layer. */
const LOADING_CALLS = new Set(['init', 'enable']);

/**
 * Calls whose latest arguments are kept and replayed once loaded (a later call
 * replaces an earlier one, `null` detaches).
 * @param {string} name
 */
const isRememberedCall = (name) =>
  name.startsWith('attach') || name === 'setRowControlsListener';

/** Calls that register a listener and return its removal. */
const isSubscription = (name) => name.startsWith('subscribe');

/**
 * @typedef {object} LayerDescriptor
 * @property {string} id
 * @property {Readonly<Record<string, unknown>>} values Static properties of
 *   the real layer (name, icon, source, updateInterval, ...).
 * @property {readonly string[]} methods Every method the real layer has.
 * @property {Readonly<Record<string, unknown>>|null} [params] Its
 *   `getParams()` before any change; null when it has no parameters.
 * @property {Readonly<Record<string, unknown>>|null} [stats] Its idle
 *   `getStats()`.
 * @property {Readonly<Record<string, unknown>>} [answers] Idle answers of
 *   query methods: a value (copied per call) or a function of the parameters
 *   set so far (`pending`, the raw merged `setParams` input) and the call's
 *   arguments. An entry that is not a method is an answer `emits` names.
 * @property {Readonly<Record<string, string>>} [emits] Subscriptions that call
 *   the listener at once with the named answer, and again after each
 *   `setParams`, as the real layer does while it is off.
 * @property {readonly string[]} [commands] Methods that load the layer and
 *   forward the call; they resolve with the real method's result.
 * @property {readonly string[]} [remember] Further methods whose latest
 *   arguments are kept and replayed once loaded, like `attach*` calls.
 * @property {Readonly<Record<string, (args: unknown[]) => boolean>>} [skipWhenIdle]
 *   Commands that change nothing with these arguments while no load has
 *   started; they answer `undefined` without loading.
 * @property {(params: object) => boolean} [acceptParams] Whether the real
 *   layer would accept these parameters; refused ones are not kept.
 */

/**
 * @param {LayerDescriptor} descriptor
 * @param {() => Promise<object>} load Imports and constructs the real layer.
 * @returns {object} The stand-in, which becomes the real layer once loaded.
 */
export function createDeferredLayer(descriptor, load) {
  validateDescriptor(descriptor, load);
  const methods = new Set(descriptor.methods);
  const commands = new Set(descriptor.commands ?? []);
  const remembered = new Map();
  const subscriptions = new Set();
  let pendingParams = null;
  let real = null;
  let destroyed = false;

  const answer = (name, args = []) =>
    readAnswer(descriptor.answers[name], pendingParams, args);
  const emitIdle = () => {
    for (const subscription of subscriptions) subscription.emitIdle?.();
  };
  const replay = (layer) => {
    for (const [name, args] of remembered) layer[name](...args);
    remembered.clear();
    if (pendingParams && typeof layer.setParams === 'function')
      layer.setParams(pendingParams, { origin: 'restore' });
    pendingParams = null;
    for (const subscription of subscriptions) subscription.attach(layer);
  };
  const ensureLoaded = createLoader(descriptor, load, {
    isDestroyed: () => destroyed,
    current: () => real,
    adopt: (layer) => {
      replay(layer);
      real = layer;
    },
  });

  const idle = {
    getStats: () => (descriptor.stats ? { ...descriptor.stats } : undefined),
    getParams: () =>
      descriptor.params ? { ...descriptor.params, ...pendingParams } : null,
    setParams: (params) => {
      if (descriptor.acceptParams && !descriptor.acceptParams(params ?? {}))
        return false;
      pendingParams = { ...pendingParams, ...params };
      emitIdle();
      return true;
    },
    getRowControls: () => null,
    update: async () => true,
    disable: async () => true,
    destroy: () => {
      destroyed = true;
      subscriptions.clear();
      remembered.clear();
    },
  };

  const idleCall = (name) => {
    if (LOADING_CALLS.has(name))
      return async (...args) => (await ensureLoaded())[name](...args);
    if (commands.has(name))
      return (...args) =>
        descriptor.skipWhenIdle?.[name]?.(args) && !ensureLoaded.started()
          ? undefined
          : ensureLoaded().then((layer) => layer[name](...args));
    if (descriptor.answers && Object.hasOwn(descriptor.answers, name))
      return (...args) => answer(name, args);
    if (Object.hasOwn(idle, name)) return idle[name];
    if (isRememberedCall(name) || descriptor.remember?.includes(name))
      return (...args) => {
        remembered.set(name, args);
      };
    if (isSubscription(name))
      return (...args) =>
        subscribe(subscriptions, name, args, () => real, {
          emits: descriptor.emits?.[name],
          answer,
        });
    // Anything else asks about data a layer that is off does not have.
    return () => undefined;
  };

  // Not frozen: once loaded, the real layer answers for every property.
  const stand = { ...descriptor.values, id: descriptor.id };
  const loaded = () => real;
  return new Proxy(stand, {
    get(target, property) {
      if (property === DEFERRED_LAYER) return { ensureLoaded, loaded };
      const layer = real;
      if (layer) {
        const value = layer[property];
        return typeof value === 'function' ? value.bind(layer) : value;
      }
      if (typeof property === 'string' && methods.has(property))
        return idleCall(property);
      return target[property];
    },
    has(target, property) {
      if (real) return property in real;
      return (
        property in target ||
        (typeof property === 'string' && methods.has(property))
      );
    },
    ownKeys(target) {
      return Reflect.ownKeys(real ?? target);
    },
    getOwnPropertyDescriptor(target, property) {
      const owner = real ?? target;
      const found = Reflect.getOwnPropertyDescriptor(owner, property);
      return found && { ...found, configurable: true };
    },
  });
}

/** Key of the stand-in's own controls: `layer[DEFERRED_LAYER]`. */
export const DEFERRED_LAYER = Symbol('deferred-layer');

/**
 * Load a layer that may be deferred; resolves at once for any other layer.
 * @param {object} layer
 * @returns {Promise<object>} The real layer.
 */
export function loadDeferredLayer(layer) {
  const control = layer?.[DEFERRED_LAYER];
  return control ? control.ensureLoaded() : Promise.resolve(layer);
}

/** Whether `layer` is a stand-in whose code has not loaded yet. */
export function isDeferredLayerPending(layer) {
  const control = layer?.[DEFERRED_LAYER];
  return Boolean(control && !control.loaded());
}

function subscribe(subscriptions, name, args, currentLayer, idle = {}) {
  const loadedNow = currentLayer();
  if (loadedNow) return loadedNow[name](...args);
  let release = null;
  let active = true;
  const [listener] = args;
  const subscription = {
    attach(layer) {
      if (active) release = layer[name](...args);
    },
    // The real layer calls the listener at once and after each change.
    emitIdle: idle.emits
      ? () => {
          if (active && typeof listener === 'function')
            listener(idle.answer(idle.emits));
        }
      : null,
  };
  subscriptions.add(subscription);
  subscription.emitIdle?.();
  return () => {
    active = false;
    subscriptions.delete(subscription);
    if (typeof release === 'function') release();
    release = null;
  };
}

/** An idle answer: a function of the parameters set so far, or a copy. */
function readAnswer(value, pending, args) {
  if (typeof value === 'function') return value(pending ?? {}, args);
  return value && typeof value === 'object' ? structuredClone(value) : value;
}

/** Import and construct once; a failed import may be retried. */
function createLoader(descriptor, load, { isDestroyed, current, adopt }) {
  let loading = null;
  const ensureLoaded = () => {
    if (current()) return Promise.resolve(current());
    if (isDestroyed())
      return Promise.reject(new Error(`${descriptor.id} was destroyed`));
    loading ??= Promise.resolve()
      .then(load)
      .then(
        (layer) => {
          if (!layer || layer.id !== descriptor.id)
            throw new Error(`${descriptor.id} loaded a different layer`);
          if (isDestroyed()) {
            layer.destroy?.();
            throw new Error(`${descriptor.id} was destroyed`);
          }
          adopt(layer);
          return layer;
        },
        (error) => {
          loading = null;
          throw loadError(descriptor, error);
        },
      );
    return loading;
  };
  ensureLoaded.started = () => Boolean(loading || current());
  return ensureLoaded;
}

function loadError(descriptor, cause) {
  const error = new Error(
    t('{name} could not be loaded. Check the connection and try again.', {
      name: t(String(descriptor.values?.name ?? descriptor.id)),
    }),
    { cause },
  );
  error.layerId = descriptor.id;
  return error;
}

function validateDescriptor(descriptor, load) {
  if (typeof descriptor?.id !== 'string' || !descriptor.id)
    throw new TypeError('A deferred layer needs an id');
  if (!Array.isArray(descriptor.methods))
    throw new TypeError(`${descriptor.id}: the descriptor lists no methods`);
  for (const name of ['init', 'enable', 'disable', 'update'])
    if (!descriptor.methods.includes(name))
      throw new TypeError(`${descriptor.id}: the layer has no ${name}()`);
  if (typeof load !== 'function')
    throw new TypeError(`${descriptor.id}: a loader is required`);
  const emitted = new Set(Object.values(descriptor.emits ?? {}));
  const declared = [
    ...(descriptor.commands ?? []),
    ...(descriptor.remember ?? []),
    ...Object.keys(descriptor.answers ?? {}).filter((key) => !emitted.has(key)),
    ...Object.keys(descriptor.emits ?? {}),
  ];
  for (const name of declared)
    if (!descriptor.methods.includes(name))
      throw new TypeError(`${descriptor.id}: the layer has no ${name}()`);
  for (const name of emitted)
    if (!Object.hasOwn(descriptor.answers ?? {}, name))
      throw new TypeError(`${descriptor.id}: ${name}() has no idle answer`);
}
