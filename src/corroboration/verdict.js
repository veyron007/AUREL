import {
  analyseDependencies,
  possiblyShared,
  sameGroup,
} from './dependencies.js';
import { finite } from './geo.js';

/**
 * The two statements every corroboration card carries, whatever its status.
 * Codes are translated by the view.
 */
export const STANDARD_WORDING = Object.freeze([
  'disagreement-normal',
  'agreement-not-truth',
]);

export const CARD_STATUSES = Object.freeze([
  'agree',
  'disagree',
  'single-source',
  'unavailable',
]);

const QUANTITY_CLASSES = new Set([
  'observed',
  'modelled',
  'derived',
  'simulated',
  'note',
]);

/**
 * One number with its provenance: source, unit, applicable time and class.
 * Non-finite values are kept as null ("unknown"), never as zero.
 */
export function quantity({ id, value, unit, cls, source, at = null }) {
  return {
    id,
    value: finite(value) ? value : null,
    unit,
    class: QUANTITY_CLASSES.has(cls) ? cls : 'note',
    source,
    at: finite(at) ? at : null,
  };
}

const ANSWERED = new Set(['ok', 'empty', 'partial', 'stale', 'loaded']);

/**
 * Assemble a card from one primary and its comparisons.
 *
 * @param {object} input
 * @param {'quake'|'fire'|'aircraft'} input.kind
 * @param {{nodeId: string, label: string, quantities?: Array}} input.primary
 * @param {Array<{nodeId: string, label: string, state: string,
 *   reason?: string|null, match: ?{agree: boolean, quantities: Array,
 *   notes?: string[]}, notes?: string[]}>} input.comparisons
 * @param {Array<object>} [input.extraEdges] Per-selection dependency edges.
 * @param {Array<string>} [input.notes] Card-level note codes.
 */
export function assembleCard({
  kind,
  primary,
  comparisons,
  extraEdges = [],
  notes = [],
  checkedAt = null,
}) {
  const analysis = analyseDependencies(
    [primary.nodeId, ...comparisons.map((row) => row.nodeId)],
    extraEdges,
  );
  const rows = comparisons.map((row) => {
    const dependent = sameGroup(analysis, primary.nodeId, row.nodeId);
    return {
      nodeId: row.nodeId,
      label: row.label,
      state: row.state,
      reason: row.reason ?? null,
      matched: Boolean(row.match),
      agree: row.match ? Boolean(row.match.agree) : null,
      role: dependent ? 'dependent' : 'independent',
      possiblyShared: possiblyShared(analysis, primary.nodeId, row.nodeId),
      quantities: row.match?.quantities ?? [],
      notes: [...(row.notes ?? []), ...(row.match?.notes ?? [])],
    };
  });
  const answered = rows.filter((row) => ANSWERED.has(row.state));
  const independent = rows.filter(
    (row) => row.matched && row.role === 'independent',
  );
  const independentGroups = analysis.groups.filter(
    (group) =>
      !group.includes(primary.nodeId) &&
      group.some((id) => independent.some((row) => row.nodeId === id)),
  ).length;
  const status = !answered.length
    ? 'unavailable'
    : !independent.length
      ? 'single-source'
      : independent.some((row) => !row.agree)
        ? 'disagree'
        : 'agree';
  return {
    kind,
    status,
    primary: {
      nodeId: primary.nodeId,
      label: primary.label,
      quantities: primary.quantities ?? [],
    },
    rows,
    dependency: {
      independentCorroborators: independentGroups,
      maxIndependent: analysis.maxIndependent,
      minIndependent: analysis.minIndependent,
      edges: analysis.edges.map(({ from, to, relation, certainty }) => ({
        from,
        to,
        relation,
        certainty,
      })),
    },
    notes: [...notes],
    wording: [...STANDARD_WORDING],
    checkedAt: finite(checkedAt) ? checkedAt : null,
  };
}
