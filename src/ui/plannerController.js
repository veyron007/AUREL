import { t } from '../i18n/index.js';
import { sampleRoute } from '../planner/routeSampling.js';
import { calculateProfile } from '../planner/profile.js';
import {
  calculateDaylight,
  localDateAt,
  resolveLocalDateTime,
} from '../planner/daylight.js';
import { validateRouteSnapshot } from '../layers/directions/snapshot.js';
import { normalizeLensSelection } from './lensPresentation.js';
import { captureRoute } from '../fieldbook/capture.js';
import { validateAnalysisSnapshot } from '../fieldbook/analysis.js';
import { loadCheckpointSheet } from '../planner/checkpointSheetLoader.js';
import {
  validateFieldContextPayload,
  unavailableFieldProvider,
  fieldQueryPoint,
} from '../sources/fieldContextModel.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
function unavailableCheckpoint(point) {
  const requested = { lat: point.lat, lon: point.lon };
  return {
    ...point,
    context: {
      version: 1,
      requested,
      queried: fieldQueryPoint(requested),
      weather: unavailableFieldProvider('weather'),
      airQuality: unavailableFieldProvider('airQuality'),
    },
  };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function timeOptions(options) {
  const timeZone = options.timeZone || 'Asia/Kolkata';
  const departureAt = options.localDateTime
    ? resolveLocalDateTime(options.localDateTime, timeZone)
    : (options.departureAt ?? null);
  if (
    departureAt !== null &&
    (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(departureAt) ||
      !Number.isFinite(Date.parse(departureAt)))
  )
    throw new Error('Invalid UTC departure time.');
  const localDate =
    options.localDate ||
    (departureAt
      ? localDateAt(departureAt, timeZone)
      : localDateAt(Date.now(), timeZone));
  if (departureAt && localDateAt(departureAt, timeZone) !== localDate)
    throw new Error('Departure does not match the selected local date.');
  return { timeZone, departureAt, localDate };
}
function fireBounds(points) {
  const west = Math.max(
      -180,
      Math.min(...points.map((point) => point.lon)) - 0.1,
    ),
    east = Math.min(180, Math.max(...points.map((point) => point.lon)) + 0.1);
  const south = Math.max(
      -90,
      Math.min(...points.map((point) => point.lat)) - 0.1,
    ),
    north = Math.min(90, Math.max(...points.map((point) => point.lat)) + 0.1);
  return east - west <= 2 && north - south <= 2
    ? { west, south, east, north }
    : null;
}

/** Explicit, cancellable planning over existing owners; never routes or refreshes on mount. */
export class PlannerController {
  constructor({
    readRoute = () => null,
    readSelection = () => null,
    subscribeChanges,
    getTerrain,
    getContext,
    getFireContext,
    getMountainWeather = null,
    saveSnapshot,
    focusSample = () => {},
    publish = () => {},
    store = null,
  } = {}) {
    Object.assign(this, {
      readRoute,
      readSelection,
      subscribeChanges,
      getTerrain,
      getContext,
      getFireContext,
      getMountainWeather,
      saveSnapshot,
      publish,
      store,
    });
    this.sheets = {};
    this.sheetRequests = new Map();
    this.focusOperation = focusSample;
    this.scope = 'place';
    this.generation = 0;
    this.destroyed = false;
    this.initialized = false;
    this.status = 'empty';
    this.snapshot = null;
    this.error = null;
    this.feedback = null;
    this.busy = false;
    this.inputKey = null;
    this.subject = null;
  }
  init() {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.owner = this.store?.connect({
      analyze: (options) => this.analyze(options),
      cancel: () => this.cancel(),
      save: () => this.save(),
      setScope: (scope) => this.setScope(scope),
      focusSample: (index) => this.focusSample(index),
      loadSheet: (index) => this.loadSheet(index),
    });
    this.unsubscribe = this.subscribeChanges?.(() => this._inputsChanged());
    this.present();
  }
  live() {
    return (
      !this.destroyed &&
      (!this.store?.owns || this.store.owns(this.owner, 'analyze'))
    );
  }
  present() {
    if (!this.live()) return;
    const availableRoute = validateRouteSnapshot(this.readRoute());
    const view = {
      scope: this.scope,
      hasRoute: Boolean(availableRoute),
      hasPlace: Boolean(normalizeLensSelection(this.readSelection())),
      routeSummary: availableRoute
        ? {
            mode: availableRoute.mode,
            distanceM: availableRoute.distanceM,
            from: availableRoute.a,
            to: availableRoute.b,
          }
        : null,
      status: this.status,
      busy: this.busy,
      error: this.error,
      feedback: this.feedback,
      snapshot: this.snapshot,
      canSave: Boolean(this.snapshot && !this.busy && this.saveSnapshot),
      canLoadSheets: Boolean(this.snapshot && this.getMountainWeather),
      sheets: { ...this.sheets },
    };
    this.publish(view);
    this.store?.publish(view);
  }
  _readInputs() {
    const raw = this.scope === 'route' ? this.readRoute() : null;
    const route = raw ? validateRouteSnapshot(raw) : null;
    if (raw && !route) throw new Error('Invalid saved route.');
    const selection =
      this.scope === 'place'
        ? normalizeLensSelection(this.readSelection())
        : null;
    return { route, selection, key: JSON.stringify(route || selection) };
  }
  _inputsChanged() {
    if (!this.live()) return;
    if (!this.inputKey) {
      this.present();
      return;
    }
    let key;
    try {
      key = this._readInputs().key;
    } catch {
      key = null;
    }
    if (key === this.inputKey) {
      this.present();
      return;
    }
    this.cancel();
    this._cancelSheets();
    this.snapshot = null;
    this.subject = null;
    this.inputKey = null;
    this.status = 'empty';
    this.error = t('The location or route changed. Analyze the new selection.');
    this.present();
  }
  _guard(generation, key) {
    this.request?.signal.throwIfAborted();
    if (!this.live() || generation !== this.generation)
      throw new Error('Planning cancelled.');
    if (this._readInputs().key !== key) {
      this._inputsChanged();
      throw new Error('Planning selection changed.');
    }
  }
  async _terrain(sampling, signal, guard) {
    const results = [];
    for (let start = 0; start < sampling.samples.length; start += 64) {
      guard();
      const points = sampling.samples.slice(start, start + 64);
      let envelope;
      try {
        envelope = await this.getTerrain(points, { signal });
      } catch (error) {
        signal.throwIfAborted();
        envelope = {
          results: Array.isArray(error?.partial) ? error.partial : [],
        };
      }
      guard();
      const rows = envelope?.results;
      if (!Array.isArray(rows) || rows.length !== points.length) {
        results.push(...points.map(() => null));
        continue;
      }
      results.push(
        ...rows.map((row) =>
          row && envelope.tileset && !row.provenance
            ? {
                ...row,
                provenance: {
                  tileset: envelope.tileset,
                  version: envelope.version,
                  retrievedAt: envelope.retrievedAt,
                },
              }
            : row,
        ),
      );
    }
    return calculateProfile(sampling, { results });
  }
  async analyze(options = {}) {
    if (!this.live()) return false;
    if (options.scope !== undefined) this.setScope(options.scope);
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const generation = ++this.generation;
    this._cancelSheets();
    this.busy = true;
    this.status = 'loading';
    this.snapshot = null;
    this.subject = null;
    this.error = null;
    this.feedback = null;
    this.present();
    try {
      const timing = timeOptions(options),
        inputs = this._readInputs();
      if (!inputs.route && !inputs.selection)
        throw new Error('A route or place is required.');
      this.inputKey = inputs.key;
      const guard = () => this._guard(generation, inputs.key);
      const sampling = inputs.route ? sampleRoute(inputs.route) : null;
      const points = inputs.route
        ? sampleRoute(inputs.route, { maxSamples: 3, minSpacingM: 1 }).samples
        : [
            {
              lon: inputs.selection.geometry.coordinates[0],
              lat: inputs.selection.geometry.coordinates[1],
              distanceM: 0,
            },
          ];
      const daylight = calculateDaylight({ ...points[0], ...timing });
      const profile =
        sampling && this.getTerrain
          ? await this._terrain(sampling, request.signal, guard)
          : null;
      guard();
      const checkpoints = [];
      let partial = Boolean(sampling && (!profile || !profile.complete)),
        outsideForecast = false;
      for (const point of points) {
        guard();
        if (!this.getContext) {
          partial = true;
          checkpoints.push(unavailableCheckpoint(point));
          continue;
        }
        try {
          const context = validateFieldContextPayload(
            await this.getContext(
              { lat: point.lat, lon: point.lon },
              { signal: request.signal },
            ),
          );
          guard();
          if (
            context.requested.lat !== point.lat ||
            context.requested.lon !== point.lon
          )
            throw new Error('Invalid field context.');
          checkpoints.push({ ...point, context: copy(context) });
          if (
            context.weather?.state !== 'ready' ||
            context.airQuality?.state !== 'ready'
          )
            partial = true;
          if (timing.departureAt) {
            const at = Date.parse(timing.departureAt);
            for (const source of [context.weather, context.airQuality]) {
              if (!source?.validFrom || !source?.validTo) continue;
              if (
                at < Date.parse(source.validFrom) ||
                at >= Date.parse(source.validTo) ||
                !source.hours.some((hour) => {
                  const start = Date.parse(hour.time);
                  return at >= start && at < start + 3600000;
                })
              ) {
                outsideForecast = true;
                partial = true;
              }
            }
          }
        } catch (error) {
          request.signal.throwIfAborted();
          guard();
          partial = true;
          checkpoints.push(unavailableCheckpoint(point));
        }
      }
      let fireContext = null;
      const bounds = fireBounds(
        inputs.route
          ? inputs.route.geometry.map(([lon, lat]) => ({ lon, lat }))
          : points,
      );
      if (this.getFireContext && bounds) {
        try {
          fireContext = await this.getFireContext(
            { bounds },
            { signal: request.signal },
          );
          guard();
          fireContext = fireContext ? copy(fireContext) : null;
        } catch (error) {
          request.signal.throwIfAborted();
          guard();
          partial = true;
        }
      }
      if (this.getFireContext && (!fireContext || fireContext.status !== 'ok'))
        partial = true;
      guard();
      const capturedAt = new Date().toISOString();
      const routeRow = inputs.route
        ? captureRoute(
            { getRouteSnapshot: () => inputs.route },
            { now: capturedAt },
          )
        : null;
      this.subject = routeRow
        ? { kind: 'route', route: routeRow }
        : copy(inputs.selection);
      const snapshot = {
        version: 1,
        capturedAt,
        route: routeRow
          ? {
              name: routeRow.name,
              geometry: copy(routeRow.geometry),
              mode: routeRow.mode,
              distanceM: routeRow.distanceM,
              durationS: routeRow.durationSec,
              retrievedAt: routeRow.retrievedAt,
            }
          : null,
        ...timing,
        profile,
        daylight,
        checkpoints,
        fireContext,
      };
      validateAnalysisSnapshot(snapshot);
      this.snapshot = freeze(snapshot);
      this.status = partial ? 'partial' : 'ready';
      this.error = outsideForecast
        ? t('The selected departure is outside the available forecast window.')
        : partial
          ? t(
              'Some context is unavailable or incomplete. Known values remain available.',
            )
          : null;
      return true;
    } catch (error) {
      if (
        generation === this.generation &&
        this.live() &&
        !request.signal.aborted
      ) {
        this.status = 'error';
        this.error = t(
          'Planning could not finish. Check the location, date and time zone, then retry.',
        );
      }
      return false;
    } finally {
      if (generation === this.generation && this.live()) {
        this.busy = false;
        this.present();
      }
    }
  }
  setScope(scope) {
    if (!this.live() || !['place', 'route'].includes(scope)) return false;
    if (scope === this.scope) return true;
    this.cancel();
    this._cancelSheets();
    this.scope = scope;
    this.snapshot = null;
    this.subject = null;
    this.inputKey = null;
    this.status = 'empty';
    this.error = null;
    this.present();
    return true;
  }
  cancel() {
    if (!this.live()) return;
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.busy = false;
    if (!this.snapshot) this.status = 'empty';
    this.feedback = null;
    this.present();
  }
  async save() {
    if (!this.live() || this.busy || !this.snapshot || !this.saveSnapshot)
      return false;
    this._inputsChanged();
    if (!this.snapshot) return false;
    const generation = this.generation,
      snapshot = this.snapshot;
    this.busy = true;
    this.error = null;
    this.present();
    try {
      const result = await this.saveSnapshot(
        copy(this.subject),
        copy(snapshot),
      );
      if (!this.live() || generation !== this.generation) return false;
      if (result === false) throw new Error('Local save refused.');
      this.feedback = t('Planning snapshot saved to Fieldbook.');
      return true;
    } catch {
      if (this.live() && generation === this.generation)
        this.error = t(
          'The planning snapshot is not saved. Your analysis remains available.',
        );
      return false;
    } finally {
      if (this.live() && generation === this.generation) {
        this.busy = false;
        this.present();
      }
    }
  }
  _cancelSheets() {
    for (const request of this.sheetRequests.values()) request.abort();
    this.sheetRequests.clear();
    this.sheets = {};
  }
  /** Explicit, per-checkpoint mountain sheet; it never refreshes on its own. */
  async loadSheet(index) {
    if (
      !this.live() ||
      this.busy ||
      !this.snapshot ||
      !this.getMountainWeather ||
      !Number.isInteger(index) ||
      !this.snapshot.checkpoints[index] ||
      this.sheetRequests.has(index)
    )
      return false;
    const request = new AbortController();
    const base = this.snapshot;
    this.sheetRequests.set(index, request);
    this.sheets = { ...this.sheets, [index]: 'loading' };
    this.present();
    try {
      const next = await loadCheckpointSheet({
        snapshot: copy(base),
        index,
        getMountainWeather: this.getMountainWeather,
        getTerrain: this.getTerrain,
        signal: request.signal,
      });
      if (!this.live() || this.snapshot === null || request.signal.aborted)
        return false;
      // Another checkpoint may have attached its sheet meanwhile; keep both.
      const merged = {
        ...this.snapshot,
        checkpoints: this.snapshot.checkpoints.map((row, i) =>
          i === index ? next.checkpoints[index] : row,
        ),
      };
      validateAnalysisSnapshot(merged);
      this.snapshot = freeze(copy(merged));
      this.sheets = { ...this.sheets, [index]: 'ready' };
      return true;
    } catch {
      if (this.live() && !request.signal.aborted)
        this.sheets = { ...this.sheets, [index]: 'error' };
      return false;
    } finally {
      if (this.sheetRequests.get(index) === request)
        this.sheetRequests.delete(index);
      if (this.live()) this.present();
    }
  }
  focusSample(index) {
    if (!this.live() || !Number.isInteger(index)) return false;
    const sample = this.snapshot?.profile?.samples[index];
    if (!sample) return false;
    return this.focusOperation({ ...sample }, index);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.request?.abort();
    this._cancelSheets();
    this.unsubscribe?.();
    this.store?.detach(this.owner);
  }
}
