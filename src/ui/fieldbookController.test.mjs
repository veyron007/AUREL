import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldbook } from '../fieldbook/document.js';
import { FieldbookController } from './fieldbookController.js';
import { createPinia } from 'pinia';
import { useFieldbookStore } from './stores/fieldbook.js';
import { analysisSnapshot } from '../fieldbook/analysisFixtures.mjs';
import { comparisonSnapshot } from '../fieldbook/comparisonFixtures.mjs';

function harness(overrides = {}) {
  const records = new Map();
  let view;
  let controls;
  const downloads = [];
  const storage = new Map();
  const store = {
    publish(next) {
      view = next;
    },
    connect(next) {
      controls = next;
      return next;
    },
    detach(token) {
      if (controls === token) controls = null;
    },
    owns(token) {
      return token === controls;
    },
  };
  const repository = {
    async list() {
      return [...records.values()];
    },
    async get(id) {
      return records.get(id) ?? null;
    },
    async save(project, { expectedRevision }) {
      const current = records.get(project.id);
      if ((current?.revision ?? null) !== expectedRevision)
        throw Object.assign(new Error('conflict'), {
          code: 'CONFLICT',
          latest: current,
        });
      const saved = { ...project, revision: (current?.revision ?? 0) + 1 };
      records.set(saved.id, saved);
      return saved;
    },
    close() {},
    ...overrides.repository,
  };
  const controller = new FieldbookController({
    store,
    repository,
    draftStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    downloadText: (text, name) => downloads.push({ text, name }),
    ...overrides,
    repository,
  });
  return {
    controller,
    records,
    downloads,
    storage,
    get view() {
      return view;
    },
    get controls() {
      return controls;
    },
  };
}
const selection = {
  id: 'external',
  name: 'Dehradun',
  aliases: ['देहरादून'],
  geometry: { type: 'Point', coordinates: [78.0438, 30.3258] },
};

test('comparison and change-note actions explicitly persist once and preserve failed drafts for retry', async () => {
  let attempts = 0;
  const h = harness({
    repository: {
      async save(project) {
        attempts++;
        if (attempts === 1) throw new Error('quota');
        return { ...project, revision: attempts - 1 };
      },
    },
  });
  await h.controller.init();
  const snapshot = comparisonSnapshot();
  assert.equal(await h.controller.saveComparison(selection, snapshot), false);
  assert.equal(h.view.draft.comparisons.length, 1);
  assert.equal(h.view.draft.evidence.length, 2);
  const saved = await h.controller.saveComparison(selection, snapshot);
  assert.equal(saved.comparisonId, h.view.draft.comparisons[0].id);
  assert.equal(saved.projectId, h.view.draft.id);
  assert.equal(h.view.draft.comparisons.length, 1);
  assert.equal(h.view.draft.evidence.length, 2);
  const savedNote = await h.controller.addChangeNote(saved.comparisonId, {
    text: 'Possible shadow difference',
    interpretation: 'unresolved',
  });
  assert.equal(savedNote.id, h.view.draft.changeNotes[0].id);
  assert.equal(savedNote.createdAt, h.view.draft.changeNotes[0].createdAt);
  assert.equal(h.view.draft.changeNotes.length, 1);
  assert.equal(attempts, 3);
  const before = h.view.draft;
  assert.equal(
    await h.controller.addChangeNote('missing', {
      text: 'Unsupported',
      interpretation: 'observed',
    }),
    false,
  );
  assert.equal(h.view.draft, before);
  assert.equal(attempts, 3);
  h.controller.destroy();
});

test('opening a saved comparison publishes detached historical inputs and notes without saving', async () => {
  let reopened;
  const h = harness({
    onOpenComparison: (value) => {
      reopened = value;
    },
  });
  await h.controller.init();
  const saved = await h.controller.saveComparison(
    selection,
    comparisonSnapshot(),
  );
  await h.controller.addChangeNote(saved.comparisonId, {
    text: 'Uncertain shadow',
    interpretation: 'unresolved',
  });
  const before = h.view.draft;
  assert.equal(h.controller.openSavedComparison(saved.comparisonId), true);
  assert.equal(reopened.projectId, before.id);
  assert.equal(reopened.subject.name, 'Dehradun');
  assert.equal(reopened.notes.length, 1);
  reopened.snapshot.before.license = 'Changed';
  reopened.notes[0].text = 'Changed';
  assert.equal(h.view.draft, before);
  assert.notEqual(before.comparisons[0].snapshot.before.license, 'Changed');
  assert.equal(h.controller.openSavedComparison('missing'), false);
  h.controller.destroy();
  assert.equal(h.controller.openSavedComparison(saved.comparisonId), false);
});

