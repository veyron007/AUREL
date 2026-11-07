import {
  forecastCard,
  forecastPoints,
  glofasCard,
  imergCard,
  imergRequestCells,
  watchObservation,
} from '../hydro/rainCards.js';
import {
  BASIN_WATCH_LIMITS,
  createBasinWatch,
  reduceBasinCheck,
  validateBasinWatch,
} from '../hydro/basinWatch.js';

const STORAGE_KEY = 'aurel.raindrop.watches.v1';
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

/** Local, explicit storage for basin watches; failures leave watches in memory only. */
export function createWatchStorage(storage = globalThis.localStorage) {
  return {
    read() {
      try {
        const rows = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(rows)
          ? rows.slice(0, BASIN_WATCH_LIMITS.watches).flatMap((row) => {
              try {
                return [validateBasinWatch(row)];
              } catch {
                return [];
              }
            })
          : [];
      } catch {
        return [];
      }
    },
    write(rows) {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(rows));
        return true;
      } catch {
        return false;
      }
    },
  };
}

const query = (cells) => cells.map((cell) => cell.key).join(',');

/**
 * Raindrop owner: one explicit drop at a time, its three data cards and the
 * basin watches. Construction never starts a request.
 */
export class RaindropController {
  constructor({
    store,
    analysis,
    render = {},
    pickPoint = async () => null,
    readSelection = () => null,
    fetchJson,
    storage = createWatchStorage(),
    now = Date.now,
    schedule = (fn, ms) => setInterval(fn, ms),
    unschedule = (timer) => clearInterval(timer),
    isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  }) {
    Object.assign(this, {
      store,
      analysis,
      render,
      pickPoint,
      readSelection,
      fetchJson,
      storage,
      now,
      schedule,
      unschedule,
      isVisible,
    });
    this.state = { status: 'idle', error: null };
    this.result = null;
    this.cards = { imerg: null, forecast: null, glofas: null };
    this.watches = [];
    this.watchesPaused = false;
    this.checking = false;
    this.run = null;
    this.timer = null;
    this.destroyed = false;
  }

  init() {
    if (this.owner || this.destroyed) return;
    const actions = [
      'pick',
      'traceSelection',
      'traceAt',
      'cancel',
      'clear',
      'replay',
      'readGlofas',
      'addWatch',
      'removeWatch',
      'checkWatches',
      'resumeWatches',
    ];
    this.owner = this.store?.connect(
      Object.fromEntries(
        actions.map((name) => [name, (...args) => this[name](...args)]),
      ),
    );
    this.watches = this.storage.read();
    this.syncTimer();
    this.present();
  }

  live() {
    return !this.destroyed && (!this.store || this.store.owns(this.owner, 'pick'));
  }

  present() {
    if (!this.live()) return;
    this.store?.publish(
      freeze({
        status: this.state.status,
        error: this.state.error,
        busy: this.state.status === 'running',
        picking: this.state.status === 'picking',
        hasSelection: Boolean(this.readSelection()),
        result: this.result && JSON.parse(JSON.stringify(this.result)),
        cards: JSON.parse(JSON.stringify(this.cards)),
        watches: this.watches.map((watch) => JSON.parse(JSON.stringify(watch))),
        watchesPaused: this.watchesPaused,
        canWatch:
          Boolean(this.result?.drop?.catchment?.imergWeights?.length) &&
          this.watches.length < BASIN_WATCH_LIMITS.watches,
      }),
    );
  }

  setState(status, error = null) {
    this.state = { status, error };
    this.present();
  }

  abortRun() {
    this.run?.abort();
    this.run = null;
  }

  async pick() {
    if (this.destroyed) return;
    this.abortRun();
    const run = (this.run = new AbortController());
    this.setState('picking');
    let point = null;
    try {
      point = await this.pickPoint(run.signal);
    } catch {
      point = null;
    }
    if (run.signal.aborted || this.run !== run) return;
    if (!point) return this.setState(this.result ? 'ready' : 'idle');
    return this.trace(point, run);
  }

  traceSelection() {
    const selection = this.readSelection();
    if (!selection) return this.setState('error', 'no-selection');
    return this.traceAt(selection.lon, selection.lat, selection.name);
  }

