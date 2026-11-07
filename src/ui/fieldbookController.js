import { t } from '../i18n/index.js';
import {
  createFieldbook,
  parseFieldbook,
  stringifyFieldbook,
  FIELDBOOK_LIMITS,
} from '../fieldbook/document.js';
import {
  renameFieldbook,
  duplicateFieldbook,
  setArchived,
  addPlace,
  addNote,
  addEvidence,
  removeEntry,
} from '../fieldbook/operations.js';
import {
  FIELDBOOK_ACTIONS,
  fieldbookView,
  findSavedPlace,
  downloadLocalText,
  preview,
  safeFilename,
  projectEvidence,
  prepareAnalysisSave,
  CAPTURE_OPERATIONS,
  CAPTURE_COLLECTIONS,
} from './fieldbookPresentation.js';
import {
  saveFieldbookComparison,
  saveFieldbookChangeNote,
  openFieldbookComparison,
} from './fieldbookComparisonActions.js';

import {
  FIELDBOOK_DRAFT_KEY,
  readDraftEnvelope,
  writeDraftEnvelope,
} from './fieldbookDraftStorage.js';
export { FIELDBOOK_DRAFT_KEY };
const IMPORT_MAX_BYTES = FIELDBOOK_LIMITS.bytes;

/** Local project editing. The view never reads storage or calls a provider. */
export class FieldbookController {
  constructor({
    store,
    repository,
    downloadText = downloadLocalText,
    draftStorage,
    focusPlace = () => {},
    captureCurrent = null,
    restoreCapture = null,
    onOpenProject = () => {},
    onOpenComparison = null,
  }) {
    this.store = store;
    this.repository = repository;
    this.downloadText = downloadText;
    this._draftStorage = draftStorage;
    this._focusPlace = focusPlace;
    this._captureCurrent = captureCurrent;
    this._restoreCapture = restoreCapture;
    this._onOpenProject = onOpenProject;
    this._onOpenComparison = onOpenComparison;
    this._draft = null;
    this._noteDraft = '';
    this._baseRevision = null;
    this._dirty = false;
    this._projects = [];
    this._corrupt = [];
    this._restore = null;
    this._busy = false;
    this._loading = false;
    this._error = null;
    this._status = '';
    this._conflict = false;
    this._import = null;
    this._export = false;
    this._showBrief = false;
    this._recovery = null;
    this._recoveryRaw = null;
    this._draftWarning = null;
    this._pending = null;
    this._generation = 0;
    this._importGeneration = 0;
    this._destroyed = false;
    this._showArchived = false;
    this._owner = null;
  }

  async init() {
    if (this._owner || this._destroyed) return;
    const actions = {};
    for (const name of FIELDBOOK_ACTIONS)
      actions[name] = (...args) => this[name](...args);
    this._owner = this.store.connect(actions);
    this._readRecovery();
    this._loading = true;
    this._publish();
    await this._refresh();
    if (!this._destroyed) {
      this._loading = false;
      this._publish();
    }
  }