test('durable change-note result identifies the exact retried note, including after quota failure', async () => {
  const h = harness();
  await h.controller.init();
  const saved = await h.controller.saveComparison(
    selection,
    comparisonSnapshot(),
  );
  const input = { text: 'First interpretation', interpretation: 'unresolved' };
  const first = await h.controller.addChangeNote(saved.comparisonId, input);
  await h.controller.addChangeNote(saved.comparisonId, {
    text: 'Another interpretation',
    interpretation: 'inferred',
  });
  const duplicate = await h.controller.addChangeNote(saved.comparisonId, input);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.createdAt, first.createdAt);
  assert.equal(h.view.draft.changeNotes.length, 2);
  const originalSave = h.controller.repository.save;
  h.controller.repository.save = async () => {
    throw new Error('quota');
  };
  const failedInput = {
    text: 'Keep this failed draft',
    interpretation: 'observed',
  };
  assert.equal(
    await h.controller.addChangeNote(saved.comparisonId, failedInput),
    false,
  );
  const pending = h.view.draft.changeNotes.at(-1);
  assert.equal(h.view.dirty, true);
  h.controller.repository.save = originalSave;
  const retried = await h.controller.addChangeNote(
    saved.comparisonId,
    failedInput,
  );
  assert.equal(retried.id, pending.id);
  assert.equal(retried.createdAt, pending.createdAt);
  assert.ok(Number.isFinite(Date.parse(retried.createdAt)));
  assert.deepEqual(retried, h.records.get(saved.projectId).changeNotes.at(-1));
  retried.text = 'External mutation';
  assert.equal(h.view.draft.changeNotes.at(-1).text, failedInput.text);
  assert.equal(h.view.draft.changeNotes.length, 3);
  h.controller.destroy();
});

test('saveAnalysis persists selected place and typed snapshot once, preserving failed drafts for retry', async () => {
  let writes = 0;
  const h = harness({
    repository: {
      async save() {
        writes++;
        throw new Error('quota');
      },
    },
  });
  await h.controller.init();
  assert.equal(
    await h.controller.saveAnalysis(selection, analysisSnapshot()),
    false,
  );
  assert.equal(writes, 1);
  assert.equal(h.view.draft.places.length, 1);
  assert.equal(h.view.draft.analyses.length, 1);
  assert.equal(h.view.dirty, true);
  h.controller.prepareExport();
  h.controller.exportBackup();
  assert.equal(
    JSON.parse(h.downloads[0].text).analyses[0].snapshot.daylight
      .daylightSeconds,
    39000,
  );
  const before = h.view.draft;
  assert.equal(
    await h.controller.saveAnalysis(
      { id: 'not-a-subject' },
      analysisSnapshot(),
    ),
    false,
  );
  assert.equal(h.view.draft, before);
  assert.equal(writes, 1);
  h.controller.destroy();
});

test('analysis save holds the write lane and ignores completion after retirement', async () => {
  let complete;
  let writes = 0;
  const h = harness({
    repository: {
      save: (project) => {
        writes++;
        return new Promise((resolve) => {
          complete = () => resolve({ ...project, revision: 1 });
        });
      },
    },
  });
  await h.controller.init();
  const saving = h.controller.saveAnalysis(selection, analysisSnapshot());
  assert.equal(h.view.busy, true);
  assert.equal(
    await h.controller.saveAnalysis(selection, analysisSnapshot()),
    false,
  );
  assert.equal(writes, 1);
  h.controller.destroy();
  complete();
  assert.equal(await saving, false);
  assert.equal(h.view, null);
});

