import { t } from '../i18n/index.js';
import { predictOrbitWitness, defaultWindow } from '../orbitWitness/predict.js';
import { parseAcquisitionPlan, PLAN_LIMITS } from '../orbitWitness/plan.js';
import { swathFootprint } from '../orbitWitness/swath.js';
import { buildRideScene, rideProvenance } from '../orbitWitness/ride.js';
import { epochAgeDays, epochConfidence } from '../orbitWitness/tle.js';

const ELEMENT_TTL_MS = 60 * 60000;
const DAY_MS = 86400000;
/** Catalogue lookback for the product lane, in UTC days ending today. */
const PRODUCT_LOOKBACK_DAYS = 10;
const MAX_SKY_ROWS = 6;
const ACTIONS = Object.freeze([
  'predict',
  'cancel',
  'loadPlans',
  'clearPlans',
  'showFootprint',
  'clearFootprint',
  'ride',
  'stopRide',
  'watch',
  'exportRecord',
]);

function placeOf(selection) {
  const [lon, lat] = selection?.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: selection.id,
    name: selection.name,
    lat,
    lon,
    extent: selection.extent ?? null,
  };
}
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Orbit Witness owner. Opening the panel never fetches; "Predict passes"
 * reads the cached TLE group, the cloud forecast and the scene catalogue once.
 */