  _live() {
    return (
      !this._destroyed &&
      Boolean(this._owner) &&
      this.store.owns(this._owner, 'save')
    );
  }
  _available() {
    return this._live() && !this._busy;
  }
  _hasUnsaved() {
    return this._dirty || Boolean(this._noteDraft.trim());
  }
  _exportPreview() {
    const value = preview(this._draft);
    return this._noteDraft.trim()
      ? { ...value, counts: { ...value.counts, notes: value.counts.notes + 1 } }
      : value;
  }
  _publish() {
    if (this._live()) this.store.publish(fieldbookView(this));
  }
  async _refresh() {
    const generation = this._generation;
    try {
      const projects = await this.repository.list();
      if (this._live() && generation === this._generation) {
        this._projects = [
          ...(Array.isArray(projects) ? projects : projects.projects),
        ];
        this._corrupt = Array.isArray(projects) ? [] : [...projects.corrupt];
      }
    } catch {
      if (this._live())
        this._error = t(
          'Saved projects could not be read. Your current draft is still available.',
        );
    }
  }
  _storage() {
    return this._draftStorage === undefined
      ? globalThis.sessionStorage
      : this._draftStorage;
  }
  _readRecovery() {
    try {
      const raw = this._storage()?.getItem(FIELDBOOK_DRAFT_KEY);
      if (!raw) return;
      this._recoveryRaw = raw;
      const { active, recovery } = readDraftEnvelope(raw);
      this._recovery = recovery;
      this._recoveryRaw = recovery
        ? JSON.stringify({ version: 1, ...recovery })
        : null;
      if (active) {
        this._draft = active.project;
        this._baseRevision = active.baseRevision;
        this._noteDraft = active.noteDraft;
        this._dirty = true;
      }
    } catch {
      this._draftWarning = t(
        'Automatic draft recovery is unavailable. Save or export your work before leaving.',
      );
    }
  }
  _protectDraft() {
    try {
      if (this._recoveryRaw && !this._recovery)
        throw new Error('unreadable recovery retained');
      const active =
        this._draft && this._hasUnsaved()
          ? {
              project: this._draft,
              baseRevision: this._baseRevision,
              noteDraft: this._noteDraft,
            }
          : null;
      writeDraftEnvelope(this._storage(), active, this._recovery);
      this._draftWarning = null;
    } catch {
      this._draftWarning = t(
        'Automatic draft recovery is unavailable. Save or export your work before leaving.',
      );
    }
  }
  _rememberDraft() {
    if (!this._draft || !this._hasUnsaved()) return true;
    if (this._recoveryRaw) {
      this._error = t(
        'Recover or dismiss the protected draft before leaving another unsaved project.',
      );
      this._publish();
      return false;
    }
    this._recovery = {
      project: this._draft,
      baseRevision: this._baseRevision,
      noteDraft: this._noteDraft,
    };
    this._recoveryRaw = JSON.stringify({ version: 1, ...this._recovery });
    this._protectDraft();
    return true;
  }
  _clearDraftProtection() {
    this._protectDraft();
  }
  _setDraft(project, baseRevision, dirty) {
    this._draft = project;
    this._noteDraft = '';
    this._baseRevision = baseRevision;
    this._dirty = dirty;
    this._error = null;
    this._status = '';
    this._conflict = false;
    this._export = false;
    this._restore = null;
    this._showBrief = false;
    this._protectDraft();
    this._publish();
  }
  _edit(operation) {
    if (!this._available() || !this._draft) return false;
    try {
      this._draft = operation(this._draft);
      this._dirty = true;
      this._error = null;
      this._status = '';
      this._export = false;
      this._protectDraft();
      this._publish();
      return true;
    } catch {
      this._error = t(
        'This change could not be applied. Check the value and try again.',
      );
      this._publish();
      return false;
    }
  }
  _navigate(request) {
    if (!this._available()) return false;
    if (this._hasUnsaved()) {
      this._pending = request;
      this._publish();
      return false;
    }
    return true;
  }
  async create(title = t('Untitled fieldbook')) {
    if (!this._navigate({ kind: 'create', title })) return false;
    try {
      this._setDraft(createFieldbook({ title }), null, true);
      return true;
    } catch {
      this._error = t('Enter a project title within the allowed length.');
      this._publish();
      return false;
    }
  }
  async open(id) {
    if (!this._navigate({ kind: 'open', id })) return false;
    return this._open(id);
  }
  async _open(id) {
    const generation = this._generation;
    this._busy = true;
    this._publish();
    try {
      const project = await this.repository.get(id);
      if (!this._live() || generation !== this._generation) return false;
      if (!project) throw new Error('not found');
      this._setDraft(project, project.revision, false);
      this._onOpenProject(project);
      return true;
    } catch {
      if (this._live())
        this._error = t(
          'This saved project could not be opened. The current draft has been kept.',
        );
      return false;
    } finally {
      if (this._live()) {
        this._busy = false;
        this._publish();
      }
    }
  }
  rename(title) {
    return this._edit((project) => renameFieldbook(project, title));
  }
  async save() {
    if (!this._available() || !this._draft || !this._hasUnsaved()) return false;
    if (this._noteDraft.trim() && !this.addProjectNote(this._noteDraft))
      return false;
    this._busy = true;
    this._error = null;
    this._publish();
    const project = this._draft;
    const generation = this._generation;
    try {
      const saved = await this.repository.save(project, {
        expectedRevision: this._baseRevision,
      });
      if (!this._live() || generation !== this._generation) return false;
      this._draft = saved;
      this._baseRevision = saved.revision;
      this._dirty = false;
      this._conflict = false;
      this._status = t('Saved on this device');
      this._clearDraftProtection();
      await this._refresh();
      return true;
    } catch (error) {
      if (!this._live()) return false;
      this._conflict = error?.code === 'CONFLICT';
      this._error = this._conflict
        ? t(
            'Another tab saved a newer version. Your edits are still here. Export a backup or reload the saved version.',
          )
        : t(
            'This project could not be saved. Your draft is still here and can be exported.',
          );
      this._protectDraft();
      return false;
    } finally {
      if (this._live()) {
        this._busy = false;
        this._publish();
      }
    }
  }
  async duplicate() {
    if (!this._available() || !this._draft) return false;
    if (!this._rememberDraft()) return false;
    try {
      this._setDraft(
        duplicateFieldbook(this._draft, {
          title: t('{title} copy', { title: this._draft.title }),
        }),
        null,
        true,
      );
      return true;
    } catch {
      this._error = t('A project copy could not be created.');
      this._publish();
      return false;
    }
  }
  archive() {
    return this._edit((project) => setArchived(project, true));
  }
  recover() {
    return this._edit((project) => setArchived(project, false));
  }
  setShowArchived(value) {
    if (!this._live()) return;
    this._showArchived = Boolean(value);
    this._publish();
  }
  /**
   * An agent saved `projectId` through the repository (src/fieldkit). Refresh
   * the library and show the saved version, unless the owner has unsaved
   * edits: those stay untouched and their next save reports the conflict.
   */
  async syncExternalWrite(projectId) {
    if (!this._live()) return false;
    await this._refresh();
    const showing = this._draft?.id === projectId;
    if (this._available() && !this._hasUnsaved() && (showing || !this._draft))
      return this._open(projectId);
    this._publish();
    return true;
  }
  async reloadSaved() {
    if (!this._available() || !this._draft || this._baseRevision === null)
      return false;
    if (!this._rememberDraft()) return false;
    return this._open(this._draft.id);
  }
  async discardAndContinue() {
    if (!this._available() || !this._pending) return false;
    const pending = this._pending;
    this._pending = null;
    if (!this._rememberDraft()) return false;
    if (pending.kind === 'open') return this._open(pending.id);
    const wasDirty = this._dirty;
    const priorNote = this._noteDraft;
    this._dirty = false;
    this._noteDraft = '';
    const result =
      pending.kind === 'create'
        ? await this.create(pending.title)
        : await this.applyImport();
    if (!result && this._live()) {
      this._dirty = wasDirty;
      this._noteDraft = priorNote;
      this._publish();
    }
    return result;
  }
  cancelNavigation() {
    this._pending = null;
    this._publish();
  }