  traceAt(lon, lat, name = null) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return this.setState('error', 'invalid-point');
    this.abortRun();
    return this.trace({ lon, lat, name }, (this.run = new AbortController()));
  }

  async trace(point, run) {
    this.setState('running');
    this.cards = { imerg: null, forecast: null, glofas: null };
    try {
      const result = await this.analysis.analyze(
        { lon: point.lon, lat: point.lat },
        { signal: run.signal },
      );
      if (run.signal.aborted || this.run !== run) return;
      this.result = { ...result, placeName: point.name || null, at: this.now() };
      this.render.show?.(this.result);
      this.setState('ready');
      await this.readRain(run);
    } catch (error) {
      if (run.signal.aborted || this.run !== run) return;
      this.setState('error', error?.code || 'analysis-failed');
    }
  }

  async readRain(run) {
    const weights = this.result?.drop?.catchment?.imergWeights || [];
    if (!weights.length) return;
    const { cells, share } = imergRequestCells(weights);
    const points = forecastPoints(weights);
    this.cards = {
      ...this.cards,
      imerg: { state: 'loading' },
      forecast: { state: 'loading' },
    };
    this.present();
    const [imerg, forecast] = await Promise.all([
      this.get(`/api/hydro/imerg?cells=${query(cells)}&window=24h`, run.signal),
      this.get(
        `/api/hydro/forecast?pts=${points.map((p) => `${p.lat},${p.lon}`).join(';')}`,
        run.signal,
      ),
    ]);
    if (run.signal.aborted || this.run !== run) return;
    this.cards = {
      ...this.cards,
      imerg: { ...imergCard(imerg, cells, this.now()), requestShare: share },
      forecast: forecastCard(forecast, points, this.now()),
    };
    this.present();
  }

  async readGlofas() {
    const outlet = this.result?.drop?.outlet;
    if (!outlet || this.cards.glofas?.state === 'loading') return;
    const run = this.run;
    this.cards = { ...this.cards, glofas: { state: 'loading' } };
    this.present();
    const envelope = await this.get(
      `/api/hydro/glofas?lat=${outlet[1].toFixed(3)}&lon=${outlet[0].toFixed(3)}`,
      run?.signal,
    );
    if (run !== this.run) return;
    this.cards = { ...this.cards, glofas: glofasCard(envelope, this.now()) };
    this.present();
  }

  async get(path, signal) {
    try {
      return await this.fetchJson(path, { signal });
    } catch (error) {
      return {
        state: 'unavailable',
        reason: signal?.aborted ? 'cancelled' : 'offline',
      };
    }
  }

  cancel() {
    this.abortRun();
    this.setState(this.result ? 'ready' : 'idle');
  }

  clear() {
    this.abortRun();
    this.result = null;
    this.cards = { imerg: null, forecast: null, glofas: null };
    this.render.clear?.();
    this.setState('idle');
  }

  replay() {
    if (this.result) this.render.replay?.();
  }

  /** Session pause: stop work and watch checks until explicitly resumed. */
  pause() {
    this.abortRun();
    this.watchesPaused = true;
    this.syncTimer();
    if (this.state.status === 'running' || this.state.status === 'picking')
      this.setState(this.result ? 'ready' : 'idle');
    else this.present();
    return true;
  }

  resumeWatches() {
    this.watchesPaused = false;
    this.syncTimer();
    this.present();
    return this.checkWatches();
  }

  addWatch(thresholdMm) {
    const catchment = this.result?.drop?.catchment;
    if (!catchment?.imergWeights?.length) return false;
    const outlet = this.result.drop.outlet;
    try {
      const watch = createBasinWatch(
        {
          basinId: `d8-outlet:${outlet[0].toFixed(3)},${outlet[1].toFixed(3)}`,
          label:
            this.result.placeName ||
            `${outlet[1].toFixed(3)}°, ${outlet[0].toFixed(3)}°`,
          thresholdMm: Number(thresholdMm),
          cells: imergRequestCells(catchment.imergWeights).cells,
        },
        { now: this.now() },
      );
      if (this.watches.some((row) => row.basinId === watch.basinId))
        return false;
      this.watches = [...this.watches, watch].slice(0, BASIN_WATCH_LIMITS.watches);
      this.storage.write(this.watches);
      this.watchesPaused = false;
      this.syncTimer();
      this.present();
      this.checkWatches();
      return true;
    } catch {
      return false;
    }
  }

  removeWatch(id) {
    this.watches = this.watches.filter((watch) => watch.id !== id);
    this.storage.write(this.watches);
    this.syncTimer();
    this.present();
  }

  syncTimer() {
    const wanted =
      !this.destroyed && !this.watchesPaused && this.watches.length > 0;
    if (wanted && this.timer === null)
      this.timer = this.schedule(() => {
        if (this.isVisible()) this.checkWatches();
      }, BASIN_WATCH_LIMITS.intervalMs);
    if (!wanted && this.timer !== null) {
      this.unschedule(this.timer);
      this.timer = null;
    }
  }

  async checkWatches() {
    if (this.checking || this.watchesPaused || !this.watches.length) return [];
    this.checking = true;
    const fired = [];
    try {
      for (const watch of this.watches) {
        const envelope = await this.get(
          `/api/hydro/imerg?cells=${query(watch.cells)}&window=3h`,
        );
        if (this.destroyed) return fired;
        const step = reduceBasinCheck(
          watch,
          watchObservation(envelope, watch.cells),
          this.now(),
        );
        this.watches = this.watches.map((row) =>
          row.id === watch.id ? step.watch : row,
        );
        if (step.fired) fired.push({ watch: step.watch, event: step.fired });
      }
      this.storage.write(this.watches);
    } finally {
      this.checking = false;
      this.present();
    }
    return fired;
  }

  destroy() {
    if (this.destroyed) return;
    this.abortRun();
    this.destroyed = true;
    this.syncTimer();
    if (this.timer !== null) this.unschedule(this.timer);
    this.timer = null;
    this.store?.detach(this.owner);
  }
}
