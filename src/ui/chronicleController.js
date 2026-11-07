import { t } from '../i18n/index.js';
import { normalizeLensSelection } from './lensPresentation.js';
import { validateHistoryWindow } from '../layers/recentImagery/historical.js';
import {
  validateComparisonInput,
  validateComparisonSnapshot,
  comparisonTimeBounds,
  extentContainsPoint,
} from '../fieldbook/comparisonSchema.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
function immutable(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
const text = (value, limit = 240) =>
  typeof value === 'string' ? value.slice(0, limit) : '';
function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function descriptor(value) {
  validateComparisonInput(value);
  return immutable(copy(value));
}
function publicInput(value) {
  const { evidenceId: _evidenceId, ...input } = value;
  return descriptor(input);
}
function candidatesFrom(result) {
  const seen = new Set();
  return (Array.isArray(result?.candidates) ? result.candidates : [])
    .slice(0, 100)
    .flatMap((row) => {
      const id = text(row?.id, 160);
      if (!id || seen.has(id)) return [];
      seen.add(id);
      let input = null;
      try {
        if (row.descriptor) input = descriptor(row.descriptor);
      } catch {
        /* Unproved rows remain selectable for a fresh probe. */
      }
      return [
        {
          id,
          label: text(row.label) || id,
          requestedDate: text(row.requestedDate, 10),
          status: input
            ? 'present'
            : ['empty', 'error'].includes(row.status)
              ? row.status
              : 'catalogue',
          descriptor: input,
        },
      ];
    });
}
function evidenceLane(rows, kind) {
  return (Array.isArray(rows) ? rows : []).slice(0, 200).map((row, index) => ({
    id: text(row.id, 160) || `${kind}-${index}`,
    label: text(row.label),
    start: iso(
      kind === 'forecasts'
        ? row.validFrom
        : kind === 'precipitation'
          ? row.start
          : kind === 'notes'
            ? row.createdAt
            : row.applicableTime,
    ),
    end:
      kind === 'forecasts'
        ? iso(row.validTo)
        : kind === 'precipitation'
          ? iso(row.end)
          : null,
    sourceId: text(row.sourceId, 160) || null,
    sourceLabel: text(row.sourceLabel) || null,
    ...(kind === 'notes' &&
    ['observed', 'inferred', 'unresolved'].includes(row.interpretation)
      ? { interpretation: row.interpretation }
      : {}),
  }));
}
function lanes(slots, evidence, notes) {
  const imagery = Object.entries(slots).flatMap(([slot, input]) => {
    if (!input) return [];
    const [start, end] = comparisonTimeBounds(input.time);
    return [
      {
        id: slot,
        label: input.sourceLabel,
        start: iso(start),
        end: iso(end),
        sourceId: input.sourceId,
        sourceLabel: input.sourceLabel,
      },
    ];
  });
  const personal = evidenceLane(evidence?.notes, 'notes');
  const saved = evidenceLane(
    notes.map((note) => ({ ...note, label: note.text })),
    'notes',
  );
  return {
    imagery,
    observations: evidenceLane(evidence?.observations, 'observations'),
    forecasts: evidenceLane(evidence?.forecasts, 'forecasts'),
    precipitation: evidenceLane(evidence?.precipitation, 'precipitation'),
    notes: [
      ...personal.filter(
        (note) => !saved.some((entry) => entry.id === note.id),
      ),
      ...saved,
    ],
  };
}
function queryFor(selection, options, now) {
  if (!selection) throw new Error('Missing place');
  const [lon, lat] = selection.geometry.coordinates;
  const extent = selection.extent || [
    Math.max(-180, lon - 0.1),
    Math.max(-90, lat - 0.1),
    Math.min(180, lon + 0.1),
    Math.min(90, lat + 0.1),
  ];
  if (!extentContainsPoint(extent, selection.geometry.coordinates))
    throw new Error('Place outside area');
  const [west, south, east, north] = extent;
  validateHistoryWindow(
    {
      box: { west, south, east, north },
      fromDay: options.startDate,
      toDay: options.endDate,
    },
    { now },
  );
  return immutable({
    extent: [...extent],
    startDate: options.startDate,
    endDate: options.endDate,
  });
}
function sameInput(a, b) {
  if (!a || !b || a.time?.kind !== b.time?.kind) return false;
  if (
    !['kind', 'productId', 'requestedDate'].every(
      (key) => a.asset?.[key] === b.asset?.[key],
    )
  )
    return false;
  const left = comparisonTimeBounds(a.time),
    right = comparisonTimeBounds(b.time);
  return left.every((value, index) => value === right[index]);
}

/** Explicit dated imagery workflow. Opening the panel or stored metadata never fetches. */
export class ChronicleController {
  constructor({
    readSelection = () => null,
    subscribeSelection,
    readEvidence = () => ({}),
    searchImagery,
    probeImagery,
    compareImagery,
    clearComparison = () => {},
    readComparison,
    saveComparison,
    addChangeNote,
    publish = () => {},
    store = null,
    now = Date.now,
  } = {}) {
    Object.assign(this, {
      readSelection,
      subscribeSelection,
      readEvidence,
      searchImagery,
      probeImagery,
      compareImagery,
      readComparison,
      saveComparison,
      addChangeNote,
      publish,
      store,
      now,
    });
    this.clearOperation = clearComparison;
    this.status = 'empty';
    this.operation = null;
    this.error = null;
    this.feedback = null;
    this.candidates = [];
    this.slots = { a: null, b: null };
    this.slotIds = { a: null, b: null };
    this.choosingSlot = null;
    this.query = null;
    this.subject = null;
    this.savedComparison = null;
    this.notes = [];
    this.comparisonActive = false;
    this.splitPosition = 0.5;
    this.generation = 0;
    this.destroyed = false;
    this.initialized = false;
  }
  init() {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.owner = this.store?.connect(
      Object.fromEntries(
        [
          'search',
          'choose',
          'compare',
          'clearComparison',
          'save',
          'addNote',
          'reopen',
          'cancel',
        ].map((name) => [name, (...args) => this[name](...args)]),
      ),
    );
    this.unsubscribe = this.subscribeSelection?.(() =>
      this._selectionChanged(),
    );
    this.present();
  }
  live() {
    return (
      !this.destroyed &&
      (!this.store?.owns || this.store.owns(this.owner, 'search'))
    );
  }
  _selection() {
    return normalizeLensSelection(this.readSelection());
  }
  _key() {
    return JSON.stringify(this._selection());
  }
  _snapshot() {
    if (!this.query) throw new Error('Missing area');
    return {
      version: 1,
      title: this.subject?.name || t('Dated imagery comparison'),
      capturedAt: new Date(this.now()).toISOString(),
      extent: [...this.query.extent],
      method: 'manual-visual',
      splitPosition: this.splitPosition,
      before: this.slots.a,
      after: this.slots.b,
    };
  }
  _validPair() {
    try {
      validateComparisonSnapshot(this._snapshot());
      return true;
    } catch {
      return false;
    }
  }
  present() {
    if (!this.live()) return;
    const busy = Boolean(this.operation);
    const view = {
      selection: this.subject || this._selection(),
      status: this.status,
      busy,
      operation: this.operation,
      canCancel: ['search', 'probe', 'compare'].includes(this.operation),
      error: this.error,
      feedback: this.feedback,
      candidates: this.candidates,
      slots: this.slots,
      slotIds: this.slotIds,
      choosingSlot: this.choosingSlot,
      query: this.query,
      comparisonActive: this.comparisonActive,
      pairWarning:
        this.slots.a && this.slots.b && !this._validPair()
          ? t(
              'Choose two verified acquisitions in chronological order before comparing.',
            )
          : null,
      canCompare: !busy && this._validPair() && Boolean(this.compareImagery),
      canSave:
        !busy &&
        this.comparisonActive &&
        this._validPair() &&
        Boolean(this.saveComparison),
      savedComparison: this.savedComparison,
      notes: this.notes,
      lanes: lanes(this.slots, this.readEvidence(), this.notes),
    };
    this.publish(view);
    this.store?.publish(view);
  }
  _clearDisplay() {
    if (this.comparisonActive) this.clearOperation();
    this.comparisonActive = false;
  }
  _reset() {
    this._clearDisplay();
    this.candidates = [];
    this.slots = { a: null, b: null };
    this.slotIds = { a: null, b: null };
    this.notes = [];
    this.savedComparison = null;
    this.query = null;
    this.subject = null;
    this.inputKey = null;
  }
  _selectionChanged() {
    if (!this.live()) return;
    if (this.inputKey && this.inputKey !== this._key()) {
      this._invalidate();
      this._reset();
      this.status = 'empty';
      this.error = null;
      this.feedback = null;
    }
    this.present();
  }
  _invalidate() {
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.operation = null;
    this.choosingSlot = null;
  }
  _begin(operation) {
    this._invalidate();
    this.request = new AbortController();
    this.operation = operation;
    this.error = null;
    this.feedback = null;
    return {
      generation: this.generation,
      signal: this.request.signal,
      key: this._key(),
    };
  }
  _current(run) {
    return (
      this.live() &&
      run.generation === this.generation &&
      !run.signal.aborted &&
      run.key === this._key()
    );
  }
  _finish(run) {
    if (
      this.live() &&
      run.generation === this.generation &&
      run.key !== this._key()
    ) {
      this._selectionChanged();
      return;
    }
    if (!this._current(run)) return;
    this.operation = null;
    this.choosingSlot = null;
    this.request = null;
    this.present();
  }
  _fail(message) {
    this.error = message;
    this.present();
    return false;
  }
  async search(options = {}) {
    if (!this.live() || ['save', 'note'].includes(this.operation)) return false;
    let query;
    const subject = this._selection();
    try {
      query = queryFor(subject, options, this.now());
    } catch {
      return this._fail(
        t(
          'Select a place and choose 1–31 past UTC days within an area no larger than 100 km per side.',
        ),
      );
    }
    if (!this.searchImagery)
      return this._fail(
        t('Historical imagery is unavailable in this session.'),
      );
    const run = this._begin('search');
    this._reset();
    this.query = query;
    this.subject = immutable(copy(subject));
    this.inputKey = run.key;
    this.status = 'searching';
    this.present();
    try {
      const result = await this.searchImagery(query, { signal: run.signal });
      if (!this._current(run)) return false;
      this.candidates = immutable(candidatesFrom(result));
      this.status =
        !this.candidates.length || result?.status === 'unavailable'
          ? 'unavailable'
          : result?.status === 'partial'
            ? 'partial'
            : 'ready';
      if (this.status === 'unavailable')
        this.feedback = t(
          'No dated imagery was found in this window. This does not establish that nothing changed.',
        );
      return true;
    } catch {
      if (this._current(run)) {
        this.status = 'error';
        this.error = t(
          'The imagery search could not finish. Try another window or retry.',
        );
      }
      return false;
    } finally {
      this._finish(run);
    }
  }
  async choose({ slot, id } = {}) {
    if (!this.live() || this.operation || !['a', 'b'].includes(slot))
      return false;
    const row = this.candidates.find((candidate) => candidate.id === id);
    if (!row) return false;
    const run = this._begin('probe');
    this._clearDisplay();
    this.savedComparison = null;
    this.notes = [];
    this.slots = { ...this.slots, [slot]: null };
    this.slotIds = { ...this.slotIds, [slot]: null };
    this.choosingSlot = slot;
    this.status = 'probing';
    this.present();
    try {
      const proof = row.descriptor
        ? { status: 'present', descriptor: row.descriptor }
        : await this.probeImagery?.(id, { signal: run.signal });
      if (!this._current(run)) return false;
      const input =
        proof?.status === 'present' && proof.descriptor
          ? descriptor(proof.descriptor)
          : null;
      this.candidates = immutable(
        this.candidates.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                status: input
                  ? 'present'
                  : proof?.status === 'empty'
                    ? 'empty'
                    : 'error',
                descriptor: input,
              }
            : candidate,
        ),
      );
      if (!input) {
        this.status = 'unavailable';
        this.error = t(
          'This date has no verified dated pixels for the selected area. Choose another acquisition or retry.',
        );
        return false;
      }
      this.slots = { ...this.slots, [slot]: input };
      this.slotIds = { ...this.slotIds, [slot]: id };
      this.status = 'ready';
      return true;
    } catch {
      if (this._current(run)) {
        this.status = 'error';
        this.error = t(
          'The selected acquisition could not be verified. Retry or choose another date.',
        );
      }
      return false;
    } finally {
      this._finish(run);
    }
  }
  _captureDisplayed() {
    if (!this.readComparison) return;
    const captured = this.readComparison();
    if (
      !captured ||
      !sameInput(captured.before, this.slots.a) ||
      !sameInput(captured.after, this.slots.b) ||
      JSON.stringify(captured.extent) !== JSON.stringify(this.query.extent)
    )
      throw new Error('Displayed comparison changed');
    const next = {
      ...this._snapshot(),
      before: captured.before,
      after: captured.after,
      splitPosition: captured.splitPosition,
    };
    validateComparisonSnapshot(next);
    this.slots = {
      a: descriptor(captured.before),
      b: descriptor(captured.after),
    };
    this.splitPosition = captured.splitPosition;
  }
  async compare() {
    if (
      !this.live() ||
      this.operation ||
      !this._validPair() ||
      !this.compareImagery
    )
      return this._fail(
        t(
          'Choose two verified acquisitions in chronological order before comparing.',
        ),
      );
    const run = this._begin('compare');
    this._clearDisplay();
    this.status = 'comparing';
    this.present();
    try {
      const result = await this.compareImagery(
        {
          extent: [...this.query.extent],
          a: this.slots.a,
          b: this.slots.b,
          splitPosition: this.splitPosition,
        },
        { signal: run.signal },
      );
      if (!this._current(run)) return false;
      if (!result?.ok) throw new Error('Unavailable dated imagery');
      if (Number.isFinite(result.splitPosition))
        this.splitPosition = result.splitPosition;
      this.comparisonActive = true;
      this._captureDisplayed();
      this.status = 'compared';
      return true;
    } catch {
      if (this._current(run)) {
        this._clearDisplay();
        this.status = 'unavailable';
        this.error = t(
          'The exact dated comparison is unavailable. Saved metadata has not been changed.',
        );
      }
      return false;
    } finally {
      this._finish(run);
    }
  }
  clearComparison() {
    if (!this.live() || this.operation) return false;
    this._clearDisplay();
    this.status = this.query ? 'ready' : 'empty';
    this.present();
    return true;
  }
  async save() {
    if (
      !this.live() ||
      this.operation ||
      !this.comparisonActive ||
      !this.saveComparison
    )
      return false;
    let snapshot;
    try {
      this._captureDisplayed();
      snapshot = immutable(copy(validateComparisonSnapshot(this._snapshot())));
    } catch {
      return this._fail(
        t(
          'The displayed comparison changed. Compare the chosen acquisitions again before saving.',
        ),
      );
    }
    const run = this._begin('save');
    this.present();
    try {
      const saved = await this.saveComparison(
        copy(this.subject),
        copy(snapshot),
      );
      if (!this._current(run)) return false;
      if (!saved?.projectId || !saved?.comparisonId)
        throw new Error('Not saved');
      this.savedComparison = immutable({
        projectId: saved.projectId,
        comparisonId: saved.comparisonId,
      });
      this.status = 'saved';
      this.feedback = t(
        'Comparison saved with its acquisition dates and source details.',
      );
      return true;
    } catch {
      if (this._current(run))
        this.error = t(
          'The comparison could not be saved. Your current comparison is still available.',
        );
      return false;
    } finally {
      this._finish(run);
    }
  }
  async addNote({ text: content, interpretation } = {}) {
    if (
      !this.live() ||
      this.operation ||
      !this.savedComparison ||
      !this.addChangeNote
    )
      return false;
    if (
      typeof content !== 'string' ||
      !content.trim() ||
      content.length > 16384 ||
      !['observed', 'inferred', 'unresolved'].includes(interpretation)
    )
      return this._fail(
        t('Write a note and mark it as observed, inferred, or unresolved.'),
      );
    const run = this._begin('note');
    this.present();
    try {
      const result = await this.addChangeNote(
        this.savedComparison.comparisonId,
        { text: content.trim(), interpretation },
      );
      if (!this._current(run)) return false;
      if (!result) throw new Error('Not saved');
      this.notes = immutable([
        ...this.notes,
        {
          id: text(result.id, 160) || `note-${this.notes.length}`,
          text: content.trim(),
          interpretation,
          createdAt: iso(result.createdAt),
        },
      ]);
      this.feedback = t(
        'Change note saved. Its interpretation remains separate from the imagery.',
      );
      return true;
    } catch {
      if (this._current(run))
        this.error = t(
          'The change note could not be saved. Your comparison is unchanged.',
        );
      return false;
    } finally {
      this._finish(run);
    }
  }
  reopen({ id, projectId, snapshot, notes = [], subject } = {}) {
    if (!this.live() || ['save', 'note'].includes(this.operation)) return false;
    try {
      validateComparisonSnapshot(snapshot, {
        linked: Boolean(snapshot?.before?.evidenceId),
      });
      const a = publicInput(snapshot.before),
        b = publicInput(snapshot.after);
      this._invalidate();
      this._reset();
      this.inputKey = this._key();
      this.subject = normalizeLensSelection(subject) || this._selection();
      this.query = immutable({
        extent: [...snapshot.extent],
        startDate: a.asset.requestedDate,
        endDate: b.asset.requestedDate,
      });
      this.slots = { a, b };
      this.splitPosition = snapshot.splitPosition;
      this.savedComparison = id
        ? immutable({ projectId: projectId || null, comparisonId: id })
        : null;
      this.notes = immutable(
        notes
          .slice(0, 200)
          .filter((note) =>
            ['observed', 'inferred', 'unresolved'].includes(
              note.interpretation,
            ),
          )
          .map((note) => ({
            id: text(note.id, 160),
            text: text(note.text, 16384),
            interpretation: note.interpretation,
            createdAt: iso(note.createdAt),
          })),
      );
      this.status = 'saved';
      this.error = null;
      this.feedback = t(
        'Stored comparison metadata is open. Display the exact acquisitions explicitly to load imagery.',
      );
      this.present();
      return true;
    } catch {
      return this._fail(
        t(
          'This saved comparison has invalid or incomplete dated imagery metadata.',
        ),
      );
    }
  }
  cancel() {
    if (!this.live() || ['save', 'note'].includes(this.operation)) return false;
    this._invalidate();
    this.status = 'cancelled';
    this.error = null;
    this.present();
    return true;
  }
  destroy() {
    if (this.destroyed) return;
    this._invalidate();
    this._clearDisplay();
    this.unsubscribe?.();
    this.store?.detach(this.owner);
    this.destroyed = true;
  }
}