  async previewImportFile(file) {
    if (!this._available() || !file) return false;
    const importGeneration = ++this._importGeneration;
    this._import = null;
    if (this._pending?.kind === 'import') this._pending = null;
    this._publish();
    if (!Number.isFinite(file.size) || file.size > IMPORT_MAX_BYTES) {
      this._error = t('This backup is too large to open.');
      this._publish();
      return false;
    }
    const generation = this._generation;
    try {
      const text = await file.text();
      if (
        !this._live() ||
        generation !== this._generation ||
        importGeneration !== this._importGeneration
      )
        return false;
      return this.previewImportText(text);
    } catch {
      if (this._live() && importGeneration === this._importGeneration) {
        this._error = t('This backup could not be read.');
        this._publish();
      }
      return false;
    }
  }
  previewImportText(text) {
    if (!this._available()) return false;
    this._importGeneration++;
    try {
      if (
        typeof text !== 'string' ||
        new TextEncoder().encode(text).byteLength > IMPORT_MAX_BYTES
      )
        throw new Error('oversize');
      this._import = parseFieldbook(text);
      this._error = null;
      this._publish();
      return true;
    } catch {
      this._import = null;
      this._error = t(
        'This is not a supported Fieldbook backup. Your current project has not changed.',
      );
      this._publish();
      return false;
    }
  }
  applyImport() {
    if (!this._import || !this._navigate({ kind: 'import' })) return false;
    try {
      const project = duplicateFieldbook(this._import, {
        title: this._import.title,
      });
      this._import = null;
      this._setDraft(project, null, true);
      return true;
    } catch {
      this._error = t(
        'This backup could not be restored. Your current project has not changed.',
      );
      this._publish();
      return false;
    }
  }
  cancelImport() {
    this._importGeneration++;
    this._import = null;
    this._publish();
  }
  prepareExport() {
    if (!this._live() || !this._draft) return;
    this._export = true;
    this._publish();
  }
  cancelExport() {
    this._export = false;
    this._publish();
  }
  exportBackup() {
    if (!this._live() || !this._draft || !this._export) return false;
    try {
      this.downloadText(
        stringifyFieldbook(
          this._noteDraft.trim()
            ? addNote(this._draft, {
                subjectId: this._draft.id,
                text: this._noteDraft.trim(),
              })
            : this._draft,
        ),
        safeFilename(this._draft.title),
      );
      this._status = t('Backup downloaded');
      this._export = false;
      this._publish();
      return true;
    } catch {
      this._error = t(
        'The backup could not be downloaded. Your draft is still available.',
      );
      this._publish();
      return false;
    }
  }
  recoverDraft() {
    if (!this._available() || !this._recovery) return false;
    if (this._hasUnsaved()) {
      this._error = t(
        'Save or export the current draft before recovering another one.',
      );
      this._publish();
      return false;
    }
    const recovery = this._recovery;
    this._recovery = null;
    this._recoveryRaw = null;
    this._setDraft(recovery.project, recovery.baseRevision, true);
    this._noteDraft = recovery.noteDraft ?? '';
    this._protectDraft();
    this._publish();
    return true;
  }
  exportRecovery() {
    if (!this._live() || !this._recoveryRaw) return;
    try {
      this.downloadText(this._recoveryRaw, 'fieldbook-recovery.json');
    } catch {
      this._error = t(
        'The recovery copy could not be downloaded. The original record is still kept.',
      );
      this._publish();
    }
  }
  dismissRecovery() {
    if (!this._live()) return;
    this._recovery = null;
    this._recoveryRaw = null;
    this._protectDraft();
    this._publish();
  }
  _ensureProject() {
    if (!this._draft)
      this._setDraft(createFieldbook({ title: t('Saved places') }), null, true);
  }
  capturePlace(selection, evidence = []) {
    return this.savePlace(selection, evidence);
  }
  /** An explicit snapshot save owns one revisioned write; failures retain its draft. */
  async saveAnalysis(subject, snapshot, kind = 'route-context') {
    if (!this._available()) return false;
    this._ensureProject();
    const edited = this._edit((project) =>
      prepareAnalysisSave(project, subject, snapshot, kind),
    );
    return edited ? this.save() : false;
  }
  saveComparison(subject, snapshot) {
    return saveFieldbookComparison(this, subject, snapshot);
  }
  addChangeNote(comparisonId, input) {
    return saveFieldbookChangeNote(this, comparisonId, input);
  }
  openSavedComparison(comparisonId) {
    return openFieldbookComparison(this, comparisonId);
  }
  savePlace(selection, evidence = []) {
    if (!this._available()) return false;
    this._ensureProject();
    return this._edit((project) => {
      let next = project;
      let place = findSavedPlace(next, selection);
      if (!place) {
        next = addPlace(next, {
          name: selection.name,
          aliases: selection.aliases ?? [],
          geometry: selection.geometry,
          extent: selection.extent ?? null,
        });
        place = next.places.at(-1);
      }
      for (const row of evidence.filter((entry) => entry.scope !== 'layer')) {
        const projected = projectEvidence(row, place.id);
        const duplicate = next.evidence.some((entry) =>
          Object.keys(projected).every(
            (key) =>
              JSON.stringify(entry[key]) === JSON.stringify(projected[key]),
          ),
        );
        if (!duplicate) next = addEvidence(next, projected);
      }
      return next;
    });
  }
  addNote(selection, text) {
    return this.addPlaceNote(selection, text);
  }
  addPlaceNote(selection, text) {
    if (!this._available() || !String(text).trim()) return false;
    if (!this.savePlace(selection)) return false;
    const place = findSavedPlace(this._draft, selection);
    if (
      this._draft.notes.some(
        (entry) =>
          entry.subjectId === place.id && entry.text === String(text).trim(),
      )
    )
      return true;
    return this._edit((project) =>
      addNote(project, { subjectId: place.id, text: String(text).trim() }),
    );
  }
  setNoteDraft(text) {
    if (
      !this._available() ||
      !this._draft ||
      typeof text !== 'string' ||
      text.length > 16384
    )
      return;
    this._noteDraft = text;
    this._protectDraft();
    this._publish();
  }
  addProjectNote(text) {
    const changed = this._edit((project) =>
      addNote(project, { subjectId: project.id, text: String(text).trim() }),
    );
    if (changed) {
      this._noteDraft = '';
      this._protectDraft();
      this._publish();
    }
    return changed;
  }
  removeNote(id) {
    return this._edit((project) => removeEntry(project, 'notes', id));
  }
  focusSavedPlace(id) {
    if (!this._live()) return;
    const place = this._draft?.places.find((entry) => entry.id === id);
    if (place) this._focusPlace(place);
  }
  toggleBrief() {
    this._showBrief = !this._showBrief;
    this._publish();
  }
  async capture(kind, file) {
    if (
      !this._available() ||
      !this._captureCurrent ||
      !CAPTURE_OPERATIONS[kind]
    )
      return false;
    this._ensureProject();
    this._busy = true;
    this._error = null;
    this._publish();
    const generation = this._generation;
    try {
      const captured = await this._captureCurrent(kind, file);
      if (!this._live() || generation !== this._generation) return false;
      const entries = Array.isArray(captured)
        ? captured
        : captured
          ? [captured]
          : [];
      if (!entries.length) {
        this._status = t('Nothing is available to capture yet.');
        return false;
      }
      let next = this._draft;
      for (const entry of entries) next = CAPTURE_OPERATIONS[kind](next, entry);
      this._draft = next;
      this._dirty = true;
      this._protectDraft();
      this._status = t('Added to the draft');
      return true;
    } catch {
      if (this._live())
        this._error = t(
          'This content could not be added. Your project has not changed.',
        );
      return false;
    } finally {
      if (this._live()) {
        this._busy = false;
        this._publish();
      }
    }
  }
  async restoreSavedCapture(kind, id) {
    if (!this._available() || !this._restoreCapture) return false;
    const entry = this._draft?.[CAPTURE_COLLECTIONS[kind]]?.find(
      (item) => item.id === id,
    );
    if (!entry) return false;
    if (kind === 'scene') {
      this._restore = { kind, entry };
      this._publish();
      return true;
    }
    return this._showCapture(kind, entry);
  }
  async _showCapture(kind, entry) {
    try {
      await this._restoreCapture(kind, entry);
      return true;
    } catch {
      if (this._live()) {
        this._error = t(
          'This saved content could not be shown. The backup is unchanged.',
        );
        this._publish();
      }
      return false;
    }
  }
  async confirmRestore() {
    if (!this._available() || !this._restore) return false;
    const restore = this._restore;
    this._restore = null;
    this._publish();
    return this._showCapture(restore.kind, restore.entry);
  }
  cancelRestore() {
    this._restore = null;
    this._publish();
  }
  async exportCorrupt(id) {
    if (!this._available() || !this._corrupt.some((item) => item.id === id))
      return;
    const generation = this._generation;
    try {
      await this.repository.get(id);
      if (this._live()) {
        this._status = t(
          'This project is readable again. Reopen it from the library.',
        );
        await this._refresh();
        this._publish();
      }
    } catch (error) {
      if (!this._live() || generation !== this._generation) return;
      if (
        error?.code === 'CORRUPT_DOCUMENT' &&
        Object.hasOwn(error, 'original')
      ) {
        try {
          this.downloadText(
            JSON.stringify(error.original, null, 2),
            'fieldbook-unreadable-recovery.json',
          );
          return;
        } catch {
          /* Keep raw repository record. */
        }
      }
      this._error = t(
        'The recovery copy could not be downloaded. The original record is still kept.',
      );
      this._publish();
    }
  }
  destroy() {
    if (this._destroyed) return;
    if (this._hasUnsaved()) this._protectDraft();
    const owned = this.store.owns(this._owner, 'save');
    this._destroyed = true;
    this._generation++;
    this.store.detach(this._owner);
    this._owner = null;
    if (owned) this.store.publish(null);
    this.repository.close?.();
  }
}
