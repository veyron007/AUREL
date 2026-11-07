import { t } from '../i18n/index.js';
import { buildFieldbookBrief } from '../fieldbook/brief.js';
import { validateAnalysisSnapshot } from '../fieldbook/analysis.js';
import {
  addPlace,
  addRoute,
  addAnalysis,
  addDrawing,
  addAttachment,
  addSceneDocument,
} from '../fieldbook/operations.js';
export const CAPTURE_OPERATIONS = Object.freeze({
  route: addRoute,
  drawing: addDrawing,
  attachment: addAttachment,
  scene: addSceneDocument,
});
export const CAPTURE_COLLECTIONS = Object.freeze({
  route: 'routes',
  drawing: 'drawings',
  attachment: 'attachments',
  scene: 'sceneDocuments',
});

const FEED_STATES = [
  'unknown',
  'nominal',
  'loading',
  'degraded',
  'stale',
  'partial',
  'fallback',
  'unavailable',
  'blocked',
];
const savedTime = (value) =>
  value == null ? null : new Date(value).toISOString();
export function downloadLocalText(text, name) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function preview(project) {
  return {
    title: project.title,
    counts: buildFieldbookBrief(project).counts,
    onlineReferences: project.evidence.filter((entry) => entry.link).length,
    localAttachments: project.attachments.length,
    localBytes: project.attachments.reduce(
      (total, item) => total + item.bytes,
      0,
    ),
  };
}
export function safeFilename(title) {
  return `${
    String(title)
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 64) || 'fieldbook'
  }.aurel.json`;
}

/** Save only explicit source metadata; UI feed timestamps are not observation times. */
export function projectEvidence(row, subjectId) {
  return {
    subjectId,
    sourceId: row.sourceId,
    sourceLabel: row.sourceLabel,
    kind: row.kind ?? 'unknown',
    applicableTime: savedTime(row.applicableTime),
    retrievedAt: savedTime(row.retrievedAt),
    extent: row.extent ?? null,
    resolutionM: row.resolutionM ?? null,
    uncertainty: row.uncertainty ?? null,
    coverage: row.coverage ?? 'unknown',
    feedState: FEED_STATES.includes(row.feedState) ? row.feedState : 'unknown',
    attribution: row.attribution ?? null,
    license: row.license ?? null,
    link: row.link ?? null,
  };
}

/** Named commands exposed to the Fieldbook panel. */
export const FIELDBOOK_ACTIONS = [
  'create',
  'open',
  'rename',
  'save',
  'saveAnalysis',
  'saveComparison',
  'addChangeNote',
  'openSavedComparison',
  'duplicate',
  'archive',
  'recover',
  'setShowArchived',
  'reloadSaved',
  'discardAndContinue',
  'cancelNavigation',
  'previewImportFile',
  'applyImport',
  'cancelImport',
  'prepareExport',
  'exportBackup',
  'cancelExport',
  'recoverDraft',
  'exportRecovery',
  'dismissRecovery',
  'addProjectNote',
  'setNoteDraft',
  'removeNote',
  'focusSavedPlace',
  'toggleBrief',
  'capture',
  'restoreSavedCapture',
  'confirmRestore',
  'cancelRestore',
  'exportCorrupt',
];

export function findSavedPlace(project, selection) {
  const coordinates = selection?.geometry?.coordinates;
  return project.places.find(
    (place) =>
      place.name === selection.name &&
      JSON.stringify(place.geometry.coordinates) ===
        JSON.stringify(coordinates),
  );
}

/** Prepare the complete validated edit before the controller starts its one save. */
export function prepareAnalysisSave(project, subject, snapshot) {
  validateAnalysisSnapshot(snapshot);
  let next = project;
  let target =
    subject?.kind === 'route'
      ? project.routes.find((entry) => entry.id === subject.route?.id)
      : [...project.places, ...project.routes].find(
          (entry) => entry.id === subject?.id,
        );
  if (!target && subject?.kind === 'route') {
    next = addRoute(next, subject.route);
    target = next.routes.at(-1);
  } else if (!target && subject?.geometry?.type === 'Point') {
    target = findSavedPlace(next, subject);
    if (!target) {
      next = addPlace(next, {
        name: subject.name,
        aliases: subject.aliases ?? [],
        geometry: subject.geometry,
        extent: subject.extent ?? null,
      });
      target = next.places.at(-1);
    }
  }
  if (!target) throw new Error('Analysis subject is not available.');
  // Retrying the same failed snapshot save must not duplicate its contents.
  if (
    next.analyses.some(
      (entry) =>
        entry.subjectId === target.id &&
        JSON.stringify(entry.snapshot) === JSON.stringify(snapshot),
    )
  )
    return next;
  return addAnalysis(next, { subjectId: target.id, snapshot });
}

/** Detached presentation of the current editing owner; no storage or provider work. */
export function fieldbookView(owner) {
  return {
    corruptProjects: owner._corrupt.map((entry) => ({ id: entry.id })),
    restorePreview: owner._restore ? { name: owner._restore.entry.name } : null,
    loading: owner._loading,
    busy: owner._busy,
    draft: owner._draft,
    projects: owner._projects.filter(
      (project) => Boolean(project.archivedAt) === owner._showArchived,
    ),
    showArchived: owner._showArchived,
    dirty: owner._hasUnsaved(),
    noteDraft: owner._noteDraft,
    error: owner._error,
    status: owner._status,
    conflict: owner._conflict,
    draftWarning: owner._draftWarning,
    importPreview: owner._import ? preview(owner._import) : null,
    exportPreview:
      owner._export && owner._draft ? owner._exportPreview() : null,
    recovery: owner._recovery
      ? { title: owner._recovery.project.title, valid: true }
      : owner._recoveryRaw
        ? { title: t('Unreadable draft'), valid: false }
        : null,
    pendingNavigation: owner._pending ? { kind: owner._pending.kind } : null,
    brief:
      owner._showBrief && owner._draft
        ? buildFieldbookBrief(owner._draft)
        : null,
    captureAvailable: Boolean(owner._captureCurrent),
    restoreAvailable: Boolean(owner._restoreCapture),
    comparisonOpenAvailable: Boolean(owner._onOpenComparison),
  };
}
