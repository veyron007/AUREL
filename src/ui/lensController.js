import { t } from '../i18n/index.js';
import {
  buildLensEvidence,
  normalizeLensEvidence,
  normalizeLensSelection,
} from './lensPresentation.js';

/** A place dossier over existing owner publications, with no provider requests. */
export class LensController {
  constructor({
    publish = () => {},
    store = null,
    subscribeLocationSearch,
    subscribeSelection,
    subscribeEvidence,
    readLayers = () => [],
    readMapSource = () => null,
    readCurrentPlace = () => null,
    readEvidence = () => [],
    savePlace = async () => false,
    addNote = async () => false,
    openWorkspace = () => {},
    focusSelection = () => {},
    clearSelection = () => {},
    onSelection = () => {},
  } = {}) {
    Object.assign(this, {
      publish,
      store,
      subscribeLocationSearch,
      subscribeSelection,
      subscribeEvidence,
      readLayers,
      readMapSource,
      readCurrentPlace,
      readEvidence,
    });
    this.actions = {
      savePlace,
      addNote,
      openWorkspace,
      focusSelection,
      clearSelection,
      onSelection,
    };
    this.selection = null;
    this.selectedSource = null;
    this.evidence = [];
    this.notes = new Map();
    this.status = 'empty';
    this.error = null;
    this.feedback = null;
    this.busy = false;
    this.revision = 0;
    this.evidenceRevision = 0;
    this.pendingSearch = null;
    this.unsubscribers = [];
    this.destroyed = false;
    this.initialized = false;
  }
  init() {
    if (this.destroyed || this.initialized) return;
    this.initialized = true;
    this.owner = this.store?.connect({
      inspectCurrentView: () => this.inspectCurrentView(),
      savePlace: () => this.savePlace(),
      addNote: () => this.addNote(),
      setNote: (value) => this.setNote(value),
      refresh: () => this.refresh(),
      openWorkspace: (id) => this.openWorkspace(id),
      focus: () => this.focus(),
      clear: () => this.clear(),
    });
    this.present();
    for (const [subscribe, callback] of [
      [this.subscribeLocationSearch, (packet) => this.onSearch(packet)],
      [
        this.subscribeSelection,
        (record) => (record ? this.select(record) : this.clear(false)),
      ],
      [
        this.subscribeEvidence,
        () => {
          void this.refresh();
        },
      ],
    ]) {
      if (subscribe) this.unsubscribers.push(subscribe(callback));
    }
  }
  present() {
    if (this.destroyed) return;
    const view = {
      selection: this.selection,
      evidence: this.evidence,
      status: this.status,
      error: this.error,
      feedback: this.feedback,
      busy: this.busy,
      note: this.selection ? this.notes.get(this.selection.id) || '' : '',
    };
    this.publish(view);
    this.store?.publish(view);
  }
  onSearch(packet) {
    if (this.destroyed) return;
    const state = packet?.state ?? packet;
    const type = packet?.change?.type ?? state?.status;
    if (type === 'started' || type === 'searching') {
      this.clear(false);
      this.pendingSearch = state.requestId;
      this.status = 'loading';
      this.present();
    } else if (
      type === 'found' &&
      (packet?.initial || this.pendingSearch === state.requestId)
    ) {
      this.select(
        {
          ...state.destination,
          label: state.destination?.label || state.query,
        },
        { reveal: !packet?.initial, origin: 'search' },
      );
    } else if (
      ['missing', 'failed', 'cancelled'].includes(type) &&
      this.pendingSearch === state.requestId
    ) {
      this.status = 'empty';
      this.pendingSearch = null;
      this.present();
    }
  }
  select(record, { reveal = true, origin = 'selection' } = {}) {
    if (this.destroyed) return false;
    this.pendingSearch = null;
    this.revision += 1;
    this.selection = normalizeLensSelection(record);
    this.selectedSource = this.selection?.sourceId
      ? normalizeLensEvidence({
          ...record,
          sourceId: this.selection.sourceId,
          sourceLabel: this.selection.sourceLabel,
        })
      : null;
    this.evidence = [];
    this.error = null;
    this.feedback = null;
    this.busy = false;
    this.status = this.selection ? 'loading' : 'empty';
    this.present();
    if (this.selection) {
      this.actions.onSelection(this.selection, { reveal, origin });
      void this.refresh();
    }
    return Boolean(this.selection);
  }
  inspectCurrentView() {
    if (!this.destroyed)
      return this.select(this.readCurrentPlace(), { origin: 'view' });
    return false;
  }
  async refresh() {
    if (this.destroyed || !this.selection) return;
    const revision = this.revision;
    const request = ++this.evidenceRevision;
    this.evidenceController?.abort();
    this.evidenceController = new AbortController();
    const signal = this.evidenceController.signal;
    const current = () =>
      !this.destroyed &&
      revision === this.revision &&
      request === this.evidenceRevision;
    try {
      const base = buildLensEvidence({
        selection: this.selection,
        layers: this.readLayers(),
        mapSource: this.readMapSource(),
        selectedSource: this.selectedSource,
      });
      this.evidence = base;
      this.present();
      const rows = await this.readEvidence(this.selection, { signal });
      if (!current()) return;
      this.evidence = [
        ...base,
        ...(Array.isArray(rows)
          ? rows
              .slice(0, 80)
              .map((row) => normalizeLensEvidence(row))
              .filter(Boolean)
          : []),
      ];
      this.status = 'ready';
      this.error = null;
      this.present();
    } catch {
      if (!current()) return;
      this.status = 'partial';
      this.error = t(
        'Some source details are unavailable. Retry or continue with the known location.',
      );
      this.present();
    }
  }
  setNote(value) {
    if (this.destroyed || !this.selection) return;
    this.notes.set(this.selection.id, String(value ?? '').slice(0, 10000));
    this.feedback = null;
    this.present();
  }
  async savePlace() {
    return this.perform('savePlace');
  }
  async addNote() {
    return this.perform('addNote');
  }
  async perform(action) {
    if (this.destroyed || !this.selection || this.busy) return false;
    const selection = this.selection;
    const note = (this.notes.get(selection.id) || '').trim();
    if (action === 'addNote' && !note) return false;
    const revision = this.revision;
    this.busy = true;
    this.error = null;
    this.feedback = null;
    this.present();
    try {
      const result = await this.actions[action](
        selection,
        action === 'addNote'
          ? note
          : this.evidence.filter((row) => row.scope !== 'layer'),
      );
      if (this.destroyed) return false;
      if (!result) throw Error('Action did not complete');
      if (action === 'addNote' && this.notes.get(selection.id)?.trim() === note)
        this.notes.delete(selection.id);
      if (revision === this.revision) this.feedback = t('Saved in Fieldbook.');
      return true;
    } catch {
      if (!this.destroyed && revision === this.revision)
        this.error = t(
          'Could not save to Fieldbook. Your note is still here; open Library to review the project.',
        );
      return false;
    } finally {
      if (!this.destroyed && revision === this.revision) {
        this.busy = false;
        this.present();
      }
    }
  }
  openWorkspace(id) {
    if (!this.destroyed && ['plan', 'compare', 'library'].includes(id))
      this.actions.openWorkspace(id);
  }
  focus() {
    if (!this.destroyed && this.selection)
      this.actions.focusSelection(this.selection);
  }
  clear(notify = true) {
    if (this.destroyed) return;
    this.pendingSearch = null;
    this.revision += 1;
    this.evidenceRevision += 1;
    this.evidenceController?.abort();
    this.selection = null;
    this.selectedSource = null;
    this.evidence = [];
    this.status = 'empty';
    this.error = null;
    this.feedback = null;
    this.busy = false;
    this.present();
    if (notify) this.actions.clearSelection();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.evidenceController?.abort();
    this.revision += 1;
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers = [];
    this.store?.detach(this.owner);
    this.store?.publish(null);
    this.publish(null);
    this.notes.clear();
  }
}
