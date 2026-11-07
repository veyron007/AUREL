import { createFieldbookRepository } from '../fieldbook/repository.js';
import { FieldbookController } from './fieldbookController.js';
import { LensController } from './lensController.js';
import { useFieldbookStore } from './stores/fieldbook.js';
import { useLensStore } from './stores/lens.js';
import { useWorkspaceStore } from './stores/workspace.js';

/** Saved evidence is a historical snapshot, never a new provider observation. */
function savedEvidence(project, selection) {
  if (!project) return [];
  const place = project.places.find(
    (entry) =>
      entry.name === selection.name &&
      entry.geometry.coordinates.every(
        (value, index) => value === selection.geometry.coordinates[index],
      ),
  );
  if (!place) return [];
  return project.evidence
    .filter((row) => row.subjectId === place.id)
    .map((row) => ({
      ...row,
      uncertaintyM: row.uncertainty,
      applicableTime:
        row.applicableTime === null ? null : Date.parse(row.applicableTime),
      retrievedAt:
        row.retrievedAt === null ? null : Date.parse(row.retrievedAt),
    }));
}

/** Composition only: existing owners supply navigation, selection and captures. */
export function createPersonalWorkspace({
  pinia,
  repository = createFieldbookRepository(),
  subscribeLocationSearch,
  subscribeSelection,
  subscribeEvidence,
  readLayers,
  readMapSource,
  readCurrentPlace,
  focusPlace = () => {},
  captureCurrent,
  restoreCapture,
  onPlanPlace = () => {},
  onOpenComparison,
} = {}) {
  const workspace = useWorkspaceStore(pinia);
  const fieldbookStore = useFieldbookStore(pinia);
  let destroyed = false;
  let lens;
  const fieldbook = new FieldbookController({
    store: fieldbookStore,
    repository,
    captureCurrent,
    restoreCapture,
    onOpenComparison,
    focusPlace: (place) => {
      if (destroyed) return;
      focusPlace(place);
      lens.select(place, { reveal: false, origin: 'fieldbook' });
    },
  });
  const ready = fieldbook.init();
  const persist = async (edit) => {
    await ready;
    if (destroyed || !edit()) return false;
    return fieldbook.save();
  };
  lens = new LensController({
    store: useLensStore(pinia),
    subscribeLocationSearch,
    subscribeSelection,
    subscribeEvidence,
    readLayers,
    readMapSource,
    readCurrentPlace,
    readEvidence: (selection) =>
      savedEvidence(fieldbookStore.view?.draft, selection),
    savePlace: (selection, evidence) =>
      persist(() => fieldbook.capturePlace(selection, evidence)),
    addNote: (selection, note) =>
      persist(() => fieldbook.addPlaceNote(selection, note)),
    openWorkspace: (id) => {
      if (id === 'plan') onPlanPlace();
      workspace.chooseDestination(id);
    },
    focusSelection: focusPlace,
    onSelection: (_selection, { reveal }) => {
      if (!reveal || destroyed) return;
      workspace.destination = 'explore';
      if (workspace.sheetSize === 'collapsed') workspace.setSheetSize('half');
      workspace.act('openPanel', 'lens-panel');
    },
  });
  lens.init();
  return {
    ready,
    lens,
    fieldbook,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      lens.destroy();
      fieldbook.destroy();
    },
  };
}
