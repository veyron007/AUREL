/**
 * The legend `render_view` draws under its picture and returns as data: one
 * row per visible layer with its class and its timestamp, plus the base map.
 * A frame can contain simulated traffic next to observed earthquakes, so no
 * row is ever left without a class; a layer whose class is not recorded says
 * "class not recorded" instead of borrowing one.
 *
 * The timestamp is the layer's last refresh in this app (`lastUpdate`), not
 * the observation time of each feature; the legend says so.
 *
 * Portable: no DOM.
 */

import { layerSnapshot } from '../data/layerSnapshot.js';

export const UNCLASSIFIED = 'unclassified';

/** Class of each data-layer ID the app registers (src/data/layerState.js). */
export const LAYER_CLASSES = Object.freeze({
  'air-quality': 'observed',
  'ais-live-vessels': 'observed',
  'alpr-cameras': 'observed',
  'bhote-koshi-2026': 'observed',
  'bhote-koshi-locator': 'note',
  bikeshare: 'observed',
  cctv: 'observed',
  directions: 'derived',
  'drone-airspace': 'note',
  earthquakes: 'observed',
  'fire-perimeters': 'observed',
  flights: 'observed',
  'gnss-integrity': 'derived',
  'local-dams': 'observed',
  'local-datacenters': 'observed',
  'local-firms': 'observed',
  military: 'observed',
  'military-awareness': 'derived',
  'military-installations': 'observed',
  radio: 'observed',
  'recent-imagery': 'observed',
  'rocket-launches': 'observed',
  's2-ghostmaps': 'note',
  satellites: 'modelled',
  'sea-marks': 'observed',
  'ski-pistes': 'observed',
  'street-level': 'observed',
  'telegeography-submarine-cables': 'observed',
  traffic: 'simulated',
  transit: 'observed',
  'weather-cyclones': 'modelled',
  'weather-lightning': 'observed',
  'weather-radar': 'observed',
  'weather-satellite': 'observed',
  'wildlife-sightings': 'observed',
  wind: 'modelled',
});

/** Traffic is simulated unless its source says it is TomTom flow. */
function classOf(snapshot) {
  if (snapshot.id === 'traffic')
    return /tomtom/i.test(snapshot.source ?? '') &&
      snapshot.feedState === 'nominal'
      ? 'observed'
      : 'simulated';
  return LAYER_CLASSES[snapshot.id] ?? UNCLASSIFIED;
}

/**
 * Legend rows for the enabled layers of `DataLayerManager.getAll()`, and the
 * base map when its label is known.
 * @param {Array<object>} layers
 * @param {{ now?: number, baseMap?: { label?: string, capturedAt?: string|null } | null }} [options]
 */
export function buildViewLegend(
  layers = [],
  { now = Date.now(), baseMap = null } = {},
) {
  const rows = (Array.isArray(layers) ? layers : [])
    .filter((layer) => layer?.enabled)
    .map((layer) => layerSnapshot(layer, { now }))
    .map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name ?? snapshot.id,
      class: classOf(snapshot),
      updated_at: snapshot.lastUpdate
        ? new Date(snapshot.lastUpdate).toISOString()
        : null,
      feed_state: snapshot.feedState,
      source: snapshot.source,
      count: snapshot.count,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (baseMap?.label)
    rows.unshift({
      id: 'base-map',
      name: baseMap.label,
      class: 'observed',
      updated_at: baseMap.capturedAt ?? null,
      feed_state: 'nominal',
      source: baseMap.label,
      count: null,
    });
  return rows;
}

/** One printable line per legend row. */
export function legendLines(rows) {
  return rows.map((row) => {
    const cls = row.class === UNCLASSIFIED ? 'class not recorded' : row.class;
    const when = row.updated_at
      ? `updated ${row.updated_at.slice(0, 16).replace('T', ' ')}Z`
      : 'time unknown';
    const state =
      row.feed_state && !['nominal', 'off'].includes(row.feed_state)
        ? ` · ${row.feed_state}`
        : '';
    return `${row.name} — ${cls} · ${when}${state}`;
  });
}

/** The footnote the PNG and the data both carry. */
export const LEGEND_FOOTNOTE =
  'Times are each layer’s last refresh in AUREL, not each feature’s observation time.';

/** Whether every row has a class and a timestamp field (possibly null). */
export function isCompleteLegend(rows) {
  return rows.every(
    (row) =>
      typeof row.class === 'string' &&
      row.class.length > 0 &&
      Object.hasOwn(row, 'updated_at'),
  );
}