export class OrbitWitnessController {
  constructor({
    readSelection = () => null,
    subscribeSelection,
    elements,
    catalogue,
    cloud,
    overlay = null,
    director = null,
    createWatch = null,
    download = null,
    now = Date.now,
    store,
  } = {}) {
    Object.assign(this, {
      readSelection,
      subscribeSelection,
      elements,
      catalogue,
      cloud,
      overlay,
      director,
      createWatch,
      download,
      now,
      store,
    });
    this.status = 'idle';
    this.error = null;
    this.feedback = null;
    this.result = null;
    this.context = null;
    this.place = null;
    this.plans = [];
    this.sets = null;
    this.setsAt = 0;
    this.footprintPassId = null;
    this.riding = null;
    this.request = null;
    this.destroyed = false;
  }
  init() {
    this.owner = this.store?.connect(
      Object.fromEntries(
        ACTIONS.map((name) => [name, (...args) => this[name](...args)]),
      ),
    );
    this.offSelection = this.subscribeSelection?.(() =>
      this._selectionChanged(),
    );
    this.offDirector = this.director?.subscribe?.(() =>
      this._directorChanged(),
    );
    this.present();
  }
  live() {
    return !this.destroyed;
  }
  _selection() {
    return placeOf(this.readSelection());
  }
  _selectionChanged() {
    const next = this._selection();
    if (
      this.place &&
      next &&
      next.lat === this.place.lat &&
      next.lon === this.place.lon
    )
      return;
    this.request?.abort();
    this.request = null;
    this.result = null;
    this.context = null;
    this.place = null;
    this.status = 'idle';
    this.overlay?.clear();
    this.footprintPassId = null;
    this.present();
  }
  _directorChanged() {
    if (!this.riding || !this.director) return;
    if (this.director.running && !this.riding.started)
      this.riding = { ...this.riding, started: true };
    else if (!this.director.running && this.riding.started) {
      this.riding = null;
      this.present();
    }
  }
  cancel() {
    this.request?.abort();
    this.request = null;
    if (this.status === 'loading') this.status = this.result ? 'ready' : 'idle';
    this.present();
  }
  async _elementSets(signal) {
    if (this.sets && this.now() - this.setsAt < ELEMENT_TTL_MS)
      return this.sets;
    const read = await this.elements.read({ signal });
    this.sets = read;
    this.setsAt = this.now();
    return read;
  }
  _searchBox(place) {
    return {
      bbox: [
        Math.max(-180, place.lon - 0.05),
        Math.max(-90, place.lat - 0.05),
        Math.min(180, place.lon + 0.05),
        Math.min(90, place.lat + 0.05),
      ],
      from: dayOf(this.now() - (PRODUCT_LOOKBACK_DAYS - 1) * DAY_MS),
      to: dayOf(this.now()),
    };
  }
  async predict() {
    if (!this.live()) return false;
    const place = this._selection();
    if (!place) {
      this.error = t(
        'Select a place in Lens first. Orbit Witness predicts passes for the selected place.',
      );
      this.present();
      return false;
    }
    this.request?.abort();
    const request = (this.request = new AbortController());
    const { signal } = request;
    Object.assign(this, {
      status: 'loading',
      error: null,
      feedback: null,
      place,
    });
    this.present();
    const nowMs = this.now();
    try {
      const [elements, cloud, catalogue] = await Promise.all([
        this._elementSets(signal),
        this.cloud.forecast(place, { signal }),
        this.catalogue.search(this._searchBox(place), { signal }),
      ]);
      if (signal.aborted || this.request !== request || !this.live())
        return false;
      this.context = { cloud, catalogue, elementsStale: elements.stale };
      this.result = this._predict(nowMs);
      this.status = 'ready';
      return true;
    } catch {
      if (this.request !== request || signal.aborted) return false;
      this.status = 'error';
      this.error = t(
        'Orbit elements could not be read from the local CelesTrak cache. Try again later.',
      );
      return false;
    } finally {
      if (this.request === request) this.request = null;
      this.present();
    }
  }
  _predict(nowMs) {
    const { fromMs, days } = defaultWindow(nowMs);
    return predictOrbitWitness({
      sets: this.sets.sets,
      place: this.place,
      fromMs,
      days,
      plans: this.plans,
      cloud: this.context.cloud,
      catalogue: this.context.catalogue,
      nowMs,
    });
  }
  async loadPlans(files = []) {
    if (!this.live()) return false;
    const loaded = [];
    const refused = [];
    for (const file of [...files].slice(0, PLAN_LIMITS.files)) {
      try {
        if (file.size > PLAN_LIMITS.bytes) throw new Error('size');
        loaded.push(parseAcquisitionPlan(await file.text(), file.name));
      } catch {
        refused.push(file.name);
      }
    }
    const names = new Set(loaded.map((plan) => plan.fileName));
    this.plans = [
      ...this.plans.filter((plan) => !names.has(plan.fileName)),
      ...loaded,
    ].slice(-PLAN_LIMITS.files);
    this.feedback = refused.length
      ? t(
          'Some files were not ESA Sentinel-2 acquisition plans and were ignored: {files}',
          { files: refused.join(', ') },
        )
      : t(
          'Acquisition plans loaded for this session only. They are not stored or shared.',
        );
    this._recompute();
    return refused.length === 0;
  }
  clearPlans() {
    this.plans = [];
    this.feedback = t('Acquisition plans cleared.');
    this._recompute();
  }
  _recompute() {
    if (this.result && this.place && this.sets && this.context)
      this.result = this._predict(Date.parse(this.result.generatedAt));
    this.present();
  }
  _pass(passId) {
    const row = this.result?.missions.find((item) =>
      item.passes.some((pass) => pass.id === passId),
    );
    const pass = row?.passes.find((item) => item.id === passId);
    const set = this.sets?.sets.find(
      (item) => item.missionId === row?.mission.id,
    );
    return pass && set ? { mission: row.mission, pass, set } : null;
  }
  async showFootprint(passId) {
    const found = this._pass(passId);
    if (!found?.mission.swathKm || !this.overlay) return false;
    const ring = swathFootprint(found.set.satrec, found.pass.timeMs, {
      swathKm: found.mission.swathKm,
    });
    const scene = found.pass.lanes.product.scene;
    const observed = scene
      ? this.context?.catalogue?.scenes.find((row) => row.id === scene.id)
          ?.footprint
      : null;
    await this.overlay.show({ predicted: ring, observed });
    this.feedback = observed
      ? t('Predicted swath (modelled) · scene footprint (observed)')
      : t('Predicted swath (modelled)');
    this.footprintPassId = passId;
    this.present();
    return true;
  }
  clearFootprint() {
    this.overlay?.clear();
    this.footprintPassId = null;
    this.present();
  }
  _build(passId) {
    const found = this._pass(passId);
    if (!found) return null;
    try {
      return {
        found,
        ...buildRideScene({
          ...found,
          place: this.place,
          sceneId: found.pass.lanes.product.scene?.id ?? null,
          translate: t,
          nowMs: this.now(),
        }),
      };
    } catch {
      return null;
    }
  }
  async ride(passId) {
    if (!this.live() || !this.director) return false;
    const built = this._build(passId);
    if (!built) {
      this.error = t(
        'This pass cannot be ridden: its orbit could not be propagated.',
      );
      this.present();
      return false;
    }
    this.riding = {
      passId,
      started: false,
      mission: built.found.mission.label,
      caption: rideProvenance(t, {
        epochMs: built.found.set.epochMs,
        sceneId: built.found.pass.lanes.product.scene?.id ?? null,
      }),
    };
    await this.showFootprint(passId);
    const started = await this.director.ride(built.scene);
    if (!this.live()) return false;
    if (!started) {
      this.riding = null;
      this.error = t(
        'The Scene Director could not start the ride. Stop any running scene and retry.',
      );
    }
    this.present();
    return Boolean(started);
  }
  stopRide() {
    this.director?.stop?.();
    this.riding = null;
    this.present();
  }
  async watch() {
    if (!this.live() || !this.createWatch) return false;
    const selection = this.readSelection();
    if (!placeOf(selection)) return false;
    const ok = await this.createWatch(selection);
    this.feedback = ok
      ? t(
          'Scene watch saved in Watchlists. Start monitoring there when you are ready.',
        )
      : t(
          'The scene watch could not be saved. Check Watchlists for the reason.',
        );
    this.present();
    return Boolean(ok);
  }
  exportRecord(passId) {
    const built = this._build(passId);
    if (!built || !this.download) return false;
    const { mission, pass } = built.found;
    this.download(
      `orbit-witness-${mission.id}-${pass.time.replace(/[:.]/g, '-')}.json`,
      JSON.stringify(
        { ...built.record, lanes: pass.lanes, place: this.place },
        null,
        2,
      ),
    );
    return true;
  }
  _rows() {
    if (!this.result) return [];
    const nowMs = Date.parse(this.result.generatedAt);
    return this.result.missions.map((row) => {
      const ageDays = row.epochMs ? epochAgeDays(row.epochMs, nowMs) : null;
      const passes = row.mission.imaging
        ? row.passes
        : row.passes.slice(0, MAX_SKY_ROWS);
      return {
        id: row.mission.id,
        label: row.mission.label,
        imaging: row.mission.imaging,
        swathKm: row.mission.swathKm,
        factSource: row.mission.factSource,
        status: row.status,
        epoch: row.epoch ?? null,
        epochAgeDays: ageDays,
        confidence: epochConfidence(ageDays),
        truncated: row.truncated,
        unplanned: row.unplanned,
        passes: passes.map((pass) => ({
          id: pass.id,
          time: pass.time,
          past: pass.past,
          lanes: pass.lanes,
          footprint: this.footprintPassId === pass.id,
        })),
      };
    });
  }
  _sourcesView() {
    const { catalogue, cloud, elementsStale } = this.context || {};
    return {
      catalogue: catalogue
        ? {
            status: catalogue.status,
            sources: catalogue.sources,
            retrievedAt: catalogue.retrievedAt,
          }
        : null,
      cloud: cloud
        ? { status: cloud.status, retrievedAt: cloud.retrievedAt ?? null }
        : null,
      elementsStale: Boolean(elementsStale),
    };
  }
  present() {
    if (!this.live()) return;
    this.view = {
      status: this.status,
      error: this.error,
      feedback: this.feedback,
      selection: this._selection(),
      place: this.place,
      window: this.result
        ? {
            from: this.result.from,
            to: this.result.to,
            generatedAt: this.result.generatedAt,
          }
        : null,
      ...this._sourcesView(),
      plans: this.plans.map((plan) => ({
        fileName: plan.fileName,
        satellite: plan.satellite,
        coverageStart: new Date(plan.coverageStartMs).toISOString(),
        coverageEnd: new Date(plan.coverageEndMs).toISOString(),
        datatakes: plan.datatakes.length,
      })),
      missions: this._rows(),
      ride: this.riding
        ? {
            passId: this.riding.passId,
            caption: this.riding.caption,
            mission: this.riding.mission,
          }
        : null,
      canWatch: Boolean(this.createWatch && this._selection()),
      canRide: Boolean(this.director),
    };
    this.store?.publish(this.view);
  }
  destroy() {
    if (this.destroyed) return;
    this.request?.abort();
    this.destroyed = true;
    this.offSelection?.();
    this.offDirector?.();
    this.overlay?.destroy();
    this.store?.detach(this.owner);
  }
}
