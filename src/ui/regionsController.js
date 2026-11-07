import { t } from '../i18n/index.js';
import { readResponseBytesCapped } from '../sources/httpBody.js';
import {
  validateRegionManifest,
  verifyRegionPack,
  searchRegionNames,
} from '../regions/pack.js';

const ROOT = '/regions/dehradun-core/';
const MANIFEST_BYTES = 32 * 1024;
const copy = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

/** A single explicit session-local pack; renderer ownership stays with file imports. */
export class RegionsController {
  constructor({
    fetchImpl = (...args) => globalThis.fetch(...args),
    importFiles,
    readImports = () => [],
    removeImport,
    subscribeImports,
    focusPlace = () => false,
    publish = () => {},
    store = null,
  } = {}) {
    Object.assign(this, {
      fetchImpl,
      importFiles,
      readImports,
      removeImport,
      subscribeImports,
      focusPlace,
      publish,
      store,
    });
    this.status = 'empty';
    this.manifest = null;
    this.index = null;
    this.importId = null;
    this.error = null;
    this.query = '';
    this.results = [];
    this.operation = null;
    this.mounting = false;
    this.destroyed = false;
    this.initialized = false;
  }
  init() {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.owner = this.store?.connect(
      Object.fromEntries(
        ['preview', 'enable', 'remove', 'search', 'focus', 'cancel'].map(
          (name) => [name, (...args) => this[name](...args)],
        ),
      ),
    );
    this.unsubscribe = this.subscribeImports?.(() => this.refreshImports());
    this.present();
  }
  live() {
    return (
      !this.destroyed && (!this.store || this.store.owns(this.owner, 'preview'))
    );
  }
  present() {
    if (!this.live()) return;
    const busy = Boolean(this.operation) || this.mounting;
    const view = freeze({
      status: this.status,
      busy,
      error: this.error,
      manifest: this.manifest && copy(this.manifest),
      loaded: Boolean(this.importId),
      indexReady: Boolean(this.index && this.importId),
      query: this.query,
      results: this.results.map((row) => ({
        ...copy(row),
        lon: row.coordinates[0],
        lat: row.coordinates[1],
      })),
      mounting: this.mounting,
      canEnable: Boolean(
        this.manifest && !busy && !this.importId && this.importFiles,
      ),
      canRemove: Boolean(this.importId && !busy),
      canCancel: busy && !this.mounting,
    });
    this.store?.publish(view);
    this.publish(view);
  }
  refreshImports() {
    if (!this.live() || !this.importId) return;
    if (!this.readImports().some((row) => row.id === this.importId)) {
      this.importId = null;
      this.index = null;
      this.results = [];
      this.status = this.manifest ? 'preview' : 'empty';
      this.present();
    }
  }
  async readAsset(path, bytes, signal) {
    // Paths are fixed by this controller or by the validated manifest contract.
    const active = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    active.throwIfAborted();
    const response = await this.fetchImpl(`${ROOT}${path}`, {
      signal: active,
      redirect: 'error',
      credentials: 'omit',
      mode: 'same-origin',
    });
    if (!response.ok || response.redirected)
      throw new Error('Region asset unavailable');
    return readResponseBytesCapped(response, bytes, active);
  }
  current(operation) {
    return (
      this.live() && this.operation === operation && !operation.signal.aborted
    );
  }
  async preview() {
    this.refreshImports();
    if (!this.live() || this.operation || this.mounting || this.importId)
      return false;
    const operation = new AbortController();
    this.operation = operation;
    this.status = 'previewing';
    this.error = null;
    this.present();
    try {
      const bytes = await this.readAsset(
        'manifest.json',
        MANIFEST_BYTES,
        operation.signal,
      );
      const manifest = validateRegionManifest(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      if (manifest.id !== 'dehradun-core') throw new Error('Unexpected region');
      if (!this.current(operation)) return false;
      this.manifest = freeze(manifest);
      this.status = 'preview';
      return true;
    } catch {
      if (this.current(operation)) {
        this.status = 'error';
        this.manifest = null;
        this.error = t(
          'The local region preview could not be loaded. Try again.',
        );
      }
      return false;
    } finally {
      if (this.operation === operation) this.operation = null;
      this.present();
    }
  }
  async enable() {
    this.refreshImports();
    if (
      !this.live() ||
      !this.manifest ||
      this.operation ||
      this.mounting ||
      this.importId ||
      !this.importFiles
    )
      return false;
    const operation = new AbortController(),
      manifest = this.manifest;
    this.operation = operation;
    this.status = 'loading';
    this.error = null;
    this.present();
    try {
      const assets = {};
      for (const asset of manifest.assets) {
        assets[asset.id] = await this.readAsset(
          asset.path,
          asset.byteLength,
          operation.signal,
        );
        if (!this.current(operation)) return false;
      }
      const verified = await verifyRegionPack(manifest, assets);
      if (!this.current(operation)) return false;
      this.mounting = true;
      this.mountOperation = operation;
      this.present();
      if (!this.current(operation)) return false;
      const file = new File(
        [JSON.stringify(verified.geojson)],
        'dehradun-core.geojson',
        { type: 'application/geo+json' },
      );
      const outcomes = await this.importFiles([file]);
      const result = outcomes?.find(
        (row) => row.ok && typeof row.id === 'string' && row.id,
      );
      if (!this.current(operation)) {
        if (result) this.removeImport?.(result.id);
        return false;
      }
      if (!result || !this.readImports().some((row) => row.id === result.id))
        throw new Error('Region import failed');
      this.importId = result.id;
      this.index = freeze(verified.index);
      this.results = searchRegionNames(this.index, this.query);
      this.status = 'ready';
      return true;
    } catch {
      if (this.current(operation)) {
        this.status = 'error';
        this.error = t(
          'The local region could not be verified or added. Your other map files are unchanged.',
        );
      }
      return false;
    } finally {
      if (this.mountOperation === operation) {
        this.mounting = false;
        this.mountOperation = null;
      }
      if (this.operation === operation) this.operation = null;
      this.present();
    }
  }
  remove() {
    this.refreshImports();
    if (!this.live() || this.operation || this.mounting || !this.importId)
      return false;
    const id = this.importId;
    this.removeImport?.(id);
    this.refreshImports();
    return this.importId !== id;
  }
  search(query) {
    this.refreshImports();
    if (!this.live()) return;
    this.query = typeof query === 'string' ? query.slice(0, 160) : '';
    this.results =
      this.importId && this.index
        ? searchRegionNames(this.index, this.query)
        : [];
    this.present();
  }
  focus(id) {
    this.refreshImports();
    if (!this.live() || !this.importId || !this.index) return false;
    const row = this.results.find((entry) => entry.id === id);
    if (!row) return false;
    return (
      this.focusPlace({
        id: `region:dehradun-core:${row.id}`,
        name: row.name,
        aliases: [...row.aliases],
        geometry: { type: 'Point', coordinates: [...row.coordinates] },
        sourceId: 'openstreetmap-geofabrik',
        sourceLabel: this.manifest.source.label,
        extent: null,
      }) !== false
    );
  }
  cancel() {
    if (!this.live() || !this.operation) return false;
    this.operation.abort();
    this.operation = null;
    this.error = null;
    this.status = this.manifest ? 'preview' : 'empty';
    this.present();
    return true;
  }
  destroy() {
    if (this.destroyed) return;
    this.operation?.abort();
    this.operation = null;
    this.destroyed = true;
    this.unsubscribe?.();
    if (this.importId) this.removeImport?.(this.importId);
    this.importId = null;
    this.index = null;
    this.store?.detach(this.owner);
  }
}
