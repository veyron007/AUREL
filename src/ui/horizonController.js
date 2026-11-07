import { t } from '../i18n/index.js';
import { normalizeLensSelection } from './lensPresentation.js';
import { localDateAt, resolveLocalDateTime } from '../planner/daylight.js';
import { toProvenanceEnvelope } from '../horizon/envelope.js';
import { toHorizonSnapshot } from '../horizon/snapshot.js';
import { validateHorizonSnapshot } from '../fieldbook/horizonAnalysis.js';

const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** Default shadow time: local noon of the chosen date. */
export function horizonDefaults(now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  return {
    localDate: localDateAt(now, timeZone),
    shadowTime: '12:00',
    timeZone,
    observerHeightM: 1.7,
    gnomonM: 1,
  };
}

/**
 * Kshitij owner: explicit, cancellable horizon computation for the Lens
 * place, shared by the Planner and Lens cards. Never computes on mount and
 * never refreshes a saved result.
 */
export class HorizonController {
  constructor({
    readSelection = () => null,
    subscribeChanges,
    horizonAt,
    drawHorizon = () => {},
    clearHorizon = () => {},
    saveSnapshot,
    store = null,
    now = () => new Date().toISOString(),
  } = {}) {
    Object.assign(this, {
      readSelection,
      subscribeChanges,
      horizonAt,
      drawHorizon,
      clearHorizon,
      saveSnapshot,
      store,
      now,
    });
    this.generation = 0;
    this.status = 'empty';
    this.result = null;
    this.envelope = null;
    this.subject = null;
    this.error = null;
    this.feedback = null;
    this.busy = false;
    this.destroyed = false;
    this.initialized = false;
  }
  init() {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.owner = this.store?.connect({
      analyze: (options) => this.analyze(options),
      cancel: () => this.cancel(),
      save: () => this.save(),
      clear: () => this.clear(),
    });
    this.unsubscribe = this.subscribeChanges?.(() => this._selectionChanged());
    this.present();
  }
  _place() {
    return normalizeLensSelection(this.readSelection());
  }
  present() {
    if (this.destroyed) return;
    const place = this._place();
    this.store?.publish({
      hasPlace: Boolean(place),
      place: place
        ? {
            name: place.name,
            lat: place.geometry.coordinates[1],
            lon: place.geometry.coordinates[0],
          }
        : null,
      status: this.status,
      busy: this.busy,
      error: this.error,
      feedback: this.feedback,
      envelope: this.envelope,
      canSave: Boolean(this.result && !this.busy && this.saveSnapshot),
    });
  }
  _selectionChanged() {
    if (this.destroyed) return;
    const place = this._place();
    const same =
      place &&
      this.subject &&
      place.geometry.coordinates.join() ===
        this.subject.geometry.coordinates.join();
    if (!same && (this.result || this.busy)) {
      this.cancel();
      this._reset();
      if (this.subject)
        this.error = t('The place changed. Compute the horizon for the new place.');
      this.subject = null;
    }
    this.present();
  }
  _reset() {
    this.result = null;
    this.envelope = null;
    this.status = 'empty';
    this.clearHorizon();
  }
  clear() {
    this.cancel();
    this._reset();
    this.subject = null;
    this.error = null;
    this.feedback = null;
    this.present();
  }
  cancel() {
    this.request?.abort();
    this.request = null;
    if (this.busy) {
      this.busy = false;
      this.status = this.result ? 'ready' : 'empty';
      this.feedback = t('Horizon cancelled.');
    }
    this.present();
  }
  async analyze(options = {}) {
    if (this.destroyed || !this.horizonAt) return false;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const generation = ++this.generation;
    this._reset();
    Object.assign(this, { busy: true, status: 'loading', error: null, feedback: null });
    this.present();
    try {
      const place = this._place();
      if (!place) throw new Error(t('Select a place in Lens first.'));
      const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
      const localDate = options.localDate || localDateAt(Date.now(), timeZone);
      const shadowAt = options.shadowTime
        ? resolveLocalDateTime(`${localDate}T${options.shadowTime}`, timeZone)
        : null;
      const [lon, lat] = place.geometry.coordinates;
      const result = await this.horizonAt(
        {
          lat,
          lon,
          observerHeightM: Number(options.observerHeightM ?? 1.7),
          localDate,
          timeZone,
          shadowAt,
          gnomonM: Number(options.gnomonM ?? 1),
        },
        { signal: request.signal },
      );
      if (generation !== this.generation || request.signal.aborted) return false;
      this.subject = place;
      this.result = result;
      this.envelope = toProvenanceEnvelope(result);
      this.status = 'ready';
      this.drawHorizon(result);
      return true;
    } catch (error) {
      if (request.signal.aborted || generation !== this.generation) return false;
      this.status = 'error';
      this.error =
        error instanceof Error && error.message
          ? error.message
          : t('The horizon could not be computed.');
      return false;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.request = null;
        this.present();
      }
    }
  }
  async save() {
    if (!this.result || !this.subject || !this.saveSnapshot) return false;
    try {
      const snapshot = validateHorizonSnapshot(
        toHorizonSnapshot(this.result, { capturedAt: this.now() }),
      );
      const saved = await this.saveSnapshot(this.subject, snapshot);
      this.feedback = saved
        ? t('Horizon saved to Fieldbook.')
        : t('Fieldbook is unavailable.');
      return Boolean(saved);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : t('Fieldbook is unavailable.');
      return false;
    } finally {
      this.present();
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.request?.abort();
    this.unsubscribe?.();
    this.clearHorizon();
    if (this.owner) this.store?.detach(this.owner);
    this.destroyed = true;
  }
}