test('route analysis save captures the exact route and retries without duplicating failed content', async () => {
  let attempts = 0;
  const h = harness({
    repository: {
      async save(project) {
        attempts++;
        if (attempts === 1) throw new Error('quota');
        return { ...project, revision: 1 };
      },
    },
  });
  await h.controller.init();
  const route = {
    id: 'saved-route',
    name: 'Foothills walk',
    geometry: {
      type: 'LineString',
      coordinates: [
        [78, 30],
        [78.01, 30.01],
      ],
    },
    mode: 'foot',
    sourceId: 'osm-routing',
    sourceLabel: 'OSRM',
    distanceM: 1000,
    durationSec: 600,
    createdAt: '2026-11-07T06:00:00.000Z',
    applicableTime: null,
    retrievedAt: null,
    snapshot: null,
  };
  const snapshot = analysisSnapshot();
  snapshot.route = {
    name: route.name,
    geometry: route.geometry,
    mode: route.mode,
    distanceM: route.distanceM,
    durationS: route.durationSec,
    retrievedAt: null,
  };
  assert.equal(
    await h.controller.saveAnalysis({ kind: 'route', route }, snapshot),
    false,
  );
  assert.equal(
    await h.controller.saveAnalysis({ kind: 'route', route }, snapshot),
    true,
  );
  assert.equal(h.view.draft.routes.length, 1);
  assert.equal(h.view.draft.analyses.length, 1);
  assert.equal(h.view.draft.analyses[0].subjectId, route.id);
  assert.equal(h.view.draft.revision, 1);
  const before = h.view.draft;
  assert.equal(
    await h.controller.saveAnalysis(
      { id: route.id },
      { ...snapshot, route: { ...snapshot.route, distanceM: 1 } },
    ),
    false,
  );
  assert.equal(h.view.draft, before);
  h.controller.destroy();
});

test('real Pinia ownership publishes actions and a retiring controller cannot clear its replacement', async () => {
  const store = useFieldbookStore(createPinia());
  const first = harness({ store });
  await first.controller.init();
  assert.equal(store.view.loading, false);
  assert.equal(await store.act('create', 'Real library'), true);
  assert.equal(store.view.draft.title, 'Real library');
  const second = harness({ store });
  await second.controller.init();
  await store.act('create', 'Replacement');
  first.controller.destroy();
  assert.equal(store.view.draft.title, 'Replacement');
  assert.equal(await store.act('save'), true);
  second.controller.destroy();
  assert.equal(store.view, null);
});

