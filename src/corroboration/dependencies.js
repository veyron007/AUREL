/**
 * Source dependency graph for corroboration.
 *
 * Two answers only corroborate each other when they do not share an input.
 * Edges that MERGE sources (relays, feeds, shares-feeders) put them in one
 * dependency group, so a shared feeder is counted once. Informational edges
 * (shares-stations, same-distributor, same-algorithm) are reported on the
 * card but do not merge, because the observations themselves are separate.
 *
 * Certainty:
 *   known     documented behaviour of the service (e.g. EMSC relaying a
 *             USGS-authored row is detected per row from its author field)
 *   declared  this installation's own configuration, stated by the owner
 *             (the local receiver feeds adsb.lol); not detected at runtime
 *   possible  plausible but unmeasured overlap (volunteer receivers often
 *             feed several aggregators); merges in the cautious count only
 */
export const MERGING_RELATIONS = Object.freeze([
  'relays',
  'feeds',
  'shares-feeders',
]);

export const SOURCE_NODES = Object.freeze({
  usgs: 'USGS',
  emsc: 'EMSC',
  geofon: 'GFZ GEOFON',
  'firms-viirs-noaa20': 'VIIRS NOAA-20',
  'firms-viirs-noaa21': 'VIIRS NOAA-21',
  'firms-viirs-snpp': 'VIIRS Suomi NPP',
  'firms-modis-terra': 'MODIS Terra',
  'firms-modis-aqua': 'MODIS Aqua',
  'local-receiver': 'Local receiver',
  'adsb-lol': 'adsb.lol',
  'adsb-fi': 'adsb.fi',
  opensky: 'OpenSky Network',
});

const FIRMS_NODES = Object.keys(SOURCE_NODES).filter((id) =>
  id.startsWith('firms-'),
);
const pairs = (ids) =>
  ids.flatMap((a, index) => ids.slice(index + 1).map((b) => [a, b]));

/**
 * The static graph. Edges are undirected for grouping; `from`/`to` keep the
 * direction for the wording ("EMSC relays USGS").
 */
export const SOURCE_EDGES = Object.freeze([
  // Catalogues: separate solutions from overlapping public station networks.
  ...pairs(['usgs', 'emsc', 'geofon']).map(([from, to]) => ({
    from,
    to,
    relation: 'shares-stations',
    certainty: 'possible',
  })),
  // Fire detections: one distributor, two instrument families.
  ...pairs(FIRMS_NODES).map(([from, to]) => ({
    from,
    to,
    relation: 'same-distributor',
    certainty: 'known',
  })),
  // Aircraft: the owner's receiver feeds adsb.lol; aggregators can share
  // volunteer receivers, and the overlap is not published.
  {
    from: 'local-receiver',
    to: 'adsb-lol',
    relation: 'feeds',
    certainty: 'declared',
  },
  {
    from: 'local-receiver',
    to: 'adsb-fi',
    relation: 'feeds',
    certainty: 'possible',
  },
  ...pairs(['adsb-lol', 'adsb-fi', 'opensky']).map(([from, to]) => ({
    from,
    to,
    relation: 'shares-feeders',
    certainty: 'possible',
  })),
]);

const merges = (edge, cautious) =>
  MERGING_RELATIONS.includes(edge.relation) &&
  (cautious || edge.certainty !== 'possible');

function groupsOf(ids, edges, cautious) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  for (const edge of edges) {
    if (
      !parent.has(edge.from) ||
      !parent.has(edge.to) ||
      !merges(edge, cautious)
    )
      continue;
    const a = find(edge.from);
    const b = find(edge.to);
    if (a !== b) parent.set(b, a);
  }
  const groups = new Map();
  for (const id of ids) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) || []), id]);
  }
  return [...groups.values()];
}

/**
 * Independence of a set of source nodes under the static graph plus any
 * per-selection edges (e.g. an EMSC row authored by USGS).
 *
 * @param {string[]} ids Source node ids taking part.
 * @param {Array<object>} [extraEdges]
 * @returns {{groups: string[][], cautiousGroups: string[][],
 *   maxIndependent: number, minIndependent: number, edges: Array<object>}}
 *   `maxIndependent` merges only known and declared links; `minIndependent`
 *   also merges possible ones. Both are reported; neither is a vote.
 */
export function analyseDependencies(ids, extraEdges = []) {
  const unique = [...new Set(ids)];
  const edges = [...SOURCE_EDGES, ...extraEdges].filter(
    (edge) => unique.includes(edge.from) && unique.includes(edge.to),
  );
  const groups = groupsOf(unique, edges, false);
  const cautiousGroups = groupsOf(unique, edges, true);
  return {
    groups,
    cautiousGroups,
    maxIndependent: groups.length,
    minIndependent: cautiousGroups.length,
    edges,
  };
}

/** Whether two nodes fall in one dependency group (known/declared links). */
export function sameGroup(analysis, a, b) {
  return analysis.groups.some(
    (group) => group.includes(a) && group.includes(b),
  );
}

/** Whether two nodes are linked only through possible links. */
export function possiblyShared(analysis, a, b) {
  return (
    !sameGroup(analysis, a, b) &&
    analysis.cautiousGroups.some(
      (group) => group.includes(a) && group.includes(b),
    )
  );
}
