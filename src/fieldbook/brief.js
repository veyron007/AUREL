/** Deterministic saved-evidence projection. No inference, provider calls or model. */
import { validateFieldbook } from './document.js';

export function buildFieldbookBrief(project) {
  validateFieldbook(project);
  const evidenceFor = (subjectId) =>
    project.evidence
      .filter((entry) => entry.subjectId === subjectId)
      .map((entry) => ({
        id: entry.id,
        sourceLabel: entry.sourceLabel,
        kind: entry.kind,
        applicableTime: entry.applicableTime,
        retrievedAt: entry.retrievedAt,
        coverage: entry.coverage,
        feedState: entry.feedState,
        resolutionM: entry.resolutionM,
        uncertainty: entry.uncertainty,
        attribution: entry.attribution,
        link: entry.link,
      }));
  return {
    title: project.title,
    updatedAt: project.updatedAt,
    places: project.places.map((place) => ({
      id: place.id,
      name: place.name,
      coordinates: [...place.geometry.coordinates],
      notes: project.notes
        .filter((note) => note.subjectId === place.id)
        .map((note) => note.text),
      evidence: evidenceFor(place.id),
    })),
    notes: project.notes
      .filter((note) => note.subjectId === project.id)
      .map((note) => note.text),
    evidence: evidenceFor(project.id),
    analyses: project.analyses.map((entry) => ({
      id: entry.id,
      subjectId: entry.subjectId,
      kind: entry.kind,
      createdAt: entry.createdAt,
      snapshot: JSON.parse(JSON.stringify(entry.snapshot)),
    })),
    comparisons: project.comparisons.map((entry) => ({
      id: entry.id,
      subjectId: entry.subjectId,
      createdAt: entry.createdAt,
      snapshot: JSON.parse(JSON.stringify(entry.snapshot)),
      notes: project.changeNotes
        .filter((note) => note.comparisonId === entry.id)
        .map((note) => JSON.parse(JSON.stringify(note))),
    })),
    counts: {
      places: project.places.length,
      notes: project.notes.length,
      evidence: project.evidence.length,
      routes: project.routes.length,
      drawings: project.drawings.length,
      attachments: project.attachments.length,
      scenes: project.sceneDocuments.length,
      analyses: project.analyses.length,
      comparisons: project.comparisons.length,
      changeNotes: project.changeNotes.length,
    },
    unknownEvidenceCount: project.evidence.filter(
      (entry) =>
        entry.kind === 'unknown' ||
        entry.coverage === 'unknown' ||
        entry.applicableTime === null,
    ).length,
  };
}
