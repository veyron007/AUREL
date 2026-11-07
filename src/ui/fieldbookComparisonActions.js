import {
  captureComparison,
  appendChangeNote,
  findChangeNote,
} from '../fieldbook/comparisonOperations.js';

/** Complete the edit before a single revisioned save; failed writes keep the draft. */
export async function saveFieldbookComparison(owner, subject, snapshot) {
  if (!owner._available()) return false;
  owner._ensureProject();
  let result;
  const edited = owner._edit((project) => {
    result = captureComparison(project, subject, snapshot);
    return result.project;
  });
  if (!edited || !(await owner.save())) return false;
  return { projectId: result.project.id, comparisonId: result.comparisonId };
}
export async function saveFieldbookChangeNote(owner, comparisonId, input) {
  if (!owner._available() || !owner._draft) return false;
  let note;
  const edited = owner._edit((project) => {
    const next = appendChangeNote(project, comparisonId, input);
    note = findChangeNote(next, comparisonId, input);
    return next;
  });
  if (!edited || !(await owner.save())) return false;
  return JSON.parse(JSON.stringify(note));
}
export function openFieldbookComparison(owner, comparisonId) {
  if (!owner._live() || !owner._onOpenComparison) return false;
  const project = owner._draft,
    comparison = project?.comparisons.find(
      (entry) => entry.id === comparisonId,
    );
  if (!comparison) return false;
  const subject = project.places.find(
    (entry) => entry.id === comparison.subjectId,
  );
  owner._onOpenComparison(
    JSON.parse(
      JSON.stringify({
        id: comparison.id,
        projectId: project.id,
        snapshot: comparison.snapshot,
        notes: project.changeNotes.filter(
          (entry) => entry.comparisonId === comparison.id,
        ),
        subject,
      }),
    ),
  );
  return true;
}
