import { t } from '../i18n/index.js';
import { normalizeLensSelection } from './lensPresentation.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const key = (selection) =>
  JSON.stringify(selection?.geometry?.coordinates || null);
function dates(start, end, now) {
  const valid = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (
    !valid(start) ||
    !valid(end) ||
    end < start ||
    (Date.parse(end) - Date.parse(start)) / 86400000 >= 31 ||
    end > new Date(now).toISOString().slice(0, 10)
  )
    throw new Error('Invalid research dates');
}
/** Scientific requests run only on deliberate actions; selecting or reopening never acquires. */
export class ResearchController {
  constructor({
    readSelection = () => null,
    subscribeSelection,
    source,
    exportResult = () => false,
    store,
    publish = () => {},
    now = Date.now,
  }) {
    Object.assign(this, {
      readSelection,
      subscribeSelection,
      source,
      store,
      publish,
      now,
    });
    this.exportOperation = exportResult;
    this.generation = 0;
    this.destroyed = false;
    this.status = 'empty';
    this.scenes = [];
    this.selectedSceneId = null;
    this.result = null;
    this.query = null;
    this.error = null;
  }
  init() {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.owner = this.store?.connect({
      search: (query) => this.search(query),
      choose: (id) => this.choose(id),
      analyze: (options) => this.analyze(options),
      cancel: () => this.cancel(),
      exportResult: () => this.exportResult(),
    });
    this.selection = normalizeLensSelection(this.readSelection());
    this.unsubscribe = this.subscribeSelection?.(() => this.changed());
    this.present();
  }
  live() {
    return (
      !this.destroyed &&
      (!this.store?.owns || this.store.owns(this.owner, 'search'))
    );
  }
  present() {
    if (!this.live()) return;
    const busy = ['searching', 'analyzing'].includes(this.status);
    const view = {
      selection: this.selection,
      status: this.status,
      busy,
      canCancel: busy,
      error: this.error,
      feedback: null,
      scenes: this.scenes,
      selectedSceneId: this.selectedSceneId,
      result: this.result,
      query: this.query,
      canAnalyze: Boolean(!busy && this.selectedSceneId && this.selection),
      canExport: Boolean(!busy && this.result?.status === 'available'),
    };
    this.publish(view);
    this.store?.publish(view);
  }
  changed() {
    const next = normalizeLensSelection(this.readSelection());
    if (key(next) === key(this.selection)) {
      this.selection = next;
      this.present();
      return;
    }
    this.cancel();
    this.selection = next;
    this.scenes = [];
    this.selectedSceneId = null;
    this.result = null;
    this.query = null;
    this.status = 'empty';
    this.error = null;
    this.present();
  }
  start(status) {
    this.cancel();
    this.changed();
    if (!this.selection) throw new Error('No selected place');
    this.request = new AbortController();
    this.status = status;
    this.error = null;
    this.present();
    return {
      generation: this.generation,
      selectionKey: key(this.selection),
      signal: this.request.signal,
    };
  }
  guard(job) {
    job.signal.throwIfAborted();
    if (!this.live() || job.generation !== this.generation)
      throw new Error('Obsolete research');
    if (
      key(normalizeLensSelection(this.readSelection())) !== job.selectionKey
    ) {
      this.changed();
      throw new Error('Research location changed');
    }
  }
  failure(job, error) {
    if (!this.live() || (job && job.generation !== this.generation))
      return false;
    this.status = 'error';
    this.error = error;
    this.present();
    return false;
  }
  async search({ startDate, endDate } = {}) {
    if (!this.live() || ['searching', 'analyzing'].includes(this.status))
      return false;
    let job;
    try {
      dates(startDate, endDate, this.now());
      job = this.start('searching');
      this.scenes = [];
      this.selectedSceneId = null;
      this.result = null;
      const [lon, lat] = this.selection.geometry.coordinates;
      this.query = { lat, lon, fromDay: startDate, toDay: endDate };
      this.present();
      const result = await this.source.search(
        { ...this.query },
        { signal: job.signal },
      );
      this.guard(job);
      if (result.status !== 'available')
        return this.failure(
          job,
          `${t('Research source is unavailable.')} ${result.reason || ''}`,
        );
      this.scenes = result.scenes.map((row) => Object.freeze({ ...row }));
      this.status = this.scenes.length ? 'ready' : 'empty';
      this.present();
      return true;
    } catch (error) {
      return this.failure(
        job,
        job
          ? t('Research could not finish. Retry when the source is available.')
          : t('Select a place and choose up to 31 past UTC days.'),
      );
    }
  }
  choose(id) {
    if (
      !this.live() ||
      ['searching', 'analyzing'].includes(this.status) ||
      !this.scenes.some((row) => row.id === id)
    )
      return false;
    this.selectedSceneId = id;
    this.result = null;
    this.error = null;
    this.status = 'ready';
    this.present();
    return true;
  }
  async analyze({ size = 128 } = {}) {
    if (
      !this.live() ||
      ![128, 256].includes(size) ||
      !this.selectedSceneId ||
      ['searching', 'analyzing'].includes(this.status)
    )
      return false;
    let job;
    try {
      job = this.start('analyzing');
      // start() refreshes selection and may discard an old scene choice.
      if (!this.selectedSceneId) throw new Error('Scene selection expired');
      const [lon, lat] = this.selection.geometry.coordinates;
      const query = {
        lat,
        lon,
        sceneId: this.selectedSceneId,
        sizePixels: size,
      };
      this.result = null;
      this.present();
      const result = await this.source.analyze(query, { signal: job.signal });
      this.guard(job);
      if (result.status !== 'available')
        return this.failure(
          job,
          `${t('No usable research raster was produced.')} ${result.reason || ''}`,
        );
      this.result = clone(result);
      this.status = 'ready';
      this.present();
      return true;
    } catch (error) {
      return this.failure(
        job,
        t('Research could not finish. Retry when the source is available.'),
      );
    }
  }
  exportResult() {
    if (
      !this.live() ||
      !this.result ||
      ['searching', 'analyzing'].includes(this.status)
    )
      return false;
    try {
      return this.exportOperation(clone(this.result)) !== false;
    } catch {
      return this.failure(
        null,
        t('The local research export could not be created.'),
      );
    }
  }
  cancel() {
    if (!this.live()) return;
    this.generation++;
    this.request?.abort();
    this.request = null;
    if (['searching', 'analyzing'].includes(this.status))
      this.status = this.result || this.scenes.length ? 'ready' : 'empty';
    this.present();
  }
  destroy() {
    if (this.destroyed) return;
    this.cancel();
    this.unsubscribe?.();
    this.store?.detach(this.owner);
    this.destroyed = true;
  }
}