test('out-of-order file reads and cancelled imports cannot replace the latest preview', async () => {
  const h = harness();
  await h.controller.init();
  let resolve;
  const pending = h.controller.previewImportFile({
    size: 100,
    text: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  h.controller.previewImportText(
    JSON.stringify(createFieldbook({ title: 'Newest' })),
  );
  resolve(JSON.stringify(createFieldbook({ title: 'Older' })));
  await pending;
  assert.equal(h.view.importPreview.title, 'Newest');
  const cancelled = h.controller.previewImportFile({
    size: 100,
    text: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  h.controller.cancelImport();
  resolve(JSON.stringify(createFieldbook({ title: 'Cancelled' })));
  await cancelled;
  assert.equal(h.view.importPreview, null);
});

test('Fieldbook retains a local place and note through an explicit revisioned save', async () => {
  const h = harness();
  await h.controller.init();
  assert.equal(h.controller.capturePlace(selection), true);
  assert.equal(
    h.controller.addPlaceNote(selection, 'Meet at the north entrance.'),
    true,
  );
  assert.equal(h.view.draft.places.length, 1);
  assert.equal(h.view.draft.notes.length, 1);
  assert.equal(h.view.dirty, true);
  await h.controller.save();
  assert.equal(h.view.dirty, false);
  assert.equal(h.view.draft.revision, 1);
  assert.equal(
    h.records.get(h.view.draft.id).notes[0].text,
    'Meet at the north entrance.',
  );
  h.controller.destroy();
  assert.equal(h.controls, null);
});

test('quota failure keeps an exportable draft and automatic recovery bytes', async () => {
  const h = harness({
    repository: {
      async save() {
        throw Object.assign(new Error('QuotaExceededError'), {
          name: 'QuotaExceededError',
        });
      },
    },
  });
  await h.controller.init();
  h.controller.capturePlace(selection);
  await h.controller.save();
  assert.equal(h.view.dirty, true);
  assert.match(h.view.error, /could not be saved/i);
  assert.ok(h.storage.size);
  h.controller.prepareExport();
  assert.ok(h.view.exportPreview);
  h.controller.exportBackup();
  assert.equal(JSON.parse(h.downloads[0].text).places[0].name, 'Dehradun');
});

test('conflicting save never replaces the draft with another tab version', async () => {
  const h = harness();
  await h.controller.init();
  h.controller.capturePlace(selection);
  await h.controller.save();
  const id = h.view.draft.id;
  const saved = h.records.get(id);
  h.records.set(id, { ...saved, title: 'Other tab', revision: 2 });
  h.controller.rename('My unsaved changes');
  await h.controller.save();
  assert.equal(h.view.conflict, true);
  assert.equal(h.view.draft.title, 'My unsaved changes');
  assert.equal(h.view.dirty, true);
  assert.equal(h.records.get(id).title, 'Other tab');
  await h.controller.reloadSaved();
  assert.equal(h.view.draft.title, 'Other tab');
  assert.equal(h.view.recovery.title, 'My unsaved changes');
});

test('imports are validated and previewed before applying as a fresh project', async () => {
  const h = harness();
  await h.controller.init();
  h.controller.capturePlace(selection);
  await h.controller.save();
  const original = h.view.draft;
  await h.controller.previewImportText('{broken');
  assert.equal(h.view.draft, original);
  assert.equal(h.view.importPreview, null);
  const incoming = createFieldbook({ title: 'Imported fieldwork' });
  await h.controller.previewImportText(JSON.stringify(incoming));
  assert.equal(h.view.draft, original);
  assert.equal(h.view.importPreview.title, incoming.title);
  await h.controller.applyImport();
  assert.equal(h.view.draft.title, incoming.title);
  assert.notEqual(h.view.draft.id, incoming.id);
  assert.ok(h.records.has(original.id));
  assert.equal(h.view.dirty, true);
});

test('switching away from dirty work requires an explicit decision', async () => {
  const h = harness();
  await h.controller.init();
  h.controller.capturePlace(selection);
  const draft = h.view.draft;
  await h.controller.create('Another project');
  assert.equal(h.view.draft, draft);
  assert.ok(h.view.pendingNavigation);
  await h.controller.discardAndContinue();
  assert.equal(h.view.draft.title, 'Another project');
  assert.equal(h.view.recovery.title, draft.title);
});

test('late repository reads cannot publish after destroy', async () => {
  let settle;
  const h = harness({
    repository: {
      list: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    },
  });
  const opening = h.controller.init();
  h.controller.destroy();
  settle([]);
  await opening;
  assert.equal(h.controls, null);
  assert.equal(h.view, null);
});

test('blocked draft storage leaves editable draft and explains recovery limitation', async () => {
  const h = harness({
    draftStorage: {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {},
    },
  });
  await h.controller.init();
  h.controller.capturePlace(selection);
  assert.equal(h.view.dirty, true);
  assert.ok(h.view.draftWarning);
  assert.equal(h.view.draft.places.length, 1);
});

test('unsubmitted note text is protected, exported and included by the single Save action', async () => {
  const h = harness();
  await h.controller.init();
  await h.controller.create('Field notes');
  await h.controller.save();
  h.controller.setNoteDraft('Take a water sample after rain.');
  assert.equal(h.view.dirty, true);
  assert.equal(h.view.draft.notes.length, 0);
  h.controller.prepareExport();
  assert.equal(h.view.exportPreview.counts.notes, 1);
  h.controller.exportBackup();
  assert.equal(
    JSON.parse(h.downloads.at(-1).text).notes[0].text,
    'Take a water sample after rain.',
  );
  await h.controller.save();
  assert.equal(h.view.dirty, false);
  assert.equal(h.view.noteDraft, '');
  assert.equal(h.view.draft.notes.length, 1);
});

test('archive, recover and duplicate preserve project contents without overwriting the original', async () => {
  const h = harness();
  await h.controller.init();
  h.controller.capturePlace(selection);
  await h.controller.save();
  const id = h.view.draft.id;
  h.controller.archive();
  await h.controller.save();
  h.controller.setShowArchived(true);
  assert.equal(h.view.projects.length, 1);
  assert.ok(h.view.draft.archivedAt);
  h.controller.recover();
  await h.controller.save();
  h.controller.setShowArchived(false);
  assert.equal(h.view.projects.length, 1);
  assert.equal(h.view.draft.archivedAt, null);
  await h.controller.duplicate();
  assert.notEqual(h.view.draft.id, id);
  assert.equal(h.view.draft.places[0].name, 'Dehradun');
  await h.controller.save();
  assert.equal(h.records.size, 2);
});

test('opening a missing project cannot make an unsaved draft look saved', async () => {
  const h = harness();
  await h.controller.init();
  h.controller.capturePlace(selection);
  await h.controller.open('missing');
  assert.ok(h.view.pendingNavigation);
  await h.controller.discardAndContinue();
  assert.equal(h.view.draft.places.length, 1);
  assert.equal(h.view.dirty, true);
  assert.match(h.view.error, /could not be opened/);
  h.controller.cancelNavigation();
  assert.equal(h.view.pendingNavigation, null);
});

test('saved evidence keeps explicit timestamps and uncertainty and excludes whole-layer status', async () => {
  const h = harness();
  await h.controller.init();
  assert.equal(
    h.controller.savePlace(selection, [
      {
        scope: 'map',
        sourceId: 'overview',
        sourceLabel: 'Natural Earth',
        kind: 'imagery',
        applicableTime: null,
        retrievedAt: 1735689600000,
        uncertainty: 500,
        feedState: 'nominal',
      },
      {
        scope: 'layer',
        sourceId: 'flights',
        sourceLabel: 'Whole layer',
        kind: 'observation',
      },
    ]),
    true,
  );
  assert.equal(h.view.draft.evidence.length, 1);
  const item = h.view.draft.evidence[0];
  assert.equal(item.applicableTime, null);
  assert.equal(item.retrievedAt, '2025-01-01T00:00:00.000Z');
  assert.equal(item.uncertainty, 500);
  assert.equal(item.coverage, 'unknown');
  assert.equal(item.resolutionM, null);
  h.controller.toggleBrief();
  assert.equal(h.view.brief.places[0].evidence[0].applicableTime, null);
  h.controller.toggleBrief();
  assert.equal(h.view.brief, null);
});

test('failed content capture is atomic and late capture is ignored after destruction', async () => {
  let resolve;
  let mode = 'invalid';
  const h = harness({
    captureCurrent: () =>
      mode === 'invalid'
        ? { name: 'bad route' }
        : new Promise((done) => {
            resolve = done;
          }),
  });
  await h.controller.init();
  h.controller.capturePlace(selection);
  const before = h.view.draft;
  assert.equal(await h.controller.capture('route'), false);
  assert.equal(h.view.draft, before);
  mode = 'pending';
  const pending = h.controller.capture('drawing');
  h.controller.destroy();
  resolve([]);
  await pending;
  assert.equal(h.view, null);
});

test('explicit file imports reject oversized and unreadable files before changing the project', async () => {
  const h = harness();
  await h.controller.init();
  h.controller.capturePlace(selection);
  const before = h.view.draft;
  let reads = 0;
  await h.controller.previewImportFile({
    size: 20 * 1024 * 1024,
    text() {
      reads++;
    },
  });
  assert.equal(reads, 0);
  await h.controller.previewImportFile({
    size: 10,
    async text() {
      throw new Error('unreadable');
    },
  });
  assert.equal(h.view.draft, before);
  assert.match(h.view.error, /could not be read/);
  h.controller.cancelImport();
  assert.equal(h.view.importPreview, null);
});

test('corrupt repository rows remain recoverable while healthy project summaries are shown', async () => {
  const raw = { kind: 'aurel-fieldbook', version: 999 };
  const h = harness({
    repository: {
      async list() {
        return { projects: [], corrupt: [{ id: 'damaged' }] };
      },
      async get() {
        throw Object.assign(new Error('corrupt'), {
          code: 'CORRUPT_DOCUMENT',
          original: raw,
        });
      },
    },
  });
  await h.controller.init();
  assert.equal(h.view.corruptProjects[0].id, 'damaged');
  await h.controller.exportCorrupt('damaged');
  assert.deepEqual(JSON.parse(h.downloads[0].text), raw);
});

test('protected note drafts recover after refresh and malformed recovery bytes can be downloaded', async () => {
  const project = createFieldbook({ title: 'Recovery project' });
  const raw = JSON.stringify({
    version: 1,
    project,
    baseRevision: null,
    noteDraft: 'Unsubmitted note',
  });
  const h = harness({
    draftStorage: { getItem: () => raw, setItem() {}, removeItem() {} },
  });
  await h.controller.init();
  assert.equal(h.view.recovery.title, 'Recovery project');
  h.controller.recoverDraft();
  assert.equal(h.view.noteDraft, 'Unsubmitted note');
  assert.equal(h.view.dirty, true);
  const bad = harness({
    draftStorage: { getItem: () => '{broken', setItem() {}, removeItem() {} },
  });
  await bad.controller.init();
  assert.equal(bad.view.recovery.valid, false);
  bad.controller.exportRecovery();
  assert.equal(bad.downloads[0].text, '{broken');
  bad.controller.dismissRecovery();
  assert.equal(bad.view.recovery, null);
});

test('saved places delegate focus and note removal affects only the selected draft note', async () => {
  const focused = [];
  const h = harness({ focusPlace: (place) => focused.push(place) });
  await h.controller.init();
  h.controller.addNote(selection, 'One note');
  const place = h.view.draft.places[0];
  h.controller.focusSavedPlace(place.id);
  assert.equal(focused[0].name, 'Dehradun');
  h.controller.removeNote(h.view.draft.notes[0].id);
  assert.equal(h.view.draft.notes.length, 0);
  assert.equal(h.view.draft.places.length, 1);
  h.controller.focusSavedPlace('missing');
  assert.equal(focused.length, 1);
});

test('download failure retains the draft and the explicit export preview', async () => {
  const h = harness({
    downloadText() {
      throw new Error('blocked');
    },
  });
  await h.controller.init();
  h.controller.capturePlace(selection);
  h.controller.prepareExport();
  assert.equal(h.controller.exportBackup(), false);
  assert.ok(h.view.exportPreview);
  assert.match(h.view.error, /could not be downloaded/);
  h.controller.cancelExport();
  assert.equal(h.view.exportPreview, null);
});

test('captured local content exports its bytes and scene replacement requires a separate confirmation', async () => {
  const { createDefaultProject } = await import('../scenes/project.js');
  const restored = [];
  const fixtures = {
    scene: { name: 'Saved scenes', document: createDefaultProject() },
    attachment: {
      name: 'field.txt',
      mimeType: 'text/plain',
      encoding: 'utf8',
      data: 'hello',
      bytes: 5,
    },
    drawing: [
      {
        name: 'Meeting point',
        geometry: { type: 'Point', coordinates: [78, 30] },
        color: '#ffffff',
      },
    ],
  };
  const h = harness({
    captureCurrent: (kind) => fixtures[kind] ?? null,
    restoreCapture: (kind, entry) => restored.push({ kind, entry }),
  });
  await h.controller.init();
  assert.equal(await h.controller.capture('route'), false);
  assert.match(h.view.status, /Nothing/);
  for (const kind of ['scene', 'attachment', 'drawing'])
    assert.equal(await h.controller.capture(kind), true);
  h.controller.prepareExport();
  assert.equal(h.view.exportPreview.localBytes, 5);
  assert.equal(h.view.exportPreview.counts.scenes, 1);
  const scene = h.view.draft.sceneDocuments[0];
  await h.controller.restoreSavedCapture('scene', scene.id);
  assert.equal(restored.length, 0);
  assert.equal(h.view.restorePreview.name, 'Saved scenes');
  h.controller.cancelRestore();
  assert.equal(h.view.restorePreview, null);
  await h.controller.restoreSavedCapture('scene', scene.id);
  await h.controller.confirmRestore();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].kind, 'scene');
  await h.controller.restoreSavedCapture(
    'attachment',
    h.view.draft.attachments[0].id,
  );
  assert.equal(restored[1].entry.data, 'hello');
});

test('failed scene restore preserves the saved document and explains the failure', async () => {
  const { createDefaultProject } = await import('../scenes/project.js');
  const h = harness({
    captureCurrent: () => ({
      name: 'Scenes',
      document: createDefaultProject(),
    }),
    restoreCapture: () => {
      throw new Error('owner unavailable');
    },
  });
  await h.controller.init();
  await h.controller.capture('scene');
  const before = h.view.draft;
  await h.controller.restoreSavedCapture('scene', before.sceneDocuments[0].id);
  assert.equal(await h.controller.confirmRestore(), false);
  assert.equal(h.view.draft, before);
  assert.match(h.view.error, /could not be shown/);
});

test('active and protected drafts both survive refresh, saving active retains only protected recovery', async () => {
  const bytes = new Map();
  const draftStorage = {
    getItem: (key) => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value),
    removeItem: (key) => bytes.delete(key),
  };
  const first = harness({ draftStorage });
  await first.controller.init();
  await first.controller.create('Draft A');
  first.controller.setNoteDraft('A pending note');
  await first.controller.create('Draft B');
  await first.controller.discardAndContinue();
  first.controller.setNoteDraft('B pending note');
  first.controller.destroy();
  const refreshed = harness({ draftStorage });
  await refreshed.controller.init();
  assert.equal(refreshed.view.draft.title, 'Draft B');
  assert.equal(refreshed.view.noteDraft, 'B pending note');
  assert.equal(refreshed.view.recovery.title, 'Draft A');
  await refreshed.controller.create('Draft C');
  assert.equal(await refreshed.controller.discardAndContinue(), false);
  assert.equal(refreshed.view.draft.title, 'Draft B');
  assert.match(refreshed.view.error, /protected draft/);
  await refreshed.controller.save();
  refreshed.controller.destroy();
  const again = harness({ draftStorage });
  await again.controller.init();
  assert.equal(again.view.draft, null);
  assert.equal(again.view.recovery.title, 'Draft A');
  assert.equal(again.controller.recoverDraft(), true);
  assert.equal(again.view.noteDraft, 'A pending note');
  assert.equal(again.view.recovery, null);
});

test('choosing an invalid or unreadable backup invalidates the previous actionable preview', async () => {
  const h = harness();
  await h.controller.init();
  const prior = JSON.stringify(createFieldbook({ title: 'Previous preview' }));
  h.controller.previewImportText(prior);
  await h.controller.previewImportFile({ size: 99 * 1024 * 1024 });
  assert.equal(h.view.importPreview, null);
  assert.equal(h.controller.applyImport(), false);
  h.controller.previewImportText(prior);
  await h.controller.previewImportFile({
    size: 10,
    text: async () => {
      throw new Error('unreadable');
    },
  });
  assert.equal(h.view.importPreview, null);
  assert.equal(h.controller.applyImport(), false);
});

test('later evidence snapshots survive save while exact observations and note retries do not duplicate', async () => {
  const h = harness({
    repository: {
      save: async () => {
        throw new Error('quota');
      },
    },
  });
  await h.controller.init();
  const original = {
    sourceId: 'terrain',
    sourceLabel: 'Terrain survey',
    kind: 'observation',
    applicableTime: 1735689600000,
    resolutionM: 20,
  };
  h.controller.capturePlace(selection, [original]);
  h.controller.capturePlace(selection, [original]);
  h.controller.capturePlace(selection, [
    { ...original, applicableTime: 1735776000000, resolutionM: 10 },
  ]);
  assert.equal(h.view.draft.evidence.length, 2);
  assert.equal(h.view.draft.evidence[1].resolutionM, 10);
  h.controller.addPlaceNote(selection, 'Remember the eastern gate');
  await h.controller.save();
  h.controller.addPlaceNote(selection, 'Remember the eastern gate');
  await h.controller.save();
  assert.equal(h.view.draft.notes.length, 1);
});
